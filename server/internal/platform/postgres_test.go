package platform

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// Each integration test gets a fresh schema, never a TRUNCATE of application data.
func TestPostgresPersistenceAndConcurrentLedger(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL for real PostgreSQL transaction verification")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := newID("gongming_test_")
	identifier := pgx.Identifier{schema}.Sanitize()
	if _, err = admin.pool.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = admin.pool.Exec(cleanup, "DROP SCHEMA "+identifier+" CASCADE")
	}()
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
	defer store.Close()
	if err = store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	a := NewApp(store, Config{Environment: "development", Origins: []string{"http://localhost:5173"}, BcryptCost: bcrypt.MinCost})
	if err = a.SeedDevelopment(ctx); err != nil {
		t.Fatal(err)
	}
	h := a.Handler()
	cookie := memberCookie(t, h)
	requireCode(t, call(t, h, "POST", "/wallet/faucet", map[string]string{"requestId": "pg-faucet-0001"}, cookie), 200)
	// New app/repository instances prove sessions and balances live in PostgreSQL.
	reopened, err := OpenPostgres(ctx, parsed.String())
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	next := NewApp(reopened, a.cfg)
	h = next.Handler()
	requireCode(t, call(t, h, "GET", "/auth/me", nil, cookie), 200)
	wallet := payload[Wallet](t, call(t, h, "GET", "/wallet", nil, cookie))
	if wallet.Assets[0].Balance != "100000" {
		t.Fatal("balance not persisted")
	}
	// Separate connections race on the database lock, not a process mutex.
	var wg sync.WaitGroup
	var mu sync.Mutex
	successful := 0
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			res := call(t, h, "POST", "/wallet/transfer", map[string]string{"recipientHandle": "zhouye", "amount": "20000", "requestId": fmt.Sprintf("pg-concurrent-%02d", i)}, cookie)
			if res.Code == http.StatusOK {
				mu.Lock()
				successful++
				mu.Unlock()
			} else if res.Code != 422 {
				t.Errorf("race status=%d error=%v", res.Code, res.Error)
			}
		}(i)
	}
	wg.Wait()
	if successful != 5 {
		t.Fatalf("overspend guard: succeeded %d", successful)
	}
	if err = store.Read(ctx, func(s *State) error {
		if s.Wallets["user_demo"].Balance != 0 || s.Wallets["user_friend"].Balance != 100000 {
			t.Fatal("ledger conservation failed across connections")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// Callback failure must roll back both authoritative state and audit.
	err = store.Update(ctx, func(s *State) error { delete(s.Accounts, "user_demo"); return fmt.Errorf("forced rollback") })
	if err == nil {
		t.Fatal("expected rollback error")
	}
	requireCode(t, call(t, h, "GET", "/auth/me", nil, cookie), 200)
}
