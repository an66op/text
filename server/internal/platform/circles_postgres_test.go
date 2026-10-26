package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
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
)

func uploadCircleImage(t *testing.T, h http.Handler, circle string, raw []byte, clientID string, cookie *http.Cookie) response {
	t.Helper()
	body, contentType := multipartMedia(t, raw, clientID, false)
	r := httptest.NewRequest("POST", "http://localhost:8080/api/v1/circles/"+circle+"/media/images", bytes.NewReader(body))
	r.Header.Set("Content-Type", contentType)
	r.Header.Set("Origin", "http://localhost:5173")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var result struct {
		Data  json.RawMessage
		Error *APIError
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return response{Code: w.Code, Data: result.Data, Error: result.Error}
}
func TestCirclePostgresPrivateMediaIsolationAndGovernance(t *testing.T) {
	ctx, s, dsn, a, h := postgresMediaFixture(t)
	owner, admin := memberCookie(t, h), adminCookie(t, h)
	person, member := circleUser(t, h, "circlepgmember")
	_, outsider := circleUser(t, h, "circlepgoutsider")
	c := createdCircle(t, h, owner, "private", "approval")
	base := "/circles/" + c.ID
	channel := circleFirstChannel(t, h, owner, c.ID)
	invite := payload[struct{ Token string }](t, call(t, h, "POST", base+"/invites", map[string]int{"maxUses": 2}, owner))
	join := payload[CircleJoinResult](t, call(t, h, "POST", base+"/join", map[string]string{"inviteToken": invite.Token}, member))
	requireCode(t, call(t, h, "POST", base+"/requests/"+join.Request.ID+"/respond", map[string]string{"action": "accept"}, owner), 200)
	raw := testMediaPNG(t)
	res := uploadCircleImage(t, h, c.ID, raw, "circle-bound-image", owner)
	requireCode(t, res, 200)
	asset := payload[MediaAsset](t, res)
	if asset.Scope != "circle" || asset.CircleID != c.ID {
		t.Fatal("media scope/circleId not fixed by server")
	}
	requireCode(t, uploadMedia(t, h, raw, "circle-bound-image", owner), 409)
	requireCode(t, uploadCircleImage(t, h, c.ID, raw, "outsider-upload-image", outsider), 404)
	requireCode(t, uploadCircleImage(t, h, c.ID, append(raw, make([]byte, 2*1024*1024)...), "circle-large-valid-image", owner), 200)
	post := circleCreatedPost(t, h, owner, c.ID, channel.ID, []string{asset.URL})
	if post.Status != "pending" {
		t.Fatal("circle image post bypassed review")
	}
	requireCode(t, call(t, h, "GET", base+"/posts/"+post.ID, nil, member), 404)
	requireCode(t, call(t, h, "PATCH", base+"/posts/"+post.ID, map[string]any{"status": "published", "pinned": true, "featured": true}, owner), 200)
	for _, cookie := range []*http.Cookie{nil, outsider} {
		if readMedia(t, h, "GET", asset.URL, cookie).Code != 404 {
			t.Fatal("private circle media leaked outside membership")
		}
	}
	if readMedia(t, h, "GET", asset.URL, member).Code != 200 {
		t.Fatal("readable circle reference did not authorize member image")
	}
	// World posts cannot claim circle media, and another circle cannot reuse it.
	requireCode(t, call(t, h, "POST", "/posts", map[string]any{"body": "圈图不能外发世界", "images": []string{asset.URL}}, owner), 400)
	otherCircle := createdCircle(t, h, owner, "public", "open")
	otherChannel := circleFirstChannel(t, h, owner, otherCircle.ID)
	requireCode(t, call(t, h, "POST", "/circles/"+otherCircle.ID+"/posts", map[string]any{"channelId": otherChannel.ID, "title": "跨圈", "body": "不应成功", "images": []string{asset.URL}, "clientId": "cross-circle-image-post"}, owner), 400)
	world := payload[MediaAsset](t, uploadMedia(t, h, raw, "world-image-circle-check", owner))
	requireCode(t, call(t, h, "POST", base+"/posts", map[string]any{"channelId": channel.ID, "title": "世界图", "body": "不应成功", "images": []string{world.URL}, "clientId": "wrong-world-scope-post"}, owner), 400)
	media := payload[struct{ Items []AdminMediaAsset }](t, call(t, h, "GET", "/admin/media?q="+asset.ID, nil, admin)).Items[0]
	if media.ReferenceCount != 1 || media.PublishedReferenceCount != 0 || media.CirclePublishedReferenceCount != 1 || len(media.Posts) != 0 || len(media.CirclePosts) != 1 {
		t.Fatal("circle references were mislabeled as public world references")
	}
	// An image request must not load unrelated domain snapshots.
	lock, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback(ctx)
	if _, err = lock.Exec(ctx, `LOCK TABLE gongming_wallets,gongming_documents,gongming_messages,gongming_friend_requests,gongming_audits IN ACCESS EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}
	bounded := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		h.ServeHTTP(w, r.WithContext(ctx))
	})
	if readMedia(t, bounded, "GET", asset.URL, member).Code != 200 {
		t.Fatal("circle image unnecessarily loaded State")
	}
	if err = lock.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	requireCode(t, call(t, h, "PATCH", "/admin/media/"+asset.ID, map[string]string{"status": "blocked", "note": "圈图审核屏蔽"}, admin), 200)
	if readMedia(t, h, "GET", asset.URL, member).Code != 404 || readMedia(t, h, "GET", asset.URL, owner).Code != 404 || readMedia(t, h, "GET", asset.URL, admin).Code != 200 {
		t.Fatal("media block policy not enforced")
	}
	requireCode(t, call(t, h, "PATCH", "/admin/media/"+asset.ID, map[string]string{"status": "ready", "note": "恢复原图不自动发帖"}, admin), 200)
	if readMedia(t, h, "GET", asset.URL, member).Code != 404 {
		t.Fatal("unblocking restored hidden circle post")
	}
	requireCode(t, call(t, h, "PATCH", "/admin/circle-posts/"+post.ID, map[string]string{"status": "published", "note": "独立平台复核"}, admin), 200)
	requireCode(t, call(t, h, "PATCH", base+"/channels/"+channel.ID, map[string]string{"access": "staff"}, owner), 200)
	if readMedia(t, h, "GET", asset.URL, member).Code != 404 {
		t.Fatal("channel access change retained image permission")
	}
	requireCode(t, call(t, h, "PATCH", base+"/members/"+person.ID, map[string]string{"role": "admin"}, owner), 200)
	if readMedia(t, h, "GET", asset.URL, member).Code != 200 {
		t.Fatal("circle admin cannot read staff channel image")
	}
	requireCode(t, call(t, h, "PATCH", base+"/members/"+person.ID, map[string]string{"role": "member"}, owner), 200)
	requireCode(t, call(t, h, "PATCH", base+"/channels/"+channel.ID, map[string]string{"access": "members"}, owner), 200)
	requireCode(t, call(t, h, "POST", base+"/members/"+person.ID+"/remove", map[string]bool{"ban": true}, owner), 200)
	if readMedia(t, h, "GET", asset.URL, member).Code != 404 {
		t.Fatal("removed member retained image access")
	}
	other, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	reopened := NewApp(other, a.cfg).Handler()
	requireCode(t, call(t, reopened, "GET", base+"/posts/"+post.ID, nil, owner), 200)
	if readMedia(t, reopened, "GET", asset.URL, member).Code != 404 {
		t.Fatal("reopen forgot ban")
	}
	requireCode(t, call(t, h, "DELETE", "/media/images/"+asset.ID, nil, owner), 409)
	requireCode(t, call(t, h, "DELETE", base+"/posts/"+post.ID, nil, owner), 200)
	requireCode(t, call(t, h, "DELETE", "/media/images/"+asset.ID, nil, owner), 200)
	var refs int
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_circle_post_media WHERE post_id=$1`, post.ID).Scan(&refs); err != nil || refs != 0 {
		t.Fatal("tombstone did not release FK references")
	}
}
func TestCirclePostgresConcurrentInvitationAndApproval(t *testing.T) {
	ctx, s, dsn, a, h := postgresMediaFixture(t)
	owner := memberCookie(t, h)
	u1, c1 := circleUser(t, h, "circlelastone")
	_, c2 := circleUser(t, h, "circlelasttwo")
	circle := createdCircle(t, h, owner, "private", "approval")
	base := "/circles/" + circle.ID
	other, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	second := NewApp(other, a.cfg).Handler()
	invite := payload[struct{ ID, Token string }](t, call(t, h, "POST", base+"/invites", map[string]int{"maxUses": 1}, owner))
	var wg sync.WaitGroup
	responses := make(chan response, 2)
	for _, handler := range []http.Handler{h, second} {
		wg.Add(1)
		go func(h http.Handler) {
			defer wg.Done()
			responses <- call(t, h, "POST", base+"/join", map[string]string{"inviteToken": invite.Token}, c1)
		}(handler)
	}
	wg.Wait()
	close(responses)
	requestID := ""
	for res := range responses {
		requireCode(t, res, 200)
		joined := payload[CircleJoinResult](t, res)
		if joined.Request == nil || requestID != "" && requestID != joined.Request.ID {
			t.Fatal("same-person concurrent join duplicated request")
		}
		requestID = joined.Request.ID
	}
	var uses, redemptions int
	if err = s.pool.QueryRow(ctx, `SELECT uses,(SELECT count(*) FROM gongming_circle_invite_redemptions WHERE invite_id=$1) FROM gongming_circle_invites WHERE id=$1`, invite.ID).Scan(&uses, &redemptions); err != nil || uses != 1 || redemptions != 1 {
		t.Fatal("same-person retry spent multiple invitation slots")
	}
	requireCode(t, call(t, h, "DELETE", base+"/invites/"+invite.ID, nil, owner), 200)
	requireCode(t, call(t, h, "POST", base+"/requests/"+requestID+"/respond", map[string]string{"action": "accept"}, owner), 200)
	requireCode(t, call(t, h, "POST", base+"/members/"+u1.ID+"/remove", map[string]bool{"ban": false}, owner), 200)
	requireCode(t, call(t, h, "POST", base+"/requests/"+requestID+"/respond", map[string]string{"action": "accept"}, owner), 200)
	requireCode(t, call(t, h, "GET", base+"/channels", nil, c1), 404)
	// Two different people compete for exactly one remaining redemption.
	last := payload[struct{ ID, Token string }](t, call(t, h, "POST", base+"/invites", map[string]int{"maxUses": 1}, owner))
	responses = make(chan response, 2)
	for index, cookie := range []*http.Cookie{c1, c2} {
		wg.Add(1)
		go func(index int, cookie *http.Cookie) {
			defer wg.Done()
			handler := h
			if index == 1 {
				handler = second
			}
			responses <- call(t, handler, "POST", base+"/join", map[string]string{"inviteToken": last.Token}, cookie)
		}(index, cookie)
	}
	wg.Wait()
	close(responses)
	success, rejected := 0, 0
	for res := range responses {
		if res.Code == 200 {
			success++
		} else if res.Code == 404 {
			rejected++
		} else {
			t.Fatalf("unexpected last-slot response %d %v", res.Code, res.Error)
		}
	}
	if success != 1 || rejected != 1 {
		t.Fatal("last invitation slot was not atomic")
	}
	var raw []byte
	if err = s.pool.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(i))::text FROM gongming_circle_invites i WHERE circle_id=$1`, circle.ID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte(last.Token)) {
		t.Fatal("raw token in normalized database")
	}
}
func TestCircleV5MigrationPreservesOldMediaRowsAndRollsBack(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	_, memory, memoryHandler := fixture(t)
	cookie := memberCookie(t, memoryHandler)
	memory.state.Circles = nil
	memory.state.CircleMembers = nil
	memory.state.CircleJoinRequests = nil
	memory.state.CircleChannels = nil
	memory.state.CirclePosts = nil
	memory.state.CircleComments = nil
	memory.state.CircleInvites = nil
	memory.state.CircleInviteRedemptions = nil
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `CREATE TABLE gongming_schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());`+normalizedSchema+normalizedGuards+`INSERT INTO gongming_schema_migrations(version) VALUES(2)`); err != nil {
		t.Fatal(err)
	}
	if err = migrateFriendships(ctx, tx); err != nil {
		t.Fatal(err)
	}
	if err = migrateDeviceSessions(ctx, tx); err != nil {
		t.Fatal(err)
	}
	if err = migrateMedia(ctx, tx); err != nil {
		t.Fatal(err)
	}
	if err = persistHistoricalFixture(ctx, tx, 5, memory.state); err != nil {
		t.Fatal(err)
	}
	id := newID("media_")
	now := time.Now().UTC().Truncate(time.Microsecond)
	raw := testMediaPNG(t)
	sum := sha256.Sum256(raw)
	v := StoredMediaAsset{MediaAsset: MediaAsset{ID: id, URL: mediaURLPrefix + id, ContentType: "image/png", Width: 12, Height: 7, Bytes: int64(len(raw)), CreatedAt: now}, OwnerID: "user_demo", ClientID: "v5-preserved-image", SourceHash: hex.EncodeToString(sum[:]), Status: "ready", UpdatedAt: now}
	if _, err = tx.Exec(ctx, `INSERT INTO gongming_media_assets(id,owner_id,client_id,source_hash,content_type,width,height,bytes,status,note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'',$10,$10)`, v.ID, v.OwnerID, v.ClientID, v.SourceHash, v.ContentType, v.Width, v.Height, v.Bytes, v.Status, now); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(t.TempDir(), "media")
	if err = PrepareMediaDirectory(directory); err != nil {
		t.Fatal(err)
	}
	if err = writeMediaFile(directory, v, raw); err != nil {
		t.Fatal(err)
	}
	before := map[string]string{}
	projections := map[string]string{}
	for _, table := range []string{"gongming_users", "gongming_sessions", "gongming_posts", "gongming_media_assets"} {
		var data string
		projection, projectionErr := freezeMigrationProjection(ctx, s, table)
		if projectionErr != nil {
			t.Fatal(projectionErr)
		}
		projections[table] = projection
		if err = s.pool.QueryRow(ctx, projection).Scan(&data); err != nil {
			t.Fatal(err)
		}
		before[table] = data
	}
	// Fail after media scope ALTER has run, proving the old table shape and row
	// versions return intact when a later DDL statement fails.
	if _, err = s.pool.Exec(ctx, `CREATE TABLE gongming_circle_post_media(collision text)`); err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(ctx); err == nil {
		t.Fatal("colliding schema6 migration succeeded")
	}
	var scope, marker bool
	if err = s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='gongming_media_assets' AND column_name='scope'),EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=6)`).Scan(&scope, &marker); err != nil || scope || marker {
		t.Fatal("failed migration retained new scope/marker")
	}
	if _, err = s.pool.Exec(ctx, `DROP TABLE gongming_circle_post_media`); err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	for table, data := range before {
		var after string
		if err = s.pool.QueryRow(ctx, projections[table]).Scan(&after); err != nil || after != data {
			t.Fatalf("schema6 rewrote old rows in %s", table)
		}
	}
	a := NewApp(s, Config{Environment: "test", Origins: []string{"http://localhost:5173"}, BcryptCost: 4, MediaDirectory: directory})
	requireCode(t, call(t, a.Handler(), "GET", "/auth/me", nil, cookie), 200)
	if err = s.Read(ctx, func(state *State) error {
		if state.Media[id].Scope != "world" || len(state.Circles) != 0 {
			t.Fatal("old media scope/default circles incorrect")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	file, err := os.ReadFile(filepath.Join(directory, mediaFilename(v)))
	if err != nil || !bytes.Equal(file, raw) {
		t.Fatal("migration changed existing image bytes")
	}
}
func TestCircleDevelopmentSeedIsFirstEmptyDatabaseOnly(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	a := seedPostgres(t, ctx, s)
	var snapshot string
	if err := s.Read(ctx, func(state *State) error {
		if len(state.Circles) != 2 || len(state.CircleInvites) != 0 || len(state.CircleJoinRequests) != 1 {
			t.Fatal("development examples absent or contain prebuilt invites")
		}
		for _, c := range state.Circles {
			if !strings.Contains(c.Name, "开发示例") {
				t.Fatal("seed not clearly labeled")
			}
		}
		raw, _ := json.Marshal(state.Circles)
		snapshot = string(raw)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.SeedDevelopment(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.Read(ctx, func(state *State) error {
		raw, _ := json.Marshal(state.Circles)
		if string(raw) != snapshot {
			t.Fatal("existing database was reseeded")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestCirclePostgresApprovalLastMemberSlotAndForeignKeys(t *testing.T) {
	ctx, s, dsn, a, h := postgresMediaFixture(t)
	owner := memberCookie(t, h)
	_, first := circleUser(t, h, "circleslotone")
	_, second := circleUser(t, h, "circleslottwo")
	c := createdCircle(t, h, owner, "public", "approval")
	base := "/circles/" + c.ID
	firstRequest := payload[CircleJoinResult](t, call(t, h, "POST", base+"/join", map[string]any{}, first)).Request
	secondRequest := payload[CircleJoinResult](t, call(t, h, "POST", base+"/join", map[string]any{}, second)).Request
	if err := s.Update(ctx, func(state *State) error {
		hash := state.Accounts["user_demo"].PasswordHash
		now := a.circleNow()
		for index := 0; index < 998; index++ {
			id := newID("user_")
			handle := fmt.Sprintf("circle_cap_%04d", index)
			state.Accounts[id] = Account{User: User{ID: id, Handle: handle, Name: "容量边界测试成员", Email: handle + "@example.test", Role: "member", Status: "active", CreatedAt: now}, PasswordHash: hash}
			state.CircleMembers[circleMemberKey(c.ID, id)] = StoredCircleMember{CircleID: c.ID, UserID: id, Role: "member", Status: "active", JoinedAt: now, UpdatedAt: now}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	other, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	remote := NewApp(other, a.cfg).Handler()
	responses := make(chan response, 2)
	var wg sync.WaitGroup
	for index, request := range []*CircleJoinRequest{firstRequest, secondRequest} {
		wg.Add(1)
		go func(index int, request *CircleJoinRequest) {
			defer wg.Done()
			handler := h
			if index == 1 {
				handler = remote
			}
			responses <- call(t, handler, "POST", base+"/requests/"+request.ID+"/respond", map[string]string{"action": "accept"}, owner)
		}(index, request)
	}
	wg.Wait()
	close(responses)
	accepted, rejected := 0, 0
	for res := range responses {
		if res.Code == 200 {
			accepted++
		} else if res.Code == 409 {
			rejected++
		} else {
			t.Fatalf("unexpected capacity response: %d %v", res.Code, res.Error)
		}
	}
	if accepted != 1 || rejected != 1 {
		t.Fatal("concurrent approvals overbooked final member slot")
	}
	var count int
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_circle_members WHERE circle_id=$1 AND status='active'`, c.ID).Scan(&count); err != nil || count != 1000 {
		t.Fatal("circle member quota was not durable")
	}
	otherCircle := createdCircle(t, h, owner, "public", "open")
	wrongChannel := circleFirstChannel(t, h, owner, otherCircle.ID)
	_, err = s.pool.Exec(ctx, `INSERT INTO gongming_circle_posts(id,circle_id,channel_id,author_id,client_id,fingerprint,title,body,images,status,created_at,updated_at) VALUES($1,$2,$3,'user_demo','wrong-circle-channel','wrong','x','x','{}','pending',now(),now())`, newID("cpost_"), c.ID, wrongChannel.ID)
	expectDatabaseCode(t, err, "23503")
	_, err = s.pool.Exec(ctx, `UPDATE gongming_circle_members SET role='owner' WHERE circle_id=$1 AND user_id<>'user_demo'`, c.ID)
	if err == nil {
		t.Fatal("database permitted unrelated multiple circle owners")
	}
}
