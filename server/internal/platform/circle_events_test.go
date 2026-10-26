package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func eventInputForTest(now time.Time, capacity int) EventInput {
	return EventInput{Title: "真实活动测试", Description: "私密圈活动介绍，仅当前成员可读", Mode: "offline", Location: "私密活动地点", StartsAt: now.UTC().Truncate(time.Microsecond).Add(48 * time.Hour), EndsAt: now.UTC().Truncate(time.Microsecond).Add(50 * time.Hour), RegistrationClosesAt: now.UTC().Truncate(time.Microsecond).Add(24 * time.Hour), Capacity: capacity}
}
func createdEvent(t *testing.T, h http.Handler, owner *http.Cookie, circle string, input EventInput) CircleEvent {
	t.Helper()
	res := call(t, h, "POST", "/circles/"+circle+"/events", struct {
		EventInput
		ClientID string `json:"clientId"`
	}{input, newID("event-client-")}, owner)
	requireCode(t, res, 201)
	return payload[CircleEvent](t, res)
}
func eventPath(e CircleEvent) string { return "/circles/" + e.CircleID + "/events/" + e.ID }
func eventRead(t *testing.T, h http.Handler, cookie *http.Cookie, e CircleEvent) CircleEvent {
	t.Helper()
	res := call(t, h, "GET", eventPath(e), nil, cookie)
	requireCode(t, res, 200)
	return payload[CircleEvent](t, res)
}
func eventRegistrationCall(t *testing.T, h http.Handler, cookie *http.Cookie, e CircleEvent, intent, client string) response {
	t.Helper()
	return call(t, h, "POST", eventPath(e)+"/registration", map[string]string{"intent": intent, "clientId": client}, cookie)
}
func eventRegistrationPayload(t *testing.T, res response) *EventRegistration {
	t.Helper()
	requireCode(t, res, 200)
	return payload[struct{ Registration *EventRegistration }](t, res).Registration
}
func TestCircleEventPostgresPermissionsRevisionAndTime(t *testing.T) {
	ctx, s, _, a, h := postgresMediaFixture(t)
	owner, admin := memberCookie(t, h), adminCookie(t, h)
	person, peer := circleUser(t, h, "eventpermissions")
	c := createdCircle(t, h, owner, "public", "open")
	base := "/circles/" + c.ID
	for _, cookie := range []*http.Cookie{nil, admin, peer} {
		status := 404
		if cookie == nil {
			status = 401
		}
		requireCode(t, call(t, h, "GET", base+"/events", nil, cookie), status)
	}
	requireCode(t, call(t, h, "POST", base+"/join", map[string]any{}, peer), 200)
	input := eventInputForTest(a.now(), 2)
	client := newID("event-fixed-")
	createBody := struct {
		EventInput
		ClientID string `json:"clientId"`
	}{input, client}
	res := call(t, h, "POST", base+"/events", createBody, owner)
	requireCode(t, res, 201)
	e := payload[CircleEvent](t, res)
	if e.Revision != 1 || e.Phase != "upcoming" || !e.RegistrationOpen || e.Creator.ID != "user_demo" {
		t.Fatal(e)
	}
	repeated := call(t, h, "POST", base+"/events", createBody, owner)
	requireCode(t, repeated, 201)
	if string(res.Data) != string(repeated.Data) {
		t.Fatal("creation idempotency")
	}
	input.Title = "已编辑当前活动"
	patch := struct {
		EventInput
		Revision int64 `json:"revision"`
	}{input, e.Revision}
	res = call(t, h, "PATCH", eventPath(e), patch, owner)
	requireCode(t, res, 200)
	e = payload[CircleEvent](t, res)
	if e.Revision != 2 {
		t.Fatal(e)
	}
	requireCode(t, call(t, h, "PATCH", eventPath(e), patch, owner), 409)
	patch.Revision = e.Revision
	res = call(t, h, "PATCH", eventPath(e), patch, owner)
	requireCode(t, res, 200)
	if payload[CircleEvent](t, res).Revision != e.Revision {
		t.Fatal("same payload mutated revision")
	}
	res = call(t, h, "POST", base+"/events", createBody, owner)
	requireCode(t, res, 201)
	if payload[CircleEvent](t, res).Title != input.Title {
		t.Fatal("old create returned historical body")
	}
	wrong := createBody
	wrong.Title = "different reused key"
	requireCode(t, call(t, h, "POST", base+"/events", wrong, owner), 409)
	requireCode(t, call(t, h, "GET", eventPath(e)+"/attendees", nil, peer), 403)
	requireCode(t, call(t, h, "PATCH", eventPath(e), patch, peer), 403)
	other := createdCircle(t, h, owner, "public", "open")
	requireCode(t, call(t, h, "GET", "/circles/"+other.ID+"/events/"+e.ID, nil, owner), 404)
	adminRes := call(t, h, "PATCH", "/admin/circle-events/"+e.ID, map[string]any{"moderation": "hidden", "note": "不能进入普通通知的内部说明", "revision": e.Revision}, admin)
	requireCode(t, adminRes, 200)
	governed := payload[AdminCircleEvent](t, adminRes)
	e.Revision = governed.Revision
	requireCode(t, call(t, h, "GET", eventPath(e), nil, peer), 404)
	listRes := call(t, h, "GET", base+"/events?view=all", nil, peer)
	requireCode(t, listRes, 200)
	if payload[struct{ Total int }](t, listRes).Total != 0 {
		t.Fatal("hidden event count leaked")
	}
	requireCode(t, call(t, h, "GET", eventPath(e), nil, admin), 404)
	// A creator who loses circle management cannot reuse creation to read hidden.
	requireCode(t, call(t, h, "POST", base+"/owner", map[string]string{"userId": person.ID}, owner), 200)
	requireCode(t, call(t, h, "PATCH", base+"/members/user_demo", map[string]string{"role": "member"}, peer), 200)
	requireCode(t, call(t, h, "POST", base+"/events", createBody, owner), 403)
	requireCode(t, call(t, h, "GET", eventPath(e), nil, owner), 404)
	for _, invalid := range []EventInput{eventInputForTest(a.now().Add(-400*24*time.Hour), 1), func() EventInput {
		v := eventInputForTest(a.now(), 1)
		v.EndsAt = v.StartsAt.Add(8 * 24 * time.Hour)
		return v
	}(), func() EventInput {
		v := eventInputForTest(a.now(), 1)
		v.RegistrationClosesAt = a.now().Add(-time.Hour)
		return v
	}()} {
		requireCode(t, call(t, h, "POST", base+"/events", struct {
			EventInput
			ClientID string `json:"clientId"`
		}{invalid, newID("invalid-")}, peer), 400)
	}
	if err := s.Read(ctx, func(state *State) error {
		raw, _ := json.Marshal(state)
		if bytes.Contains(raw, []byte(e.Description)) || bytes.Contains(raw, []byte(e.Location)) || len(state.EventSeedDrafts) != 0 {
			t.Fatal("activity history loaded into State")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestCircleEventPostgresCapacityWaitlistReceiptsAndCancel(t *testing.T) {
	ctx, _, dsn, a, h := postgresMediaFixture(t)
	owner := memberCookie(t, h)
	one, c1 := circleUser(t, h, "eventcapacityone")
	two, c2 := circleUser(t, h, "eventcapacitytwo")
	_, c3 := circleUser(t, h, "eventcapacitythree")
	c := createdCircle(t, h, owner, "public", "open")
	for _, cookie := range []*http.Cookie{c1, c2, c3} {
		requireCode(t, call(t, h, "POST", "/circles/"+c.ID+"/join", map[string]any{}, cookie), 200)
	}
	e := createdEvent(t, h, owner, c.ID, eventInputForTest(a.now(), 1))
	other, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	h2 := NewApp(other, a.cfg).Handler()
	var wg sync.WaitGroup
	responses := make(chan struct {
		res    response
		cookie *http.Cookie
		user   PublicUser
		client string
	}, 2)
	for i, v := range []struct {
		cookie *http.Cookie
		user   PublicUser
	}{{c1, one}, {c2, two}} {
		wg.Add(1)
		go func(i int, v struct {
			cookie *http.Cookie
			user   PublicUser
		}) {
			defer wg.Done()
			handler := h
			if i == 1 {
				handler = h2
			}
			client := newID("join-fixed-")
			responses <- struct {
				res    response
				cookie *http.Cookie
				user   PublicUser
				client string
			}{eventRegistrationCall(t, handler, v.cookie, e, "join", client), v.cookie, v.user, client}
		}(i, v)
	}
	wg.Wait()
	close(responses)
	var winner, loser *http.Cookie
	var originalClient string
	for v := range responses {
		if v.res.Code == 200 {
			if winner != nil {
				t.Fatal("two final seats")
			}
			winner = v.cookie
			originalClient = v.client
		} else {
			requireCode(t, v.res, 409)
			loser = v.cookie
		}
	}
	reg := eventRegistrationPayload(t, eventRegistrationCall(t, h, loser, e, "waitlist", "waitlist-first-key"))
	if reg.Status != "waitlisted" || reg.QueuePosition == nil || *reg.QueuePosition != 1 {
		t.Fatal(reg)
	}
	reg = eventRegistrationPayload(t, eventRegistrationCall(t, h, c3, e, "waitlist", "waitlist-second-key"))
	if *reg.QueuePosition != 2 {
		t.Fatal(reg)
	}
	requireCode(t, eventRegistrationCall(t, h, c3, e, "join", "full-join-error-key"), 200) // Already waitlisted stays in place.
	reg = eventRegistrationPayload(t, eventRegistrationCall(t, h, winner, e, "leave", "leave-first-key"))
	if reg.Status != "cancelled" || reg.Reason != "user" {
		t.Fatal(reg)
	}
	if detail := eventRead(t, h2, loser, e); detail.RegisteredCount != 1 || detail.WaitlistedCount != 1 || detail.MyRegistration.Status != "registered" {
		t.Fatal(detail)
	}
	page := notificationsPage(t, h, loser)
	n := requireNotice(t, page, "circle-event-registration", "promoted")
	if !n.Available || n.Actor != nil || n.Target.Type != "circle-event" || n.Target.EventID != e.ID {
		t.Fatal(n)
	}
	// Old successful join is a receipt, not a request to resurrect the old seat.
	reg = eventRegistrationPayload(t, eventRegistrationCall(t, h, winner, e, "join", originalClient))
	if reg.Status != "cancelled" {
		t.Fatal("old join revived registration", reg)
	}
	reg = eventRegistrationPayload(t, eventRegistrationCall(t, h, winner, e, "waitlist", "second-cycle-waitlist"))
	if reg.Status != "waitlisted" || *reg.QueuePosition != 2 {
		t.Fatal(reg)
	}
	reg = eventRegistrationPayload(t, eventRegistrationCall(t, h, winner, e, "leave", "leave-first-key"))
	if reg.Status != "waitlisted" {
		t.Fatal("old leave cancelled later registration", reg)
	}
	requireCode(t, eventRegistrationCall(t, h, winner, e, "join", "leave-first-key"), 409)
	updated := eventRead(t, h, owner, e)
	res := call(t, h, "POST", eventPath(e)+"/cancel", map[string]int64{"revision": updated.Revision}, owner)
	requireCode(t, res, 200)
	cancelled := payload[CircleEvent](t, res)
	if cancelled.Lifecycle != "cancelled" || cancelled.RegisteredCount != 0 || cancelled.WaitlistedCount != 0 {
		t.Fatal(cancelled)
	}
	requireCode(t, call(t, h, "POST", eventPath(e)+"/cancel", map[string]int64{"revision": updated.Revision}, owner), 200)
	requireCode(t, call(t, h, "PATCH", eventPath(e), struct {
		EventInput
		Revision int64 `json:"revision"`
	}{updated.EventInput, cancelled.Revision}, owner), 409)
	for _, cookie := range []*http.Cookie{winner, loser, c3} {
		if reg := eventRead(t, h, cookie, e).MyRegistration; reg.Status != "cancelled" || reg.Reason != "event" {
			t.Fatal(reg)
		}
	}
	list := call(t, h, "GET", eventPath(e)+"/attendees?status=cancelled&limit=2", nil, owner)
	requireCode(t, list, 200)
	if p := payload[struct {
		Items []EventAttendee
		Total int
	}](t, list); p.Total != 3 || len(p.Items) != 2 {
		t.Fatal(p)
	}
}

func TestCircleEventPostgresSQLPathsIgnoreUnrelatedTableLocks(t *testing.T) {
	ctx, s, _, a, h := postgresMediaFixture(t)
	owner := memberCookie(t, h)
	c := createdCircle(t, h, owner, "public", "open")
	e := createdEvent(t, h, owner, c.ID, eventInputForTest(a.now(), 2))
	lock, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback(ctx)
	if _, err = lock.Exec(ctx, `LOCK TABLE gongming_posts,gongming_comments,gongming_messages,gongming_wallets,gongming_documents,gongming_media_assets,gongming_friend_requests IN ACCESS EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}
	for _, req := range []struct {
		method, path string
		body         any
	}{{"GET", "/circles/" + c.ID + "/events", nil}, {"GET", eventPath(e), nil}, {"GET", eventPath(e) + "/attendees", nil}, {"POST", eventPath(e) + "/registration", map[string]string{"intent": "join", "clientId": "domain-sql-event-join"}}, {"POST", eventPath(e) + "/registration", map[string]string{"intent": "leave", "clientId": "domain-sql-event-leave"}}, {"PATCH", eventPath(e), struct {
		EventInput
		Revision int64 `json:"revision"`
	}{e.EventInput, e.Revision}}} {
		raw, _ := json.Marshal(req.body)
		r := httptest.NewRequest(req.method, "http://localhost:8080/api/v1"+req.path, bytes.NewReader(raw))
		requestCtx, cancel := context.WithTimeout(ctx, time.Second)
		r = r.WithContext(requestCtx)
		r.AddCookie(owner)
		r.Header.Set("Origin", "http://localhost:5173")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		cancel()
		if w.Code != 200 {
			t.Fatalf("domain SQL blocked %s %d %s", req.path, w.Code, w.Body.String())
		}
	}
}

func TestCircleEventInputValidation(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Microsecond)
	valid := eventInputForTest(now, 1)
	if _, err := cleanEventInput(valid); err != nil {
		t.Fatal(err)
	}
	invalid := valid
	invalid.Title = strings.Repeat("界", 81)
	if _, err := cleanEventInput(invalid); err == nil {
		t.Fatal("unbounded title")
	}
	invalid = valid
	invalid.Mode = "future-kind"
	if _, err := cleanEventInput(invalid); err == nil {
		t.Fatal("invalid mode")
	}
}
