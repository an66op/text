package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestCircleEventV7MigrationPreservesRowsFilesCookieAndFailureRollback(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	_, memory, mh := fixture(t)
	cookie := memberCookie(t, mh)
	directory := filepath.Join(t.TempDir(), "media")
	if err := PrepareMediaDirectory(directory); err != nil {
		t.Fatal(err)
	}
	raw := testMediaPNG(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	id := newID("media_")
	asset := StoredMediaAsset{MediaAsset: MediaAsset{ID: id, URL: mediaURLPrefix + id, Scope: "world", ContentType: "image/png", Width: 12, Height: 7, Bytes: int64(len(raw)), CreatedAt: now}, OwnerID: "user_demo", ClientID: "event-v7-old-media", SourceHash: fmt.Sprintf("%x", sha256.Sum256(raw)), Status: "ready", UpdatedAt: now}
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
	for _, migrate := range []func(context.Context, pgx.Tx) error{migrateFriendships, migrateDeviceSessions, migrateMedia, migrateCircles, migrateNotifications} {
		if err = migrate(ctx, tx); err != nil {
			t.Fatal(err)
		}
	}
	if err = persistHistoricalFixture(ctx, tx, 7, memory.state); err != nil {
		t.Fatal(err)
	}
	draft := NotificationDraft{RecipientID: "user_demo", ActorID: "user_friend", Kind: "world-like", ReferenceID: "post_design", EventKey: "v7-old-notice", CreatedAt: now}
	if err = persistNotificationDrafts(ctx, tx, []NotificationDraft{draft}); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	rows, err := s.pool.Query(ctx, `SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE 'gongming_%' AND tablename<>'gongming_schema_migrations' ORDER BY tablename`)
	if err != nil {
		t.Fatal(err)
	}
	tables := []string{}
	for rows.Next() {
		var table string
		if err = rows.Scan(&table); err != nil {
			t.Fatal(err)
		}
		tables = append(tables, table)
	}
	rows.Close()
	before := map[string]string{}
	projections := map[string]string{}
	for _, table := range tables {
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
	if _, err = s.pool.Exec(ctx, `CREATE TABLE gongming_circle_event_requests(collision text)`); err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(ctx); err == nil {
		t.Fatal("schema8 collision did not fail")
	}
	var partial, marker bool
	if err = s.pool.QueryRow(ctx, `SELECT to_regclass('gongming_circle_events') IS NOT NULL,EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=8)`).Scan(&partial, &marker); err != nil || partial || marker {
		t.Fatal("partial schema8 retained", err)
	}
	if _, err = s.pool.Exec(ctx, `DROP TABLE gongming_circle_event_requests`); err != nil {
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
			t.Fatalf("schema8 rewrote old %s: %v", table, err)
		}
	}
	a := NewApp(s, Config{Environment: "development", Origins: []string{"http://localhost:5173"}, BcryptCost: 4, MediaDirectory: directory})
	if err = a.SeedDevelopment(ctx); err != nil {
		t.Fatal(err)
	}
	if count := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_circle_events`); count != 0 {
		t.Fatal("upgraded existing database seeded activity", count)
	}
	requireCode(t, call(t, a.Handler(), "GET", "/auth/me", nil, cookie), 200)
	if page := notificationsPage(t, a.Handler(), cookie); page.Total != 1 || page.Items[0].Kind != "world-like" {
		t.Fatal("old notification changed", page)
	}
	file, err := os.ReadFile(filepath.Join(directory, mediaFilename(asset)))
	if err != nil || !bytes.Equal(file, raw) {
		t.Fatal("private file changed", err)
	}
}

func TestCircleEventPostgresQuotaSeedAndDSTDuration(t *testing.T) {
	ctx, s, _, a, h := postgresMediaFixture(t)
	owner := memberCookie(t, h)
	var circle string
	if err := s.pool.QueryRow(ctx, `SELECT id FROM gongming_circles WHERE visibility='public' AND client_id LIKE 'development-circle-%'`).Scan(&circle); err != nil {
		t.Fatal(err)
	}
	res := call(t, h, "GET", "/circles/"+circle+"/events?view=mine", nil, owner)
	requireCode(t, res, 200)
	page := payload[struct {
		Items []CircleEvent
		Total int
	}](t, res)
	if page.Total != 2 {
		t.Fatal("first-empty seed missing activities", page)
	}
	confirmed, waiting := 0, 0
	for _, e := range page.Items {
		if e.RegisteredCount != 1 || e.WaitlistedCount != 1 || e.MyRegistration == nil {
			t.Fatal(e)
		}
		switch e.MyRegistration.Status {
		case "registered":
			confirmed++
		case "waitlisted":
			waiting++
		}
	}
	if confirmed != 1 || waiting != 1 {
		t.Fatal("seed does not include own confirmation and waitlist")
	}
	if err := a.SeedDevelopment(ctx); err != nil {
		t.Fatal(err)
	}
	if n := notificationCount(t, ctx, s, `SELECT count(*) FROM gongming_circle_events`); n != 2 {
		t.Fatal("existing seed duplicated", n)
	}
	c := createdCircle(t, h, owner, "public", "open")
	for i := 0; i < 20; i++ {
		createdEvent(t, h, owner, c.ID, eventInputForTest(a.now(), 1))
	}
	res = call(t, h, "POST", "/circles/"+c.ID+"/events", struct {
		EventInput
		ClientID string `json:"clientId"`
	}{eventInputForTest(a.now(), 1), "quota-over-twenty"}, owner)
	requireCode(t, res, 409)
	// SQL intervals use absolute hours too, independent of a session's DST zone.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SET LOCAL TIME ZONE 'America/Denver'`); err != nil {
		t.Fatal(err)
	}
	start := time.Date(2027, 3, 13, 19, 0, 0, 0, time.UTC)
	v := eventInputForTest(a.now(), 1)
	v.StartsAt = start
	v.EndsAt = start.Add(168 * time.Hour)
	v.RegistrationClosesAt = start.Add(-time.Hour)
	e := storedCircleEvent{CircleEvent: CircleEvent{ID: newID("cevent_"), CircleID: circle, EventInput: v, Lifecycle: "published", Moderation: "visible", Revision: 1, CreatedAt: a.circleNow(), UpdatedAt: a.circleNow()}, CreatorID: "user_demo", ClientID: "dst-absolute-duration", Fingerprint: eventFingerprint(v)}
	if err = insertCircleEvent(ctx, tx, e); err != nil {
		t.Fatal("valid 168 hours rejected in DST zone", err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	_, err = s.pool.Exec(ctx, `UPDATE gongming_circle_events SET ends_at=starts_at+interval '168 hours 1 second',revision=revision+1 WHERE id=$1`, e.ID)
	expectDatabaseCode(t, err, "23514")
}

func TestCircleEventPostgresNewEventAfterStateSnapshotReconciles(t *testing.T) {
	ctx, s, dsn, a, h := postgresMediaFixture(t)
	owner := memberCookie(t, h)
	person, peer := circleUser(t, h, "eventnewpredicate")
	c := createdCircle(t, h, owner, "public", "open")
	requireCode(t, call(t, h, "POST", "/circles/"+c.ID+"/join", map[string]any{}, peer), 200)
	other, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	h2 := NewApp(other, a.cfg).Handler()
	for _, accountLoss := range []bool{false, true} {
		loaded, release, done := make(chan struct{}), make(chan struct{}), make(chan error, 1)
		var first sync.Once
		var attempts atomic.Int32
		go func() {
			done <- s.Update(ctx, func(st *State) error {
				attempts.Add(1)
				first.Do(func() { close(loaded); <-release })
				if accountLoss {
					account := st.Accounts[person.ID]
					account.User.Status = "suspended"
					st.Accounts[person.ID] = account
					for hash, session := range st.Sessions {
						if session.UserID == person.ID {
							delete(st.Sessions, hash)
						}
					}
				} else {
					member := st.CircleMembers[circleMemberKey(c.ID, person.ID)]
					member.Status = "removed"
					st.CircleMembers[circleMemberKey(c.ID, person.ID)] = member
				}
				return nil
			})
		}()
		<-loaded
		e := createdEvent(t, h2, owner, c.ID, eventInputForTest(a.now(), 1))
		eventRegistrationPayload(t, eventRegistrationCall(t, h2, peer, e, "join", "new-entity-after-snapshot"))
		close(release)
		if err = <-done; err != nil {
			t.Fatal(err)
		}
		if attempts.Load() < 2 {
			t.Fatal("new entity predicate did not cause complete retry")
		}
		current := eventRead(t, h2, owner, e)
		if current.RegisteredCount != 0 {
			t.Fatal("new invisible activity kept lost member booking", current)
		}
		if !accountLoss {
			requireCode(t, call(t, h, "POST", "/circles/"+c.ID+"/join", map[string]any{}, peer), 200)
		}
	}
}
