package platform

import (
	"bytes"
	"context"
	"errors"
	"io"
	"math/rand/v2"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// The route selects an explicit operation. Stores without PostgreSQL (including
// the deterministic memory fixtures) continue to use the original State handler.
type messagingOperation uint8

const (
	messagingList messagingOperation = iota
	messagingDetail
	messagingHistory
	messagingSend
	messagingRead
	messagingMessageDetail
	messagingByClient
	messagingResolve
	messagingRetract
)

func (a *App) messagingEndpoint(op messagingOperation, write bool, fallback func(*State, *User, *http.Request) (any, error)) http.HandlerFunc {
	s, ok := a.store.(*PostgresStore)
	if !ok {
		return a.endpoint(write, "member", fallback)
	}
	return func(w http.ResponseWriter, r *http.Request) {
		result, err := a.executeMessagingSQL(s, r, op, write)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

func (a *App) executeMessagingSQL(s *PostgresStore, r *http.Request, op messagingOperation, write bool) (any, error) {
	var body []byte
	if write && r.Body != nil {
		var err error
		body, err = io.ReadAll(r.Body)
		if err != nil {
			var max *http.MaxBytesError
			if errors.As(err, &max) {
				return nil, &APIError{413, "body_too_large", "请求内容过大"}
			}
			return nil, bad("无法读取请求内容")
		}
	}
	options := pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}
	if write {
		options = pgx.TxOptions{IsoLevel: pgx.Serializable}
	}
	for attempt := 0; attempt < 20; attempt++ {
		if write {
			r.Body = io.NopCloser(bytes.NewReader(body))
		}
		result, err := a.messagingSQLOnce(s, r, op, write, options)
		if err == nil || !write || !retryableTransaction(err) {
			return result, err
		}
		// Retry the whole authorization + operation with a fresh snapshot and body;
		// no event is published before its transaction commits.
		timer := time.NewTimer(time.Duration(min(150, 5*(attempt+1))+rand.IntN(15)) * time.Millisecond)
		select {
		case <-r.Context().Done():
			timer.Stop()
			return nil, r.Context().Err()
		case <-timer.C:
		}
	}
	return nil, &APIError{503, "transaction_conflict", "操作繁忙，请稍后重试"}
}

func (a *App) messagingSQLOnce(s *PostgresStore, r *http.Request, op messagingOperation, write bool, options pgx.TxOptions) (any, error) {
	tx, err := s.pool.BeginTx(r.Context(), options)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(r.Context())
	u, err := a.messagingSQLActor(r, tx, write)
	if err != nil {
		return nil, err
	}
	var result any
	switch op {
	case messagingList:
		result, err = messagingSQLConversations(r, tx, u)
	case messagingDetail:
		result, err = messagingSQLDetail(r, tx, u)
	case messagingHistory:
		result, err = messagingSQLHistory(r, tx, u)
	case messagingSend:
		result, err = a.messagingSQLSend(r, tx, u)
	case messagingRead:
		result, err = a.messagingSQLRead(r, tx, u)
	case messagingMessageDetail:
		result, err = messagingSQLMessageDetail(r, tx, u, false)
	case messagingByClient:
		result, err = messagingSQLMessageDetail(r, tx, u, true)
	case messagingResolve:
		result, err = messagingSQLResolve(r, tx, u)
	case messagingRetract:
		result, err = a.messagingSQLRetract(r, tx, u)
	default:
		err = errors.New("unknown messaging SQL operation")
	}
	if err != nil {
		return nil, err
	}
	return result, tx.Commit(r.Context())
}

// Reads authenticate within their repeatable snapshot. Writes also share-lock
// the actor and session, so suspension/revocation cannot commit in the middle of
// a successful send/read transaction. Browser provenance/current-pointer checks
// are shared with State, media and stream authorization.
func (a *App) messagingSQLActor(r *http.Request, tx pgx.Tx, lock bool) (PublicUser, error) {
	u := PublicUser{}
	valid := false
	if cookie, err := r.Cookie(cookieName); err == nil {
		query := `SELECT u.id,u.handle,u.name,u.avatar,u.bio FROM gongming_sessions s JOIN gongming_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.status='active' AND ` + browserSessionPredicate("s", "$3")
		if lock {
			query += ` FOR SHARE OF u,s`
		}
		err = tx.QueryRow(r.Context(), query, tokenHash(cookie.Value), a.now(), browserCredentialHash(r)).Scan(&u.ID, &u.Handle, &u.Name, &u.Avatar, &u.Bio)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return u, err
		}
		valid = err == nil
	}
	if expected := r.Header.Get("X-Gongming-Account"); expected != "" && (!valid || expected != u.ID) {
		return u, &APIError{409, "account_changed", "账号已切换，请重新确认后再操作"}
	}
	if !valid {
		return u, unauthorized()
	}
	return u, nil
}

// Write lock order: actor/session -> conversation -> viewer membership -> read
// mark/message -> outbox counter. A send serializes only its conversation. A read
// mark shares the conversation lock and serializes only its own mark. Membership
// key-share locks prevent removal before commit; SERIALIZABLE retries coordinate
// with the transitional State management transactions, including owner changes.
func messagingSQLConversation(ctx context.Context, tx pgx.Tx, id, viewer, lock string) (StoredConversation, error) {
	if id == "" || len(id) > 128 || strings.ContainsRune(id, 0) {
		return StoredConversation{}, bad("会话编号不正确")
	}
	c := StoredConversation{}
	query := `SELECT c.id,c.title,c.kind,c.owner_id,c.created_at FROM gongming_conversations c JOIN gongming_conversation_members m ON m.conversation_id=c.id AND m.user_id=$2 WHERE c.id=$1`
	if lock == "send" {
		query += ` FOR UPDATE OF c FOR KEY SHARE OF m`
	} else if lock == "read" {
		query += ` FOR SHARE OF c FOR KEY SHARE OF m`
	}
	err := tx.QueryRow(ctx, query, id, viewer).Scan(&c.ID, &c.Title, &c.Kind, &c.OwnerID, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, missing("会话不存在或你尚未加入")
	}
	return c, err
}
