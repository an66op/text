package platform

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

type EventRegistration struct {
	Status        string    `json:"status"`
	Reason        string    `json:"reason"`
	QueuePosition *int      `json:"queuePosition"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}
type EventInput struct {
	Title                string    `json:"title"`
	Description          string    `json:"description"`
	Mode                 string    `json:"mode"`
	Location             string    `json:"location"`
	StartsAt             time.Time `json:"startsAt"`
	EndsAt               time.Time `json:"endsAt"`
	RegistrationClosesAt time.Time `json:"registrationClosesAt"`
	Capacity             int       `json:"capacity"`
}
type CircleEvent struct {
	ID       string     `json:"id"`
	CircleID string     `json:"circleId"`
	Creator  PublicUser `json:"creator"`
	EventInput
	RegisteredCount  int                `json:"registeredCount"`
	WaitlistedCount  int                `json:"waitlistedCount"`
	Lifecycle        string             `json:"lifecycle"`
	Moderation       string             `json:"moderation"`
	Phase            string             `json:"phase"`
	RegistrationOpen bool               `json:"registrationOpen"`
	MyRegistration   *EventRegistration `json:"myRegistration"`
	Revision         int64              `json:"revision"`
	CreatedAt        time.Time          `json:"createdAt"`
	UpdatedAt        time.Time          `json:"updatedAt"`
}
type EventAttendee struct {
	User         PublicUser        `json:"user"`
	Registration EventRegistration `json:"registration"`
}
type AdminCircleEvent struct {
	CircleEvent
	CircleName     string `json:"circleName"`
	CircleStatus   string `json:"circleStatus"`
	ModerationNote string `json:"moderationNote"`
}
type storedCircleEvent struct {
	CircleEvent
	CreatorID, ClientID, Fingerprint, Note string
	RegistrationSequence                   int64
	CircleName, CircleStatus               string
}
type storedEventRegistration struct {
	EventRegistration
	UserID  string
	Ordinal int64
}
type eventSeedDraft struct {
	Event              storedCircleEvent
	Confirmed, Waiting string
}
type eventCircleAccess struct {
	ID, Name, Status, Role string
	Member                 bool
}
type eventOperation uint8

const (
	eventList eventOperation = iota
	eventDetail
	eventCreate
	eventEdit
	eventCancel
	eventRegister
	eventAttendees
	eventReport
	eventAdminList
	eventAdminGovern
)

func (a *App) registerCircleEventRoutes(mux *http.ServeMux) {
	for _, route := range []struct {
		pattern string
		op      eventOperation
		write   bool
		created bool
	}{
		{"GET /api/v1/circles/{id}/events", eventList, false, false}, {"GET /api/v1/circles/{id}/events/{eventId}", eventDetail, false, false},
		{"POST /api/v1/circles/{id}/events", eventCreate, true, true}, {"PATCH /api/v1/circles/{id}/events/{eventId}", eventEdit, true, false},
		{"POST /api/v1/circles/{id}/events/{eventId}/cancel", eventCancel, true, false}, {"POST /api/v1/circles/{id}/events/{eventId}/registration", eventRegister, true, false},
		{"GET /api/v1/circles/{id}/events/{eventId}/attendees", eventAttendees, false, false}, {"POST /api/v1/circles/{id}/events/{eventId}/report", eventReport, true, true},
		{"GET /api/v1/admin/circle-events", eventAdminList, false, false}, {"PATCH /api/v1/admin/circle-events/{eventId}", eventAdminGovern, true, false},
	} {
		mux.HandleFunc(route.pattern, a.circleEventEndpoint(route.op, route.write, route.created))
	}
}
func (a *App) circleEventEndpoint(op eventOperation, write, created bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s, ok := a.store.(*PostgresStore)
		if !ok {
			writeError(w, &APIError{503, "events_unavailable", "活动服务暂不可用"})
			return
		}
		result, err := a.executeCircleEventSQL(s, r, op, write)
		if err != nil {
			writeError(w, err)
			return
		}
		status := 200
		if created {
			status = 201
		}
		writeJSON(w, status, result)
	}
}
func (a *App) executeCircleEventSQL(s *PostgresStore, r *http.Request, op eventOperation, write bool) (any, error) {
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
		result, err := a.circleEventSQLOnce(s, r, op, write)
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
func (a *App) circleEventSQLOnce(s *PostgresStore, r *http.Request, op eventOperation, write bool) (any, error) {
	options := pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}
	if write {
		options = pgx.TxOptions{IsoLevel: pgx.Serializable}
	}
	tx, err := s.pool.BeginTx(r.Context(), options)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(r.Context())
	u, err := a.messagingSQLActor(r, tx, write)
	if err != nil {
		return nil, err
	}
	if op == eventAdminList || op == eventAdminGovern {
		var allowed bool
		if err = tx.QueryRow(r.Context(), `SELECT role IN ('admin','moderator') FROM gongming_users WHERE id=$1`, u.ID).Scan(&allowed); err != nil {
			return nil, err
		}
		if !allowed {
			return nil, forbidden("仅运营人员可访问")
		}
	}
	now := a.circleNow()
	drafts := []NotificationDraft{}
	var result any
	switch op {
	case eventList:
		result, err = eventSQLList(r, tx, u.ID, now)
	case eventDetail:
		result, err = eventSQLDetail(r, tx, u.ID, now, false)
	case eventCreate:
		result, err = eventSQLCreate(r, tx, u, now)
	case eventEdit:
		result, err = eventSQLEdit(r, tx, u, now, &drafts)
	case eventCancel:
		result, err = eventSQLCancel(r, tx, u, now, &drafts)
	case eventRegister:
		result, err = eventSQLRegister(r, tx, u, now, &drafts)
	case eventAttendees:
		result, err = eventSQLAttendees(r, tx, u.ID, now)
	case eventReport:
		result, err = eventSQLReport(r, tx, u, now)
	case eventAdminList:
		result, err = eventSQLAdminList(r, tx, u.ID, now)
	case eventAdminGovern:
		result, err = eventSQLGovern(r, tx, u, now, &drafts)
	}
	if err != nil {
		return nil, err
	}
	if write {
		if err = persistNotificationDrafts(r.Context(), tx, drafts); err != nil {
			return nil, err
		}
	}
	return result, tx.Commit(r.Context())
}
func eventPagination(r *http.Request) (int, int, error) {
	limit, offset := 20, 0
	for _, v := range []struct {
		k        string
		p        *int
		min, max int
	}{{"limit", &limit, 1, 100}, {"offset", &offset, 0, 100000}} {
		if raw := r.URL.Query().Get(v.k); raw != "" {
			n, e := strconv.Atoi(raw)
			if e != nil || n < v.min || n > v.max {
				return 0, 0, bad("分页参数无效")
			}
			*v.p = n
		}
	}
	return limit, offset, nil
}
func cleanEventInput(v EventInput) (EventInput, error) {
	v.Title = strings.TrimSpace(v.Title)
	v.Description = strings.TrimSpace(v.Description)
	v.Location = strings.TrimSpace(v.Location)
	for _, p := range []struct {
		s   string
		max int
	}{{v.Title, 80}, {v.Description, 4000}, {v.Location, 200}} {
		if strings.ContainsRune(p.s, 0) || utf8.RuneCountInString(p.s) < 1 || utf8.RuneCountInString(p.s) > p.max {
			return v, bad("活动标题、介绍或地点长度无效")
		}
	}
	if v.Mode != "online" && v.Mode != "offline" {
		return v, bad("活动方式无效")
	}
	if v.Capacity < 1 || v.Capacity > 1000 {
		return v, bad("容量须为1–1000")
	}
	v.StartsAt = v.StartsAt.UTC().Truncate(time.Microsecond)
	v.EndsAt = v.EndsAt.UTC().Truncate(time.Microsecond)
	v.RegistrationClosesAt = v.RegistrationClosesAt.UTC().Truncate(time.Microsecond)
	if v.StartsAt.IsZero() || v.EndsAt.IsZero() || v.RegistrationClosesAt.IsZero() || !v.EndsAt.After(v.StartsAt) || v.EndsAt.Sub(v.StartsAt) > 7*24*time.Hour || v.RegistrationClosesAt.After(v.StartsAt) {
		return v, bad("活动时间范围无效")
	}
	return v, nil
}
func validEventTimes(v EventInput, now time.Time, old *storedCircleEvent) error {
	if !v.StartsAt.After(now) || v.StartsAt.After(now.Add(365*24*time.Hour)) {
		return bad("活动须在未来365天内开始")
	}
	if !v.RegistrationClosesAt.After(now) && (old == nil || !v.RegistrationClosesAt.Equal(old.RegistrationClosesAt)) {
		return bad("报名截止须在未来，或保持原有已截止时间")
	}
	return nil
}
func eventFingerprint(v EventInput) string {
	raw, _ := json.Marshal(v)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func eventOpen(e storedCircleEvent, now time.Time) bool {
	return e.CircleStatus == "active" && e.Lifecycle == "published" && e.Moderation == "visible" && now.Before(e.RegistrationClosesAt) && now.Before(e.StartsAt)
}
func eventPhase(e storedCircleEvent, now time.Time) string {
	if e.Lifecycle == "cancelled" {
		return "cancelled"
	}
	if !now.Before(e.EndsAt) {
		return "ended"
	}
	if !now.Before(e.StartsAt) {
		return "ongoing"
	}
	return "upcoming"
}
