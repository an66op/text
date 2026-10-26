package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Test-only transactional repository. Production startup always requires PG.
type memoryStore struct {
	mu    sync.Mutex
	state *State
}

func (m *memoryStore) Ping(context.Context) error { return nil }
func (m *memoryStore) Read(_ context.Context, fn func(*State) error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	raw, _ := json.Marshal(m.state)
	copy := NewState()
	_ = json.Unmarshal(raw, copy)
	return fn(copy)
}
func (m *memoryStore) Update(_ context.Context, fn func(*State) error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	raw, _ := json.Marshal(m.state)
	copy := NewState()
	_ = json.Unmarshal(raw, copy)
	if err := fn(copy); err != nil {
		return err
	}
	m.state = copy
	return nil
}

type response struct {
	Code    int
	Data    json.RawMessage
	Error   *APIError
	Cookies []*http.Cookie
}

func request(t *testing.T, h http.Handler, method, path string, body any, cookie *http.Cookie, origin string) response {
	t.Helper()
	var raw []byte
	if body != nil {
		var err error
		raw, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	r := httptest.NewRequest(method, "http://localhost:8080/api/v1"+path, bytes.NewReader(raw))
	r.RemoteAddr = "127.0.0.1:45678"
	r.Header.Set("Content-Type", "application/json")
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var envelope struct {
		Data  json.RawMessage `json:"data"`
		Error *APIError       `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("invalid JSON %d %s", w.Code, w.Body.String())
	}
	return response{w.Code, envelope.Data, envelope.Error, w.Result().Cookies()}
}
func call(t *testing.T, h http.Handler, method, path string, body any, cookie *http.Cookie) response {
	return request(t, h, method, path, body, cookie, "http://localhost:5173")
}
func requireCode(t *testing.T, res response, code int) {
	t.Helper()
	if res.Code != code {
		t.Fatalf("status %d expected %d: %s %v", res.Code, code, res.Data, res.Error)
	}
}
func payload[T any](t *testing.T, res response) T {
	t.Helper()
	var value T
	if err := json.Unmarshal(res.Data, &value); err != nil {
		t.Fatal(err)
	}
	return value
}
func fixture(t *testing.T) (*App, *memoryStore, http.Handler) {
	t.Helper()
	store := &memoryStore{state: NewState()}
	a := NewApp(store, Config{Environment: "test", Origins: []string{"http://localhost:5173"}, BcryptCost: bcrypt.MinCost})
	a.cfg.Environment = "development"
	if err := a.SeedDevelopment(context.Background()); err != nil {
		t.Fatal(err)
	}
	return a, store, a.Handler()
}
func loginAs(t *testing.T, h http.Handler, email, password string) *http.Cookie {
	t.Helper()
	res := call(t, h, "POST", "/auth/login", map[string]string{"email": email, "password": password}, nil)
	requireCode(t, res, 200)
	if len(res.Cookies) != 1 {
		t.Fatal("expected session cookie")
	}
	return res.Cookies[0]
}
func memberCookie(t *testing.T, h http.Handler) *http.Cookie {
	return loginAs(t, h, "demo@gongming.local", "Demo2026!")
}
func adminCookie(t *testing.T, h http.Handler) *http.Cookie {
	return loginAs(t, h, "admin@gongming.local", "Admin2026!")
}
func TestAuthenticationAndHashedSessions(t *testing.T) {
	a, store, h := fixture(t)
	res := call(t, h, "POST", "/auth/register", map[string]string{"email": "alice@example.org", "password": "A-valid-password!", "name": "Alice", "handle": "alice"}, nil)
	requireCode(t, res, 201)
	cookie := res.Cookies[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/api/v1" {
		t.Fatal("unsafe session cookie")
	}
	requireCode(t, call(t, h, "GET", "/auth/me", nil, cookie), 200)
	raw, _ := json.Marshal(store.state)
	if bytes.Contains(raw, []byte(cookie.Value)) || bytes.Contains(raw, []byte("A-valid-password!")) {
		t.Fatal("secret persisted in plaintext")
	}
	if _, exists := store.state.Sessions[tokenHash(cookie.Value)]; !exists {
		t.Fatal("session must be SHA256 addressed")
	}
	requireCode(t, call(t, h, "POST", "/auth/register", map[string]any{"email": "x@example.org", "password": "Valid-pass1234", "name": "X", "handle": "xyz", "role": "admin"}, nil), 400)
	requireCode(t, call(t, h, "POST", "/auth/login", map[string]string{"email": "alice@example.org", "password": "wrong"}, nil), 401)
	a.now = func() time.Time { return time.Now().Add(8 * 24 * time.Hour) }
	requireCode(t, call(t, h, "GET", "/auth/me", nil, cookie), 401)
}
func TestLogoutRevokesSession(t *testing.T) {
	_, _, h := fixture(t)
	cookie := memberCookie(t, h)
	requireCode(t, call(t, h, "POST", "/auth/logout", map[string]any{}, cookie), 200)
	requireCode(t, call(t, h, "GET", "/auth/me", nil, cookie), 401)
}
func TestOriginBodyAndRateLimits(t *testing.T) {
	_, _, h := fixture(t)
	requireCode(t, request(t, h, "POST", "/auth/login", map[string]string{}, nil, "https://evil.example"), 403)
	requireCode(t, request(t, h, "POST", "/auth/login", map[string]string{}, nil, ""), 403)
	for i := 0; i < 15; i++ {
		requireCode(t, call(t, h, "POST", "/auth/login", map[string]string{"email": "nobody@example.org", "password": "wrong"}, nil), 401)
	}
	requireCode(t, call(t, h, "POST", "/auth/login", map[string]string{"email": "nobody@example.org", "password": "wrong"}, nil), 429)
	r := httptest.NewRequest("POST", "/api/v1/auth/register", strings.NewReader(`{"email":"`+strings.Repeat("x", 1024*1024)+`"}`))
	r.Header.Set("Origin", "http://localhost:5173")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 413 {
		t.Fatalf("body limit = %d", w.Code)
	}
}
func TestCommunityLifecycleAndModeration(t *testing.T) {
	_, _, h := fixture(t)
	cookie := memberCookie(t, h)
	admin := adminCookie(t, h)
	res := call(t, h, "POST", "/posts", map[string]any{"body": "一起做一个好产品", "topic": "测试", "images": []string{}}, cookie)
	requireCode(t, res, 200)
	post := payload[Post](t, res)
	requireCode(t, call(t, h, "POST", "/posts", map[string]string{"body": ""}, cookie), 400)
	for i := 0; i < 2; i++ {
		res = call(t, h, "POST", "/posts/"+post.ID+"/like", map[string]bool{"liked": true}, cookie)
		requireCode(t, res, 200)
		if got := payload[Post](t, res); got.LikeCount != 1 || !got.Liked {
			t.Fatal("like must be target-state idempotent")
		}
	}
	res = call(t, h, "POST", "/posts/"+post.ID+"/comments", map[string]string{"body": "支持"}, cookie)
	requireCode(t, res, 200)
	requireCode(t, call(t, h, "POST", "/reports", map[string]string{"targetType": "post", "targetId": post.ID, "reason": "测试举报"}, cookie), 200)
	requireCode(t, call(t, h, "PATCH", "/admin/posts/"+post.ID, map[string]string{"status": "hidden"}, cookie), 403)
	requireCode(t, call(t, h, "PATCH", "/admin/posts/"+post.ID, map[string]string{"status": "hidden"}, admin), 200)
	requireCode(t, call(t, h, "GET", "/posts/"+post.ID, nil, nil), 404)
	requireCode(t, call(t, h, "POST", "/posts/"+post.ID+"/comments", map[string]string{"body": "不能互动隐藏动态"}, cookie), 403)
	res = call(t, h, "GET", "/posts?topic=测试", nil, nil)
	requireCode(t, res, 200)
	if page := payload[struct {
		Items []Post
		Total int
	}](t, res); page.Total != 0 {
		t.Fatal("hidden post leaked in public feed")
	}
	requireCode(t, call(t, h, "DELETE", "/posts/"+post.ID, nil, cookie), 200)
	requireCode(t, call(t, h, "GET", "/posts/"+post.ID, nil, admin), 404)
}
func TestConversationMembershipAndChannelPublishing(t *testing.T) {
	_, _, h := fixture(t)
	cookie := memberCookie(t, h)
	admin := adminCookie(t, h)
	requireCode(t, call(t, h, "POST", "/conversations/conversation_channel/messages", map[string]string{"body": "普通订阅者不能发公告"}, cookie), 403)
	requireCode(t, call(t, h, "POST", "/conversations/conversation_channel/messages", map[string]string{"body": "频道主公告"}, admin), 200)
	res := call(t, h, "POST", "/conversations", map[string]any{"title": "私密频道", "kind": "channel", "memberIds": []string{}}, cookie)
	requireCode(t, res, 200)
	channel := payload[Conversation](t, res)
	requireCode(t, call(t, h, "GET", "/conversations/"+channel.ID+"/messages", nil, admin), 404)
	for i := 0; i < 4; i++ {
		requireCode(t, call(t, h, "POST", "/conversations/"+channel.ID+"/messages", map[string]string{"body": fmt.Sprintf("msg%d", i)}, cookie), 200)
	}
	res = call(t, h, "GET", "/conversations/"+channel.ID+"/messages?limit=2", nil, cookie)
	page := payload[struct {
		Items []Message
		Total int
	}](t, res)
	if page.Total != 4 || len(page.Items) != 2 || page.Items[0].Body != "msg2" || page.Items[1].Body != "msg3" {
		t.Fatalf("last page ascending: %+v", page)
	}
	requireCode(t, call(t, h, "POST", "/conversations", map[string]any{"title": "坏私聊", "kind": "direct", "memberIds": []string{}}, cookie), 400)
	res = call(t, h, "GET", "/directory", nil, cookie)
	if bytes.Contains(res.Data, []byte("email")) || bytes.Contains(res.Data, []byte("role")) {
		t.Fatal("directory leaked sensitive fields")
	}
}
func TestDocumentsIsolationAndOptimisticRevision(t *testing.T) {
	_, _, h := fixture(t)
	cookie := memberCookie(t, h)
	admin := adminCookie(t, h)
	body := map[string]any{"value": map[string]string{"theme": "dark"}, "revision": 0}
	res := call(t, h, "PUT", "/documents/preferences", body, cookie)
	requireCode(t, res, 200)
	if payload[Document](t, res).Revision != 1 {
		t.Fatal("first revision")
	}
	requireCode(t, call(t, h, "PUT", "/documents/preferences", body, cookie), 409)
	res = call(t, h, "GET", "/documents", nil, admin)
	if page := payload[struct {
		Items []Document
		Total int
	}](t, res); page.Total != 0 {
		t.Fatal("account documents leaked")
	}
	requireCode(t, call(t, h, "PUT", "/documents/wallet-state", body, cookie), 400)
	requireCode(t, call(t, h, "PUT", "/documents/preferences", map[string]any{"value": "next", "revision": 1}, cookie), 200)
}
func TestAdminGuardsAuditAndFiltering(t *testing.T) {
	_, store, h := fixture(t)
	admin := adminCookie(t, h)
	cookie := memberCookie(t, h)
	requireCode(t, call(t, h, "PATCH", "/admin/users/user_admin", map[string]string{"role": "member"}, admin), 403)
	requireCode(t, call(t, h, "GET", "/admin/users?role=superadmin", nil, admin), 400)
	requireCode(t, call(t, h, "GET", "/admin/posts?status=unknown", nil, admin), 400)
	requireCode(t, call(t, h, "GET", "/posts?limit=1000", nil, nil), 400)
	requireCode(t, call(t, h, "PATCH", "/admin/users/user_demo", map[string]string{"role": "moderator"}, admin), 200)
	requireCode(t, call(t, h, "GET", "/admin/overview", nil, cookie), 200)
	requireCode(t, call(t, h, "PATCH", "/admin/users/user_friend", map[string]string{"status": "suspended"}, cookie), 403)
	before := len(store.state.Audits)
	requireCode(t, call(t, h, "PATCH", "/admin/reports/report_demo", map[string]string{"status": "resolved", "note": "审核完成"}, cookie), 200)
	if len(store.state.Audits) != before+1 || store.state.Reports["report_demo"].Status != "resolved" {
		t.Fatal("report review and audit must commit together")
	}
	requireCode(t, call(t, h, "PATCH", "/admin/users/user_demo", map[string]string{"status": "suspended"}, admin), 200)
	requireCode(t, call(t, h, "GET", "/auth/me", nil, cookie), 401)
	for _, session := range store.state.Sessions {
		if session.UserID == "user_demo" {
			t.Fatal("suspension did not revoke sessions")
		}
	}
}
func TestAtomicLedgerAndIdempotency(t *testing.T) {
	_, store, h := fixture(t)
	cookie := memberCookie(t, h)
	body := map[string]string{"requestId": "faucet-request-1"}
	first := call(t, h, "POST", "/wallet/faucet", body, cookie)
	requireCode(t, first, 200)
	second := call(t, h, "POST", "/wallet/faucet", body, cookie)
	requireCode(t, second, 200)
	if string(first.Data) != string(second.Data) {
		t.Fatal("faucet retry must return original result")
	}
	requireCode(t, call(t, h, "POST", "/wallet/faucet", map[string]string{"requestId": "faucet-request-2"}, cookie), 429)
	transfer := map[string]string{"recipientHandle": "zhouye", "amount": "25000", "requestId": "transfer-request-1"}
	requireCode(t, call(t, h, "POST", "/wallet/transfer", transfer, cookie), 200)
	requireCode(t, call(t, h, "POST", "/wallet/transfer", transfer, cookie), 200)
	if store.state.Wallets["user_demo"].Balance != 75000 || store.state.Wallets["user_friend"].Balance != 25000 {
		t.Fatal("double debit or non-atomic transfer")
	}
	transfer["amount"] = "20000"
	requireCode(t, call(t, h, "POST", "/wallet/transfer", transfer, cookie), 409)
	transfer["amount"] = "999999"
	transfer["requestId"] = "transfer-request-2"
	requireCode(t, call(t, h, "POST", "/wallet/transfer", transfer, cookie), 422)
	if store.state.Wallets["user_demo"].Balance != 75000 {
		t.Fatal("failed transfer modified balance")
	}
	for _, amount := range []string{"-1", "0", "1.1", "1e3", "999999999999999999999"} {
		transfer["amount"] = amount
		requireCode(t, call(t, h, "POST", "/wallet/transfer", transfer, cookie), 400)
	}
}
func TestConcurrentTransfersCannotOverspend(t *testing.T) {
	_, store, h := fixture(t)
	cookie := memberCookie(t, h)
	requireCode(t, call(t, h, "POST", "/wallet/faucet", map[string]string{"requestId": "faucet-concurrent"}, cookie), 200)
	var wg sync.WaitGroup
	var mu sync.Mutex
	success := 0
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			res := call(t, h, "POST", "/wallet/transfer", map[string]string{"recipientHandle": "zhouye", "amount": "20000", "requestId": fmt.Sprintf("concurrent-%d", i)}, cookie)
			if res.Code == 200 {
				mu.Lock()
				success++
				mu.Unlock()
			} else if res.Code != 422 {
				t.Errorf("unexpected transfer status: %d", res.Code)
			}
		}(i)
	}
	wg.Wait()
	if success != 5 || store.state.Wallets["user_demo"].Balance != 0 || store.state.Wallets["user_friend"].Balance != 100000 {
		t.Fatal("atomic conservation violated")
	}
}
func TestProductionRejectsDefaultSeeds(t *testing.T) {
	a, _, _ := fixture(t)
	a.cfg.Environment = "production"
	if a.CheckProductionData(context.Background()) == nil {
		t.Fatal("production accepted development credentials")
	}
	if a.SeedDevelopment(context.Background()) == nil {
		t.Fatal("seed allowed outside development")
	}
	if err := (Config{Environment: "production", Origins: []string{"http://localhost:5173"}, CookieSecure: true}).Validate(); err == nil {
		t.Fatal("production accepted HTTP origin")
	}
}

func TestPublicAuthorAndSenderProjection(t *testing.T) {
	_, _, h := fixture(t)
	cookie := memberCookie(t, h)
	for _, path := range []string{"/posts", "/posts/post_welcome", "/posts/post_welcome/comments", "/conversations", "/conversations/conversation_direct/messages"} {
		res := call(t, h, "GET", path, nil, cookie)
		requireCode(t, res, 200)
		for _, sensitive := range []string{`"email"`, `"role"`, `"passwordHash"`, `"status":"active"`} {
			if bytes.Contains(res.Data, []byte(sensitive)) {
				t.Errorf("%s leaked %s", path, sensitive)
			}
		}
	}
	for _, res := range []response{
		call(t, h, "POST", "/posts", map[string]string{"body": "公开作者投影"}, cookie),
		call(t, h, "POST", "/posts/post_welcome/comments", map[string]string{"body": "公开评论作者投影"}, cookie),
		call(t, h, "POST", "/conversations/conversation_direct/messages", map[string]string{"body": "公开消息发送者投影"}, cookie),
	} {
		requireCode(t, res, 200)
		if bytes.Contains(res.Data, []byte(`"email"`)) {
			t.Fatal("write result leaked author email")
		}
	}
	me := call(t, h, "GET", "/auth/me", nil, cookie)
	if !bytes.Contains(me.Data, []byte(`"email":"demo@gongming.local"`)) {
		t.Fatal("own auth endpoint must retain email")
	}
}

func TestAdminSearchIDsAndReportResolutionGuard(t *testing.T) {
	_, store, h := fixture(t)
	admin := adminCookie(t, h)
	for _, path := range []string{"/admin/users?q=user_friend", "/admin/posts?q=post_weekend", "/admin/posts?q=zhouye"} {
		res := call(t, h, "GET", path, nil, admin)
		requireCode(t, res, 200)
		page := payload[struct{ Total int }](t, res)
		if page.Total == 0 {
			t.Fatalf("%s did not match", path)
		}
	}
	before := len(store.state.Audits)
	requireCode(t, call(t, h, "PATCH", "/admin/reports/report_demo", map[string]string{"status": "resolved", "note": "  "}, admin), 400)
	if len(store.state.Audits) != before {
		t.Fatal("invalid review produced audit")
	}
	requireCode(t, call(t, h, "PATCH", "/admin/reports/report_demo", map[string]string{"status": "resolved", "note": "检查完成，已处理"}, admin), 200)
	requireCode(t, call(t, h, "PATCH", "/admin/reports/report_demo", map[string]string{"status": "dismissed", "note": "过时审核不能覆盖"}, admin), 409)
	if store.state.Reports["report_demo"].Status != "resolved" || len(store.state.Audits) != before+1 {
		t.Fatal("closed report was overwritten or audit duplicated")
	}
}
