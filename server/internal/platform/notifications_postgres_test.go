package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func clearNotificationInbox(t *testing.T, ctx context.Context, s *PostgresStore) {
	t.Helper()
	if _, err := s.pool.Exec(ctx, `TRUNCATE gongming_notifications,gongming_notification_counters`); err != nil {
		t.Fatal(err)
	}
}
func notificationCount(t *testing.T, ctx context.Context, s *PostgresStore, query string, args ...any) int {
	t.Helper()
	var n int
	if err := s.pool.QueryRow(ctx, query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
func notificationPost(t *testing.T, h http.Handler, cookie *http.Cookie, images []string) Post {
	t.Helper()
	res := call(t, h, "POST", "/posts", map[string]any{"body": "通知测试中的当前世界正文", "images": images}, cookie)
	requireCode(t, res, 200)
	return payload[Post](t, res)
}
func TestNotificationPostgresAtomicBusinessEventsAndLifetimeDedup(t *testing.T) {
	ctx, s, dsn, a, h := postgresMediaFixture(t)
	owner, admin := memberCookie(t, h), adminCookie(t, h)
	_, peer := circleUser(t, h, "noticepgpeer")
	clearNotificationInbox(t, ctx, s)
	other, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	h2 := NewApp(other, a.cfg).Handler()
	responses := make(chan response, 2)
	var wg sync.WaitGroup
	for _, handler := range []http.Handler{h, h2} {
		wg.Add(1)
		go func(handler http.Handler) {
			defer wg.Done()
			responses <- call(t, handler, "POST", "/friend-requests", map[string]string{"userId": "user_demo", "note": "好友附言"}, peer)
		}(handler)
	}
	wg.Wait()
	close(responses)
	var requestID string
	for res := range responses {
		requireCode(t, res, 200)
		id := payload[FriendRequest](t, res).ID
		if requestID != "" && requestID != id {
			t.Fatal("concurrent idempotency failed")
		}
		requestID = id
	}
	if page := notificationsPage(t, h, owner); page.Total != 1 {
		t.Fatal(page)
	}
	for i := 0; i < 2; i++ {
		requireCode(t, call(t, h, "POST", "/friend-requests/"+requestID+"/respond", map[string]string{"action": "accept"}, owner), 200)
	}
	if page := notificationsPage(t, h2, peer); page.Total != 1 || page.Items[0].Kind != "friend-decision" {
		t.Fatal(page)
	}
	post := notificationPost(t, h, owner, nil)
	for _, liked := range []bool{true, true, false, true, false, true} {
		requireCode(t, call(t, h, "POST", "/posts/"+post.ID+"/like", map[string]bool{"liked": liked}, peer), 200)
	}
	for _, handler := range []http.Handler{h, h2} {
		wg.Add(1)
		go func(handler http.Handler) {
			defer wg.Done()
			res := call(t, handler, "POST", "/posts/"+post.ID+"/like", map[string]bool{"liked": true}, peer)
			requireCode(t, res, 200)
		}(handler)
	}
	wg.Wait()
	if n := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_notifications WHERE kind='world-like'`); n != 1 {
		t.Fatal("like lifetime dedup", n)
	}
	requireCode(t, call(t, h, "POST", "/posts/"+post.ID+"/like", map[string]bool{"liked": true}, owner), 200)
	before := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_comments WHERE post_id=$1`, post.ID)
	_, err = s.pool.Exec(ctx, `CREATE FUNCTION notification_reject_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'inbox failure' USING ERRCODE='23514'; END $$;CREATE TRIGGER notification_reject BEFORE INSERT ON gongming_notifications FOR EACH ROW EXECUTE FUNCTION notification_reject_test()`)
	if err != nil {
		t.Fatal(err)
	}
	requireCode(t, call(t, h, "POST", "/posts/"+post.ID+"/comments", map[string]string{"body": "must roll back"}, peer), 500)
	if n := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_comments WHERE post_id=$1`, post.ID); n != before {
		t.Fatal("business committed without notification")
	}
	audits := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_audits`)
	requireCode(t, call(t, h, "PATCH", "/admin/posts/"+post.ID, map[string]string{"status": "hidden"}, admin), 500)
	if n := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_audits`); n != audits {
		t.Fatal("audit committed without notification")
	}
	if _, err = s.pool.Exec(ctx, `DROP TRIGGER notification_reject ON gongming_notifications`); err != nil {
		t.Fatal(err)
	}
	if detail := payload[Post](t, call(t, h2, "GET", "/posts/"+post.ID, nil, owner)); detail.Status != "published" {
		t.Fatal("moderation partially committed")
	}
	requireCode(t, call(t, h, "POST", "/posts/"+post.ID+"/comments", map[string]string{"body": "committed current comment"}, peer), 200)
	requireNotice(t, notificationsPage(t, h2, owner), "world-comment", "")
	for i := 0; i < 2; i++ {
		requireCode(t, call(t, h, "PATCH", "/admin/posts/"+post.ID, map[string]string{"status": "hidden"}, admin), 200)
	}
	if n := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_notifications WHERE kind='world-review'`); n != 1 {
		t.Fatal("same moderation status duplicated", n)
	}
	if err = s.Read(ctx, func(st *State) error {
		if len(st.NotificationDrafts) != 0 {
			t.Fatal("history loaded into State")
		}
		raw, _ := json.Marshal(st)
		if bytes.Contains(raw, []byte("notice_")) {
			t.Fatal("inbox history in normalized state")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestNotificationPostgresDomainSQLReadBoundsAndSessionGuards(t *testing.T) {
	ctx, s, dsn, a, h := postgresMediaFixture(t)
	owner := memberCookie(t, h)
	person, peer := circleUser(t, h, "noticepgread")
	clearNotificationInbox(t, ctx, s)
	requireCode(t, call(t, h, "POST", "/friend-requests", map[string]string{"userId": "user_demo"}, peer), 200)
	page := notificationsPage(t, h, owner)
	notice := page.Items[0]
	requireCode(t, call(t, h, "POST", "/notifications/"+notice.ID+"/read", map[string]any{}, peer), 404)
	requireCode(t, call(t, h, "POST", "/notifications/read-all", map[string]any{"throughId": notice.ID}, peer), 404)
	requireCode(t, request(t, h, "POST", "/notifications/read-all", map[string]any{"throughId": notice.ID}, owner, "https://bad.example"), 403)
	r := httptest.NewRequest("GET", "http://localhost:8080/api/v1/notifications/unread", nil)
	r.AddCookie(owner)
	r.Header.Set("X-Gongming-Account", person.ID)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 409 {
		t.Fatal(w.Code)
	}
	post := notificationPost(t, h, owner, nil)
	requireCode(t, call(t, h, "POST", "/posts/"+post.ID+"/comments", map[string]string{"body": "after throughId"}, peer), 200)
	other, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	h2 := NewApp(other, a.cfg).Handler()
	res := call(t, h2, "POST", "/notifications/read-all", map[string]any{"throughId": page.ThroughID}, owner)
	requireCode(t, res, 200)
	if v := payload[struct{ MarkedRead, UnreadTotal int }](t, res); v.MarkedRead != 1 || v.UnreadTotal != 1 {
		t.Fatal(v)
	}
	requireCode(t, call(t, h, "POST", "/notifications/read-all", map[string]any{"throughId": nil}, owner), 200)
	firstRead := call(t, h, "POST", "/notifications/"+notice.ID+"/read", map[string]any{}, owner)
	requireCode(t, firstRead, 200)
	a.now = func() time.Time { return time.Now().Add(time.Minute) }
	secondRead := call(t, h, "POST", "/notifications/"+notice.ID+"/read", map[string]any{}, owner)
	if string(firstRead.Data) != string(secondRead.Data) {
		t.Fatal("readAt was refreshed")
	}
	// Only request-category rows are projected while these unrelated tables are
	// inaccessible. Badge, single read and bounded read-all never hydrate State.
	lock, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback(ctx)
	if _, err = lock.Exec(ctx, `LOCK TABLE gongming_posts,gongming_wallets,gongming_documents,gongming_circle_posts,gongming_media_assets IN ACCESS EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		method, path string
		body         any
	}{{"GET", "/notifications/unread", nil}, {"GET", "/notifications?category=requests", nil}, {"POST", "/notifications/" + notice.ID + "/read", map[string]any{}}, {"POST", "/notifications/read-all", map[string]any{"throughId": page.ThroughID}}} {
		raw, _ := json.Marshal(c.body)
		r := httptest.NewRequest(c.method, "http://localhost:8080/api/v1"+c.path, bytes.NewReader(raw))
		requestCtx, cancel := context.WithTimeout(ctx, time.Second)
		r = r.WithContext(requestCtx)
		r.AddCookie(owner)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", "http://localhost:5173")
		w := httptest.NewRecorder()
		h2.ServeHTTP(w, r)
		cancel()
		if w.Code != 200 {
			t.Fatalf("%s blocked on unrelated domain: %d %s", c.path, w.Code, w.Body.String())
		}
	}
	if err = lock.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"?category=x", "?unread=0", "?limit=101", "?offset=100001"} {
		requireCode(t, call(t, h, "GET", "/notifications"+path, nil, owner), 400)
	}
	requireCode(t, call(t, h, "POST", "/notifications/read-all", map[string]any{}, owner), 400)
	requireCode(t, call(t, h, "POST", "/notifications/read-all", map[string]any{"throughId": newID("notice_")}, owner), 404)
	requireCode(t, call(t, h, "GET", "/notifications/unread", nil, nil), 401)
}

func TestNotificationPostgresPrivateCircleDynamicRedaction(t *testing.T) {
	ctx, s, _, _, h := postgresMediaFixture(t)
	owner, admin := memberCookie(t, h), adminCookie(t, h)
	person, peer := circleUser(t, h, "noticepgcircle")
	_, outsider := circleUser(t, h, "noticepgoutsider")
	clearNotificationInbox(t, ctx, s)
	c := createdCircle(t, h, owner, "private", "approval")
	base := "/circles/" + c.ID
	invite := payload[struct{ Token string }](t, call(t, h, "POST", base+"/invites", map[string]int{"maxUses": 2}, owner))
	join := payload[CircleJoinResult](t, call(t, h, "POST", base+"/join", map[string]string{"inviteToken": invite.Token, "note": "只给现任管理的敏感附言"}, peer))
	requireNotice(t, notificationsPage(t, h, owner), "circle-request", "")
	for i := 0; i < 2; i++ {
		requireCode(t, call(t, h, "POST", base+"/requests/"+join.Request.ID+"/respond", map[string]string{"action": "accept"}, owner), 200)
	}
	decision := requireNotice(t, notificationsPage(t, h, peer), "circle-decision", "accepted")
	if !decision.Available {
		t.Fatal(decision)
	}
	for i := 0; i < 2; i++ {
		requireCode(t, call(t, h, "PATCH", base+"/members/"+person.ID, map[string]string{"role": "admin"}, owner), 200)
	}
	if n := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_notifications WHERE recipient_id=$1 AND kind='circle-membership'`, person.ID); n != 1 {
		t.Fatal(n)
	}
	join2 := payload[CircleJoinResult](t, call(t, h, "POST", base+"/join", map[string]string{"inviteToken": invite.Token, "note": "another private pending note"}, outsider))
	if !requireNotice(t, notificationsPage(t, h, peer), "circle-request", "").Available {
		t.Fatal("manager could not see request")
	}
	channel := payload[CircleChannel](t, call(t, h, "POST", base+"/channels", map[string]string{"name": "敏感管理频道", "kind": "forum", "access": "staff"}, owner))
	post := circleCreatedPost(t, h, peer, c.ID, channel.ID, nil)
	requireCode(t, call(t, h, "POST", base+"/posts/"+post.ID+"/comments", map[string]string{"body": "不应持久保存到通知的评论内容"}, owner), 200)
	requireCode(t, call(t, h, "POST", base+"/posts/"+post.ID+"/like", map[string]bool{"liked": true}, owner), 200)
	if !requireNotice(t, notificationsPage(t, h, peer), "circle-comment", "").Available {
		t.Fatal("authorized staff post unavailable")
	}
	requireCode(t, call(t, h, "PATCH", base+"/members/"+person.ID, map[string]string{"role": "member"}, owner), 200)
	page := notificationsPage(t, h, peer)
	for _, kind := range []string{"circle-request", "circle-comment", "circle-like"} {
		n := requireNotice(t, page, kind, "")
		if n.Available || n.Actor != nil || n.Context != nil || n.Target != nil {
			t.Fatal("downgraded role leaked", n)
		}
	}
	if req := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_notifications WHERE reference_id=$1`, join2.Request.ID); req != 2 {
		t.Fatal("request audience not original two managers", req)
	}
	memberChannel := circleFirstChannel(t, h, owner, c.ID)
	publicToMembers := circleCreatedPost(t, h, peer, c.ID, memberChannel.ID, nil)
	requireCode(t, call(t, h, "POST", base+"/posts/"+publicToMembers.ID+"/comments", map[string]string{"body": "current member interaction"}, owner), 200)
	requireCode(t, call(t, h, "PATCH", "/admin/circles/"+c.ID, map[string]string{"status": "suspended", "note": "private internal moderation note"}, admin), 200)
	for _, n := range notificationsPage(t, h, peer).Items {
		if n.Kind == "circle-comment" && (n.Available || n.Context != nil || n.Target != nil || n.Actor != nil) {
			t.Fatal("suspended circle interaction leaked", n)
		}
	}
	status := requireNotice(t, notificationsPage(t, h, peer), "circle-status", "suspended")
	if !status.Available || status.Actor != nil {
		t.Fatal(status)
	}
	requireCode(t, call(t, h, "PATCH", "/admin/circles/"+c.ID, map[string]string{"status": "active", "note": "restore"}, admin), 200)
	requireCode(t, call(t, h, "POST", base+"/members/"+person.ID+"/remove", map[string]bool{"ban": true}, owner), 200)
	for _, n := range notificationsPage(t, h, peer).Items {
		if n.Available || n.Actor != nil || n.Context != nil || n.Target != nil {
			t.Fatal("removed private member retained target", n)
		}
	}
	rows, err := s.pool.Query(ctx, `SELECT to_jsonb(n)::text FROM gongming_notifications n`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var raw string
		if err = rows.Scan(&raw); err != nil {
			t.Fatal(err)
		}
		for _, secret := range []string{invite.Token, "敏感附言", "private internal moderation note", "不应持久保存到通知"} {
			if strings.Contains(raw, secret) {
				t.Fatal("content snapshot in durable inbox", raw)
			}
		}
	}
}

func TestNotificationPostgresCircleLifecycleDecisionsAndNoSelfNoise(t *testing.T) {
	ctx, s, _, _, h := postgresMediaFixture(t)
	owner := memberCookie(t, h)
	person, peer := circleUser(t, h, "noticelifecycle")
	_, declined := circleUser(t, h, "noticedeclined")
	_, leaver := circleUser(t, h, "noticeleaver")
	clearNotificationInbox(t, ctx, s)
	c := createdCircle(t, h, owner, "public", "approval")
	base := "/circles/" + c.ID
	join := func(cookie *http.Cookie) CircleJoinResult {
		res := call(t, h, "POST", base+"/join", map[string]any{}, cookie)
		requireCode(t, res, 200)
		return payload[CircleJoinResult](t, res)
	}
	decision := func(requestID, action string) {
		requireCode(t, call(t, h, "POST", base+"/requests/"+requestID+"/respond", map[string]string{"action": action}, owner), 200)
	}
	request := join(declined)
	decision(request.Request.ID, "decline")
	decision(request.Request.ID, "decline")
	n := requireNotice(t, notificationsPage(t, h, declined), "circle-decision", "declined")
	if n.Available || n.Target != nil {
		t.Fatal("public introduction bypassed notification membership rule", n)
	}
	request = join(peer)
	decision(request.Request.ID, "accept")
	request = join(leaver)
	decision(request.Request.ID, "accept")
	beforeLeave := notificationsPage(t, h, leaver).Total
	requireCode(t, call(t, h, "POST", base+"/leave", map[string]any{}, leaver), 200)
	if page := notificationsPage(t, h, leaver); page.Total != beforeLeave || page.Items[0].Available {
		t.Fatal("self leave generated noise or retained public context", page)
	}
	request = join(declined)
	beforeCancel := notificationsPage(t, h, declined).Total
	requireCode(t, call(t, h, "POST", base+"/requests/"+request.Request.ID+"/respond", map[string]string{"action": "cancel"}, declined), 200)
	if page := notificationsPage(t, h, declined); page.Total != beforeCancel {
		t.Fatal("cancel created decision notification", page)
	}
	requireCode(t, call(t, h, "POST", base+"/owner", map[string]string{"userId": person.ID}, owner), 200)
	newOwner := requireNotice(t, notificationsPage(t, h, peer), "circle-membership", "owner")
	if !newOwner.Available || newOwner.Actor != nil {
		t.Fatal(newOwner)
	}
	if n := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_notifications WHERE kind='circle-membership' AND outcome='owner'`); n != 1 {
		t.Fatal("transfer notified old owner", n)
	}
	beforeArchive := notificationsPage(t, h, peer).Total
	for i := 0; i < 2; i++ {
		requireCode(t, call(t, h, "DELETE", base, nil, peer), 200)
	}
	archived := requireNotice(t, notificationsPage(t, h, owner), "circle-status", "archived")
	if !archived.Available || archived.Actor != nil {
		t.Fatal(archived)
	}
	if page := notificationsPage(t, h, peer); page.Total != beforeArchive {
		t.Fatal("owner archive generated self notification", page)
	}
	if n := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_notifications WHERE kind='circle-status' AND outcome='archived'`); n != 1 {
		t.Fatal("archive recipients or repeated archive wrong", n)
	}
}

func TestNotificationPostgresMediaCascadeAndReportInfo(t *testing.T) {
	ctx, s, _, _, h := postgresMediaFixture(t)
	owner, admin := memberCookie(t, h), adminCookie(t, h)
	person, peer := circleUser(t, h, "noticepgmedia")
	clearNotificationInbox(t, ctx, s)
	asset := payload[MediaAsset](t, uploadMedia(t, h, testMediaPNG(t), "notification-world-image", owner))
	post := notificationPost(t, h, owner, []string{asset.URL})
	requireCode(t, call(t, h, "PATCH", "/admin/posts/"+post.ID, map[string]string{"status": "published"}, admin), 200)
	for i := 0; i < 2; i++ {
		requireCode(t, call(t, h, "PATCH", "/admin/media/"+asset.ID, map[string]string{"status": "blocked", "note": "敏感内部审核备注不可通知"}, admin), 200)
	}
	page := notificationsPage(t, h, owner)
	m := requireNotice(t, page, "media-review", "blocked")
	if !m.Available || m.Actor != nil || m.Target.Type != "uploads" {
		t.Fatal(m)
	}
	requireNotice(t, page, "world-review", "hidden")
	if n := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_notifications WHERE kind='media-review'`); n != 1 {
		t.Fatal(n)
	}
	// A second, independent circle asset exercises moderation's other reference
	// domain. The author remains a current member so the review is readable.
	c := createdCircle(t, h, owner, "public", "open")
	base := "/circles/" + c.ID
	requireCode(t, call(t, h, "POST", base+"/join", map[string]any{}, peer), 200)
	ch := circleFirstChannel(t, h, owner, c.ID)
	circleAsset := payload[MediaAsset](t, uploadCircleImage(t, h, c.ID, testMediaPNG(t), "notification-circle-image", peer))
	cp := circleCreatedPost(t, h, peer, c.ID, ch.ID, []string{circleAsset.URL})
	requireCode(t, call(t, h, "PATCH", base+"/posts/"+cp.ID, map[string]string{"status": "published"}, owner), 200)
	requireCode(t, call(t, h, "PATCH", "/admin/media/"+circleAsset.ID, map[string]string{"status": "blocked", "note": "circle image blocked"}, admin), 200)
	requireNotice(t, notificationsPage(t, h, peer), "circle-review", "hidden")
	requireNotice(t, notificationsPage(t, h, peer), "media-review", "blocked")
	report := payload[Report](t, call(t, h, "POST", "/reports", map[string]string{"targetType": "user", "targetId": "user_demo", "reason": "只用于验证结案"}, peer))
	requireCode(t, call(t, h, "PATCH", "/admin/reports/"+report.ID, map[string]string{"status": "dismissed", "note": "私密内部处理信息"}, admin), 200)
	reportNotice := requireNotice(t, notificationsPage(t, h, peer), "report-review", "dismissed")
	if !reportNotice.Available || reportNotice.Actor != nil || reportNotice.Context != nil || reportNotice.Target != nil {
		t.Fatal(reportNotice)
	}
	requireCode(t, call(t, h, "PATCH", "/admin/reports/"+report.ID, map[string]string{"status": "resolved", "note": "another"}, admin), 409)
	if n := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_notifications WHERE recipient_id=$1 AND kind='report-review'`, person.ID); n != 1 {
		t.Fatal(n)
	}
	requireCode(t, call(t, h, "DELETE", "/posts/"+post.ID, nil, owner), 200)
	requireCode(t, call(t, h, "DELETE", "/media/images/"+asset.ID, nil, owner), 200)
	if n := requireNotice(t, notificationsPage(t, h, owner), "media-review", "blocked"); n.Available || n.Target != nil {
		t.Fatal("deleted media target survived", n)
	}
}

func TestNotificationV6MigrationPreservesRowsFilesCookiesAndRollsBack(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	_, memory, memoryHandler := fixture(t)
	cookie := memberCookie(t, memoryHandler)
	directory := filepath.Join(t.TempDir(), "media")
	if err := PrepareMediaDirectory(directory); err != nil {
		t.Fatal(err)
	}
	raw := testMediaPNG(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	id := newID("media_")
	asset := StoredMediaAsset{MediaAsset: MediaAsset{ID: id, URL: mediaURLPrefix + id, ContentType: "image/png", Width: 12, Height: 7, Bytes: int64(len(raw)), CreatedAt: now, Scope: "world"}, OwnerID: "user_demo", ClientID: "v6-existing-upload", SourceHash: fmt.Sprintf("%x", sha256.Sum256(raw)), Status: "ready", UpdatedAt: now}
	memory.state.Media[id] = asset
	if err := writeMediaFile(directory, asset, raw); err != nil {
		t.Fatal(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `CREATE TABLE gongming_schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());`+normalizedSchema+normalizedGuards+`INSERT INTO gongming_schema_migrations(version) VALUES(2)`); err != nil {
		t.Fatal(err)
	}
	for _, migrate := range []func(context.Context, pgx.Tx) error{migrateFriendships, migrateDeviceSessions, migrateMedia, migrateCircles} {
		if err = migrate(ctx, tx); err != nil {
			t.Fatal(err)
		}
	}
	if err = persistHistoricalFixture(ctx, tx, 6, memory.state); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	before := map[string]string{}
	projections := map[string]string{}
	for _, table := range []string{"gongming_users", "gongming_sessions", "gongming_posts", "gongming_media_assets", "gongming_circles", "gongming_circle_members", "gongming_circle_posts", "gongming_circle_requests"} {
		var value string
		projection, projectionErr := freezeMigrationProjection(ctx, s, table)
		if projectionErr != nil {
			t.Fatal(projectionErr)
		}
		projections[table] = projection
		if err = s.pool.QueryRow(ctx, projection).Scan(&value); err != nil {
			t.Fatal(err)
		}
		before[table] = value
	}
	if _, err = s.pool.Exec(ctx, `CREATE TABLE gongming_notifications(collision text)`); err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(ctx); err == nil {
		t.Fatal("schema collision did not roll back")
	}
	var counter, marker bool
	if err = s.pool.QueryRow(ctx, `SELECT to_regclass('gongming_notification_counters') IS NOT NULL,EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=7)`).Scan(&counter, &marker); err != nil || counter || marker {
		t.Fatal("partial schema7 survived", err)
	}
	if _, err = s.pool.Exec(ctx, `DROP TABLE gongming_notifications`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err = s.Migrate(ctx); err != nil {
			t.Fatal(err)
		}
	}
	for table, value := range before {
		var after string
		if err = s.pool.QueryRow(ctx, projections[table]).Scan(&after); err != nil || after != value {
			t.Fatalf("migration rewrote %s: %v", table, err)
		}
	}
	a := NewApp(s, Config{Environment: "development", Origins: []string{"http://localhost:5173"}, BcryptCost: 4, MediaDirectory: directory})
	if err = a.SeedDevelopment(ctx); err != nil {
		t.Fatal(err)
	}
	requireCode(t, call(t, a.Handler(), "GET", "/auth/me", nil, cookie), 200)
	if page := notificationsPage(t, a.Handler(), cookie); page.Total != 0 || page.UnreadTotal != 0 || page.ThroughID != nil {
		t.Fatal("upgrade backfilled notification history", page)
	}
	content, err := os.ReadFile(filepath.Join(directory, mediaFilename(asset)))
	if err != nil || !bytes.Equal(content, raw) {
		t.Fatal("upgrade changed private files", err)
	}
	if res := readMedia(t, a.Handler(), "GET", asset.URL, cookie); res.Code != 200 {
		t.Fatal(res.Code)
	}
}

func TestNotificationPostgresConstraintsOrderedCountersAndFirstSeed(t *testing.T) {
	ctx, s, dsn, a, h := postgresMediaFixture(t)
	owner := memberCookie(t, h)
	seed := notificationsPage(t, h, owner)
	if seed.Total < 3 || seed.UnreadTotal != seed.Total {
		t.Fatal("first-empty seed has no real unread examples", seed)
	}
	for _, n := range seed.Items {
		if !n.Available {
			t.Fatal("seed example cannot be understood", n)
		}
	}
	if err := a.SeedDevelopment(ctx); err != nil {
		t.Fatal(err)
	}
	if next := notificationsPage(t, h, owner); next.Total != seed.Total {
		t.Fatal("seed duplicated")
	}
	clearNotificationInbox(t, ctx, s)
	post := notificationPost(t, h, owner, nil)
	other, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			store := s
			if i%2 == 1 {
				store = other
			}
			errs <- store.Update(ctx, func(st *State) error {
				st.queueNotification("world-like", "user_friend", "user_demo", post.ID, "", "same-forever-key", time.Now())
				st.queueNotification("world-comment", "user_friend", "user_demo", post.ID, "", fmt.Sprintf("different-comment-%d", i), time.Now())
				return nil
			})
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	page := notificationsPage(t, h, owner)
	if page.Total != 9 {
		t.Fatal("concurrent counter or dedup lost events", page.Total)
	}
	var distinct, minSeq, maxSeq int
	if err = s.pool.QueryRow(ctx, `SELECT count(DISTINCT sequence),min(sequence),max(sequence) FROM gongming_notifications WHERE recipient_id='user_demo'`).Scan(&distinct, &minSeq, &maxSeq); err != nil || distinct != 9 || minSeq != 1 || maxSeq != 9 {
		t.Fatal(distinct, minSeq, maxSeq, err)
	}
	id := page.Items[0].ID
	for _, query := range []string{`UPDATE gongming_notifications SET reference_id='other' WHERE id=$1`, `UPDATE gongming_notifications SET actor_id='user_admin' WHERE id=$1`, `UPDATE gongming_notifications SET outcome='hidden' WHERE id=$1`, `UPDATE gongming_notifications SET sequence=sequence+100 WHERE id=$1`, `UPDATE gongming_notifications SET recipient_id='user_admin' WHERE id=$1`} {
		_, err = s.pool.Exec(ctx, query, id)
		expectDatabaseCode(t, err, "23514")
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO gongming_notifications(id,recipient_id,sequence,kind,outcome,reference_id,event_key,created_at) VALUES($1,'nonexistent-user',1,'world-like','',$2,'bad-fk',now())`, newID("notice_"), post.ID)
	expectDatabaseCode(t, err, "23503")
	_, err = s.pool.Exec(ctx, `INSERT INTO gongming_notifications(id,recipient_id,sequence,kind,outcome,reference_id,event_key,created_at) SELECT $1,recipient_id,sequence+100,kind,outcome,reference_id,event_key,created_at FROM gongming_notifications WHERE id=$2`, newID("notice_"), id)
	expectDatabaseCode(t, err, "23505")
	read := call(t, h, "POST", "/notifications/"+id+"/read", map[string]any{}, owner)
	requireCode(t, read, 200)
	_, err = s.pool.Exec(ctx, `UPDATE gongming_notifications SET read_at=NULL WHERE id=$1`, id)
	expectDatabaseCode(t, err, "23514")
	// Stable full-inbox bound is independent of filters and page offsets.
	filtered := call(t, h, "GET", "/notifications?category=requests&unread=true&offset=100", nil, owner)
	requireCode(t, filtered, 200)
	f := payload[NotificationsPage](t, filtered)
	if f.Total != 0 || len(f.Items) != 0 || f.ThroughID == nil || *f.ThroughID != *page.ThroughID || f.UnreadTotal != 8 {
		t.Fatal(f)
	}
}
