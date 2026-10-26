package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

type deviceSessionPage struct {
	Items []DeviceSession `json:"items"`
	Total int             `json:"total"`
}

func deviceRequest(t *testing.T, h http.Handler, method, path string, body any, cookie *http.Cookie, headers map[string]string) response {
	t.Helper()
	var raw []byte
	if body != nil {
		var err error
		raw, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, "http://localhost:8080/api/v1"+path, bytes.NewReader(raw))
	req.RemoteAddr = "127.0.0.1:41234"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:5173")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	recorder := httptest.NewRecorder()
	h.ServeHTTP(recorder, req)
	var result struct {
		Data  json.RawMessage `json:"data"`
		Error *APIError       `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return response{Code: recorder.Code, Data: result.Data, Error: result.Error, Cookies: recorder.Result().Cookies()}
}

func loginDevice(t *testing.T, h http.Handler, email, password, userAgent string) *http.Cookie {
	t.Helper()
	reply := deviceRequest(t, h, "POST", "/auth/login", map[string]string{"email": email, "password": password}, nil, map[string]string{"User-Agent": userAgent})
	requireCode(t, reply, 200)
	if len(reply.Cookies) != 1 {
		t.Fatal("missing session cookie")
	}
	return reply.Cookies[0]
}

func devices(t *testing.T, h http.Handler, cookie *http.Cookie) deviceSessionPage {
	t.Helper()
	reply := call(t, h, "GET", "/me/sessions", nil, cookie)
	requireCode(t, reply, 200)
	return payload[deviceSessionPage](t, reply)
}

func currentDevice(t *testing.T, page deviceSessionPage) DeviceSession {
	t.Helper()
	var selected DeviceSession
	count := 0
	for _, item := range page.Items {
		if item.Current {
			selected = item
			count++
		}
	}
	if count != 1 {
		t.Fatalf("expected one current device, got %d", count)
	}
	return selected
}

func TestDeviceDescriptionIsCoarseAndNeverStoresRawUserAgent(t *testing.T) {
	for _, test := range []struct{ ua, want string }{
		{"", "未知设备"}, {"curl/8.0 IP=198.51.100.27 secret-device-fingerprint", "未知设备"},
		{"Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/18.0 Safari/605.1.15", "macOS · Safari"},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS) CriOS/123.0 Safari/604.1", "iOS · Chrome"},
		{"Mozilla/5.0 (Windows NT 10.0) Chrome/123 Safari/537.36 Edg/123", "Windows · Edge"},
		{"Mozilla/5.0 (Linux; Android 14) Chrome/123 Mobile Safari/537", "Android · Chrome"},
		{"Mozilla/5.0 (X11; CrOS x86_64) Chrome/123 Safari/537", "ChromeOS · Chrome"},
		{"Mozilla/5.0 (X11; Linux x86_64) Firefox/120.0", "Linux · Firefox"},
	} {
		if got := sessionDevice(test.ua); got != test.want {
			t.Fatalf("coarse label %q, expected %q", got, test.want)
		}
	}
	_, store, h := fixture(t)
	cookie := loginDevice(t, h, "demo@gongming.local", "Demo2026!", "Mozilla/5.0 (Macintosh) Safari/605.1.15 private-agent-identifier-198.51.100.27")
	raw, _ := json.Marshal(store.state)
	if bytes.Contains(raw, []byte("private-agent-identifier")) || bytes.Contains(raw, []byte("198.51.100.27")) {
		t.Fatal("raw device identity was stored")
	}
	item := currentDevice(t, devices(t, h, cookie))
	if item.Legacy || item.CreatedAt == nil || item.LastSeenAt == nil || !item.CreatedAt.Equal(*item.LastSeenAt) {
		t.Fatal("new session lacks honest establishment timestamps")
	}
}

func TestDeviceSessionListIsPrivateStableAndReadOnly(t *testing.T) {
	a, store, h := fixture(t)
	fixed := time.Date(2026, 10, 27, 9, 30, 0, 123456789, time.UTC)
	a.now = func() time.Time { return fixed }
	aCookie := loginDevice(t, h, "demo@gongming.local", "Demo2026!", "Mozilla/5.0 (Macintosh) Safari/605.1.15")
	bCookie := loginDevice(t, h, "demo@gongming.local", "Demo2026!", "Mozilla/5.0 (iPhone) CriOS/120 Safari/604")
	admin := adminCookie(t, h)
	if err := store.Update(context.Background(), func(s *State) error {
		s.Sessions[tokenHash("expired-device-cookie")] = Session{UserID: "user_demo", ExpiresAt: fixed.Add(-time.Second), ID: newID("session_"), Device: unknownSessionDevice, Legacy: true}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(store.state)
	reply := call(t, h, "GET", "/me/sessions", nil, aCookie)
	requireCode(t, reply, 200)
	page := payload[deviceSessionPage](t, reply)
	if page.Total != 2 || len(page.Items) != 2 {
		t.Fatal("list included an expired or another user's session")
	}
	aDevice := currentDevice(t, page)
	if aDevice.Device != "macOS · Safari" || aDevice.CreatedAt.Nanosecond() != 123456000 {
		t.Fatal("device or microsecond precision is incorrect")
	}
	bDevice := currentDevice(t, devices(t, h, bCookie))
	if bDevice.ID == aDevice.ID || page.Items[0].ID != aDevice.ID {
		t.Fatal("device public IDs or current ordering are unstable")
	}
	if currentDevice(t, devices(t, h, admin)).ID == aDevice.ID {
		t.Fatal("session locator crossed account boundary")
	}
	for _, secret := range []string{aCookie.Value, bCookie.Value, admin.Value, tokenHash(aCookie.Value), tokenHash(bCookie.Value), `"userId"`, `"token"`, `"tokenHash"`, `"userAgent"`, `"ip"`} {
		if bytes.Contains(reply.Data, []byte(secret)) {
			t.Fatal("private session data was exposed")
		}
	}
	after, _ := json.Marshal(store.state)
	if !bytes.Equal(before, after) {
		t.Fatal("reading sessions invented activity or wrote metadata")
	}
	// Registration, not only login, establishes honest device metadata.
	registered := deviceRequest(t, h, "POST", "/auth/register", map[string]string{"email": "newdevice@example.test", "password": "NewDevicePassword123!", "name": "新设备", "handle": "newdevice"}, nil, map[string]string{"User-Agent": "Mozilla/5.0 (Windows NT) Firefox/123"})
	requireCode(t, registered, 201)
	if item := currentDevice(t, devices(t, h, registered.Cookies[0])); item.Device != "Windows · Firefox" || item.Legacy {
		t.Fatal("registration did not record device metadata")
	}
}

func TestDeviceSessionRevocationIsolationIdentityOriginAndCurrentCookie(t *testing.T) {
	_, _, h := fixture(t)
	a := loginDevice(t, h, "demo@gongming.local", "Demo2026!", "Mozilla/5.0 (Macintosh) Safari/605")
	b := loginDevice(t, h, "demo@gongming.local", "Demo2026!", "Mozilla/5.0 (Android) Chrome/123")
	admin := adminCookie(t, h)
	aID, bID, adminID := currentDevice(t, devices(t, h, a)).ID, currentDevice(t, devices(t, h, b)).ID, currentDevice(t, devices(t, h, admin)).ID
	for _, id := range []string{adminID, "missing-session", tokenHash(b.Value), b.Value} {
		requireCode(t, call(t, h, "DELETE", "/me/sessions/"+id, nil, a), 404)
	}
	wrongOrigin := deviceRequest(t, h, "DELETE", "/me/sessions/"+bID, nil, a, map[string]string{"Origin": "https://evil.example"})
	requireCode(t, wrongOrigin, 403)
	changed := deviceRequest(t, h, "DELETE", "/me/sessions/"+bID, nil, a, map[string]string{"X-Gongming-Account": "user_admin"})
	requireCode(t, changed, 409)
	if changed.Error.Code != "account_changed" || len(changed.Cookies) != 0 {
		t.Fatal("stale account guard mutated browser authentication")
	}
	if devices(t, h, a).Total != 2 {
		t.Fatal("rejected deletion changed a session")
	}
	revoked := call(t, h, "DELETE", "/me/sessions/"+bID, nil, a)
	requireCode(t, revoked, 200)
	if receipt := payload[DeviceSessionRevocation](t, revoked); !receipt.OK || receipt.Current || len(revoked.Cookies) != 0 {
		t.Fatal("revoking another device affected current cookie")
	}
	requireCode(t, call(t, h, "GET", "/auth/me", nil, b), 401)
	requireCode(t, call(t, h, "DELETE", "/me/sessions/"+bID, nil, a), 404)
	c := loginDevice(t, h, "demo@gongming.local", "Demo2026!", "")
	d := loginDevice(t, h, "demo@gongming.local", "Demo2026!", "")
	response := call(t, h, "POST", "/me/sessions/revoke-others", map[string]any{}, a)
	requireCode(t, response, 200)
	if payload[struct {
		Revoked int `json:"revoked"`
	}](t, response).Revoked != 2 {
		t.Fatal("revoke others counted wrong sessions")
	}
	requireCode(t, call(t, h, "GET", "/auth/me", nil, c), 401)
	requireCode(t, call(t, h, "GET", "/auth/me", nil, d), 401)
	requireCode(t, call(t, h, "GET", "/auth/me", nil, admin), 200)
	again := call(t, h, "POST", "/me/sessions/revoke-others", map[string]any{}, a)
	requireCode(t, again, 200)
	if payload[struct {
		Revoked int `json:"revoked"`
	}](t, again).Revoked != 0 || devices(t, h, a).Total != 1 {
		t.Fatal("idempotent revoke others lost current session")
	}
	current := call(t, h, "DELETE", "/me/sessions/"+aID, nil, a)
	requireCode(t, current, 200)
	if !payload[DeviceSessionRevocation](t, current).Current || len(current.Cookies) != 1 || current.Cookies[0].MaxAge >= 0 || !current.Cookies[0].HttpOnly || current.Cookies[0].Path != "/api/v1" {
		t.Fatal("current revoke did not clear the correct cookie after commit")
	}
	requireCode(t, call(t, h, "GET", "/auth/me", nil, a), 401)
	requireCode(t, call(t, h, "GET", "/me/sessions", nil, a), 401)
}

func TestDisabledAccountCannotManageDeviceSessions(t *testing.T) {
	_, _, h := fixture(t)
	cookie := memberCookie(t, h)
	admin := adminCookie(t, h)
	id := currentDevice(t, devices(t, h, cookie)).ID
	requireCode(t, call(t, h, "PATCH", "/admin/users/user_demo", map[string]string{"status": "suspended"}, admin), 200)
	requireCode(t, call(t, h, "GET", "/me/sessions", nil, cookie), 401)
	requireCode(t, call(t, h, "DELETE", "/me/sessions/"+id, nil, cookie), 401)
	requireCode(t, call(t, h, "POST", "/me/sessions/revoke-others", map[string]any{}, cookie), 401)
}

func TestRevokedDeviceSocketClosesWhileCurrentDeviceContinues(t *testing.T) {
	a, _, h := fixture(t)
	server := httptest.NewServer(h)
	t.Cleanup(server.Close)
	t.Cleanup(a.CloseStreams)
	current := loginDevice(t, h, "demo@gongming.local", "Demo2026!", "Mozilla/5.0 (Macintosh) Safari/605")
	other := loginDevice(t, h, "demo@gongming.local", "Demo2026!", "Mozilla/5.0 (Android) Chrome/123")
	currentConn, _ := socket(t, server.URL, current, "")
	otherConn, _ := socket(t, server.URL, other, "")
	otherID := currentDevice(t, devices(t, h, other)).ID
	requireCode(t, call(t, h, "DELETE", "/me/sessions/"+otherID, nil, current), 200)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _, err := otherConn.Read(ctx)
	if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
		t.Fatalf("revoked device retained stream: %v", err)
	}
	message := sent(t, h, current, "conversation_group", "保留设备仍可接收服务端消息", "device-current-alive")
	if event := receive(t, currentConn); event.MessageID != message.ID {
		t.Fatal("revocation interrupted the retained device")
	}
	if item := currentDevice(t, devices(t, h, current)); !item.Current {
		t.Fatal("retained current device disappeared")
	}
}

func TestLegacySessionImportMetadataDoesNotInventHistory(t *testing.T) {
	expires := time.Now().Add(time.Hour)
	state := NewState()
	state.Sessions[tokenHash("legacy")] = Session{UserID: "user_demo", ExpiresAt: expires}
	normalizeLegacySessionMetadata(state)
	first := state.Sessions[tokenHash("legacy")]
	if first.ID == "" || first.Device != unknownSessionDevice || !first.Legacy || first.CreatedAt != nil || first.LastSeenAt != nil || !first.ExpiresAt.Equal(expires) {
		t.Fatal("legacy migration changed authentication or fabricated activity")
	}
	normalizeLegacySessionMetadata(state)
	if state.Sessions[tokenHash("legacy")].ID != first.ID {
		t.Fatal("legacy public ID changed on repeated normalization")
	}
	if strings.Contains(first.ID, tokenHash("legacy")) {
		t.Fatal("public locator was derived from an authentication digest")
	}
}
