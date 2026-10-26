package platform

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// ReadStream is the narrow SQL read path used by the WebSocket dispatcher. It
// does not hydrate accounts, posts, wallets, messages or the full State snapshot.
func (s *PostgresStore) ReadStream(ctx context.Context, requests []StreamRequest, limit int) (StreamSnapshot, error) {
	result := StreamSnapshot{Events: []MessageEvent{}, Sessions: map[string]StreamSession{}}
	if len(requests) == 0 {
		return result, nil
	}
	if limit < 1 {
		limit = 512
	}
	if limit > 2000 {
		limit = 2000
	}
	hashes := make([]string, 0, len(requests))
	expected := map[string]string{}
	browsers := map[string]string{}
	after := requests[0].AfterSeq
	for _, request := range requests {
		hashes = append(hashes, request.SessionHash)
		expected[request.SessionHash] = request.UserID
		browsers[request.SessionHash] = request.BrowserHash
		if request.AfterSeq < after {
			after = request.AfterSeq
		}
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT s.token_hash,s.user_id,s.expires_at,(u.status='active' AND s.expires_at>now()),COALESCE(s.browser_context_hash,''),COALESCE(b.current_session_hash,''),COALESCE(b.expires_at>now(),false) FROM gongming_sessions s JOIN gongming_users u ON u.id=s.user_id LEFT JOIN gongming_auth_browser_contexts b ON b.hash=s.browser_context_hash WHERE s.token_hash=ANY($1::text[])`, hashes)
	if err != nil {
		return result, err
	}
	users := []string{}
	for rows.Next() {
		var hash, source, current string
		var browserActive bool
		v := StreamSession{ConversationIDs: map[string]bool{}}
		if err = rows.Scan(&hash, &v.UserID, &v.ExpiresAt, &v.Active, &source, &current, &browserActive); err != nil {
			rows.Close()
			return result, err
		}
		if source != "" {
			v.Active = v.Active && source == browsers[hash] && current == hash && browserActive
		} else {
			v.Active = v.Active && browsers[hash] == ""
		}
		if expected[hash] != v.UserID {
			continue
		}
		result.Sessions[hash] = v
		if v.Active {
			users = append(users, v.UserID)
		}
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return result, err
	}
	if len(users) > 0 {
		members, err := tx.Query(ctx, `SELECT user_id,conversation_id FROM gongming_conversation_members WHERE user_id=ANY($1::text[])`, users)
		if err != nil {
			return result, err
		}
		byUser := map[string]map[string]bool{}
		for members.Next() {
			var user, conversation string
			if err = members.Scan(&user, &conversation); err != nil {
				members.Close()
				return result, err
			}
			if byUser[user] == nil {
				byUser[user] = map[string]bool{}
			}
			byUser[user][conversation] = true
		}
		members.Close()
		if err = members.Err(); err != nil {
			return result, err
		}
		for hash, v := range result.Sessions {
			if v.Active && byUser[v.UserID] != nil {
				v.ConversationIDs = byUser[v.UserID]
				result.Sessions[hash] = v
			}
		}
	}
	if err = tx.QueryRow(ctx, `SELECT COALESCE((SELECT min(seq) FROM gongming_message_outbox),0),(SELECT value FROM gongming_sequences WHERE name='message_events')`).Scan(&result.FirstSequence, &result.LatestSequence); err != nil {
		return result, err
	}
	if len(users) > 0 {
		events, err := tx.Query(ctx, `SELECT e.id,e.seq,e.type,COALESCE(e.conversation_id,''),COALESCE(e.message_id,''),COALESCE(e.recipient_id,''),e.created_at FROM gongming_message_outbox e WHERE e.seq>$1 AND ((e.type IN ('membership.revoked','contact.resync') AND e.recipient_id=ANY($2::text[])) OR (e.type NOT IN ('membership.revoked','contact.resync') AND EXISTS(SELECT 1 FROM gongming_conversation_members m WHERE m.conversation_id=e.conversation_id AND m.user_id=ANY($2::text[]) AND (e.recipient_id IS NULL OR e.recipient_id=m.user_id)))) ORDER BY e.seq LIMIT $3`, after, users, limit)
		if err != nil {
			return result, err
		}
		for events.Next() {
			var v MessageEvent
			if err = events.Scan(&v.ID, &v.Seq, &v.Type, &v.ConversationID, &v.MessageID, &v.RecipientID, &v.CreatedAt); err != nil {
				events.Close()
				return result, err
			}
			result.Events = append(result.Events, v)
		}
		events.Close()
		if err = events.Err(); err != nil {
			return result, err
		}
	}
	return result, tx.Commit(ctx)
}

// AuthorizeStream checks the latest committed session and membership at send
// time without loading messages or holding a transaction across a network write.
func (s *PostgresStore) AuthorizeStream(ctx context.Context, request StreamRequest, conversationID string) (bool, bool, error) {
	var valid, allowed bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gongming_sessions s JOIN gongming_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.user_id=$2 AND s.expires_at>now() AND u.status='active' AND `+browserSessionPredicate("s", "$4")+`), ($3='' OR EXISTS(SELECT 1 FROM gongming_conversation_members WHERE conversation_id=$3 AND user_id=$2))`, request.SessionHash, request.UserID, conversationID, request.BrowserHash).Scan(&valid, &allowed)
	return valid, valid && allowed, err
}
