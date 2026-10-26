package platform

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

type notificationFilter struct {
	category      string
	unread        bool
	limit, offset int
}

func parseNotificationFilter(r *http.Request) (notificationFilter, error) {
	f := notificationFilter{category: "all", limit: 20}
	category, err := queryEnum(r, "category", "all", "requests", "interactions", "system")
	if err != nil {
		return f, err
	}
	if category != "" {
		f.category = category
	}
	unread, err := queryEnum(r, "unread", "true", "false")
	if err != nil {
		return f, err
	}
	f.unread = unread == "true"
	for _, p := range []struct {
		key       string
		value     *int
		low, high int
	}{{"limit", &f.limit, 1, 100}, {"offset", &f.offset, 0, 100000}} {
		if raw := r.URL.Query().Get(p.key); raw != "" {
			v, e := strconv.Atoi(raw)
			if e != nil || v < p.low || v > p.high {
				return f, bad("分页参数无效")
			}
			*p.value = v
		}
	}
	return f, nil
}

func (a *App) executeNotificationSQL(s *PostgresStore, r *http.Request, op notificationOperation) (any, error) {
	write := op == notificationRead || op == notificationReadAll
	var body []byte
	if write {
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
	for attempt := 0; attempt < 20; attempt++ {
		if write {
			r.Body = io.NopCloser(bytes.NewReader(body))
		}
		result, err := a.notificationSQLOnce(s, r, op, write)
		if err == nil || !write || !retryableTransaction(err) {
			return result, err
		}
		timer := time.NewTimer(time.Duration(min(150, 5*(attempt+1))) * time.Millisecond)
		select {
		case <-r.Context().Done():
			timer.Stop()
			return nil, r.Context().Err()
		case <-timer.C:
		}
	}
	return nil, &APIError{503, "transaction_conflict", "操作繁忙，请稍后重试"}
}
func (a *App) notificationSQLOnce(s *PostgresStore, r *http.Request, op notificationOperation, write bool) (any, error) {
	options := pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}
	if write {
		options = pgx.TxOptions{IsoLevel: pgx.Serializable}
	}
	tx, err := s.pool.BeginTx(r.Context(), options)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(r.Context())
	user, err := a.messagingSQLActor(r, tx, write)
	if err != nil {
		return nil, err
	}
	var result any
	switch op {
	case notificationList:
		result, err = notificationSQLList(r, tx, user.ID)
	case notificationUnread:
		var count int
		var through *string
		count, through, err = notificationSQLSummary(r, tx, user.ID)
		result = map[string]any{"unreadTotal": count, "throughId": through}
	case notificationRead:
		result, err = a.notificationSQLRead(r, tx, user.ID)
	case notificationReadAll:
		result, err = a.notificationSQLReadAll(r, tx, user.ID)
	}
	if err != nil {
		return nil, err
	}
	return result, tx.Commit(r.Context())
}
func notificationSQLSummary(r *http.Request, tx pgx.Tx, user string) (int, *string, error) {
	var unread int
	var through *string
	err := tx.QueryRow(r.Context(), `SELECT (SELECT count(*) FROM gongming_notifications WHERE recipient_id=$1 AND read_at IS NULL),(SELECT id FROM gongming_notifications WHERE recipient_id=$1 ORDER BY sequence DESC LIMIT 1)`, user).Scan(&unread, &through)
	return unread, through, err
}

const notificationFields = `id,sequence,recipient_id,COALESCE(actor_id,''),kind,outcome,reference_id,event_key,created_at,read_at`

func scanNotification(row messagingSQLScanner) (storedNotification, error) {
	v := storedNotification{}
	err := row.Scan(&v.ID, &v.Seq, &v.RecipientID, &v.ActorID, &v.Kind, &v.Outcome, &v.ReferenceID, &v.EventKey, &v.CreatedAt, &v.ReadAt)
	return v, err
}
func notificationSQLList(r *http.Request, tx pgx.Tx, user string) (any, error) {
	f, err := parseNotificationFilter(r)
	if err != nil {
		return nil, err
	}
	page := NotificationsPage{Items: []Notification{}}
	page.UnreadTotal, page.ThroughID, err = notificationSQLSummary(r, tx, user)
	if err != nil {
		return nil, err
	}
	kinds := []string{}
	for kind, rule := range notificationRules {
		if f.category == "all" || rule.category == f.category {
			kinds = append(kinds, kind)
		}
	}
	where := `recipient_id=$1 AND kind=ANY($2::text[]) AND (NOT $3::boolean OR read_at IS NULL)`
	if err = tx.QueryRow(r.Context(), `SELECT count(*) FROM gongming_notifications WHERE `+where, user, kinds, f.unread).Scan(&page.Total); err != nil {
		return nil, err
	}
	rows, err := tx.Query(r.Context(), `SELECT `+notificationFields+` FROM gongming_notifications WHERE `+where+` ORDER BY sequence DESC LIMIT $4 OFFSET $5`, user, kinds, f.unread, f.limit, f.offset)
	if err != nil {
		return nil, err
	}
	stored := []storedNotification{}
	for rows.Next() {
		v, e := scanNotification(rows)
		if e != nil {
			rows.Close()
			return nil, e
		}
		stored = append(stored, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	projection, err := loadNotificationProjection(r, tx, user, stored)
	if err != nil {
		return nil, err
	}
	for _, v := range stored {
		page.Items = append(page.Items, projectNotification(projection, user, v))
	}
	if err = projectEventNotifications(r, tx, user, stored, page.Items); err != nil {
		return nil, err
	}
	return page, nil
}
func (a *App) notificationSQLRead(r *http.Request, tx pgx.Tx, user string) (any, error) {
	if err := decodeNotificationEmpty(r); err != nil {
		return nil, err
	}
	var readAt time.Time
	err := tx.QueryRow(r.Context(), `UPDATE gongming_notifications SET read_at=COALESCE(read_at,GREATEST(created_at,$3)) WHERE id=$1 AND recipient_id=$2 RETURNING read_at`, r.PathValue("id"), user, a.now().UTC().Truncate(time.Microsecond)).Scan(&readAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, missing("通知不存在")
	}
	if err != nil {
		return nil, err
	}
	unread, _, err := notificationSQLSummary(r, tx, user)
	return map[string]any{"ok": true, "unreadTotal": unread, "readAt": readAt.UTC()}, err
}

func decodeNotificationEmpty(r *http.Request) error {
	var input map[string]json.RawMessage
	if err := decode(r, &input); err != nil {
		return err
	}
	if input == nil || len(input) != 0 {
		return bad("请提供空 JSON 对象")
	}
	return nil
}
func decodeNotificationThrough(r *http.Request) (*string, error) {
	var input struct {
		ThroughID json.RawMessage `json:"throughId"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	if len(input.ThroughID) == 0 {
		return nil, bad("请提供 throughId 字段")
	}
	if bytes.Equal(bytes.TrimSpace(input.ThroughID), []byte("null")) {
		return nil, nil
	}
	var id string
	if err := json.Unmarshal(input.ThroughID, &id); err != nil || len(id) != 39 || id[:7] != "notice_" {
		return nil, bad("throughId 格式无效")
	}
	for _, v := range id[7:] {
		if !(v >= 'a' && v <= 'f' || v >= '0' && v <= '9') {
			return nil, bad("throughId 格式无效")
		}
	}
	return &id, nil
}
func (a *App) notificationSQLReadAll(r *http.Request, tx pgx.Tx, user string) (any, error) {
	id, err := decodeNotificationThrough(r)
	if err != nil {
		return nil, err
	}
	var marked int64
	if id != nil {
		var sequence int64
		err = tx.QueryRow(r.Context(), `SELECT sequence FROM gongming_notifications WHERE id=$1 AND recipient_id=$2`, *id, user).Scan(&sequence)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, missing("通知不存在")
		}
		if err != nil {
			return nil, err
		}
		tag, e := tx.Exec(r.Context(), `UPDATE gongming_notifications SET read_at=GREATEST(created_at,$3) WHERE recipient_id=$1 AND sequence<=$2 AND read_at IS NULL`, user, sequence, a.now().UTC().Truncate(time.Microsecond))
		if e != nil {
			return nil, e
		}
		marked = tag.RowsAffected()
	}
	unread, _, err := notificationSQLSummary(r, tx, user)
	return map[string]any{"ok": true, "markedRead": marked, "unreadTotal": unread}, err
}
