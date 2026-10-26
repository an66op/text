package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func entityEqual(a, b any) bool {
	left, e1 := json.Marshal(a)
	right, e2 := json.Marshal(b)
	return e1 == nil && e2 == nil && bytes.Equal(left, right)
}
func mapKeys[T any](values map[string]T) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
func syncEntities[T any](before, after map[string]T, upsert func(string, T) error, remove func(string) error) error {
	for _, key := range mapKeys(after) {
		value := after[key]
		if previous, exists := before[key]; exists && entityEqual(previous, value) {
			continue
		}
		if err := upsert(key, value); err != nil {
			return err
		}
	}
	for _, key := range mapKeys(before) {
		if _, exists := after[key]; !exists {
			if err := remove(key); err != nil {
				return err
			}
		}
	}
	return nil
}
func execRow(ctx context.Context, tx pgx.Tx, sql string, args ...any) error {
	_, err := tx.Exec(ctx, sql, args...)
	return err
}
func removeID(ctx context.Context, tx pgx.Tx, table, id string) error {
	return execRow(ctx, tx, "DELETE FROM "+table+" WHERE id=$1", id)
}
func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func nullTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
}

// Persist only changed entities. The State callback is a compatibility adapter,
// not a storage format; no global state row is locked, rewritten, or consulted.
func persistNormalized(ctx context.Context, tx pgx.Tx, before, after *State) error {
	if err := syncEntities(before.Accounts, after.Accounts, func(_ string, a Account) error {
		u := a.User
		return execRow(ctx, tx, `INSERT INTO gongming_users(id,handle,name,email,avatar,bio,role,status,password_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET handle=EXCLUDED.handle,name=EXCLUDED.name,email=EXCLUDED.email,avatar=EXCLUDED.avatar,bio=EXCLUDED.bio,role=EXCLUDED.role,status=EXCLUDED.status,password_hash=EXCLUDED.password_hash,created_at=EXCLUDED.created_at`, u.ID, u.Handle, u.Name, u.Email, u.Avatar, u.Bio, u.Role, u.Status, a.PasswordHash, u.CreatedAt)
	}, func(id string) error { return removeID(ctx, tx, "gongming_users", id) }); err != nil {
		return err
	}
	if err := syncEntities(before.Sessions, after.Sessions, func(key string, v Session) error {
		return execRow(ctx, tx, `INSERT INTO gongming_sessions(token_hash,user_id,expires_at,public_id,device,created_at,last_seen_at,legacy) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(token_hash) DO UPDATE SET user_id=EXCLUDED.user_id,expires_at=EXCLUDED.expires_at,public_id=EXCLUDED.public_id,device=EXCLUDED.device,created_at=EXCLUDED.created_at,last_seen_at=EXCLUDED.last_seen_at,legacy=EXCLUDED.legacy`, key, v.UserID, v.ExpiresAt, v.ID, v.Device, v.CreatedAt, v.LastSeenAt, v.Legacy)
	}, func(key string) error {
		return execRow(ctx, tx, `DELETE FROM gongming_sessions WHERE token_hash=$1`, key)
	}); err != nil {
		return err
	}
	if err := persistMedia(ctx, tx, before, after); err != nil {
		return err
	}
	if err := syncEntities(before.Posts, after.Posts, func(id string, v StoredPost) error {
		old := before.Posts[id]
		old.Likes = nil
		plain := v
		plain.Likes = nil
		if !entityEqual(old, plain) {
			images := v.Images
			if images == nil {
				images = []string{}
			}
			if err := execRow(ctx, tx, `INSERT INTO gongming_posts(id,author_id,body,images,topic,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET author_id=EXCLUDED.author_id,body=EXCLUDED.body,images=EXCLUDED.images,topic=EXCLUDED.topic,status=EXCLUDED.status,created_at=EXCLUDED.created_at`, v.ID, v.AuthorID, v.Body, images, v.Topic, v.Status, v.CreatedAt); err != nil {
				return err
			}
		}
		for _, user := range mapKeys(v.Likes) {
			if v.Likes[user] && !before.Posts[id].Likes[user] {
				if err := execRow(ctx, tx, `INSERT INTO gongming_post_likes(post_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, id, user); err != nil {
					return err
				}
			}
		}
		for _, user := range mapKeys(before.Posts[id].Likes) {
			if before.Posts[id].Likes[user] && !v.Likes[user] {
				if err := execRow(ctx, tx, `DELETE FROM gongming_post_likes WHERE post_id=$1 AND user_id=$2`, id, user); err != nil {
					return err
				}
			}
		}
		return nil
	}, func(id string) error { return removeID(ctx, tx, "gongming_posts", id) }); err != nil {
		return err
	}
	if err := syncEntities(before.Comments, after.Comments, func(_ string, v StoredComment) error {
		return execRow(ctx, tx, `INSERT INTO gongming_comments(id,post_id,author_id,body,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET post_id=EXCLUDED.post_id,author_id=EXCLUDED.author_id,body=EXCLUDED.body,created_at=EXCLUDED.created_at`, v.ID, v.PostID, v.AuthorID, v.Body, v.CreatedAt)
	}, func(id string) error { return removeID(ctx, tx, "gongming_comments", id) }); err != nil {
		return err
	}
	if err := syncEntities(before.Conversations, after.Conversations, func(id string, v StoredConversation) error {
		old := before.Conversations[id]
		old.Members = nil
		plain := v
		plain.Members = nil
		if !entityEqual(old, plain) {
			if err := execRow(ctx, tx, `INSERT INTO gongming_conversations(id,title,kind,owner_id,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,kind=EXCLUDED.kind,owner_id=EXCLUDED.owner_id,created_at=EXCLUDED.created_at`, v.ID, v.Title, v.Kind, v.OwnerID, v.CreatedAt); err != nil {
				return err
			}
		}
		oldMembers := map[string]int{}
		for i, user := range before.Conversations[id].Members {
			oldMembers[user] = i
		}
		newMembers := map[string]int{}
		for i, user := range v.Members {
			if _, duplicate := newMembers[user]; duplicate {
				return fmt.Errorf("duplicate conversation member")
			}
			newMembers[user] = i
			if pos, exists := oldMembers[user]; !exists || pos != i {
				if err := execRow(ctx, tx, `INSERT INTO gongming_conversation_members(conversation_id,user_id,position) VALUES($1,$2,$3) ON CONFLICT(conversation_id,user_id) DO UPDATE SET position=EXCLUDED.position`, id, user, i); err != nil {
					return err
				}
			}
		}
		for _, user := range mapKeys(oldMembers) {
			if _, exists := newMembers[user]; !exists {
				if err := execRow(ctx, tx, `DELETE FROM gongming_conversation_members WHERE conversation_id=$1 AND user_id=$2`, id, user); err != nil {
					return err
				}
			}
		}
		return nil
	}, func(id string) error { return removeID(ctx, tx, "gongming_conversations", id) }); err != nil {
		return err
	}
	if err := syncEntities(before.Messages, after.Messages, func(_ string, v StoredMessage) error {
		return execRow(ctx, tx, `INSERT INTO gongming_messages(id,conversation_id,sender_id,body,created_at,seq,client_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET conversation_id=EXCLUDED.conversation_id,sender_id=EXCLUDED.sender_id,body=EXCLUDED.body,created_at=EXCLUDED.created_at,seq=EXCLUDED.seq,client_id=EXCLUDED.client_id`, v.ID, v.ConversationID, v.SenderID, v.Body, v.CreatedAt, v.Seq, nullString(v.ClientID))
	}, func(id string) error { return removeID(ctx, tx, "gongming_messages", id) }); err != nil {
		return err
	}
	if err := persistDocuments(ctx, tx, before, after); err != nil {
		return err
	}
	if err := persistPostMedia(ctx, tx, before, after); err != nil {
		return err
	}
	if err := syncEntities(before.Reports, after.Reports, func(_ string, v Report) error {
		return execRow(ctx, tx, `INSERT INTO gongming_reports(id,reporter_id,target_type,target_id,reason,status,note,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET reporter_id=EXCLUDED.reporter_id,target_type=EXCLUDED.target_type,target_id=EXCLUDED.target_id,reason=EXCLUDED.reason,status=EXCLUDED.status,note=EXCLUDED.note,created_at=EXCLUDED.created_at`, v.ID, v.ReporterID, v.TargetType, v.TargetID, v.Reason, v.Status, v.Note, v.CreatedAt)
	}, func(id string) error { return removeID(ctx, tx, "gongming_reports", id) }); err != nil {
		return err
	}
	auditsBefore := map[string]Audit{}
	auditsAfter := map[string]Audit{}
	for _, v := range before.Audits {
		auditsBefore[v.ID] = v
	}
	for _, v := range after.Audits {
		if _, exists := auditsAfter[v.ID]; exists {
			return fmt.Errorf("duplicate audit id")
		}
		auditsAfter[v.ID] = v
	}
	for id, old := range auditsBefore {
		if next, exists := auditsAfter[id]; !exists || !entityEqual(old, next) {
			return fmt.Errorf("audit records are immutable")
		}
	}
	for _, v := range after.Audits {
		if _, exists := auditsBefore[v.ID]; !exists {
			if err := execRow(ctx, tx, `INSERT INTO gongming_audits(id,actor_id,actor_name,action,target_id,detail,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, v.ID, nullString(v.ActorID), v.ActorName, v.Action, v.TargetID, v.Detail, v.CreatedAt); err != nil {
				return err
			}
		}
	}
	if err := persistWallets(ctx, tx, before, after); err != nil {
		return err
	}
	if err := persistMessaging(ctx, tx, before, after); err != nil {
		return err
	}
	if err := persistFriendships(ctx, tx, before, after); err != nil {
		return err
	}
	return persistCircles(ctx, tx, before, after)
}

func flattenDocuments(s *State) map[string]Document {
	result := map[string]Document{}
	for user, documents := range s.Documents {
		for key, doc := range documents {
			result[user+"\x00"+key] = doc
		}
	}
	return result
}
func persistDocuments(ctx context.Context, tx pgx.Tx, before, after *State) error {
	return syncEntities(flattenDocuments(before), flattenDocuments(after), func(key string, v Document) error {
		user, _, _ := strings.Cut(key, "\x00")
		return execRow(ctx, tx, `INSERT INTO gongming_documents(user_id,key,value,revision,updated_at) VALUES($1,$2,$3::jsonb,$4,$5) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value,revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at`, user, v.Key, string(v.Value), v.Revision, v.UpdatedAt)
	}, func(key string) error {
		user, name, _ := strings.Cut(key, "\x00")
		return execRow(ctx, tx, `DELETE FROM gongming_documents WHERE user_id=$1 AND key=$2`, user, name)
	})
}
func persistWallets(ctx context.Context, tx pgx.Tx, before, after *State) error {
	if err := syncEntities(before.Wallets, after.Wallets, func(user string, v StoredWallet) error {
		old := before.Wallets[user]
		if len(v.Transactions) < len(old.Transactions) || (len(old.Transactions) > 0 && !entityEqual(old.Transactions, v.Transactions[:len(old.Transactions)])) {
			return fmt.Errorf("ledger entries are immutable")
		}
		plain := v
		plain.Transactions = nil
		oldPlain := old
		oldPlain.Transactions = nil
		if !entityEqual(oldPlain, plain) {
			if err := execRow(ctx, tx, `INSERT INTO gongming_wallets(user_id,balance,address,last_faucet) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET balance=EXCLUDED.balance,address=EXCLUDED.address,last_faucet=EXCLUDED.last_faucet`, user, v.Balance, v.Address, nullTime(v.LastFaucet)); err != nil {
				return err
			}
		}
		for index := len(old.Transactions); index < len(v.Transactions); index++ {
			entry := v.Transactions[index]
			amount, err := strconv.ParseInt(entry.Amount, 10, 64)
			if err != nil {
				return fmt.Errorf("invalid ledger integer: %w", err)
			}
			if err = execRow(ctx, tx, `INSERT INTO gongming_ledger(wallet_user_id,entry_id,kind,amount,symbol,counterparty,request_id,created_at,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, user, entry.ID, entry.Kind, amount, entry.Symbol, entry.Counterparty, entry.RequestID, entry.CreatedAt, index); err != nil {
				return err
			}
		}
		return nil
	}, func(user string) error {
		if len(before.Wallets[user].Transactions) > 0 {
			return fmt.Errorf("cannot delete wallet with ledger history")
		}
		return execRow(ctx, tx, `DELETE FROM gongming_wallets WHERE user_id=$1`, user)
	}); err != nil {
		return err
	}
	return syncEntities(before.Idempotency, after.Idempotency, func(key string, v Idempotency) error {
		if _, exists := before.Idempotency[key]; exists {
			return fmt.Errorf("wallet idempotency records are immutable")
		}
		user, request, ok := strings.Cut(key, ":")
		if !ok {
			return fmt.Errorf("invalid wallet request key")
		}
		raw, err := json.Marshal(v.Result)
		if err != nil {
			return err
		}
		return execRow(ctx, tx, `INSERT INTO gongming_wallet_requests(user_id,request_id,fingerprint,result) VALUES($1,$2,$3,$4::jsonb)`, user, request, v.Fingerprint, string(raw))
	}, func(string) error { return fmt.Errorf("wallet idempotency records are immutable") })
}
func persistMessaging(ctx context.Context, tx pgx.Tx, before, after *State) error {
	if err := syncEntities(before.Reads, after.Reads, func(_ string, v ConversationRead) error {
		return execRow(ctx, tx, `INSERT INTO gongming_conversation_reads(conversation_id,user_id,message_id,seq,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(conversation_id,user_id) DO UPDATE SET message_id=EXCLUDED.message_id,seq=EXCLUDED.seq,updated_at=EXCLUDED.updated_at`, v.ConversationID, v.UserID, nullString(v.MessageID), v.Seq, v.UpdatedAt)
	}, func(key string) error {
		v := before.Reads[key]
		return execRow(ctx, tx, `DELETE FROM gongming_conversation_reads WHERE conversation_id=$1 AND user_id=$2`, v.ConversationID, v.UserID)
	}); err != nil {
		return err
	}
	oldEvents := map[string]MessageEvent{}
	newEvents := map[string]MessageEvent{}
	for _, v := range before.Outbox {
		oldEvents[v.ID] = v
	}
	for _, v := range after.Outbox {
		if _, exists := newEvents[v.ID]; exists {
			return fmt.Errorf("duplicate event id")
		}
		newEvents[v.ID] = v
	}
	if err := syncEntities(oldEvents, newEvents, func(_ string, v MessageEvent) error {
		if _, exists := oldEvents[v.ID]; exists {
			return fmt.Errorf("outbox event payload is immutable")
		}
		return execRow(ctx, tx, `INSERT INTO gongming_message_outbox(id,seq,type,conversation_id,message_id,recipient_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, v.ID, v.Seq, v.Type, v.ConversationID, nullString(v.MessageID), nullString(v.RecipientID), v.CreatedAt)
	}, func(id string) error { return removeID(ctx, tx, "gongming_message_outbox", id) }); err != nil {
		return err
	}
	if after.EventSequence < before.EventSequence {
		return fmt.Errorf("event sequence cannot move backwards")
	}
	if after.EventSequence != before.EventSequence {
		return execRow(ctx, tx, `UPDATE gongming_sequences SET value=$1 WHERE name='message_events'`, after.EventSequence)
	}
	return nil
}
