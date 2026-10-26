package platform

import (
	"net/http"
	"strings"
	"time"
)

// Drafts exist only during a business transaction. They are never included in
// State snapshots or loaded by the normalized compatibility adapter.
type NotificationDraft struct {
	RecipientID string
	ActorID     string
	Kind        string
	Outcome     string
	ReferenceID string
	EventKey    string
	CreatedAt   time.Time
}

type storedNotification struct {
	ID  string
	Seq int64
	NotificationDraft
	ReadAt *time.Time
}

type NotificationContext struct {
	Title   string `json:"title"`
	Excerpt string `json:"excerpt"`
}
type NotificationTarget struct {
	Type     string `json:"type"`
	Handle   string `json:"handle,omitempty"`
	CircleID string `json:"circleId,omitempty"`
	PostID   string `json:"postId,omitempty"`
	MediaID  string `json:"mediaId,omitempty"`
}
type Notification struct {
	ID        string               `json:"id"`
	Kind      string               `json:"kind"`
	Category  string               `json:"category"`
	Outcome   string               `json:"outcome"`
	Actor     *PublicUser          `json:"actor"`
	Available bool                 `json:"available"`
	Context   *NotificationContext `json:"context"`
	Target    *NotificationTarget  `json:"target"`
	CreatedAt time.Time            `json:"createdAt"`
	ReadAt    *time.Time           `json:"readAt"`
}
type NotificationsPage struct {
	Items       []Notification `json:"items"`
	Total       int            `json:"total"`
	UnreadTotal int            `json:"unreadTotal"`
	ThroughID   *string        `json:"throughId"`
}
type notificationRule struct {
	category string
	outcomes string
}

var notificationRules = map[string]notificationRule{
	"friend-request": {"requests", ""}, "friend-decision": {"requests", "accepted|declined"},
	"circle-request": {"requests", ""}, "circle-decision": {"requests", "accepted|declined"},
	"circle-membership": {"system", "admin|member|owner|removed|banned|unbanned"},
	"circle-status":     {"system", "active|suspended|archived"},
	"world-comment":     {"interactions", ""}, "world-like": {"interactions", ""},
	"circle-comment": {"interactions", ""}, "circle-like": {"interactions", ""},
	"world-review": {"system", "published|pending|hidden"}, "circle-review": {"system", "published|pending|hidden"},
	"media-review": {"system", "ready|blocked"}, "report-review": {"system", "resolved|dismissed"},
}

func (s *State) queueNotification(kind, actor, recipient, reference, outcome, eventKey string, now time.Time) {
	if actor == recipient || recipient == "" {
		return
	}
	if _, exists := s.Accounts[recipient]; !exists {
		return
	}
	s.NotificationDrafts = append(s.NotificationDrafts, NotificationDraft{recipient, actor, kind, outcome, reference, eventKey, now.UTC().Truncate(time.Microsecond)})
}
func (s *State) notifyChange(kind, actor, recipient, reference, outcome string, now time.Time) {
	s.queueNotification(kind, actor, recipient, reference, outcome, kind+":"+reference+":"+newID(""), now)
}
func (s *State) notifyCircleManagers(request StoredCircleJoinRequest, now time.Time) {
	for _, member := range s.CircleMembers {
		if member.CircleID == request.CircleID && member.Status == "active" && circleStaff(member.Role) {
			s.queueNotification("circle-request", request.UserID, member.UserID, request.ID, "", "circle-request:"+request.ID, now)
		}
	}
}
func (s *State) notifyCircleStatus(circle, actor, status string, now time.Time) {
	key := "circle-status:" + circle + ":" + newID("")
	for _, member := range s.CircleMembers {
		if member.CircleID == circle && member.Status == "active" {
			s.queueNotification("circle-status", actor, member.UserID, circle, status, key, now)
		}
	}
}
func notificationBase(v storedNotification) Notification {
	return Notification{ID: v.ID, Kind: v.Kind, Category: notificationRules[v.Kind].category, Outcome: v.Outcome, CreatedAt: v.CreatedAt.UTC(), ReadAt: utcSessionTime(v.ReadAt)}
}
func notificationSnippet(value string, max int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > max {
		runes = runes[:max]
	}
	return string(runes)
}

type notificationOperation uint8

const (
	notificationList notificationOperation = iota
	notificationUnread
	notificationRead
	notificationReadAll
)

// This optional adapter is used by transactional test stores only. Production
// startup requires PostgreSQL; there is no process-local notification fallback.
type notificationTestStore interface {
	notificationRequest(*App, *http.Request, notificationOperation) (any, error)
}

func (a *App) registerNotificationRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/notifications", a.notificationEndpoint(notificationList))
	mux.HandleFunc("GET /api/v1/notifications/unread", a.notificationEndpoint(notificationUnread))
	mux.HandleFunc("POST /api/v1/notifications/{id}/read", a.notificationEndpoint(notificationRead))
	mux.HandleFunc("POST /api/v1/notifications/read-all", a.notificationEndpoint(notificationReadAll))
}
func (a *App) notificationEndpoint(op notificationOperation) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var result any
		var err error
		if s, ok := a.store.(*PostgresStore); ok {
			result, err = a.executeNotificationSQL(s, r, op)
		} else if s, ok := a.store.(notificationTestStore); ok {
			result, err = s.notificationRequest(a, r, op)
		} else {
			err = &APIError{503, "notifications_unavailable", "通知服务暂不可用"}
		}
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}
