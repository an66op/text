package platform

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// This bounded local comparison measures read amplification, not production
// capacity. It creates and drops only a fresh random schema on the test server.
//
//	TEST_DATABASE_URL=... go test ./internal/platform -run '^$' \
//	  -bench '^BenchmarkMessagingHistoryReadPaths$' -benchmem -benchtime=1s
func BenchmarkMessagingHistoryReadPaths(b *testing.B) {
	ctx, s := messagingBenchmarkPostgres(b)
	a := NewApp(s, Config{Environment: "development", Origins: []string{"http://localhost:5173"}, BcryptCost: bcrypt.MinCost})
	if err := a.SeedDevelopment(ctx); err != nil {
		b.Fatal(err)
	}
	created := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	if err := s.Update(ctx, func(state *State) error {
		for index := 0; index < 3000; index++ {
			id := fmt.Sprintf("benchmark-post-%04d", index)
			state.Posts[id] = StoredPost{ID: id, AuthorID: "user_friend", Body: strings.Repeat("无关社交帖内容。", 40), Images: []string{}, Topic: "基准", Status: "published", CreatedAt: created, Likes: map[string]bool{}}
		}
		for index := 0; index < 1000; index++ {
			id := fmt.Sprintf("benchmark-message-%04d", index)
			state.Messages[id] = StoredMessage{ID: id, ConversationID: "conversation_group", SenderID: "user_friend", Body: fmt.Sprintf("历史消息 %04d %s", index, strings.Repeat("消息正文。", 10)), CreatedAt: created.Add(time.Duration(index) * time.Second), Seq: int64(index + 2)}
		}
		return nil
	}); err != nil {
		b.Fatal(err)
	}
	// Insert only the three stable session columns. Device metadata defaults are
	// owned by the session migration, rather than this benchmark fixture.
	token := newID("benchmark_session_")
	if _, err := s.pool.Exec(ctx, `INSERT INTO gongming_sessions(token_hash,user_id,expires_at) VALUES($1,'user_demo',$2)`, tokenHash(token), time.Now().Add(time.Hour)); err != nil {
		b.Fatal(err)
	}
	cookie := &http.Cookie{Name: cookieName, Value: token}
	paths := []struct {
		name    string
		handler http.HandlerFunc
	}{
		{"StateSnapshot", a.endpoint(false, "member", a.messages)},
		{"DomainSQL", a.messagingEndpoint(messagingHistory, false, a.messages)},
	}
	invoke := func(handler http.HandlerFunc) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "http://localhost:8080/api/v1/conversations/conversation_group/messages?limit=30", nil)
		r.SetPathValue("id", "conversation_group")
		r.Header.Set("X-Gongming-Account", "user_demo")
		r.AddCookie(cookie)
		w := httptest.NewRecorder()
		handler(w, r)
		return w
	}
	baseline := invoke(paths[0].handler)
	domain := invoke(paths[1].handler)
	if baseline.Code != 200 || domain.Code != 200 || !bytes.Equal(baseline.Body.Bytes(), domain.Body.Bytes()) {
		b.Fatalf("benchmark responses differ: State=%d %s SQL=%d %s", baseline.Code, baseline.Body, domain.Code, domain.Body)
	}
	b.Logf("isolated dataset: 3000 unrelated posts, 1000 additional messages, latest 30; HTTP JSON responses byte-identical (%d bytes)", domain.Body.Len())
	for _, path := range paths {
		b.Run(path.name, func(b *testing.B) {
			b.ReportAllocs()
			b.ResetTimer()
			for index := 0; index < b.N; index++ {
				response := invoke(path.handler)
				if response.Code != 200 {
					b.Fatalf("benchmark request failed: %d %s", response.Code, response.Body)
				}
			}
		})
	}
}

func messagingBenchmarkPostgres(b *testing.B) (context.Context, *PostgresStore) {
	b.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		b.Skip("TEST_DATABASE_URL required; benchmark never defaults to the running application database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	b.Cleanup(cancel)
	admin, err := OpenPostgres(ctx, dsn)
	if err != nil {
		b.Fatal(err)
	}
	schema := pgx.Identifier{newID("gongming_messaging_benchmark_")}.Sanitize()
	if _, err = admin.pool.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		b.Fatal(err)
	}
	b.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		if _, err := admin.pool.Exec(cleanup, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			b.Errorf("benchmark cleanup: %v", err)
		}
		admin.Close()
	})
	parsed, err := url.Parse(dsn)
	if err != nil {
		b.Fatal(err)
	}
	query := parsed.Query()
	// schema is a quoted SQL identifier; the raw name is the quoted content.
	query.Set("search_path", strings.Trim(schema, `"`))
	parsed.RawQuery = query.Encode()
	s, err := OpenPostgres(ctx, parsed.String())
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(s.Close)
	if err = s.Migrate(ctx); err != nil {
		b.Fatal(err)
	}
	return ctx, s
}
