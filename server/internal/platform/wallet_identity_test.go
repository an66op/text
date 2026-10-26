package platform

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"github.com/jackc/pgx/v5"
)

type walletTestBrowser struct {
	Cookie, Session *http.Cookie
	Generation      string
}

func walletTestRequest(t *testing.T, h http.Handler, b walletTestBrowser, method, path string, input any) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(input)
	r := httptest.NewRequest(method, "/api/v1"+path, bytes.NewReader(raw))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "http://localhost:5173")
	r.Header.Set("X-Gongming-Browser", "1")
	if b.Generation != "" {
		r.Header.Set("X-Gongming-Auth-Generation", b.Generation)
	}
	if b.Cookie != nil {
		r.AddCookie(b.Cookie)
	}
	if b.Session != nil {
		r.AddCookie(b.Session)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func walletTestData[T any](t *testing.T, w *httptest.ResponseRecorder, code int) T {
	t.Helper()
	if w.Code != code {
		t.Fatalf("status %d expected %d: %s", w.Code, code, w.Body.String())
	}
	var result struct{ Data T }
	if e := json.Unmarshal(w.Body.Bytes(), &result); e != nil {
		t.Fatal(e)
	}
	return result.Data
}
func walletTestContext(t *testing.T, h http.Handler) walletTestBrowser {
	t.Helper()
	w := walletTestRequest(t, h, walletTestBrowser{}, "GET", "/auth/context", nil)
	d := walletTestData[struct{ Generation string }](t, w, 200)
	b := walletTestBrowser{Generation: d.Generation}
	for _, c := range w.Result().Cookies() {
		if c.Name == browserCookieName {
			b.Cookie = c
		}
	}
	if b.Cookie == nil || strings.Contains(w.Body.String(), b.Cookie.Value) {
		t.Fatal("context cookie/JSON secrecy")
	}
	return b
}
func walletTestLogin(t *testing.T, h http.Handler, b walletTestBrowser, email, password string) walletTestBrowser {
	t.Helper()
	w := walletTestRequest(t, h, b, "POST", "/auth/login", map[string]string{"email": email, "password": password})
	d := walletTestData[struct{ AuthGeneration string }](t, w, 200)
	b.Generation = d.AuthGeneration
	for _, c := range w.Result().Cookies() {
		if c.Name == cookieName {
			b.Session = c
		}
	}
	if b.Session == nil {
		t.Fatal("missing session")
	}
	return b
}
func walletTestKey(t *testing.T) (*secp256k1.PrivateKey, string) {
	t.Helper()
	key, e := secp256k1.GeneratePrivateKey()
	if e != nil {
		t.Fatal(e)
	}
	return key, walletChecksum(keccak(key.PubKey().SerializeUncompressed()[1:])[12:])
}
func walletTestSign(key *secp256k1.PrivateKey, message string) string {
	sig := ecdsa.SignCompact(key, walletMessageHash(message), false)
	return "0x" + hex.EncodeToString(append(append([]byte{}, sig[1:]...), sig[0]))
}
func walletTestChallenge(t *testing.T, h http.Handler, b walletTestBrowser, address, purpose string, passwords ...string) WalletChallenge {
	t.Helper()
	body := map[string]string{"purpose": purpose, "address": address, "chainId": "1"}
	if purpose == "bind" {
		body["password"] = "Demo2026!"
		if len(passwords) > 0 {
			body["password"] = passwords[0]
		}
	}
	return walletTestData[WalletChallenge](t, walletTestRequest(t, h, b, "POST", "/auth/wallet/challenge", body), 200)
}
func walletTestVerify(t *testing.T, h http.Handler, b walletTestBrowser, c WalletChallenge, key *secp256k1.PrivateKey) *httptest.ResponseRecorder {
	return walletTestRequest(t, h, b, "POST", "/auth/wallet/verify", map[string]string{"id": c.ID, "message": c.Message, "signature": walletTestSign(key, c.Message)})
}
func walletTestBind(t *testing.T, h http.Handler, b walletTestBrowser, key *secp256k1.PrivateKey, address string) WalletBinding {
	t.Helper()
	c := walletTestChallenge(t, h, b, address, "bind")
	return walletTestData[struct{ Binding WalletBinding }](t, walletTestVerify(t, h, b, c, key), 200).Binding
}
func walletTestFixture(t *testing.T) (context.Context, *PostgresStore, *App, http.Handler) {
	t.Helper()
	ctx, s, _ := isolatedPostgres(t)
	a := seedPostgres(t, ctx, s)
	t.Cleanup(a.CloseStreams)
	return ctx, s, a, a.Handler()
}

func TestWalletIdentityCryptoCanonicalAndMalformed(t *testing.T) {
	for _, v := range []string{"0x52908400098527886E0F7030069857D2E4169EE7", "0x8617E340B3D01FA5F11F306F4090FD50E238070D", "0xde709f2102306220921060314715629080e2fb77", "0x27b1fdb04752bbc536007a920d24acb045561c26", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359", "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB", "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb"} {
		raw, e := parseWalletAddress(v)
		if e != nil || walletChecksum(raw) != v {
			t.Fatal("EIP55 vector failed", v, e)
		}
	}
	key, address := walletTestKey(t)
	raw, _ := parseWalletAddress(address)
	msg := "Ethereum signed message 字节长度"
	signature := walletTestSign(key, msg)
	valid, e := verifyWalletSignature(msg, signature, raw)
	if e != nil || !valid {
		t.Fatal(e)
	}
	sig, _ := hex.DecodeString(signature[2:])
	sig[64] -= 27
	valid, e = verifyWalletSignature(msg, "0x"+hex.EncodeToString(sig), raw)
	if e != nil || !valid {
		t.Fatal("0/1 recovery")
	}
	if valid, _ = verifyWalletSignature(msg+"tamper", signature, raw); valid {
		t.Fatal("tampered message")
	}
	var high secp256k1.ModNScalar
	high.SetByteSlice(sig[32:64])
	high.Negate()
	highBytes := high.Bytes()
	copy(sig[32:64], highBytes[:])
	sig[64] ^= 1
	if _, e = verifyWalletSignature(msg, "0x"+hex.EncodeToString(sig), raw); e == nil {
		t.Fatal("high-s accepted")
	}
	for _, value := range []string{"0x", "0x" + strings.Repeat("00", 65), strings.TrimSuffix(signature, "00")} {
		if value == signature {
			continue
		}
		if _, e = verifyWalletSignature(msg, value, raw); e == nil {
			t.Fatal("invalid signature accepted")
		}
	}
	if _, e = parseWalletAddress("0x0000000000000000000000000000000000000000"); e == nil {
		t.Fatal("zero address")
	}
	for _, origin := range []string{"http://éxample.test", "http://localhost:5173?x=1", "http://localhost:5173#x", "http://u@localhost:5173", "http://localhost:5173/"} {
		c := Config{Environment: "development", Origins: []string{origin}, WalletOrigins: []string{origin}}
		if c.Validate() == nil {
			t.Fatal("invalid origin accepted", origin)
		}
	}
}
func TestWalletIdentityPostgresRoundTripSourceAndUnbind(t *testing.T) {
	ctx, s, _, h := walletTestFixture(t)
	b := walletTestLogin(t, h, walletTestContext(t, h), "demo@gongming.local", "Demo2026!")
	key, address := walletTestKey(t)
	binding := walletTestBind(t, h, b, key, address)
	d := walletTestData[struct{ Items []WalletBinding }](t, walletTestRequest(t, h, b, "GET", "/me/wallet-bindings", nil), 200)
	if len(d.Items) != 1 || d.Items[0].ID != binding.ID {
		t.Fatal(d)
	}
	passwordBrowser := walletTestLogin(t, h, walletTestContext(t, h), "demo@gongming.local", "Demo2026!")
	w := walletTestRequest(t, h, b, "POST", "/auth/logout", map[string]any{})
	walletTestData[any](t, w, 200)
	ctxReply := walletTestRequest(t, h, b, "GET", "/auth/context", nil)
	b.Generation = walletTestData[struct{ Generation string }](t, ctxReply, 200).Generation
	b.Session = nil
	c := walletTestChallenge(t, h, b, address, "login")
	w = walletTestVerify(t, h, b, c, key)
	login := walletTestData[struct {
		User           User
		AuthGeneration string
	}](t, w, 200)
	if login.User.ID != "user_demo" {
		t.Fatal("wrong account")
	}
	b.Generation = login.AuthGeneration
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == cookieName {
			b.Session = cookie
		}
	}
	sessions := walletTestData[struct{ Items []DeviceSession }](t, walletTestRequest(t, h, b, "GET", "/me/sessions", nil), 200)
	seen := false
	for _, v := range sessions.Items {
		if v.Current {
			seen = true
			if v.AuthMethod != "wallet" {
				t.Fatal("source lost")
			}
		}
	}
	if !seen {
		t.Fatal("no current")
	}
	// Replaying a consumed proof cannot produce another session, including after context refresh.
	walletTestData[any](t, walletTestVerify(t, h, b, c, key), 409)
	w = walletTestRequest(t, h, b, "DELETE", "/me/wallet-bindings/"+binding.ID, map[string]string{"password": "Demo2026!"})
	receipt := walletTestData[struct {
		RevokedSessions       int
		CurrentSessionRevoked bool
	}](t, w, 200)
	if receipt.RevokedSessions != 1 || !receipt.CurrentSessionRevoked || len(w.Result().Cookies()) != 0 {
		t.Fatal("unlink receipt/cookie")
	}
	walletTestData[any](t, walletTestRequest(t, h, b, "GET", "/auth/me", nil), 401)
	walletTestData[any](t, walletTestRequest(t, h, passwordBrowser, "GET", "/auth/me", nil), 200)
	var count int
	if e := s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_wallet_session_proofs`).Scan(&count); e != nil || count != 0 {
		t.Fatal("proof cascade", e)
	}
	var raw string
	if e := s.Read(ctx, func(state *State) error { data, _ := json.Marshal(state); raw = string(data); return nil }); e != nil {
		t.Fatal(e)
	}
	if strings.Contains(raw, c.Message) || strings.Contains(raw, b.Cookie.Value) || strings.Contains(raw, address) {
		t.Fatal("history/secret entered State")
	}
}
func TestWalletIdentityPostgresFailedProofQuotaAndExpiry(t *testing.T) {
	ctx, s, a, h := walletTestFixture(t)
	b := walletTestLogin(t, h, walletTestContext(t, h), "demo@gongming.local", "Demo2026!")
	key, address := walletTestKey(t)
	other, _ := walletTestKey(t)
	c := walletTestChallenge(t, h, b, address, "bind")
	for i := 0; i < 5; i++ {
		walletTestData[any](t, walletTestVerify(t, h, b, c, other), 403)
	}
	walletTestData[any](t, walletTestVerify(t, h, b, c, key), 409)
	var attempts int
	if e := s.pool.QueryRow(ctx, `SELECT attempts FROM gongming_siwe_challenges WHERE id=$1`, c.ID).Scan(&attempts); e != nil || attempts != 5 {
		t.Fatal(attempts, e)
	}
	c = walletTestChallenge(t, h, b, address, "bind")
	a.now = func() time.Time { return c.ExpiresAt }
	walletTestData[any](t, walletTestVerify(t, h, b, c, key), 409)
	a.now = time.Now
	walletTestData[any](t, walletTestRequest(t, h, b, "POST", "/auth/wallet/challenge", map[string]string{"purpose": "bind", "address": address, "chainId": "01", "password": "Demo2026!"}), 400)
	walletTestData[any](t, walletTestRequest(t, h, b, "POST", "/auth/wallet/challenge", map[string]string{"purpose": "bind", "address": address, "chainId": "1", "password": "wrong"}), 403)
	c = walletTestChallenge(t, h, b, address, "bind")
	w := walletTestRequest(t, h, b, "POST", "/auth/wallet/verify", map[string]string{"id": c.ID, "message": c.Message + "\n", "signature": walletTestSign(key, c.Message)})
	walletTestData[any](t, w, 403)
	if _, e := s.pool.Exec(ctx, `UPDATE gongming_siwe_challenges SET issued_at=$2,expires_at=$3 WHERE browser_hash=$1`, tokenHash(b.Cookie.Value), time.Now(), time.Now().Add(time.Minute)); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 26; i++ {
		walletTestChallenge(t, h, b, address, "bind")
	}
	walletTestData[any](t, walletTestRequest(t, h, b, "POST", "/auth/wallet/challenge", map[string]string{"purpose": "bind", "address": address, "chainId": "1", "password": "Demo2026!"}), 429)
}
func TestWalletIdentityPostgresBrowserCASAndAllAuthSurfaces(t *testing.T) {
	ctx, s, a, h := walletTestFixture(t)
	legacy := memberCookie(t, h)
	walletTestData[any](t, walletTestRequest(t, h, walletTestBrowser{Session: legacy}, "GET", "/auth/me", nil), 401)
	c1, c2 := walletTestContext(t, h), walletTestContext(t, h)
	if c1.Generation == c2.Generation {
		t.Fatal("initial generation collision")
	}
	first := walletTestLogin(t, h, c1, "demo@gongming.local", "Demo2026!")
	second := walletTestLogin(t, h, c2, "admin@gongming.local", "Admin2026!")
	mixed := second
	mixed.Session = first.Session
	for _, path := range []string{"/auth/me", "/me/sessions", "/wallet", "/documents", "/conversations", "/notifications", "/circles/circle_fake/events", "/media/images/media_00000000000000000000000000000000", "/stream"} {
		walletTestData[any](t, walletTestRequest(t, h, mixed, "GET", path, nil), 401)
	}
	stripped := first
	stripped.Cookie = nil
	stripped.Generation = ""
	walletTestData[any](t, walletTestRequest(t, h, stripped, "GET", "/auth/me", nil), 401)
	wrongGen := first
	wrongGen.Generation = c1.Generation
	w := walletTestRequest(t, h, wrongGen, "POST", "/auth/login", map[string]string{"email": "demo@gongming.local", "password": "Demo2026!"})
	walletTestData[any](t, w, 409)
	if len(w.Result().Cookies()) != 0 {
		t.Fatal("conflict set cookie")
	}
	repeated := walletTestRequest(t, h, first, "GET", "/auth/context", nil)
	if len(repeated.Result().Cookies()) != 0 {
		t.Fatal("read context reset cookie")
	}
	// Mixed-context logout cannot revoke another context's token.
	mixed.Generation = second.Generation
	walletTestData[any](t, walletTestRequest(t, h, mixed, "POST", "/auth/logout", map[string]any{}), 200)
	walletTestData[any](t, walletTestRequest(t, h, first, "GET", "/auth/me", nil), 200)
	req := StreamRequest{SessionHash: tokenHash(first.Session.Value), BrowserHash: tokenHash(second.Cookie.Value), UserID: "user_demo"}
	valid, _, e := s.AuthorizeStream(ctx, req, "")
	if e != nil || valid {
		t.Fatal("stream mismatch", e)
	}
	snapshot, e := s.ReadStream(ctx, []StreamRequest{req}, 512)
	if e != nil || snapshot.Sessions[req.SessionHash].Active {
		t.Fatal("stream poll mismatch", e)
	}
	// Same browser two simultaneous password sign-ins produce only one CAS winner.
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := walletTestRequest(t, a.Handler(), first, "POST", "/auth/login", map[string]string{"email": "demo@gongming.local", "password": "Demo2026!"})
			codes <- w.Code
		}()
	}
	wg.Wait()
	close(codes)
	wins, conflicts := 0, 0
	for code := range codes {
		if code == 200 {
			wins++
		} else if code == 409 {
			conflicts++
		} else {
			t.Fatal(code)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatal(wins, conflicts)
	}
}
func TestWalletIdentityPostgresAtomicConsumptionAndOwnership(t *testing.T) {
	ctx, s, _, h := walletTestFixture(t)
	b := walletTestLogin(t, h, walletTestContext(t, h), "demo@gongming.local", "Demo2026!")
	key, address := walletTestKey(t)
	c := walletTestChallenge(t, h, b, address, "bind")
	otherBrowser := walletTestLogin(t, h, walletTestContext(t, h), "demo@gongming.local", "Demo2026!")
	walletTestData[any](t, walletTestVerify(t, h, otherBrowser, c, key), 409)
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); codes <- walletTestVerify(t, h, b, c, key).Code }()
	}
	wg.Wait()
	close(codes)
	wins := 0
	for code := range codes {
		if code == 200 {
			wins++
		} else if code != 409 {
			t.Fatal(code)
		}
	}
	if wins != 1 {
		t.Fatal("nonce winners", wins)
	}
	// A previously issued unbound login must not start matching a future binding.
	unknownKey, unknownAddress := walletTestKey(t)
	guest := walletTestContext(t, h)
	early := walletTestChallenge(t, h, guest, unknownAddress, "login")
	walletTestBind(t, h, b, unknownKey, unknownAddress)
	walletTestData[any](t, walletTestVerify(t, h, guest, early, unknownKey), 403)
	// Account status round-trip increments the credential epoch, invalidating pre-suspension proofs.
	laterKey, laterAddress := walletTestKey(t)
	later := walletTestChallenge(t, h, b, laterAddress, "bind")
	if _, e := s.pool.Exec(ctx, `UPDATE gongming_users SET status='suspended' WHERE id='user_demo';UPDATE gongming_users SET status='active' WHERE id='user_demo'`); e != nil {
		t.Fatal(e)
	}
	walletTestData[any](t, walletTestVerify(t, h, b, later, laterKey), 409)
	// Session revocation blocks a signed bind even while its nonce is unconsumed.
	later = walletTestChallenge(t, h, b, laterAddress, "bind")
	if _, e := s.pool.Exec(ctx, `DELETE FROM gongming_sessions WHERE token_hash=$1`, tokenHash(b.Session.Value)); e != nil {
		t.Fatal(e)
	}
	walletTestData[any](t, walletTestVerify(t, h, b, later, laterKey), 401)
}
func TestWalletIdentityPostgresMigrationAndRollback(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	// Install the exact pre-v9 schema without altering a running application's schema.
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	_, e = tx.Exec(ctx, `CREATE TABLE gongming_schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());`+normalizedSchema+normalizedGuards)
	if e != nil {
		t.Fatal(e)
	}
	for _, migrate := range []func(context.Context, pgx.Tx) error{migrateFriendships, migrateDeviceSessions, migrateMedia, migrateCircles, migrateNotifications, migrateCircleEvents} {
		if e = migrate(ctx, tx); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = tx.Exec(ctx, `INSERT INTO gongming_schema_migrations(version) VALUES(2)`); e != nil {
		t.Fatal(e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	if _, e = s.pool.Exec(ctx, `INSERT INTO gongming_users(id,handle,name,email,avatar,bio,role,status,password_hash,created_at) VALUES('old_user','olduser','Old','old@example.test','','','member','active','oldhash',now());INSERT INTO gongming_sessions(token_hash,user_id,expires_at) VALUES(repeat('a',64),'old_user',now()+interval '1 day')`); e != nil {
		t.Fatal(e)
	}
	tx, e = s.pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if e = migrateWalletIdentity(ctx, tx); e != nil {
		t.Fatal(e)
	}
	if e = tx.Rollback(ctx); e != nil {
		t.Fatal(e)
	}
	var exists bool
	if e = s.pool.QueryRow(ctx, `SELECT to_regclass('gongming_wallet_bindings') IS NOT NULL`).Scan(&exists); e != nil || exists {
		t.Fatal("migration rollback", e)
	}
	if e = s.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	if e = s.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	var method string
	if e = s.pool.QueryRow(ctx, `SELECT auth_method FROM gongming_sessions WHERE token_hash=repeat('a',64)`).Scan(&method); e != nil || method != "unknown" {
		t.Fatal("historical source invented", e)
	}
	var count int
	if e = s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_wallet_bindings`).Scan(&count); e != nil || count != 0 {
		t.Fatal("auto binding", e)
	}
}

func TestWalletIdentityPostgresShortContextAndFailedCommit(t *testing.T) {
	ctx, s, a, h := walletTestFixture(t)
	b := walletTestLogin(t, h, walletTestContext(t, h), "demo@gongming.local", "Demo2026!")
	key, address := walletTestKey(t)
	cutoff := a.now().UTC().Truncate(time.Second).Add(90*time.Second + 123*time.Millisecond)
	if _, e := s.pool.Exec(ctx, `UPDATE gongming_auth_browser_contexts SET expires_at=$2 WHERE hash=$1`, tokenHash(b.Cookie.Value), cutoff); e != nil {
		t.Fatal(e)
	}
	c := walletTestChallenge(t, h, b, address, "bind")
	if c.ExpiresAt.Nanosecond() != 0 || c.ExpiresAt.After(cutoff) || !strings.Contains(c.Message, "Expiration Time: "+c.ExpiresAt.Format(time.RFC3339)) {
		t.Fatal("inconsistent expiry")
	}
	if _, e := s.pool.Exec(ctx, `CREATE FUNCTION fail_wallet_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected commit failure';END $$;CREATE CONSTRAINT TRIGGER fail_wallet_commit AFTER INSERT ON gongming_wallet_bindings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_wallet_commit()`); e != nil {
		t.Fatal(e)
	}
	w := walletTestVerify(t, h, b, c, key)
	walletTestData[any](t, w, 500)
	if len(w.Result().Cookies()) != 0 {
		t.Fatal("failed commit wrote cookie")
	}
	var consumed *time.Time
	if e := s.pool.QueryRow(ctx, `SELECT consumed_at FROM gongming_siwe_challenges WHERE id=$1`, c.ID).Scan(&consumed); e != nil || consumed != nil {
		t.Fatal("failed commit consumed nonce", e)
	}
	if _, e := s.pool.Exec(ctx, `DROP TRIGGER fail_wallet_commit ON gongming_wallet_bindings`); e != nil {
		t.Fatal(e)
	}
	walletTestData[any](t, walletTestVerify(t, h, b, c, key), 200)
	// Password State CAS must likewise keep its context and cookies unchanged on commit error.
	before := b.Generation
	if _, e := s.pool.Exec(ctx, `CREATE CONSTRAINT TRIGGER fail_session_commit AFTER INSERT ON gongming_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_wallet_commit()`); e != nil {
		t.Fatal(e)
	}
	w = walletTestRequest(t, h, b, "POST", "/auth/login", map[string]string{"email": "demo@gongming.local", "password": "Demo2026!"})
	walletTestData[any](t, w, 500)
	if len(w.Result().Cookies()) != 0 {
		t.Fatal("State failed commit set cookie")
	}
	got := walletTestData[struct{ Generation string }](t, walletTestRequest(t, h, b, "GET", "/auth/context", nil), 200)
	if got.Generation != before {
		t.Fatal("failed commit advanced generation")
	}
}
func TestWalletIdentityPostgresStateProvenanceAndRebindEpoch(t *testing.T) {
	ctx, s, _, h := walletTestFixture(t)
	password := walletTestLogin(t, h, walletTestContext(t, h), "demo@gongming.local", "Demo2026!")
	key, address := walletTestKey(t)
	binding := walletTestBind(t, h, password, key, address)
	walletBrowser := walletTestContext(t, h)
	c := walletTestChallenge(t, h, walletBrowser, address, "login")
	w := walletTestVerify(t, h, walletBrowser, c, key)
	login := walletTestData[struct{ AuthGeneration string }](t, w, 200)
	walletBrowser.Generation = login.AuthGeneration
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == cookieName {
			walletBrowser.Session = cookie
		}
	}
	if e := s.Update(ctx, func(state *State) error {
		hash := tokenHash(walletBrowser.Session.Value)
		v := state.Sessions[hash]
		v.Device = "updated metadata"
		v.AuthMethod = "unknown"
		state.Sessions[hash] = v
		return nil
	}); e != nil {
		t.Fatal("State metadata update rejected", e)
	}
	var method, source, proof string
	if e := s.pool.QueryRow(ctx, `SELECT s.auth_method,s.browser_context_hash,p.binding_id FROM gongming_sessions s JOIN gongming_wallet_session_proofs p ON p.token_hash=s.token_hash WHERE s.token_hash=$1`, tokenHash(walletBrowser.Session.Value)).Scan(&method, &source, &proof); e != nil || method != "wallet" || source != tokenHash(walletBrowser.Cookie.Value) || proof != binding.ID {
		t.Fatal("State changed SQL provenance", e)
	}
	guest := walletTestContext(t, h)
	old := walletTestChallenge(t, h, guest, address, "login")
	walletTestData[any](t, walletTestRequest(t, h, password, "DELETE", "/me/wallet-bindings/"+binding.ID, map[string]string{"password": "Demo2026!"}), 200)
	next := walletTestBind(t, h, password, key, address)
	if next.ID == binding.ID {
		t.Fatal("rebind reused immutable identity")
	}
	walletTestData[any](t, walletTestVerify(t, h, guest, old, key), 409)
	walletTestData[any](t, walletTestRequest(t, h, walletBrowser, "GET", "/auth/me", nil), 401)
}
func TestWalletIdentityPostgresCrossInstanceUniqueBindingAndSessionLocks(t *testing.T) {
	ctx, s, a, h := walletTestFixture(t)
	one := walletTestLogin(t, h, walletTestContext(t, h), "demo@gongming.local", "Demo2026!")
	two := walletTestContext(t, h)
	w := walletTestRequest(t, h, two, "POST", "/auth/register", map[string]string{"email": "walletpeer@example.test", "password": "WalletPeer2026!", "name": "Wallet peer", "handle": "walletpeer"})
	registration := walletTestData[struct{ AuthGeneration string }](t, w, 201)
	two.Generation = registration.AuthGeneration
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == cookieName {
			two.Session = cookie
		}
	}
	key, address := walletTestKey(t)
	c1, c2 := walletTestChallenge(t, h, one, address, "bind"), walletTestChallenge(t, h, two, address, "bind", "WalletPeer2026!")
	instance := NewApp(s, a.cfg)
	defer instance.CloseStreams()
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i, c := range []WalletChallenge{c1, c2} {
		wg.Add(1)
		go func(i int, c WalletChallenge) {
			defer wg.Done()
			b := one
			if i == 1 {
				b = two
			}
			codes <- walletTestVerify(t, instance.Handler(), b, c, key).Code
		}(i, c)
	}
	wg.Wait()
	close(codes)
	winners := 0
	for code := range codes {
		if code == 200 {
			winners++
		} else if code != 409 {
			t.Fatal(code)
		}
	}
	if winners != 1 {
		t.Fatal("duplicate global binding", winners)
	}
	// A direct SQL revocation holding the token row must finish before a bind can
	// validate it, even if the signature and browser generation remain valid.
	revokeKey, revokeAddress := walletTestKey(t)
	challenge := walletTestChallenge(t, h, one, revokeAddress, "bind")
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = tx.Exec(ctx, `DELETE FROM gongming_sessions WHERE token_hash=$1`, tokenHash(one.Session.Value)); e != nil {
		t.Fatal(e)
	}
	done := make(chan int, 1)
	go func() { done <- walletTestVerify(t, h, one, challenge, revokeKey).Code }()
	select {
	case code := <-done:
		t.Fatal("verify bypassed locked revoked session", code)
	case <-time.After(40 * time.Millisecond):
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	if code := <-done; code != 401 {
		t.Fatal("revoked source accepted", code)
	}
}
func TestWalletIdentityPostgresWebSocketContextAndRevocation(t *testing.T) {
	_, _, _, h := walletTestFixture(t)
	b := walletTestLogin(t, h, walletTestContext(t, h), "demo@gongming.local", "Demo2026!")
	server := httptest.NewServer(h)
	defer server.Close()
	headers := http.Header{"Origin": []string{"http://localhost:5173"}, "Cookie": []string{b.Cookie.String() + "; " + b.Session.String()}}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	connection, _, e := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/api/v1/stream?account=user_demo", &websocket.DialOptions{HTTPHeader: headers})
	if e != nil {
		t.Fatal(e)
	}
	defer connection.CloseNow()
	var ready StreamEvent
	if e = wsjson.Read(ctx, connection, &ready); e != nil || ready.Type != "ready" {
		t.Fatal("stream ready", e)
	}
	_ = walletTestLogin(t, h, b, "demo@gongming.local", "Demo2026!")
	var event StreamEvent
	if e = wsjson.Read(ctx, connection, &event); e == nil || websocket.CloseStatus(e) != websocket.StatusPolicyViolation {
		t.Fatal("superseded browser stream remains active", e)
	}
}
func TestWalletIdentityMemoryBrowserRequestsFailClosed(t *testing.T) {
	_, _, h := fixture(t)
	b := walletTestBrowser{Cookie: &http.Cookie{Name: browserCookieName, Value: strings.Repeat("a", 64)}, Generation: strings.Repeat("b", 64)}
	for _, path := range []string{"/auth/login", "/auth/register", "/auth/logout"} {
		walletTestData[any](t, walletTestRequest(t, h, b, "POST", path, map[string]any{}), 503)
	}
	b.Session = memberCookie(t, h)
	walletTestData[any](t, walletTestRequest(t, h, b, "GET", "/auth/me", nil), 503)
}

func TestWalletIdentityPostgresDatabaseIssuanceAndBindingLimits(t *testing.T) {
	ctx, s, a, h := walletTestFixture(t)
	b := walletTestLogin(t, h, walletTestContext(t, h), "demo@gongming.local", "Demo2026!")
	for i := 0; i < 5; i++ {
		key, address := walletTestKey(t)
		walletTestBind(t, h, b, key, address)
	}
	_, extra := walletTestKey(t)
	walletTestData[any](t, walletTestRequest(t, h, b, "POST", "/auth/wallet/challenge", map[string]string{"purpose": "bind", "address": extra, "chainId": "1", "password": "Demo2026!"}), 409)
	guest := walletTestContext(t, h)
	// Each fresh App has an empty process limiter; the shared SQL window must
	// remain authoritative across instances, and no private key is stored.
	for i := 0; i < 30; i++ {
		instance := NewApp(s, a.cfg)
		w := walletTestRequest(t, instance.Handler(), guest, "POST", "/auth/wallet/challenge", map[string]string{"purpose": "login", "address": extra, "chainId": "1"})
		instance.CloseStreams()
		walletTestData[any](t, w, 200)
	}
	instance := NewApp(s, a.cfg)
	defer instance.CloseStreams()
	walletTestData[any](t, walletTestRequest(t, instance.Handler(), guest, "POST", "/auth/wallet/challenge", map[string]string{"purpose": "login", "address": extra, "chainId": "1"}), 429)
	var count int
	if e := s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_siwe_challenges WHERE browser_hash=$1`, tokenHash(guest.Cookie.Value)).Scan(&count); e != nil || count != 30 {
		t.Fatal("durable issuance bound", count, e)
	}
}
