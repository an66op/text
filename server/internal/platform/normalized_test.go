package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

func isolatedPostgres(t *testing.T) (context.Context, *PostgresStore, string) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required for normalized PostgreSQL verification")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	t.Cleanup(cancel)
	admin, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := newID("gongming_normalized_test_")
	identifier := pgx.Identifier{schema}.Sanitize()
	if _, err = admin.pool.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := admin.pool.Exec(cleanup, "DROP SCHEMA "+identifier+" CASCADE")
		if err != nil {
			t.Errorf("schema cleanup: %v", err)
		}
		admin.Close()
	})
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	store, err := OpenPostgres(ctx, parsed.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Close)
	return ctx, store, parsed.String()
}
func seedPostgres(t *testing.T, ctx context.Context, s *PostgresStore) *App {
	t.Helper()
	if err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	a := NewApp(s, Config{Environment: "development", Origins: []string{"http://localhost:5173"}, BcryptCost: bcrypt.MinCost})
	if err := a.SeedDevelopment(ctx); err != nil {
		t.Fatal(err)
	}
	return a
}
func installLegacy(t *testing.T, ctx context.Context, s *PostgresStore, state *State) []byte {
	t.Helper()
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.pool.Exec(ctx, `CREATE TABLE gongming_schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());INSERT INTO gongming_schema_migrations(version) VALUES(1);CREATE TABLE gongming_app_state(id smallint PRIMARY KEY,value jsonb NOT NULL,revision bigint NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now());`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.pool.Exec(ctx, `INSERT INTO gongming_app_state(id,value) VALUES(1,$1::jsonb)`, string(raw)); err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestNormalizedLegacyMigrationPreservesAndBecomesAuthoritative(t *testing.T) {
	ctx, s, dsn := isolatedPostgres(t)
	_, mem, h := fixture(t)
	cookie := memberCookie(t, h)
	requireCode(t, call(t, h, "POST", "/wallet/faucet", map[string]string{"requestId": "migration-faucet"}, cookie), 200)
	requireCode(t, call(t, h, "POST", "/wallet/transfer", map[string]string{"recipientHandle": "zhouye", "amount": "12345", "requestId": "migration-transfer"}, cookie), 200)
	requireCode(t, call(t, h, "PUT", "/documents/preferences", map[string]any{"value": map[string]string{"theme": "night"}, "revision": 0}, cookie), 200)
	// The v1 export intentionally predates message sequences, reads and outbox.
	for id, m := range mem.state.Messages {
		m.Seq = 0
		mem.state.Messages[id] = m
	}
	raw := installLegacy(t, ctx, s, mem.state)
	if err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("migration was not idempotent: %v", err)
	}
	var original bool
	if err := s.pool.QueryRow(ctx, `SELECT value=$1::jsonb FROM gongming_legacy_state_v1 WHERE id=1`, string(raw)).Scan(&original); err != nil || !original {
		t.Fatalf("original legacy payload changed: %v", err)
	}
	var oldName bool
	_ = s.pool.QueryRow(ctx, `SELECT to_regclass('gongming_app_state') IS NOT NULL`).Scan(&oldName)
	if oldName {
		t.Fatal("old binary could still write abandoned blob")
	}
	reopened, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if err = reopened.Read(ctx, func(state *State) error {
		if len(state.Accounts) != len(mem.state.Accounts) || len(state.Posts) != len(mem.state.Posts) || len(state.Messages) != len(mem.state.Messages) || len(state.Sessions) != len(mem.state.Sessions) {
			t.Fatal("entity counts changed during migration")
		}
		for id, post := range mem.state.Posts {
			got, exists := state.Posts[id]
			if !exists || got.Body != post.Body || !entityEqual(got.Likes, post.Likes) {
				t.Fatalf("post ID/content/likes changed %s", id)
			}
		}
		if state.Wallets["user_demo"].Balance != 87655 || state.Wallets["user_friend"].Balance != 12345 || len(state.Wallets["user_demo"].Transactions) != 2 || len(state.Idempotency) != 2 {
			t.Fatal("ledger/balance/idempotency migration changed")
		}
		if state.Documents["user_demo"]["preferences"].Revision != 1 {
			t.Fatal("document revision lost")
		}
		for _, message := range state.Messages {
			if message.Seq < 1 {
				t.Fatal("legacy sequence not backfilled")
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// The normalized tables must be the only authority, even without the backup.
	if _, err = s.pool.Exec(ctx, `DROP TABLE gongming_legacy_state_v1;UPDATE gongming_users SET name='来自权威关系表' WHERE id='user_demo'`); err != nil {
		t.Fatal(err)
	}
	if err = reopened.Read(ctx, func(state *State) error {
		if state.Accounts["user_demo"].User.Name != "来自权威关系表" {
			t.Fatal("runtime still reads legacy state")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	next := NewApp(reopened, Config{Environment: "test", Origins: []string{"http://localhost:5173"}, BcryptCost: bcrypt.MinCost})
	requireCode(t, call(t, next.Handler(), "GET", "/auth/me", nil, cookie), 200)
}

func TestNormalizedFailedMigrationRollsBackSchemaAndSource(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	state := NewState()
	state.Posts["broken"] = StoredPost{ID: "broken", AuthorID: "nonexistent", Body: "invalid foreign key", Images: []string{}, Status: "published", CreatedAt: time.Now(), Likes: map[string]bool{}}
	raw := installLegacy(t, ctx, s, state)
	if err := s.Migrate(ctx); err == nil {
		t.Fatal("orphaned legacy post migrated")
	}
	var preserved bool
	if err := s.pool.QueryRow(ctx, `SELECT value=$1::jsonb FROM gongming_app_state WHERE id=1`, string(raw)).Scan(&preserved); err != nil || !preserved {
		t.Fatal("failed migration altered source")
	}
	var usersExist, marker bool
	if err := s.pool.QueryRow(ctx, `SELECT to_regclass('gongming_users') IS NOT NULL,EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=2)`).Scan(&usersExist, &marker); err != nil || usersExist || marker {
		t.Fatal("failed migration left partial schema/version")
	}
}

func TestNormalizedWritesOnlyChangedRows(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	seedPostgres(t, ctx, s)
	readVersions := func() map[string]string {
		result := map[string]string{}
		for _, query := range []string{`SELECT id,xmin::text FROM gongming_users`, `SELECT id,xmin::text FROM gongming_posts`, `SELECT id,xmin::text FROM gongming_messages`} {
			rows, err := s.pool.Query(ctx, query)
			if err != nil {
				t.Fatal(err)
			}
			for rows.Next() {
				var id, version string
				if err = rows.Scan(&id, &version); err != nil {
					t.Fatal(err)
				}
				result[id] = version
			}
			rows.Close()
		}
		return result
	}
	before := readVersions()
	if err := s.Update(ctx, func(state *State) error {
		account := state.Accounts["user_demo"]
		account.User.Bio = "仅更新这一条资料"
		state.Accounts["user_demo"] = account
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	after := readVersions()
	for id, version := range before {
		if id == "user_demo" {
			if after[id] == version {
				t.Fatal("changed user was not persisted")
			}
		} else if after[id] != version {
			t.Fatalf("unrelated row %s was rewritten", id)
		}
	}
}

func expectDatabaseCode(t *testing.T, err error, code string) {
	t.Helper()
	var pg *pgconn.PgError
	if !errors.As(err, &pg) || pg.Code != code {
		t.Fatalf("expected SQLSTATE %s, got %v", code, err)
	}
}
func TestNormalizedConstraintsAndImmutableBalancedLedger(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	a := seedPostgres(t, ctx, s)
	h := a.Handler()
	cookie := memberCookie(t, h)
	requireCode(t, call(t, h, "POST", "/wallet/faucet", map[string]string{"requestId": "constraints-faucet"}, cookie), 200)
	for _, test := range []struct{ query, code string }{
		{`UPDATE gongming_users SET role='superuser' WHERE id='user_demo'`, "23514"},
		{`UPDATE gongming_users SET email='admin@gongming.local' WHERE id='user_demo'`, "23505"},
		{`INSERT INTO gongming_comments(id,post_id,author_id,body,created_at) VALUES('orphan','missing','user_demo','x',now())`, "23503"},
		{`UPDATE gongming_wallets SET balance=-1 WHERE user_id='user_demo'`, "23514"},
		{`UPDATE gongming_wallets SET balance=1 WHERE user_id='user_demo'`, "23514"},
		{`UPDATE gongming_ledger SET amount=1`, "23514"},
		{`DELETE FROM gongming_audits`, "23514"},
		{`UPDATE gongming_wallet_requests SET fingerprint='corrupt'`, "23514"},
	} {
		_, err := s.pool.Exec(ctx, test.query)
		expectDatabaseCode(t, err, test.code)
	}
	// A balanced wallet delta alone cannot manufacture a one-sided transfer.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `UPDATE gongming_wallets SET balance=99999 WHERE user_id='user_demo';INSERT INTO gongming_ledger(wallet_user_id,entry_id,kind,amount,symbol,counterparty,request_id,created_at,position) VALUES('user_demo','forged','transfer_out',-1,'GEM','zhouye','forged-request',now(),1)`)
	if err != nil {
		t.Fatal(err)
	}
	expectDatabaseCode(t, tx.Commit(ctx), "23514")
	wallet := payload[Wallet](t, call(t, h, "GET", "/wallet", nil, cookie))
	if wallet.Assets[0].Balance != "100000" {
		t.Fatal("failed DB invariant transaction changed wallet")
	}
}

func TestNormalizedRepeatableSnapshotAndConcurrentEntityUpdates(t *testing.T) {
	ctx, s, dsn := isolatedPostgres(t)
	seedPostgres(t, ctx, s)
	other, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	loaded := make(chan struct{})
	changed := make(chan struct{})
	errCh := make(chan error, 1)
	go func() {
		errCh <- s.Read(ctx, func(state *State) error {
			old := state.Accounts["user_demo"].User.Bio
			close(loaded)
			<-changed
			var dbBio string
			if err := s.pool.QueryRow(ctx, `SELECT bio FROM gongming_users WHERE id='user_demo'`).Scan(&dbBio); err != nil {
				return err
			}
			if state.Accounts["user_demo"].User.Bio != old || dbBio == old {
				return fmt.Errorf("snapshot was torn or concurrent writer failed")
			}
			return nil
		})
	}()
	<-loaded
	if err = other.Update(ctx, func(state *State) error {
		account := state.Accounts["user_demo"]
		account.User.Bio = "并发提交后的资料"
		state.Accounts["user_demo"] = account
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	close(changed)
	if err = <-errCh; err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for index, id := range []string{"user_demo", "user_friend"} {
		wg.Add(1)
		go func(index int, id string) {
			defer wg.Done()
			if err := other.Update(ctx, func(state *State) error {
				account := state.Accounts[id]
				account.User.Bio = fmt.Sprintf("独立更新-%d", index)
				state.Accounts[id] = account
				return nil
			}); err != nil {
				t.Error(err)
			}
		}(index, id)
	}
	wg.Wait()
	if err = s.Read(ctx, func(state *State) error {
		if state.Accounts["user_demo"].User.Bio != "独立更新-0" || state.Accounts["user_friend"].User.Bio != "独立更新-1" {
			t.Fatal("concurrent independent updates were lost")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestNormalizedMessagingOutboxReadmarksAndNarrowStream(t *testing.T) {
	ctx, s, dsn := isolatedPostgres(t)
	a := seedPostgres(t, ctx, s)
	h := a.Handler()
	cookie := memberCookie(t, h)
	admin := adminCookie(t, h)
	var wg sync.WaitGroup
	ids := make(chan string, 8)
	for index := 0; index < 8; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res := call(t, h, "POST", "/conversations/conversation_direct/messages", map[string]string{"body": "客户端重试只发布一次", "clientId": "normalized-client-0001"}, cookie)
			if res.Code != 200 {
				t.Errorf("message retry failed: %d %v", res.Code, res.Error)
				return
			}
			ids <- payload[Message](t, res).ID
		}()
	}
	wg.Wait()
	close(ids)
	id := ""
	for next := range ids {
		if id != "" && next != id {
			t.Fatal("concurrent message retry produced distinct records")
		}
		id = next
	}
	if id == "" {
		t.Fatal("no message persisted")
	}
	requireCode(t, call(t, h, "POST", "/conversations/conversation_direct/read", map[string]string{"messageId": id}, cookie), 200)
	reopened, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	snapshot, err := reopened.ReadStream(ctx, []StreamRequest{{SessionHash: tokenHash(cookie.Value), UserID: "user_demo", AfterSeq: 0}}, 512)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Events) != 2 || snapshot.LatestSequence != 2 || snapshot.FirstSequence != 1 || !snapshot.Sessions[tokenHash(cookie.Value)].ConversationIDs["conversation_direct"] {
		t.Fatalf("outbox/readmarks did not survive restart: %+v", snapshot)
	}
	if err = reopened.Read(ctx, func(state *State) error {
		if state.Reads["conversation_direct:user_demo"].MessageID != id || state.Reads["conversation_direct:user_demo"].Seq < 1 {
			t.Fatal("readmark did not persist")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// An unrelated table may be exclusively locked without slowing dispatch.
	lock, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback(ctx)
	if _, err = lock.Exec(ctx, `LOCK TABLE gongming_posts IN ACCESS EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}
	narrow, done := context.WithTimeout(ctx, time.Second)
	_, err = reopened.ReadStream(narrow, []StreamRequest{{SessionHash: tokenHash(cookie.Value), UserID: "user_demo", AfterSeq: 2}}, 512)
	done()
	if err != nil {
		t.Fatalf("stream unnecessarily loaded posts: %v", err)
	}
	if err = lock.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	inaccessible, err := reopened.ReadStream(ctx, []StreamRequest{{SessionHash: tokenHash(admin.Value), UserID: "user_admin", AfterSeq: 0}}, 512)
	if err != nil {
		t.Fatal(err)
	}
	if len(inaccessible.Events) != 0 {
		t.Fatal("non-member administrator received private conversation event")
	}
	forged, err := reopened.ReadStream(ctx, []StreamRequest{{SessionHash: tokenHash(cookie.Value), UserID: "user_admin", AfterSeq: 0}}, 512)
	if err != nil {
		t.Fatal(err)
	}
	if len(forged.Sessions) != 0 || len(forged.Events) != 0 {
		t.Fatal("stream session/user mismatch was accepted")
	}
	requireCode(t, call(t, h, "POST", "/auth/logout", map[string]any{}, cookie), 200)
	revoked, err := reopened.ReadStream(ctx, []StreamRequest{{SessionHash: tokenHash(cookie.Value), UserID: "user_demo", AfterSeq: 0}}, 512)
	if err != nil {
		t.Fatal(err)
	}
	if len(revoked.Sessions) != 0 || len(revoked.Events) != 0 {
		t.Fatal("revoked session remained active in narrow stream")
	}
}
