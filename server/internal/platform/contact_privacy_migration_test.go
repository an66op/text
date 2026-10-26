package platform

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"github.com/jackc/pgx/v5"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestContactPrivacyV10MigrationPreservesAllColumnsXminFilesCookieAndRollback(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	_, memory, mh := fixture(t)
	cookie := memberCookie(t, mh)
	now := time.Now().UTC().Truncate(time.Microsecond)
	raw := testMediaPNG(t)
	sum := sha256.Sum256(raw)
	asset := StoredMediaAsset{MediaAsset: MediaAsset{ID: newID("media_"), ContentType: "image/png", Width: 12, Height: 7, Bytes: int64(len(raw)), CreatedAt: now, Scope: "world"}, OwnerID: "user_demo", ClientID: "pre-v11-image-file", SourceHash: hex.EncodeToString(sum[:]), Status: "ready", UpdatedAt: now}
	asset.URL = mediaURLPrefix + asset.ID
	memory.state.Media[asset.ID] = asset
	appendMessageEvent(memory.state, "message.created", "conversation_group", "message_group", "", now)
	dir := filepath.Join(t.TempDir(), "private")
	if e := PrepareMediaDirectory(dir); e != nil {
		t.Fatal(e)
	}
	if e := writeMediaFile(dir, asset, raw); e != nil {
		t.Fatal(e)
	}
	oldFile, e := os.ReadFile(filepath.Join(dir, mediaFilename(asset)))
	if e != nil {
		t.Fatal(e)
	}
	oldHash := sha256.Sum256(oldFile)
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `CREATE TABLE gongming_schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());`+normalizedSchema+normalizedGuards+`INSERT INTO gongming_schema_migrations(version) VALUES(2)`); e != nil {
		t.Fatal(e)
	}
	for _, fn := range []func(context.Context, pgx.Tx) error{migrateFriendships, migrateDeviceSessions, migrateMedia, migrateCircles, migrateNotifications, migrateCircleEvents, migrateWalletIdentity, migrateMessageMedia} {
		if e = fn(ctx, tx); e != nil {
			t.Fatal(e)
		}
	}
	if e = persistHistoricalFixture(ctx, tx, 10, memory.state); e != nil {
		t.Fatal(e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	rows, e := s.pool.Query(ctx, `SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name`)
	if e != nil {
		t.Fatal(e)
	}
	tables := []string{}
	for rows.Next() {
		var table string
		if e = rows.Scan(&table); e != nil {
			t.Fatal(e)
		}
		tables = append(tables, table)
	}
	rows.Close()
	if len(tables) != 42 {
		t.Fatal("unexpected v10 baseline", len(tables))
	}
	queries, values := map[string]string{}, map[string]string{}
	for _, table := range tables {
		q, e := freezeMigrationProjection(ctx, s, table)
		if e != nil {
			t.Fatal(e)
		}
		if table == "gongming_schema_migrations" {
			q = strings.Replace(q, `FROM "gongming_schema_migrations")`, `FROM "gongming_schema_migrations" WHERE version<=10)`, 1)
		}
		queries[table] = q
		var raw string
		if e = s.pool.QueryRow(ctx, q).Scan(&raw); e != nil {
			t.Fatal(e)
		}
		values[table] = raw
	}
	if _, e = s.pool.Exec(ctx, `CREATE TABLE gongming_user_blocks(collision text)`); e != nil {
		t.Fatal(e)
	}
	if e = s.Migrate(ctx); e == nil {
		t.Fatal("collision committed")
	}
	var marker, prefs bool
	if e = s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=11),to_regclass('gongming_contact_preferences') IS NOT NULL`).Scan(&marker, &prefs); e != nil || marker || prefs {
		t.Fatal("partial v11 schema", marker, prefs, e)
	}
	if _, e = s.pool.Exec(ctx, `DROP TABLE gongming_user_blocks`); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 2; i++ {
		if e = s.Migrate(ctx); e != nil {
			t.Fatal(e)
		}
	}
	for table, q := range queries {
		var value string
		if e = s.pool.QueryRow(ctx, q).Scan(&value); e != nil || value != values[table] {
			t.Fatal("rewrote baseline", table, e)
		}
	}
	after, e := os.ReadFile(filepath.Join(dir, mediaFilename(asset)))
	if e != nil || sha256.Sum256(after) != oldHash {
		t.Fatal("old media file changed", e)
	}
	var privateRows int
	if e = s.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM gongming_contact_preferences)+(SELECT count(*) FROM gongming_user_blocks)`).Scan(&privateRows); e != nil || privateRows != 0 {
		t.Fatal("private domain backfilled", privateRows, e)
	}
	a := NewApp(s, Config{Environment: "development", Origins: []string{"http://localhost:5173"}, MediaDirectory: dir})
	h := a.Handler()
	requireCode(t, call(t, h, "GET", "/auth/me", nil, cookie), 200)
	if readMedia(t, h, "GET", asset.URL, cookie).Code != 200 {
		t.Fatal("old media permission changed")
	}
	requireCode(t, call(t, h, "GET", "/me/contact-privacy", nil, cookie), 200)
	if e = s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_contact_preferences`).Scan(&privateRows); e != nil || privateRows != 0 {
		t.Fatal("read created a policy row")
	}
}
