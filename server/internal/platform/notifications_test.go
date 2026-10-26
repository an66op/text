package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// An atomic test-only inbox adapter. It deliberately keeps history outside
// State, just like the runtime SQL repository. Existing generic memory fixtures
// need not pretend to offer a durable production notification store.
type notificationMemoryStore struct {
	mu        sync.Mutex
	state     *State
	rows      map[string]storedNotification
	sequences map[string]int64
}

func (m *notificationMemoryStore) Ping(context.Context) error { return nil }
func (m *notificationMemoryStore) Read(_ context.Context, fn func(*State) error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	raw, _ := json.Marshal(m.state)
	copy := NewState()
	_ = json.Unmarshal(raw, copy)
	return fn(copy)
}
func (m *notificationMemoryStore) Update(_ context.Context, fn func(*State) error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	raw, _ := json.Marshal(m.state)
	copy := NewState()
	_ = json.Unmarshal(raw, copy)
	previous := m.rows
	working := map[string]storedNotification{}
	for k, v := range previous {
		working[k] = v
	}
	m.rows = working
	if err := fn(copy); err != nil {
		m.rows = previous
		return err
	}
	for _, d := range copy.NotificationDrafts {
		if !validNotificationDraft(d) {
			m.rows = previous
			return bad("invalid test draft")
		}
	}
	for _, d := range copy.NotificationDrafts {
		found := false
		for _, v := range m.rows {
			if v.RecipientID == d.RecipientID && v.EventKey == d.EventKey {
				found = true
				break
			}
		}
		if found {
			continue
		}
		m.sequences[d.RecipientID]++
		id := newID("notice_")
		m.rows[id] = storedNotification{ID: id, Seq: m.sequences[d.RecipientID], NotificationDraft: d}
	}
	copy.NotificationDrafts = nil
	m.state = copy
	return nil
}
func (m *notificationMemoryStore) summary(user string) (int, *string) {
	unread := 0
	var seq int64
	var through *string
	for _, v := range m.rows {
		if v.RecipientID != user {
			continue
		}
		if v.ReadAt == nil {
			unread++
		}
		if v.Seq > seq {
			seq = v.Seq
			id := v.ID
			through = &id
		}
	}
	return unread, through
}
func (m *notificationMemoryStore) notificationRequest(a *App, r *http.Request, op notificationOperation) (any, error) {
	return a.execute(r, op == notificationRead || op == notificationReadAll, "member", func(s *State, u *User) (any, error) {
		unread, through := m.summary(u.ID)
		switch op {
		case notificationUnread:
			return map[string]any{"unreadTotal": unread, "throughId": through}, nil
		case notificationList:
			f, err := parseNotificationFilter(r)
			if err != nil {
				return nil, err
			}
			stored := []storedNotification{}
			for _, v := range m.rows {
				if v.RecipientID == u.ID && (f.category == "all" || notificationRules[v.Kind].category == f.category) && (!f.unread || v.ReadAt == nil) {
					stored = append(stored, v)
				}
			}
			sort.Slice(stored, func(i, j int) bool { return stored[i].Seq > stored[j].Seq })
			page := NotificationsPage{Items: []Notification{}, Total: len(stored), UnreadTotal: unread, ThroughID: through}
			for i := min(f.offset, len(stored)); i < min(f.offset+f.limit, len(stored)); i++ {
				page.Items = append(page.Items, projectNotification(s, u.ID, stored[i]))
			}
			return page, nil
		case notificationRead:
			if err := decodeNotificationEmpty(r); err != nil {
				return nil, err
			}
			v, ok := m.rows[r.PathValue("id")]
			if !ok || v.RecipientID != u.ID {
				return nil, missing("通知不存在")
			}
			if v.ReadAt == nil {
				now := a.now().UTC().Truncate(time.Microsecond)
				if now.Before(v.CreatedAt) {
					now = v.CreatedAt
				}
				v.ReadAt = &now
				m.rows[v.ID] = v
			}
			count, _ := m.summary(u.ID)
			return map[string]any{"ok": true, "unreadTotal": count, "readAt": v.ReadAt}, nil
		case notificationReadAll:
			id, err := decodeNotificationThrough(r)
			if err != nil {
				return nil, err
			}
			marked := 0
			if id != nil {
				bound, ok := m.rows[*id]
				if !ok || bound.RecipientID != u.ID {
					return nil, missing("通知不存在")
				}
				for key, v := range m.rows {
					if v.RecipientID == u.ID && v.Seq <= bound.Seq && v.ReadAt == nil {
						now := a.now().UTC().Truncate(time.Microsecond)
						if now.Before(v.CreatedAt) {
							now = v.CreatedAt
						}
						v.ReadAt = &now
						m.rows[key] = v
						marked++
					}
				}
			}
			count, _ := m.summary(u.ID)
			return map[string]any{"ok": true, "markedRead": marked, "unreadTotal": count}, nil
		}
		return nil, bad("unknown test operation")
	})
}
func notificationFixture(t *testing.T) (*App, *notificationMemoryStore, http.Handler) {
	t.Helper()
	s := &notificationMemoryStore{state: NewState(), rows: map[string]storedNotification{}, sequences: map[string]int64{}}
	a := NewApp(s, Config{Environment: "development", Origins: []string{"http://localhost:5173"}, BcryptCost: bcrypt.MinCost})
	if err := a.SeedDevelopment(context.Background()); err != nil {
		t.Fatal(err)
	}
	s.rows = map[string]storedNotification{}
	s.sequences = map[string]int64{}
	return a, s, a.Handler()
}
func notificationsPage(t *testing.T, h http.Handler, cookie *http.Cookie) NotificationsPage {
	t.Helper()
	res := call(t, h, "GET", "/notifications?limit=100", nil, cookie)
	requireCode(t, res, 200)
	return payload[NotificationsPage](t, res)
}
func requireNotice(t *testing.T, page NotificationsPage, kind, outcome string) Notification {
	t.Helper()
	for _, v := range page.Items {
		if v.Kind == kind && v.Outcome == outcome {
			return v
		}
	}
	t.Fatalf("missing %s/%s in %+v", kind, outcome, page)
	return Notification{}
}
func TestNotificationMemoryEventsWatermarkAndAccountIsolation(t *testing.T) {
	a, s, h := notificationFixture(t)
	owner := memberCookie(t, h)
	person, peer := circleUser(t, h, "noticeperson")
	requestBody := map[string]string{"userId": "user_demo", "note": "a private friend note"}
	first := call(t, h, "POST", "/friend-requests", requestBody, peer)
	requireCode(t, first, 200)
	requireCode(t, call(t, h, "POST", "/friend-requests", requestBody, peer), 200)
	page := notificationsPage(t, h, owner)
	if page.Total != 1 || page.UnreadTotal != 1 || page.ThroughID == nil {
		t.Fatal(page)
	}
	n := requireNotice(t, page, "friend-request", "")
	if !n.Available || n.Actor.ID != person.ID || n.Target.Type != "friend-requests" {
		t.Fatal(n)
	}
	requestID := payload[FriendRequest](t, first).ID
	requireCode(t, call(t, h, "POST", "/friend-requests/"+requestID+"/respond", map[string]string{"action": "accept"}, owner), 200)
	requireCode(t, call(t, h, "POST", "/friend-requests/"+requestID+"/respond", map[string]string{"action": "accept"}, owner), 200)
	decision := requireNotice(t, notificationsPage(t, h, peer), "friend-decision", "accepted")
	if decision.Target.Type != "user" || decision.Target.Handle != "demo" {
		t.Fatal(decision)
	}
	requireCode(t, call(t, h, "POST", "/notifications/"+n.ID+"/read", map[string]any{}, peer), 404)
	requireCode(t, call(t, h, "POST", "/notifications/read-all", map[string]any{"throughId": n.ID}, peer), 404)
	requireCode(t, call(t, h, "POST", "/notifications/read-all", map[string]any{}, owner), 400)
	requireCode(t, request(t, h, "POST", "/notifications/"+n.ID+"/read", map[string]any{}, owner, "https://evil.example"), 403)
	r := httptest.NewRequest("GET", "http://localhost:8080/api/v1/notifications", nil)
	r.AddCookie(owner)
	r.Header.Set("X-Gongming-Account", person.ID)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 409 {
		t.Fatal(w.Code)
	}
	postRes := call(t, h, "POST", "/posts", map[string]string{"body": "watermark post"}, owner)
	post := payload[Post](t, postRes)
	requireCode(t, call(t, h, "POST", "/posts/"+post.ID+"/comments", map[string]string{"body": "new after snapshot"}, peer), 200)
	readAll := call(t, h, "POST", "/notifications/read-all", map[string]any{"throughId": page.ThroughID}, owner)
	requireCode(t, readAll, 200)
	if result := payload[struct{ MarkedRead, UnreadTotal int }](t, readAll); result.MarkedRead != 1 || result.UnreadTotal != 1 {
		t.Fatal(result)
	}
	read := call(t, h, "POST", "/notifications/"+n.ID+"/read", map[string]any{}, owner)
	a.now = func() time.Time { return time.Now().Add(time.Hour) }
	repeated := call(t, h, "POST", "/notifications/"+n.ID+"/read", map[string]any{}, owner)
	if string(read.Data) != string(repeated.Data) {
		t.Fatal("readAt changed on repeated read")
	}
	for _, path := range []string{"?category=invalid", "?unread=1", "?limit=0", "?offset=-1"} {
		requireCode(t, call(t, h, "GET", "/notifications"+path, nil, owner), 400)
	}
	if err := s.Update(context.Background(), func(st *State) error {
		st.Accounts[person.ID] = Account{User: User{ID: person.ID, Status: "suspended"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	redacted := requireNotice(t, notificationsPage(t, h, owner), "friend-request", "")
	if redacted.Available || redacted.Actor != nil || redacted.Context != nil || redacted.Target != nil {
		t.Fatal("inactive profile leaked", redacted)
	}
}
func TestNotificationMemoryLikeLifetimeAndTransactionRollback(t *testing.T) {
	_, s, h := notificationFixture(t)
	owner := memberCookie(t, h)
	_, peer := circleUser(t, h, "noticelike")
	post := payload[Post](t, call(t, h, "POST", "/posts", map[string]string{"body": "like lifetime"}, owner))
	for _, liked := range []bool{true, true, false, true, false, true} {
		requireCode(t, call(t, h, "POST", "/posts/"+post.ID+"/like", map[string]bool{"liked": liked}, peer), 200)
	}
	requireCode(t, call(t, h, "POST", "/posts/"+post.ID+"/like", map[string]bool{"liked": true}, owner), 200)
	if page := notificationsPage(t, h, owner); page.Total != 1 {
		t.Fatal(page)
	}
	err := s.Update(context.Background(), func(st *State) error {
		delete(st.Posts, post.ID)
		st.queueNotification("world-like", "user_friend", "user_demo", post.ID, "", "rollback-event", time.Now())
		return conflict("abort")
	})
	if err == nil {
		t.Fatal("expected error")
	}
	if page := notificationsPage(t, h, owner); page.Total != 1 || !page.Items[0].Available {
		t.Fatal("rollback leaked", page)
	}
	requireCode(t, call(t, h, "DELETE", "/posts/"+post.ID, nil, owner), 200)
	n := notificationsPage(t, h, owner).Items[0]
	if n.Available || n.Target != nil || n.Context != nil || n.Actor != nil {
		t.Fatal(n)
	}
	raw, _ := json.Marshal(s.state)
	if strings.Contains(string(raw), "notificationDrafts") || strings.Contains(string(raw), "rollback-event") {
		t.Fatal("transient events in state serialization")
	}
}
func TestNotificationMemoryCircleCurrentPermissionProjection(t *testing.T) {
	_, _, h := notificationFixture(t)
	owner := memberCookie(t, h)
	person, peer := circleUser(t, h, "noticecircle")
	c := createdCircle(t, h, owner, "private", "approval")
	base := "/circles/" + c.ID
	invite := payload[struct{ Token string }](t, call(t, h, "POST", base+"/invites", map[string]int{"maxUses": 1}, owner))
	join := payload[CircleJoinResult](t, call(t, h, "POST", base+"/join", map[string]string{"inviteToken": invite.Token, "note": "申请私密附言"}, peer))
	n := requireNotice(t, notificationsPage(t, h, owner), "circle-request", "")
	if !n.Available || n.Context.Excerpt != "申请私密附言" {
		t.Fatal(n)
	}
	requireCode(t, call(t, h, "POST", base+"/requests/"+join.Request.ID+"/respond", map[string]string{"action": "accept"}, owner), 200)
	requireNotice(t, notificationsPage(t, h, peer), "circle-decision", "accepted")
	requireCode(t, call(t, h, "PATCH", base+"/members/"+person.ID, map[string]string{"role": "admin"}, owner), 200)
	m := requireNotice(t, notificationsPage(t, h, peer), "circle-membership", "admin")
	if !m.Available || m.Actor != nil {
		t.Fatal(m)
	}
	requireCode(t, call(t, h, "POST", base+"/members/"+person.ID+"/remove", map[string]bool{"ban": true}, owner), 200)
	for _, v := range notificationsPage(t, h, peer).Items {
		if v.Available || v.Actor != nil || v.Context != nil || v.Target != nil {
			t.Fatal("private history leaked after ban", v)
		}
	}
	requireCode(t, call(t, h, "POST", base+"/members/"+person.ID+"/unban", map[string]any{}, owner), 200)
	requireNotice(t, notificationsPage(t, h, peer), "circle-membership", "unbanned")
	serialized, _ := json.Marshal(notificationsPage(t, h, peer))
	if strings.Contains(string(serialized), invite.Token) || strings.Contains(string(serialized), "申请私密附言") {
		t.Fatal("private data leaked")
	}
}
