package platform

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

func collectRows(ctx context.Context, tx pgx.Tx, query string, scan func(pgx.Rows) error) error {
	rows, err := tx.Query(ctx, query)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err = scan(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}

// Every entity is loaded from its authoritative normalized table in one MVCC
// snapshot. The callback adapter remains intentionally broad until handlers are
// converted to domain-specific SQL repositories; it never reads the legacy blob.
func loadNormalized(ctx context.Context, tx pgx.Tx) (*State, error) {
	s := NewState()
	if err := collectRows(ctx, tx, `SELECT id,handle,name,email,avatar,bio,role,status,created_at,password_hash FROM gongming_users`, func(r pgx.Rows) error {
		var a Account
		u := &a.User
		if err := r.Scan(&u.ID, &u.Handle, &u.Name, &u.Email, &u.Avatar, &u.Bio, &u.Role, &u.Status, &u.CreatedAt, &a.PasswordHash); err != nil {
			return err
		}
		s.Accounts[u.ID] = a
		return nil
	}); err != nil {
		return nil, err
	}
	if err := collectRows(ctx, tx, `SELECT token_hash,user_id,expires_at FROM gongming_sessions`, func(r pgx.Rows) error {
		var key string
		var v Session
		if err := r.Scan(&key, &v.UserID, &v.ExpiresAt); err != nil {
			return err
		}
		s.Sessions[key] = v
		return nil
	}); err != nil {
		return nil, err
	}
	if err := collectRows(ctx, tx, `SELECT id,author_id,body,images,topic,status,created_at FROM gongming_posts`, func(r pgx.Rows) error {
		var v StoredPost
		if err := r.Scan(&v.ID, &v.AuthorID, &v.Body, &v.Images, &v.Topic, &v.Status, &v.CreatedAt); err != nil {
			return err
		}
		v.Likes = map[string]bool{}
		s.Posts[v.ID] = v
		return nil
	}); err != nil {
		return nil, err
	}
	if err := collectRows(ctx, tx, `SELECT post_id,user_id FROM gongming_post_likes`, func(r pgx.Rows) error {
		var postID, userID string
		if err := r.Scan(&postID, &userID); err != nil {
			return err
		}
		v := s.Posts[postID]
		v.Likes[userID] = true
		s.Posts[postID] = v
		return nil
	}); err != nil {
		return nil, err
	}
	if err := collectRows(ctx, tx, `SELECT id,post_id,author_id,body,created_at FROM gongming_comments`, func(r pgx.Rows) error {
		var v StoredComment
		if err := r.Scan(&v.ID, &v.PostID, &v.AuthorID, &v.Body, &v.CreatedAt); err != nil {
			return err
		}
		s.Comments[v.ID] = v
		return nil
	}); err != nil {
		return nil, err
	}
	if err := collectRows(ctx, tx, `SELECT id,title,kind,owner_id,created_at FROM gongming_conversations`, func(r pgx.Rows) error {
		var v StoredConversation
		if err := r.Scan(&v.ID, &v.Title, &v.Kind, &v.OwnerID, &v.CreatedAt); err != nil {
			return err
		}
		v.Members = []string{}
		s.Conversations[v.ID] = v
		return nil
	}); err != nil {
		return nil, err
	}
	if err := collectRows(ctx, tx, `SELECT conversation_id,user_id FROM gongming_conversation_members ORDER BY conversation_id,position`, func(r pgx.Rows) error {
		var id, user string
		if err := r.Scan(&id, &user); err != nil {
			return err
		}
		v := s.Conversations[id]
		v.Members = append(v.Members, user)
		s.Conversations[id] = v
		return nil
	}); err != nil {
		return nil, err
	}
	if err := collectRows(ctx, tx, `SELECT id,conversation_id,sender_id,body,created_at,seq,COALESCE(client_id,'') FROM gongming_messages`, func(r pgx.Rows) error {
		var v StoredMessage
		if err := r.Scan(&v.ID, &v.ConversationID, &v.SenderID, &v.Body, &v.CreatedAt, &v.Seq, &v.ClientID); err != nil {
			return err
		}
		s.Messages[v.ID] = v
		return nil
	}); err != nil {
		return nil, err
	}
	if err := collectRows(ctx, tx, `SELECT user_id,key,value,revision,updated_at FROM gongming_documents`, func(r pgx.Rows) error {
		var id string
		var v Document
		if err := r.Scan(&id, &v.Key, &v.Value, &v.Revision, &v.UpdatedAt); err != nil {
			return err
		}
		if s.Documents[id] == nil {
			s.Documents[id] = map[string]Document{}
		}
		s.Documents[id][v.Key] = v
		return nil
	}); err != nil {
		return nil, err
	}
	if err := collectRows(ctx, tx, `SELECT id,reporter_id,target_type,target_id,reason,status,note,created_at FROM gongming_reports`, func(r pgx.Rows) error {
		var v Report
		if err := r.Scan(&v.ID, &v.ReporterID, &v.TargetType, &v.TargetID, &v.Reason, &v.Status, &v.Note, &v.CreatedAt); err != nil {
			return err
		}
		s.Reports[v.ID] = v
		return nil
	}); err != nil {
		return nil, err
	}
	if err := collectRows(ctx, tx, `SELECT id,COALESCE(actor_id,''),actor_name,action,target_id,detail,created_at FROM gongming_audits ORDER BY position`, func(r pgx.Rows) error {
		var v Audit
		if err := r.Scan(&v.ID, &v.ActorID, &v.ActorName, &v.Action, &v.TargetID, &v.Detail, &v.CreatedAt); err != nil {
			return err
		}
		s.Audits = append(s.Audits, v)
		return nil
	}); err != nil {
		return nil, err
	}
	if err := collectRows(ctx, tx, `SELECT user_id,balance,address,last_faucet FROM gongming_wallets`, func(r pgx.Rows) error {
		var id string
		var v StoredWallet
		var last *time.Time
		if err := r.Scan(&id, &v.Balance, &v.Address, &last); err != nil {
			return err
		}
		if last != nil {
			v.LastFaucet = *last
		}
		v.Transactions = []LedgerEntry{}
		s.Wallets[id] = v
		return nil
	}); err != nil {
		return nil, err
	}
	if err := collectRows(ctx, tx, `SELECT wallet_user_id,entry_id,kind,amount,symbol,counterparty,request_id,created_at FROM gongming_ledger ORDER BY wallet_user_id,position`, func(r pgx.Rows) error {
		var id string
		var amount int64
		var v LedgerEntry
		if err := r.Scan(&id, &v.ID, &v.Kind, &amount, &v.Symbol, &v.Counterparty, &v.RequestID, &v.CreatedAt); err != nil {
			return err
		}
		v.Amount = strconv.FormatInt(amount, 10)
		wallet := s.Wallets[id]
		wallet.Transactions = append(wallet.Transactions, v)
		s.Wallets[id] = wallet
		return nil
	}); err != nil {
		return nil, err
	}
	if err := collectRows(ctx, tx, `SELECT user_id,request_id,fingerprint,result FROM gongming_wallet_requests`, func(r pgx.Rows) error {
		var user, request string
		var v Idempotency
		var raw []byte
		if err := r.Scan(&user, &request, &v.Fingerprint, &raw); err != nil {
			return err
		}
		if err := json.Unmarshal(raw, &v.Result); err != nil {
			return err
		}
		s.Idempotency[user+":"+request] = v
		return nil
	}); err != nil {
		return nil, err
	}
	if err := loadMessagingNormalized(ctx, tx, s); err != nil {
		return nil, err
	}
	return s, nil
}

func loadMessagingNormalized(ctx context.Context, tx pgx.Tx, s *State) error {
	if s.Reads == nil {
		s.Reads = map[string]ConversationRead{}
	}
	if err := collectRows(ctx, tx, `SELECT conversation_id,user_id,COALESCE(message_id,''),seq,updated_at FROM gongming_conversation_reads`, func(r pgx.Rows) error {
		var v ConversationRead
		if err := r.Scan(&v.ConversationID, &v.UserID, &v.MessageID, &v.Seq, &v.UpdatedAt); err != nil {
			return err
		}
		s.Reads[v.ConversationID+":"+v.UserID] = v
		return nil
	}); err != nil {
		return err
	}
	if err := collectRows(ctx, tx, `SELECT id,seq,type,conversation_id,COALESCE(message_id,''),COALESCE(recipient_id,''),created_at FROM gongming_message_outbox ORDER BY seq`, func(r pgx.Rows) error {
		var v MessageEvent
		if err := r.Scan(&v.ID, &v.Seq, &v.Type, &v.ConversationID, &v.MessageID, &v.RecipientID, &v.CreatedAt); err != nil {
			return err
		}
		s.Outbox = append(s.Outbox, v)
		return nil
	}); err != nil {
		return err
	}
	return tx.QueryRow(ctx, `SELECT value FROM gongming_sequences WHERE name='message_events'`).Scan(&s.EventSequence)
}
