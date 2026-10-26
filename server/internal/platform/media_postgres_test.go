package platform

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func postgresMediaFixture(t *testing.T) (context.Context, *PostgresStore, string, *App, http.Handler) {
	t.Helper()
	ctx, s, dsn := isolatedPostgres(t)
	a := seedPostgres(t, ctx, s)
	a.cfg.MediaDirectory = filepath.Join(t.TempDir(), "media")
	if err := PrepareMediaDirectory(a.cfg.MediaDirectory); err != nil {
		t.Fatal(err)
	}
	return ctx, s, dsn, a, a.Handler()
}
func TestMediaPostgresPersistenceNarrowReadAndOwnerList(t *testing.T) {
	ctx, s, dsn, a, h := postgresMediaFixture(t)
	cookie, admin := memberCookie(t, h), adminCookie(t, h)
	res := uploadMedia(t, h, testMediaPNG(t), "postgres-media-first", cookie)
	requireCode(t, res, 200)
	asset := payload[MediaAsset](t, res)
	for _, query := range []string{
		`UPDATE gongming_media_assets SET owner_id='user_admin' WHERE id=$1`,
		`UPDATE gongming_media_assets SET width=8193 WHERE id=$1`,
		`UPDATE gongming_media_assets SET bytes=8388609 WHERE id=$1`,
		`UPDATE gongming_media_assets SET source_hash=repeat('b',64) WHERE id=$1`,
	} {
		_, err := s.pool.Exec(ctx, query, asset.ID)
		expectDatabaseCode(t, err, "23514")
	}
	other, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	b := NewApp(other, a.cfg)
	reopened := b.Handler()
	repeated := uploadMedia(t, reopened, testMediaPNG(t), "postgres-media-first", cookie)
	requireCode(t, repeated, 200)
	if !bytes.Equal(res.Data, repeated.Data) {
		t.Fatalf("reopened idempotent response changed:\n%s\n%s", res.Data, repeated.Data)
	}
	if readMedia(t, reopened, "GET", asset.URL, nil).Code != 404 {
		t.Fatal("private media leaked")
	}
	post := payload[Post](t, call(t, h, "POST", "/posts", map[string]any{"body": "数据库持久图片", "images": []string{asset.URL, asset.URL}}, cookie))
	if post.Status != "pending" || len(post.Images) != 1 {
		t.Fatal("image references bypassed review/dedup")
	}
	requireCode(t, call(t, h, "PATCH", "/admin/posts/"+post.ID, map[string]string{"status": "published"}, admin), 200)
	var refs int
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_post_media WHERE media_id=$1`, asset.ID).Scan(&refs); err != nil || refs != 1 {
		t.Fatal("normalized FK references not persisted")
	}
	_, err = s.pool.Exec(ctx, `UPDATE gongming_media_assets SET deleted_at=now(),updated_at=now() WHERE id=$1`, asset.ID)
	expectDatabaseCode(t, err, "23514")
	// Owner list ignores userId/owner-style query parameters: identity is always
	// the authenticated user, never a caller-controlled URL/body selector.
	owned := payload[struct {
		Items []AdminMediaAsset
		Total int
	}](t, call(t, reopened, "GET", "/me/media?limit=1&q="+post.ID, nil, cookie))
	if owned.Total != 1 || len(owned.Items) != 1 || owned.Items[0].Owner.ID != "user_demo" || owned.Items[0].ReferenceCount != 1 {
		t.Fatal("owner list missing own referenced asset")
	}
	foreign := payload[struct {
		Items []AdminMediaAsset
		Total int
	}](t, call(t, h, "GET", "/me/media?userId=user_demo&q="+asset.ID, nil, admin))
	if foreign.Total != 0 || len(foreign.Items) != 0 {
		t.Fatal("owner media list exposed another user's asset")
	}
	empty := payload[struct {
		Items []AdminMediaAsset
		Total int
	}](t, call(t, h, "GET", "/me/media?offset=1&limit=1", nil, cookie))
	if empty.Total != 1 || len(empty.Items) != 0 {
		t.Fatal("owner media pagination lost total")
	}
	requireCode(t, call(t, h, "GET", "/me/media?status=deleted", nil, cookie), 400)
	requireCode(t, call(t, h, "GET", "/me/media?limit=101", nil, cookie), 400)
	requireCode(t, call(t, h, "GET", "/me/media", nil, nil), 401)
	requireCode(t, call(t, h, "DELETE", "/media/images/"+asset.ID, nil, cookie), 409)
	lock, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback(ctx)
	if _, err = lock.Exec(ctx, `LOCK TABLE gongming_wallets,gongming_ledger,gongming_documents,gongming_messages,gongming_friend_requests,gongming_reports,gongming_audits IN ACCESS EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}
	bounded := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		reopened.ServeHTTP(w, r.WithContext(ctx))
	})
	for _, session := range []*http.Cookie{cookie, nil} {
		for _, method := range []string{"GET", "HEAD"} {
			if next := readMedia(t, bounded, method, asset.URL, session); next.Code != 200 {
				t.Fatalf("media unnecessarily loads unrelated State: %d %s", next.Code, next.Body)
			}
		}
	}
	if err = lock.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	requireCode(t, call(t, h, "PATCH", "/admin/media/"+asset.ID, map[string]string{"status": "blocked", "note": "数据库审核"}, admin), 200)
	if readMedia(t, reopened, "GET", asset.URL, nil).Code != 404 || readMedia(t, reopened, "GET", asset.URL, cookie).Code != 404 || readMedia(t, reopened, "GET", asset.URL, admin).Code != 200 {
		t.Fatal("committed blocked status not enforced across instances")
	}
	if err = s.Read(ctx, func(state *State) error {
		if state.Media[asset.ID].Status != "blocked" || state.Posts[post.ID].Status != "hidden" {
			t.Fatal("block and post hiding were not atomic")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.pool.Exec(ctx, `UPDATE gongming_posts SET status='published' WHERE id=$1`, post.ID); err == nil {
		t.Fatal("database allowed blocked media publication")
	}
	requireCode(t, call(t, h, "DELETE", "/posts/"+post.ID, nil, cookie), 200)
	requireCode(t, call(t, h, "DELETE", "/media/images/"+asset.ID, nil, cookie), 200)
	var deleted bool
	if err = s.pool.QueryRow(ctx, `SELECT deleted_at IS NOT NULL FROM gongming_media_assets WHERE id=$1`, asset.ID).Scan(&deleted); err != nil || !deleted {
		t.Fatal("soft deletion not durable")
	}
	if readMedia(t, reopened, "GET", asset.URL, admin).Code != 404 {
		t.Fatal("staff read a deleted asset")
	}
}

func TestMediaPostgresConcurrentIdempotencyQuotaAndPublishBlock(t *testing.T) {
	ctx, s, dsn, a, h := postgresMediaFixture(t)
	cookie, admin := memberCookie(t, h), adminCookie(t, h)
	other, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	b := NewApp(other, a.cfg)
	second := b.Handler()
	raw := testMediaPNG(t)
	var wg sync.WaitGroup
	responses := make(chan response, 2)
	for _, handler := range []http.Handler{h, second} {
		wg.Add(1)
		go func(h http.Handler) {
			defer wg.Done()
			responses <- uploadMedia(t, h, raw, "parallel-media-client", cookie)
		}(handler)
	}
	wg.Wait()
	close(responses)
	id := ""
	for res := range responses {
		requireCode(t, res, 200)
		next := payload[MediaAsset](t, res)
		if id != "" && id != next.ID {
			t.Fatal("concurrent clientId created two assets")
		}
		id = next.ID
	}
	files, _ := os.ReadDir(a.cfg.MediaDirectory)
	if len(files) != 1 {
		t.Fatal("concurrent idempotency left losing candidate file")
	}
	assetURL := mediaURLPrefix + id
	post := payload[Post](t, call(t, h, "POST", "/posts", map[string]any{"body": "审核并发", "images": []string{assetURL}}, cookie))
	results := make(chan response, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		results <- call(t, h, "PATCH", "/admin/posts/"+post.ID, map[string]string{"status": "published"}, admin)
	}()
	go func() {
		defer wg.Done()
		results <- call(t, second, "PATCH", "/admin/media/"+id, map[string]string{"status": "blocked", "note": "并发审核"}, admin)
	}()
	wg.Wait()
	close(results)
	for res := range results {
		if res.Code != 200 && res.Code != 409 {
			t.Fatalf("unexpected review race error: %d %v", res.Code, res.Error)
		}
	}
	var invalid int
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_posts p JOIN gongming_post_media ref ON ref.post_id=p.id JOIN gongming_media_assets a ON a.id=ref.media_id WHERE p.status='published' AND a.status='blocked'`).Scan(&invalid); err != nil || invalid != 0 {
		t.Fatal("concurrent review left blocked media published")
	}
	if readMedia(t, h, "GET", assetURL, nil).Code != 404 {
		t.Fatal("blocked media raced public authorization")
	}
	// Fill to 99; the two independent API instances must not both consume the
	// final slot despite separate in-process upload gates.
	if err = s.Update(ctx, func(state *State) error {
		for index := 0; index < 98; index++ {
			assetID := newID("media_")
			now := time.Now().UTC().Truncate(time.Microsecond)
			state.Media[assetID] = StoredMediaAsset{MediaAsset: MediaAsset{ID: assetID, URL: mediaURLPrefix + assetID, ContentType: "image/png", Width: 1, Height: 1, Bytes: 1, CreatedAt: now}, OwnerID: "user_demo", ClientID: fmt.Sprintf("quota-existing-%03d", index), SourceHash: strings.Repeat("a", 64), Status: "ready", UpdatedAt: now}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	results = make(chan response, 2)
	for index, handler := range []http.Handler{h, second} {
		wg.Add(1)
		go func(index int, h http.Handler) {
			defer wg.Done()
			results <- uploadMedia(t, h, raw, fmt.Sprintf("quota-concurrent-%02d", index), cookie)
		}(index, handler)
	}
	wg.Wait()
	close(results)
	success, quota := 0, 0
	for res := range results {
		if res.Code == 200 {
			success++
		} else if res.Code == 409 && res.Error.Code == "media_quota_exceeded" {
			quota++
		} else {
			t.Fatalf("unexpected quota response: %d %v", res.Code, res.Error)
		}
	}
	if success != 1 || quota != 1 {
		t.Fatal("cross-instance quota final slot was not atomic")
	}
	var count int
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_media_assets WHERE owner_id='user_demo' AND deleted_at IS NULL`).Scan(&count); err != nil || count != 100 {
		t.Fatal("durable count exceeded quota")
	}
	files, _ = os.ReadDir(a.cfg.MediaDirectory)
	if len(files) != 2 {
		t.Fatal("quota loser left an orphan candidate")
	}
}

func TestMediaPostgresUnknownDatabaseFailureRetainsPrivateFile(t *testing.T) {
	ctx, s, _, a, h := postgresMediaFixture(t)
	cookie := memberCookie(t, h)
	if _, err := s.pool.Exec(ctx, `CREATE FUNCTION reject_media_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced media insert failure' USING ERRCODE='23514'; END $$;CREATE TRIGGER reject_media_test BEFORE INSERT ON gongming_media_assets FOR EACH ROW EXECUTE FUNCTION reject_media_test()`); err != nil {
		t.Fatal(err)
	}
	requireCode(t, uploadMedia(t, h, testMediaPNG(t), "pg-rejected-upload", cookie), 500)
	files, _ := os.ReadDir(a.cfg.MediaDirectory)
	if len(files) != 1 {
		t.Fatal("unknown database result did not retain its private candidate")
	}
	id := strings.TrimSuffix(files[0].Name(), ".png")
	if readMedia(t, h, "GET", mediaURLPrefix+id, cookie).Code != 404 {
		t.Fatal("uncommitted candidate became addressable")
	}
	var count int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_media_assets`).Scan(&count); err != nil || count != 0 {
		t.Fatal("failed transaction committed media row")
	}
}

func TestMediaV4MigrationAtomicPreservesRowsAndCookie(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	_, memory, memoryHandler := fixture(t)
	cookie := memberCookie(t, memoryHandler)
	// The source predates circles; today's development fixture includes v6
	// examples, which must not be imported into a simulated v4 source schema.
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
	if err = persistNormalized(ctx, tx, NewState(), memory.state); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	versions := map[string]string{}
	for _, table := range []string{"gongming_users", "gongming_posts", "gongming_sessions"} {
		var raw []byte
		query := `SELECT jsonb_agg(to_jsonb(row))::text FROM (SELECT *,xmin::text AS row_version FROM ` + table + `) row`
		if err = s.pool.QueryRow(ctx, query).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		versions[table] = string(raw)
	}
	// A schema collision forces migration failure. All new tables/functions and
	// the v5 marker roll back together; old rows and sessions stay intact.
	if _, err = s.pool.Exec(ctx, `CREATE TABLE gongming_media_assets(collision text)`); err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(ctx); err == nil {
		t.Fatal("colliding v5 migration unexpectedly succeeded")
	}
	var marker, refs bool
	if err = s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=5),to_regclass('gongming_post_media') IS NOT NULL`).Scan(&marker, &refs); err != nil || marker || refs {
		t.Fatal("failed v5 migration leaked partial schema/marker")
	}
	if _, err = s.pool.Exec(ctx, `DROP TABLE gongming_media_assets`); err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(ctx); err != nil {
		t.Fatal("v5 migration is not idempotent", err)
	}
	for table, before := range versions {
		var raw []byte
		query := `SELECT jsonb_agg(to_jsonb(row))::text FROM (SELECT *,xmin::text AS row_version FROM ` + table + `) row`
		if err = s.pool.QueryRow(ctx, query).Scan(&raw); err != nil || string(raw) != before {
			t.Fatalf("v5 rewrote existing %s rows or IDs", table)
		}
	}
	a := NewApp(s, Config{Environment: "test", Origins: []string{"http://localhost:5173"}, BcryptCost: 4})
	requireCode(t, call(t, a.Handler(), "GET", "/auth/me", nil, cookie), 200)
	if err = s.Read(ctx, func(state *State) error {
		if state.Media == nil || len(state.Media) != 0 {
			t.Fatal("legacy media state not initialized empty")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
