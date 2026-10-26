package platform

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func eventGoverned(t *testing.T, h http.Handler, admin *http.Cookie, e CircleEvent, moderation string) CircleEvent {
	t.Helper()
	res := call(t, h, "PATCH", "/admin/circle-events/"+e.ID, map[string]any{"moderation": moderation, "note": "活动治理内部说明，不得进入通知", "revision": e.Revision}, admin)
	requireCode(t, res, 200)
	return payload[AdminCircleEvent](t, res).CircleEvent
}
func TestCircleEventPostgresRestoreQueueCutoffAndRevision(t *testing.T) {
	ctx, s, _, a, h := postgresMediaFixture(t)
	owner, admin := memberCookie(t, h), adminCookie(t, h)
	_, p1 := circleUser(t, h, "eventrestoreone")
	_, p2 := circleUser(t, h, "eventrestoretwo")
	_, outsider := circleUser(t, h, "eventrestorenone")
	c := createdCircle(t, h, owner, "public", "open")
	base := "/circles/" + c.ID
	for _, cookie := range []*http.Cookie{p1, p2} {
		requireCode(t, call(t, h, "POST", base+"/join", map[string]any{}, cookie), 200)
	}
	e := createdEvent(t, h, owner, c.ID, eventInputForTest(a.now(), 1))
	eventRegistrationPayload(t, eventRegistrationCall(t, h, owner, e, "join", "restore-owner-join"))
	eventRegistrationPayload(t, eventRegistrationCall(t, h, p1, e, "waitlist", "restore-first-wait"))
	eventRegistrationPayload(t, eventRegistrationCall(t, h, p2, e, "waitlist", "restore-second-wait"))
	e = eventGoverned(t, h, admin, e, "hidden")
	eventRegistrationPayload(t, eventRegistrationCall(t, h, owner, e, "leave", "hidden-owner-leave"))
	if v := eventRead(t, h, owner, e); v.RegisteredCount != 0 || v.WaitlistedCount != 2 {
		t.Fatal(v)
	}
	e = eventGoverned(t, h, admin, e, "visible")
	if v := eventRead(t, h, p1, e); v.MyRegistration.Status != "registered" || v.WaitlistedCount != 1 {
		t.Fatal("restore did not coordinate", v)
	}
	requireCode(t, call(t, h, "PATCH", "/admin/circles/"+c.ID, map[string]string{"status": "suspended", "note": "暂停保留登记"}, admin), 200)
	requireCode(t, call(t, h, "GET", eventPath(e), nil, p1), 404)
	reg := eventRegistrationPayload(t, eventRegistrationCall(t, h, p1, e, "leave", "paused-member-leave"))
	if reg.Status != "cancelled" {
		t.Fatal(reg)
	}
	requireCode(t, eventRegistrationCall(t, h, outsider, e, "leave", "outsider-no-history"), 404)
	if confirmed := notificationCount(t, ctx, s, `SELECT registered_count FROM gongming_circle_events WHERE id=$1`, e.ID); confirmed != 0 {
		t.Fatal("paused leave did not release")
	}
	requireCode(t, call(t, h, "PATCH", "/admin/circles/"+c.ID, map[string]string{"status": "active", "note": "恢复时协调有效候补"}, admin), 200)
	if v := eventRead(t, h, p2, e); v.MyRegistration.Status != "registered" || v.WaitlistedCount != 0 {
		t.Fatal("circle restore did not coordinate", v)
	}
	eventRegistrationPayload(t, eventRegistrationCall(t, h, owner, e, "waitlist", "owner-later-waitlist"))
	deadline := e.RegistrationClosesAt.Add(time.Second)
	a.now = func() time.Time { return deadline }
	eventRegistrationPayload(t, eventRegistrationCall(t, h, p2, e, "leave", "after-cutoff-leave"))
	v := eventRead(t, h, owner, e)
	if v.RegisteredCount != 0 || v.WaitlistedCount != 1 || v.MyRegistration.Status != "waitlisted" || v.RegistrationOpen {
		t.Fatal("cutoff promoted a waiter", v)
	}
	requireCode(t, eventRegistrationCall(t, h, p1, e, "join", "after-cutoff-new-join"), 409)
	input := v.EventInput
	input.Capacity = 2
	res := call(t, h, "PATCH", eventPath(e), struct {
		EventInput
		Revision int64 `json:"revision"`
	}{input, v.Revision}, owner)
	requireCode(t, res, 200)
	v = payload[CircleEvent](t, res)
	if v.RegisteredCount != 0 || v.WaitlistedCount != 1 {
		t.Fatal("edit promoted after cutoff", v)
	}
	input.RegistrationClosesAt = deadline.Add(time.Hour)
	res = call(t, h, "PATCH", eventPath(e), struct {
		EventInput
		Revision int64 `json:"revision"`
	}{input, v.Revision}, owner)
	requireCode(t, res, 200)
	v = payload[CircleEvent](t, res)
	if v.RegisteredCount != 1 || v.MyRegistration.Status != "registered" {
		t.Fatal("extended cutoff did not coordinate", v)
	}
	if n := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_notifications WHERE kind='circle-event-registration' AND recipient_id='user_demo' AND reference_id=$1`, e.ID); n != 0 {
		t.Fatal("self operation generated promotion noise")
	}
	// Archive retains original registrations, denies new actions, allows blind
	// leave and current managers to inspect historical attendee data.
	requireCode(t, call(t, h, "DELETE", base, nil, owner), 200)
	if v := eventRead(t, h, owner, e); v.RegisteredCount != 1 || v.RegistrationOpen {
		t.Fatal("archive erased registration", v)
	}
	eventRegistrationPayload(t, eventRegistrationCall(t, h, owner, e, "leave", "archived-own-leave"))
	requireCode(t, eventRegistrationCall(t, h, p1, e, "join", "archive-new-join"), 409)
}

func TestCircleEventPostgresFailedJoinRollsBackCoordinationAndNotifications(t *testing.T) {
	ctx, s, _, a, h := postgresMediaFixture(t)
	owner, admin := memberCookie(t, h), adminCookie(t, h)
	_, waiting := circleUser(t, h, "eventrollbackwait")
	_, newcomer := circleUser(t, h, "eventrollbacknew")
	c := createdCircle(t, h, owner, "public", "open")
	for _, cookie := range []*http.Cookie{waiting, newcomer} {
		requireCode(t, call(t, h, "POST", "/circles/"+c.ID+"/join", map[string]any{}, cookie), 200)
	}
	e := createdEvent(t, h, owner, c.ID, eventInputForTest(a.now(), 1))
	eventRegistrationPayload(t, eventRegistrationCall(t, h, owner, e, "join", "rollback-owner-join"))
	eventRegistrationPayload(t, eventRegistrationCall(t, h, waiting, e, "waitlist", "rollback-waiting-key"))
	e = eventGoverned(t, h, admin, e, "hidden")
	eventRegistrationPayload(t, eventRegistrationCall(t, h, owner, e, "leave", "rollback-owner-leave"))
	// Simulate an old writer's valid backlog: visible with a free slot and an
	// existing waiter. Normal restore now coordinates it in the same transaction.
	if _, err := s.pool.Exec(ctx, `UPDATE gongming_circle_events SET moderation='visible',revision=revision+1 WHERE id=$1`, e.ID); err != nil {
		t.Fatal(err)
	}
	requireCode(t, eventRegistrationCall(t, h, newcomer, e, "join", "failed-newcomer-join"), 409)
	if v := eventRead(t, h, waiting, e); v.RegisteredCount != 0 || v.MyRegistration.Status != "waitlisted" {
		t.Fatal("failed join committed partial promotion", v)
	}
	if n := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_notifications WHERE kind='circle-event-registration' AND reference_id=$1`, e.ID); n != 0 {
		t.Fatal("failed join committed notification")
	}
	if n := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_circle_event_requests WHERE event_id=$1 AND client_id='failed-newcomer-join'`, e.ID); n != 0 {
		t.Fatal("failed request saved receipt")
	}
	reg := eventRegistrationPayload(t, eventRegistrationCall(t, h, newcomer, e, "waitlist", "successful-newcomer-wait"))
	if reg.Status != "waitlisted" || *reg.QueuePosition != 1 {
		t.Fatal(reg)
	}
	if v := eventRead(t, h, waiting, e); v.MyRegistration.Status != "registered" {
		t.Fatal("new waiter inserted ahead of old waiter", v)
	}
	// Inbox failure also rolls back a genuine capacity increase/promotion/edit.
	_, err := s.pool.Exec(ctx, `CREATE FUNCTION event_notice_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'reject notification' USING ERRCODE='23514'; END $$;CREATE TRIGGER event_notice_reject BEFORE INSERT ON gongming_notifications FOR EACH ROW EXECUTE FUNCTION event_notice_reject()`)
	if err != nil {
		t.Fatal(err)
	}
	current := eventRead(t, h, owner, e)
	input := current.EventInput
	input.Capacity = 2
	requireCode(t, call(t, h, "PATCH", eventPath(e), struct {
		EventInput
		Revision int64 `json:"revision"`
	}{input, current.Revision}, owner), 500)
	if v := eventRead(t, h, owner, e); v.Capacity != 1 || v.Revision != current.Revision || v.WaitlistedCount != 1 {
		t.Fatal("failed notification partially committed edit", v)
	}
}

func TestCircleEventPostgresMemberAndAccountReconciliationSnapshotRaces(t *testing.T) {
	ctx, s, dsn, a, h := postgresMediaFixture(t)
	owner, admin := memberCookie(t, h), adminCookie(t, h)
	person, peer := circleUser(t, h, "eventreconcile")
	otherUser, otherCookie := circleUser(t, h, "eventreconcilewait")
	c := createdCircle(t, h, owner, "public", "open")
	for _, cookie := range []*http.Cookie{peer, otherCookie} {
		requireCode(t, call(t, h, "POST", "/circles/"+c.ID+"/join", map[string]any{}, cookie), 200)
	}
	other, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	h2 := NewApp(other, a.cfg).Handler()
	for _, lockSQLFirst := range []bool{false, true} {
		e := createdEvent(t, h, owner, c.ID, eventInputForTest(a.now(), 1))
		loaded := make(chan struct{})
		release := make(chan struct{})
		done := make(chan error, 1)
		var first sync.Once
		var attempts atomic.Int32
		var pending pgx.Tx
		if lockSQLFirst {
			pending, err = other.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
			if err != nil {
				t.Fatal(err)
			}
			raw := `{"intent":"join","clientId":"sql-pending-join"}`
			r := httptest.NewRequest("POST", "http://localhost:8080/api/v1"+eventPath(e)+"/registration", strings.NewReader(raw))
			r.SetPathValue("id", c.ID)
			r.SetPathValue("eventId", e.ID)
			r.AddCookie(peer)
			r.Header.Set("Content-Type", "application/json")
			u, er := a.messagingSQLActor(r, pending, true)
			if er != nil {
				t.Fatal(er)
			}
			drafts := []NotificationDraft{}
			if _, er = eventSQLRegister(r, pending, u, a.circleNow(), &drafts); er != nil {
				t.Fatal(er)
			}
		}
		go func() {
			done <- s.Update(ctx, func(st *State) error {
				attempts.Add(1)
				first.Do(func() { close(loaded); <-release })
				m := st.CircleMembers[circleMemberKey(c.ID, person.ID)]
				m.Status = "removed"
				m.UpdatedAt = time.Now().UTC()
				st.CircleMembers[circleMemberKey(c.ID, person.ID)] = m
				return nil
			})
		}()
		<-loaded
		if lockSQLFirst {
			close(release)
			if err = pending.Commit(ctx); err != nil {
				t.Fatal(err)
			}
		} else {
			eventRegistrationPayload(t, eventRegistrationCall(t, h2, peer, e, "join", "late-sql-success"))
			close(release)
		}
		if err = <-done; err != nil {
			t.Fatal(err)
		}
		if attempts.Load() < 2 {
			t.Fatal("stale membership snapshot did not retry")
		}
		if current := eventRead(t, h, owner, e); current.RegisteredCount != 0 {
			t.Fatal("membership loss missed late SQL registration", current)
		}
		attendees := payload[struct{ Items []EventAttendee }](t, call(t, h, "GET", eventPath(e)+"/attendees", nil, owner))
		if len(attendees.Items) != 1 || attendees.Items[0].Registration.Status != "cancelled" || attendees.Items[0].Registration.Reason != "membership" {
			t.Fatal(attendees)
		}
		requireCode(t, call(t, h, "POST", "/circles/"+c.ID+"/join", map[string]any{}, peer), 200)
		if own := eventRead(t, h, peer, e).MyRegistration; own.Status != "cancelled" {
			t.Fatal("rejoin restored old registration")
		}
	}
	e := createdEvent(t, h, owner, c.ID, eventInputForTest(a.now(), 1))
	eventRegistrationPayload(t, eventRegistrationCall(t, h, peer, e, "join", "account-join-first"))
	eventRegistrationPayload(t, eventRegistrationCall(t, h, otherCookie, e, "waitlist", "account-next-wait"))
	requireCode(t, call(t, h, "PATCH", "/admin/users/"+person.ID, map[string]string{"status": "suspended"}, admin), 200)
	if v := eventRead(t, h, otherCookie, e); v.MyRegistration.Status != "registered" {
		t.Fatal("account suspend did not release/promote", v)
	}
	if n := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_circle_event_registrations WHERE event_id=$1 AND user_id=$2 AND status='cancelled' AND reason='account'`, e.ID, person.ID); n != 1 {
		t.Fatal("missing account release")
	}
	if n := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_notifications WHERE reference_id=$1 AND recipient_id=$2 AND kind='circle-event-registration'`, e.ID, otherUser.ID); n != 1 {
		t.Fatal("promotion notification", n)
	}
}

func TestCircleEventPostgresCreatorReviewPrivacyReportAndConstraints(t *testing.T) {
	ctx, s, _, a, h := postgresMediaFixture(t)
	owner, admin := memberCookie(t, h), adminCookie(t, h)
	person, peer := circleUser(t, h, "eventnewowner")
	c := createdCircle(t, h, owner, "public", "open")
	base := "/circles/" + c.ID
	requireCode(t, call(t, h, "POST", base+"/join", map[string]any{}, peer), 200)
	e := createdEvent(t, h, owner, c.ID, eventInputForTest(a.now(), 1))
	eventRegistrationPayload(t, eventRegistrationCall(t, h, peer, e, "join", "creator-review-booking"))
	requireCode(t, call(t, h, "POST", base+"/owner", map[string]string{"userId": person.ID}, owner), 200)
	requireCode(t, call(t, h, "POST", base+"/leave", map[string]any{}, owner), 200)
	e = eventGoverned(t, h, admin, e, "hidden")
	n := requireNotice(t, notificationsPage(t, h, owner), "circle-event-review", "hidden")
	if n.Available || n.Actor != nil || n.Context != nil || n.Target != nil {
		t.Fatal("former creator did not get redacted result", n)
	}
	if n := requireNotice(t, notificationsPage(t, h, peer), "circle-event-review", "hidden"); !n.Available || n.Actor != nil || n.Target.Type != "circle-event" {
		t.Fatal(n)
	}
	reportRes := call(t, h, "POST", eventPath(e)+"/report", map[string]string{"reason": "活动内容审核"}, peer)
	requireCode(t, reportRes, 201)
	report := payload[Report](t, reportRes)
	if report.TargetType != "circle-event" || report.TargetID != e.ID {
		t.Fatal(report)
	}
	requireCode(t, call(t, h, "POST", eventPath(e)+"/report", map[string]string{"reason": "重复"}, peer), 409)
	requireCode(t, call(t, h, "POST", eventPath(e)+"/report", map[string]string{"reason": "退出后"}, owner), 404)
	requireCode(t, call(t, h, "PATCH", "/admin/reports/"+report.ID, map[string]string{"status": "resolved", "note": "内部不可通知的活动审核说明"}, admin), 200)
	requireNotice(t, notificationsPage(t, h, peer), "report-review", "resolved")
	for _, query := range []string{`DELETE FROM gongming_circle_events WHERE id=$1`, `DELETE FROM gongming_circle_event_registrations WHERE event_id=$1`, `DELETE FROM gongming_circle_event_requests WHERE event_id=$1`, `UPDATE gongming_circle_events SET creator_id='user_admin' WHERE id=$1`, `UPDATE gongming_circle_events SET registered_count=0 WHERE id=$1`, `UPDATE gongming_circle_events SET title='without revision' WHERE id=$1`} {
		_, err := s.pool.Exec(ctx, query, e.ID)
		expectDatabaseCode(t, err, "23514")
	}
	for _, query := range []string{`UPDATE gongming_circle_event_requests SET intent='leave' WHERE event_id=$1`, `UPDATE gongming_circle_event_registrations SET ordinal=0 WHERE event_id=$1`} {
		_, err := s.pool.Exec(ctx, query, e.ID)
		expectDatabaseCode(t, err, "23514")
	}
	empty := createdEvent(t, h, peer, c.ID, eventInputForTest(a.now(), 1))
	_, err := s.pool.Exec(ctx, `DELETE FROM gongming_circle_events WHERE id=$1`, empty.ID)
	expectDatabaseCode(t, err, "23514")
	_, err = s.pool.Exec(ctx, `INSERT INTO gongming_circle_event_requests(event_id,user_id,client_id,intent,created_at) VALUES($1,'does-not-exist','bad-user-request','join',now())`, e.ID)
	expectDatabaseCode(t, err, "23503")
	res := call(t, h, "GET", "/admin/circle-events?q="+e.ID+"&moderation=hidden", nil, admin)
	requireCode(t, res, 200)
	if page := payload[struct {
		Items []AdminCircleEvent
		Total int
	}](t, res); page.Total != 1 || len(page.Items) != 1 || page.Items[0].MyRegistration != nil {
		t.Fatal(page)
	}
	if err = s.Read(ctx, func(st *State) error {
		raw, _ := json.Marshal(st)
		if strings.Contains(string(raw), e.Description) {
			return fmt.Errorf("event description entered State")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
