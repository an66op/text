package platform

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func versionThreeSessionDatabase(t *testing.T) (context.Context, *PostgresStore, string, *http.Cookie) {
	t.Helper()
	ctx, store, dsn := isolatedPostgres(t)
	if _, err := store.pool.Exec(ctx, `CREATE TABLE gongming_schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		t.Fatal(err)
	}
	for _, ddl := range []string{normalizedSchema, normalizedGuards, friendshipSchema, `INSERT INTO gongming_schema_migrations(version) VALUES(2),(3)`} {
		if _, err := store.pool.Exec(ctx, ddl); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.pool.Exec(ctx, `INSERT INTO gongming_users(id,handle,name,email,avatar,bio,role,status,password_hash,created_at) VALUES('user_legacy','legacy_owner','旧会话成员','legacy@example.test','','','member','active',$1,$2)`, hashPassword("LegacyPassword123!", 4), time.Now().Add(-30*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{Name: cookieName, Value: strings.Repeat("a", 64)}
	for _, row := range []struct {
		token   string
		expires time.Time
	}{{cookie.Value, time.Now().Add(24 * time.Hour)}, {strings.Repeat("b", 64), time.Now().Add(48 * time.Hour)}, {strings.Repeat("c", 64), time.Now().Add(-time.Hour)}} {
		if _, err := store.pool.Exec(ctx, `INSERT INTO gongming_sessions(token_hash,user_id,expires_at) VALUES($1,'user_legacy',$2)`, tokenHash(row.token), row.expires.UTC().Truncate(time.Microsecond)); err != nil {
			t.Fatal(err)
		}
	}
	return ctx, store, dsn, cookie
}

func authenticationRows(t *testing.T, ctx context.Context, store *PostgresStore) string {
	t.Helper()
	var result string
	if err := store.pool.QueryRow(ctx, `SELECT jsonb_agg(jsonb_build_array(token_hash,user_id,extract(epoch from expires_at)) ORDER BY token_hash)::text FROM gongming_sessions`).Scan(&result); err != nil {
		t.Fatal(err)
	}
	return result
}

func publicSessionIDs(t *testing.T, ctx context.Context, store *PostgresStore) map[string]string {
	t.Helper()
	result := map[string]string{}
	rows, err := store.pool.Query(ctx, `SELECT token_hash,public_id FROM gongming_sessions`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var hash, id string
		if err := rows.Scan(&hash, &id); err != nil {
			t.Fatal(err)
		}
		result[hash] = id
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestDeviceSessionPostgresMigrationPreservesCookiesAndOldWriterCompatibility(t *testing.T) {
	ctx, store, _, cookie := versionThreeSessionDatabase(t)
	original := authenticationRows(t, ctx, store)
	if err := store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if authenticationRows(t, ctx, store) != original {
		t.Fatal("device migration changed existing authentication rows or expiry")
	}
	app := NewApp(store, Config{Environment: "development", Origins: []string{"http://localhost:5173"}, BcryptCost: 4})
	t.Cleanup(app.CloseStreams)
	h := app.Handler()
	requireCode(t, call(t, h, "GET", "/auth/me", nil, cookie), 200)
	first := devices(t, h, cookie)
	if first.Total != 2 {
		t.Fatal("migration lost active sessions or exposed expired ones")
	}
	for _, item := range first.Items {
		if !item.Legacy || item.Device != unknownSessionDevice || item.CreatedAt != nil || item.LastSeenAt != nil || len(item.ID) != 40 || !strings.HasPrefix(item.ID, "session_") {
			t.Fatalf("legacy metadata fabricated history: %+v", item)
		}
	}
	beforeIDs := publicSessionIDs(t, ctx, store)
	if err := store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	for hash, id := range publicSessionIDs(t, ctx, store) {
		if beforeIDs[hash] != id {
			t.Fatal("migration rerun changed public session identity")
		}
	}
	// An older binary's original INSERT remains valid after additive v4 rollout.
	oldWriterCookie := &http.Cookie{Name: cookieName, Value: strings.Repeat("d", 64)}
	if _, err := store.pool.Exec(ctx, `INSERT INTO gongming_sessions(token_hash,user_id,expires_at) VALUES($1,'user_legacy',$2)`, tokenHash(oldWriterCookie.Value), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	unknown := currentDevice(t, devices(t, h, oldWriterCookie))
	if !unknown.Legacy || unknown.CreatedAt != nil || unknown.LastSeenAt != nil || unknown.Device != unknownSessionDevice {
		t.Fatal("old writer was given invented metadata")
	}
	if currentDevice(t, devices(t, h, cookie)).ID != beforeIDs[tokenHash(cookie.Value)] {
		t.Fatal("old cookie stopped identifying its original session")
	}
}

func TestDeviceSessionPostgresMigrationFailureRollsBackAndRecovers(t *testing.T) {
	ctx, store, _, cookie := versionThreeSessionDatabase(t)
	original := authenticationRows(t, ctx, store)
	if _, err := store.pool.Exec(ctx, `CREATE FUNCTION reject_session_v4() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.version=4 THEN RAISE EXCEPTION 'injected migration failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_session_v4 BEFORE INSERT ON gongming_schema_migrations FOR EACH ROW EXECUTE FUNCTION reject_session_v4()`); err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(ctx); err == nil {
		t.Fatal("injected failure did not reject migration")
	}
	var column, marker bool
	if err := store.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='gongming_sessions' AND column_name='public_id'),EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=4)`).Scan(&column, &marker); err != nil {
		t.Fatal(err)
	}
	if column || marker || authenticationRows(t, ctx, store) != original {
		t.Fatal("failed migration left partial metadata/schema or changed old credentials")
	}
	var usable bool
	if err := store.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gongming_sessions s JOIN gongming_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status='active')`, tokenHash(cookie.Value)).Scan(&usable); err != nil || !usable {
		t.Fatal("rollback invalidated the old binary's authentication inputs")
	}
	if _, err := store.pool.Exec(ctx, `DROP TRIGGER reject_session_v4 ON gongming_schema_migrations; DROP FUNCTION reject_session_v4()`); err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("migration did not recover after repairing cause: %v", err)
	}
	if authenticationRows(t, ctx, store) != original {
		t.Fatal("recovered migration changed authentication history")
	}
	app := NewApp(store, Config{Environment: "development", Origins: []string{"http://localhost:5173"}, BcryptCost: 4})
	t.Cleanup(app.CloseStreams)
	requireCode(t, call(t, app.Handler(), "GET", "/auth/me", nil, cookie), 200)
	if item := currentDevice(t, devices(t, app.Handler(), cookie)); !item.Legacy || item.CreatedAt != nil {
		t.Fatal("recovery fabricated session establishment time")
	}
}

func TestDeviceSessionPostgresPersistenceReadOnlyMetadataAndCrossInstanceRevocation(t *testing.T) {
	ctx, store, dsn := isolatedPostgres(t)
	app := seedPostgres(t, ctx, store)
	t.Cleanup(app.CloseStreams)
	h := app.Handler()
	current := loginDevice(t, h, "demo@gongming.local", "Demo2026!", "Mozilla/5.0 (Macintosh) Safari/605")
	other := loginDevice(t, h, "demo@gongming.local", "Demo2026!", "Mozilla/5.0 (Android) Chrome/123")
	currentID := currentDevice(t, devices(t, h, current)).ID
	otherID := currentDevice(t, devices(t, h, other)).ID
	var xmin string
	if err := store.pool.QueryRow(ctx, `SELECT xmin::text FROM gongming_sessions WHERE public_id=$1`, currentID).Scan(&xmin); err != nil {
		t.Fatal(err)
	}
	original := devices(t, h, current)
	peerStore, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(peerStore.Close)
	peer := NewApp(peerStore, app.cfg)
	t.Cleanup(peer.CloseStreams)
	peer.now = func() time.Time { return time.Now().Add(5 * time.Hour) }
	reloaded := devices(t, peer.Handler(), current)
	if reloaded.Total != 2 || currentDevice(t, reloaded).ID != currentID || !currentDevice(t, reloaded).LastSeenAt.Equal(*currentDevice(t, original).LastSeenAt) {
		t.Fatal("metadata was lost or GET invented a new validation time")
	}
	var nextXmin string
	if err := store.pool.QueryRow(ctx, `SELECT xmin::text FROM gongming_sessions WHERE public_id=$1`, currentID).Scan(&nextXmin); err != nil || nextXmin != xmin {
		t.Fatal("GET rewrote session metadata")
	}
	// Use real server time for socket validity; the prior artificial clock only
	// proved that a later read does not rewrite lastSeenAt.
	peer.now = time.Now
	server := httptest.NewServer(peer.Handler())
	t.Cleanup(server.Close)
	currentConn, _ := socket(t, server.URL, current, "")
	otherConn, _ := socket(t, server.URL, other, "")
	requireCode(t, call(t, h, "DELETE", "/me/sessions/"+otherID, nil, current), 200)
	closeCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _, err = otherConn.Read(closeCtx)
	if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
		t.Fatalf("other instance kept a revoked device stream open: %v", err)
	}
	message := sent(t, h, current, "conversation_group", "保留设备的跨实例连接仍有效", "device-pg-retained")
	if receive(t, currentConn).MessageID != message.ID {
		t.Fatal("retained device did not receive authoritative event")
	}
	requireCode(t, call(t, peer.Handler(), "GET", "/auth/me", nil, other), 401)
	if err = peerStore.Read(ctx, func(s *State) error {
		if s.Sessions[tokenHash(current.Value)].ID != currentID {
			t.Fatal("current public ID did not persist")
		}
		if _, exists := s.Sessions[tokenHash(other.Value)]; exists {
			t.Fatal("revocation was not persisted")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestDeviceSessionPostgresFailedCommitDoesNotClearCurrentCookie(t *testing.T) {
	ctx, store, _ := isolatedPostgres(t)
	app := seedPostgres(t, ctx, store)
	t.Cleanup(app.CloseStreams)
	h := app.Handler()
	cookie := memberCookie(t, h)
	id := currentDevice(t, devices(t, h, cookie)).ID
	if _, err := store.pool.Exec(ctx, `CREATE FUNCTION reject_session_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected revoke failure' USING ERRCODE='23514'; END $$; CREATE TRIGGER reject_session_delete BEFORE DELETE ON gongming_sessions FOR EACH ROW EXECUTE FUNCTION reject_session_delete()`); err != nil {
		t.Fatal(err)
	}
	failed := call(t, h, "DELETE", "/me/sessions/"+id, nil, cookie)
	requireCode(t, failed, 500)
	if len(failed.Cookies) != 0 {
		t.Fatal("failed transaction cleared the browser cookie")
	}
	requireCode(t, call(t, h, "GET", "/auth/me", nil, cookie), 200)
	if _, err := store.pool.Exec(ctx, `DROP TRIGGER reject_session_delete ON gongming_sessions; DROP FUNCTION reject_session_delete()`); err != nil {
		t.Fatal(err)
	}
	success := call(t, h, "DELETE", "/me/sessions/"+id, nil, cookie)
	requireCode(t, success, 200)
	if !payload[DeviceSessionRevocation](t, success).Current || len(success.Cookies) != 1 {
		t.Fatal("successful current revocation did not clear cookie")
	}
}

func TestDeviceSessionPostgresConcurrentRevokeOthersKeepsAValidWinner(t *testing.T) {
	ctx, store, dsn := isolatedPostgres(t)
	app := seedPostgres(t, ctx, store)
	t.Cleanup(app.CloseStreams)
	h := app.Handler()
	first := memberCookie(t, h)
	second := memberCookie(t, h)
	peerStore, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(peerStore.Close)
	peer := NewApp(peerStore, app.cfg)
	t.Cleanup(peer.CloseStreams)
	replies := make(chan response, 2)
	var workers sync.WaitGroup
	for index, cookie := range []*http.Cookie{first, second} {
		workers.Add(1)
		go func(index int, cookie *http.Cookie) {
			defer workers.Done()
			handler := h
			if index == 1 {
				handler = peer.Handler()
			}
			replies <- call(t, handler, "POST", "/me/sessions/revoke-others", map[string]any{}, cookie)
		}(index, cookie)
	}
	workers.Wait()
	success, rejected := 0, 0
	for i := 0; i < 2; i++ {
		reply := <-replies
		switch reply.Code {
		case 200:
			success++
			if payload[struct {
				Revoked int `json:"revoked"`
			}](t, reply).Revoked != 1 {
				t.Fatal("winner did not revoke exactly the other session")
			}
		case 401:
			rejected++
		default:
			t.Fatalf("unexpected concurrent revocation: %d %v", reply.Code, reply.Error)
		}
	}
	if success != 1 || rejected != 1 {
		t.Fatal("competing revocations did not serialize")
	}
	var count int
	if err := store.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_sessions WHERE user_id='user_demo' AND expires_at>now()`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("no valid current device retained: %d %v", count, err)
	}
}
