// Command verify-wallet-auth exercises real signatures against the running local
// development API. Keys live only in memory; test bindings are removed on exit.
package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

type client struct {
	base string
	http *http.Client
}
type result struct {
	status  int
	data    map[string]any
	code    string
	cookies []*http.Cookie
}

func require(ok bool, message string) {
	if !ok {
		panic(message)
	}
}
func local(u *url.URL) bool {
	return u != nil && u.User == nil && (u.Scheme == "http" || u.Scheme == "https") && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1")
}
func newClient(base string) *client {
	jar, _ := cookiejar.New(nil)
	return &client{base, &http.Client{Jar: jar, Timeout: 15 * time.Second, CheckRedirect: func(r *http.Request, _ []*http.Request) error {
		if !local(r.URL) {
			return fmt.Errorf("refused non-local redirect")
		}
		return nil
	}}}
}
func (c *client) request(method, path string, body any, headers map[string]string) result {
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	r, err := http.NewRequest(method, c.base+path, bytes.NewReader(raw))
	if err != nil {
		panic("request creation failed")
	}
	r.Header.Set("Origin", "http://localhost:5173")
	r.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		r.Header.Set(key, value)
	}
	response, err := c.http.Do(r)
	if err != nil {
		panic("local API request failed")
	}
	defer response.Body.Close()
	var envelope struct {
		Data  map[string]any `json:"data"`
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&envelope); err != nil {
		panic("API envelope was not JSON")
	}
	return result{response.StatusCode, envelope.Data, envelope.Error.Code, response.Cookies()}
}
func (c *client) call(method, path string, body any, status int, headers map[string]string) result {
	r := c.request(method, path, body, headers)
	require(r.status == status, fmt.Sprintf("%s %s: status=%d expected=%d code=%s", method, path, r.status, status, r.code))
	return r
}
func (c *client) context() map[string]string {
	r := c.call("GET", "/auth/context", nil, 200, map[string]string{"X-Gongming-Browser": "1"})
	for _, cookie := range r.cookies {
		require(cookie.Name == "gongming_auth_browser" && cookie.HttpOnly && cookie.SameSite == http.SameSiteLaxMode && cookie.Path == "/api/v1", "browser context cookie attributes differ")
	}
	generation, _ := r.data["generation"].(string)
	require(len(generation) >= 16, "context lacks an opaque generation")
	return map[string]string{"X-Gongming-Browser": "1", "X-Gongming-Auth-Generation": generation}
}
func (c *client) auth(method, path string, body any, status int) result {
	return c.call(method, path, body, status, c.context())
}
func (c *client) cookies() map[string]string {
	u, _ := url.Parse(c.base + "/auth/me")
	values := map[string]string{}
	for _, cookie := range c.http.Jar.Cookies(u) {
		values[cookie.Name] = cookie.Value
	}
	return values
}
func (c *client) clone() *client {
	next := newClient(c.base)
	u, _ := url.Parse(c.base)
	for name, value := range c.cookies() {
		next.http.Jar.SetCookies(u, []*http.Cookie{{Name: name, Value: value, Path: "/api/v1"}})
	}
	return next
}
func (c *client) identity(expected string) {
	r := c.call("GET", "/auth/me", nil, 200, nil)
	user, _ := r.data["user"].(map[string]any)
	require(user["id"] == expected, "unexpected authenticated account")
}
func userID(r result) string {
	u, _ := r.data["user"].(map[string]any)
	id, _ := u["id"].(string)
	require(id != "", "missing authenticated account")
	return id
}
func newKey() *secp256k1.PrivateKey {
	k, err := secp256k1.GeneratePrivateKey()
	if err != nil {
		panic("ephemeral signing key generation failed")
	}
	return k
}
func address(key *secp256k1.PrivateKey) string {
	h := sha3.NewLegacyKeccak256()
	_, _ = h.Write(key.PubKey().SerializeUncompressed()[1:])
	return "0x" + hex.EncodeToString(h.Sum(nil)[12:])
}
func sign(key *secp256k1.PrivateKey, message string) string {
	h := sha3.NewLegacyKeccak256()
	_, _ = fmt.Fprintf(h, "\x19Ethereum Signed Message:\n%d%s", len([]byte(message)), message)
	compact := ecdsa.SignCompact(key, h.Sum(nil), false)
	signature := append(append([]byte{}, compact[1:]...), compact[0]-27)
	return "0x" + hex.EncodeToString(signature)
}
func challenge(c *client, key *secp256k1.PrivateKey, purpose, password string) (result, map[string]string) {
	headers := c.context()
	body := map[string]string{"purpose": purpose, "address": address(key), "chainId": "1"}
	if purpose == "bind" {
		body["password"] = password
	}
	r := c.call("POST", "/auth/wallet/challenge", body, 200, headers)
	message, _ := r.data["message"].(string)
	require(strings.Contains(message, "URI: http://localhost:5173/") && strings.Contains(message, "Chain ID: 1\n"), "challenge origin or chain was not canonical")
	require(r.data["purpose"] == purpose && r.data["origin"] == "http://localhost:5173", "challenge purpose or origin changed")
	return r, headers
}
func proof(ch result, key *secp256k1.PrivateKey) map[string]string {
	return map[string]string{"id": ch.data["id"].(string), "message": ch.data["message"].(string), "signature": sign(key, ch.data["message"].(string))}
}
func bindings(c *client) []any {
	r := c.call("GET", "/me/wallet-bindings", nil, 200, nil)
	items, ok := r.data["items"].([]any)
	require(ok && r.data["hasPassword"] == true && r.data["maxBindings"] == float64(5), "binding credential summary differs")
	for _, item := range items {
		row := item.(map[string]any)
		require(len(row) == 3 && row["id"] != nil && row["address"] != nil && row["boundAt"] != nil, "binding exposed unexpected metadata")
	}
	return items
}
func bind(c *client, key *secp256k1.PrivateKey, password string) string {
	ch, headers := challenge(c, key, "bind", password)
	r := c.call("POST", "/auth/wallet/verify", proof(ch, key), 200, headers)
	row, _ := r.data["binding"].(map[string]any)
	id, _ := row["id"].(string)
	require(id != "", "binding receipt missing")
	return id
}
func walletLogin(c *client, key *secp256k1.PrivateKey, expected string) result {
	ch, headers := challenge(c, key, "login", "")
	r := c.call("POST", "/auth/wallet/verify", proof(ch, key), 200, headers)
	require(userID(r) == expected, "wallet resolved to a different account")
	c.identity(expected)
	return r
}
func check(name string, action func()) {
	action()
	fmt.Println("✓ " + name)
}
func attemptCleanup(action func()) (ok bool) {
	defer func() {
		if recover() != nil {
			ok = false
		}
	}()
	action()
	return true
}

// The operator restarts the API while this process retains its key and Cookie
// jars in memory. No credential is exported into the backup or a result file.
func verifyRestart(base string) {
	owner, wallet := newClient(base), newClient(base)
	key := newKey()
	defer key.Zero()
	const password = "Demo2026!"
	owner.auth("POST", "/auth/login", map[string]string{"email": "demo@gongming.local", "password": password}, 200)
	owner.identity("user_demo")
	previous := len(bindings(owner))
	var binding string
	cleaned := false
	cleanup := func() {
		// Never unlink another wallet on this shared development example account.
		// The bind response could have been lost after commit, before its ID was
		// assigned locally; locate only this process's random public address.
		if binding == "" {
			items, ok := owner.call("GET", "/me/wallet-bindings", nil, 200, nil).data["items"].([]any)
			require(ok, "restart QA cleanup list unavailable")
			for _, raw := range items {
				row, _ := raw.(map[string]any)
				candidate, _ := row["address"].(string)
				if strings.EqualFold(candidate, address(key)) {
					binding, _ = row["id"].(string)
				}
			}
		}
		if binding != "" {
			owner.auth("DELETE", "/me/wallet-bindings/"+binding, map[string]string{"password": password}, 200)
			for _, raw := range bindings(owner) {
				require(raw.(map[string]any)["id"] != binding, "restart QA binding remained active")
			}
		}
		owner.auth("POST", "/auth/logout", nil, 200)
		cleaned = true
	}
	defer func() {
		original := recover()
		if !cleaned && !attemptCleanup(cleanup) {
			fmt.Fprintln(os.Stderr, "Restart QA cleanup incomplete; inspect binding ID", binding)
			if original == nil {
				original = "restart QA cleanup incomplete"
			}
		}
		if original != nil {
			panic(original)
		}
	}()
	binding = bind(owner, key, password)
	ch, headers := challenge(wallet, key, "login", "")
	p := proof(ch, key)
	require(userID(wallet.call("POST", "/auth/wallet/verify", p, 200, headers)) == "user_demo", "restart wallet login failed")
	wallet.identity("user_demo")
	fmt.Println("READY: active wallet session and consumed proof established; ephemeral key retained in this process. Resume stdin after the API restart.")
	ready := make(chan bool, 1)
	go func() {
		_, err := bufio.NewReader(os.Stdin).ReadString('\n')
		ready <- err == nil
	}()
	select {
	case ok := <-ready:
		require(ok, "restart verification stdin closed")
	case <-time.After(2 * time.Minute):
		panic("restart verification coordination timed out")
	}
	wallet.identity("user_demo")
	owner.identity("user_demo")
	require(len(bindings(owner)) == previous+1, "active wallet binding did not survive restart")
	wallet.call("POST", "/auth/wallet/verify", p, 409, wallet.context())
	r := wallet.auth("DELETE", "/me/wallet-bindings/"+binding, map[string]string{"password": password}, 200)
	require(r.data["currentSessionRevoked"] == true && r.data["revokedSessions"].(float64) >= 1, "wallet provenance did not survive restart")
	wallet.call("GET", "/auth/me", nil, 401, nil)
	owner.identity("user_demo")
	cleanup()
	fmt.Println("✓ Active wallet identity, browser context, consumed proof and session provenance survived a real API restart; temporary binding removed.")
}

func main() {
	defer func() {
		if problem := recover(); problem != nil {
			fmt.Fprintln(os.Stderr, "Wallet identity verification failed:", problem)
			os.Exit(1)
		}
	}()
	base := os.Getenv("API_URL")
	if base == "" {
		base = "http://localhost:5173/api/v1"
	}
	u, err := url.Parse(base)
	require(err == nil && local(u) && u.Path == "/api/v1" && u.RawQuery == "" && u.Fragment == "", "verifier requires a local development API")
	if len(os.Args) > 1 {
		require(len(os.Args) == 2 && os.Args[1] == "--restart-check", "unsupported verification option")
		verifyRestart(base)
		return
	}
	stampBytes := make([]byte, 6)
	_, err = rand.Read(stampBytes)
	require(err == nil, "random verification suffix failed")
	stamp := hex.EncodeToString(stampBytes)
	password := "Verify_" + stamp + "!"
	emailA, emailB := "wallet_a_"+stamp+"@example.test", "wallet_b_"+stamp+"@example.test"
	a, b, login, foreign := newClient(base), newClient(base), newClient(base), newClient(base)
	key, wrong := newKey(), newKey()
	defer key.Zero()
	defer wrong.Zero()
	var aID, bID, binding string
	var restoreAdmin *client
	needsRestore, cleanupDone := false, false
	// Cleanup runs before keys are discarded, even if a later verification fails.
	cleanup := func() error {
		failures := 0
		if needsRestore && restoreAdmin != nil {
			if attemptCleanup(func() {
				restoreAdmin.call("PATCH", "/admin/users/"+aID, map[string]string{"status": "active"}, 200, nil)
				needsRestore = false
			}) == false {
				failures++
			}
		}
		for _, account := range []struct {
			id, email string
			owner     *client
		}{{aID, emailA, a}, {bID, emailB, b}} {
			if account.id == "" {
				continue
			}
			if attemptCleanup(func() {
				owner := account.owner
				me := owner.request("GET", "/auth/me", nil, nil)
				current, _ := me.data["user"].(map[string]any)
				if me.status != 200 || current["id"] != account.id {
					owner = newClient(base)
					owner.auth("POST", "/auth/login", map[string]string{"email": account.email, "password": password}, 200)
					owner.identity(account.id)
				}
				// Cleanup tolerates extra projection fields; it must also work when a
				// projection assertion above is precisely what failed verification.
				items, ok := owner.call("GET", "/me/wallet-bindings", nil, 200, nil).data["items"].([]any)
				require(ok, "cleanup list unavailable")
				for _, value := range items {
					if attemptCleanup(func() {
						row := value.(map[string]any)
						id, _ := row["id"].(string)
						require(strings.HasPrefix(id, "binding_") && len(id) == 40, "cleanup binding locator malformed")
						_, parseErr := hex.DecodeString(strings.TrimPrefix(id, "binding_"))
						require(parseErr == nil, "cleanup binding locator malformed")
						owner.auth("DELETE", "/me/wallet-bindings/"+url.PathEscape(id), map[string]string{"password": password}, 200)
					}) == false {
						failures++
					}
				}
				remaining, ok := owner.call("GET", "/me/wallet-bindings", nil, 200, nil).data["items"].([]any)
				require(ok && len(remaining) == 0, "QA credential cleanup was not confirmed")
				owner.auth("POST", "/auth/logout", nil, 200)
			}) == false {
				failures++
			}
		}
		if failures > 0 {
			return fmt.Errorf("QA cleanup incomplete; inspect account IDs %s / %s and binding %s", aID, bID, binding)
		}
		cleanupDone = true
		return nil
	}
	defer func() {
		original := recover()
		if !cleanupDone {
			if failure := cleanup(); failure != nil {
				fmt.Fprintln(os.Stderr, failure)
				if original == nil {
					original = failure
				}
			}
		}
		if original != nil {
			panic(original)
		}
	}()
	check("能力、浏览器上下文与真实账号", func() {
		config := a.call("GET", "/auth/wallet/config", nil, 200, nil).data
		require(config["enabled"] == true && config["contractWallets"] == false, "wallet capability unavailable or overstated")
		aID = userID(a.auth("POST", "/auth/register", map[string]string{"email": emailA, "password": password, "handle": "walleta_" + stamp, "name": "钱包身份联调甲"}, 201))
		bID = userID(b.auth("POST", "/auth/register", map[string]string{"email": emailB, "password": password, "handle": "walletb_" + stamp, "name": "钱包身份联调乙"}, 201))
		require(len(bindings(a)) == 0 && len(bindings(b)) == 0, "registration fabricated a wallet binding")
	})
	check("密码复核、签名错误与消息篡改不会退出原账号", func() {
		a.auth("POST", "/auth/wallet/challenge", map[string]string{"purpose": "bind", "address": address(key), "chainId": "1", "password": "incorrect-password"}, 403)
		ch, headers := challenge(a, key, "bind", password)
		p := proof(ch, wrong)
		a.call("POST", "/auth/wallet/verify", p, 403, headers)
		p = proof(ch, key)
		p["message"] += "\nUnexpected permission"
		r := a.request("POST", "/auth/wallet/verify", p, headers)
		require((r.status == 400 || r.status == 403) && len(r.cookies) == 0, "altered message was accepted or changed cookies")
		a.identity(aID)
		require(len(bindings(a)) == 0, "failed proof wrote binding")
		binding = bind(a, key, password)
		require(len(bindings(a)) == 1, "successful signature did not persist binding")
	})
	check("同地址跨账号排他，不泄露归属或合并账号", func() {
		headers := b.context()
		r := b.request("POST", "/auth/wallet/challenge", map[string]string{"purpose": "bind", "address": address(key), "chainId": "1", "password": password}, headers)
		if r.status == 200 {
			r = b.request("POST", "/auth/wallet/verify", proof(r, key), headers)
		}
		require(r.status == 409 && len(r.cookies) == 0, "another account acquired bound wallet")
		require(len(bindings(b)) == 0, "conflicting bind changed owner")
		b.identity(bID)
	})
	check("签名登录、来源设备与已消费 nonce 重放", func() {
		ch, headers := challenge(login, key, "login", "")
		p := proof(ch, key)
		require(userID(login.call("POST", "/auth/wallet/verify", p, 200, headers)) == aID, "signed login failed")
		login.identity(aID)
		sessions := login.call("GET", "/me/sessions", nil, 200, nil).data["items"].([]any)
		found := false
		for _, item := range sessions {
			row := item.(map[string]any)
			if row["current"] == true {
				require(row["authMethod"] == "wallet", "wallet session provenance missing")
				found = true
			}
		}
		require(found, "current wallet device not listed")
		r := login.call("POST", "/auth/wallet/verify", p, 409, headers)
		require(len(r.cookies) == 0, "replayed proof changed cookies")
		login.identity(aID)
	})
	check("窃取签名不能从另一浏览器兑换", func() {
		guest := newClient(base)
		ch, headers := challenge(guest, key, "login", "")
		foreignHeaders := foreign.context()
		r := foreign.request("POST", "/auth/wallet/verify", proof(ch, key), foreignHeaders)
		require((r.status == 403 || r.status == 409) && len(r.cookies) == 0, "cross-browser proof accepted")
		guest.call("POST", "/auth/wallet/verify", proof(ch, key), 200, headers)
		guest.identity(aID)
	})
	check("旧 challenge 与缺失 generation 不能覆盖新登录", func() {
		guest := newClient(base)
		ch, oldHeaders := challenge(guest, key, "login", "")
		guest.auth("POST", "/auth/login", map[string]string{"email": emailB, "password": password}, 200)
		r := guest.call("POST", "/auth/wallet/verify", proof(ch, key), 409, oldHeaders)
		require(len(r.cookies) == 0, "stale wallet response rewrote session")
		guest.call("POST", "/auth/login", map[string]string{"email": emailA, "password": password}, 409, map[string]string{"X-Gongming-Browser": "1"})
		noCookie := newClient(base)
		r = noCookie.call("POST", "/auth/login", map[string]string{"email": emailA, "password": password}, 409, oldHeaders)
		require(len(r.cookies) == 0, "missing context cookie downgraded to legacy auth")
		guest.identity(bID)
	})
	check("同 browser 认证 CAS 只允许一个版本成功", func() {
		racer := newClient(base)
		headers := racer.context()
		other := racer.clone()
		responses := make(chan result, 2)
		var wg sync.WaitGroup
		for _, caller := range []*client{racer, other} {
			wg.Add(1)
			go func(c *client) {
				defer wg.Done()
				defer func() {
					if recover() != nil {
						responses <- result{code: "request_failed"}
					}
				}()
				responses <- c.request("POST", "/auth/login", map[string]string{"email": emailA, "password": password}, headers)
			}(caller)
		}
		wg.Wait()
		close(responses)
		success, rejected := 0, 0
		for r := range responses {
			if r.status == 200 {
				success++
			} else if r.status == 409 && len(r.cookies) == 0 {
				rejected++
			}
		}
		require(success == 1 && rejected == 1, "same-version auth transitions both committed")
	})
	check("同一真实签名并发兑换只建立一个会话", func() {
		racer := newClient(base)
		ch, headers := challenge(racer, key, "login", "")
		other := racer.clone()
		responses := make(chan result, 2)
		var wg sync.WaitGroup
		for _, caller := range []*client{racer, other} {
			wg.Add(1)
			go func(c *client) {
				defer wg.Done()
				defer func() {
					if recover() != nil {
						responses <- result{code: "request_failed"}
					}
				}()
				responses <- c.request("POST", "/auth/wallet/verify", proof(ch, key), headers)
			}(caller)
		}
		wg.Wait()
		close(responses)
		success, rejected := 0, 0
		for r := range responses {
			if r.status == 200 {
				require(userID(r) == aID, "concurrent signature changed account")
				success++
			} else if r.status == 409 && len(r.cookies) == 0 {
				rejected++
			}
		}
		require(success == 1 && rejected == 1, "same proof committed more than once")
	})
	check("双初始化迟到 Cookie 在 State、窄 SQL、媒体、WS 全面拒绝", func() {
		first, second := newClient(base), newClient(base)
		first.auth("POST", "/auth/login", map[string]string{"email": emailA, "password": password}, 200)
		second.auth("POST", "/auth/login", map[string]string{"email": emailB, "password": password}, 200)
		mixed := second.clone()
		parsed, _ := url.Parse(base)
		mixed.http.Jar.SetCookies(parsed, []*http.Cookie{{Name: "gongming_session", Value: first.cookies()["gongming_session"], Path: "/api/v1"}})
		for _, path := range []string{"/auth/me", "/wallet", "/notifications", "/conversations", "/media/images/media_00000000000000000000000000000000"} {
			r := mixed.request("GET", path, nil, nil)
			require(r.status == 401 || r.status == 409, "mismatched context/session passed authenticated gate: "+path)
		}
		wsURL, _ := url.Parse(base + "/stream")
		wsURL.Scheme = strings.Replace(wsURL.Scheme, "http", "ws", 1)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		conn, response, dialErr := websocket.Dial(ctx, wsURL.String(), &websocket.DialOptions{HTTPClient: mixed.http, HTTPHeader: http.Header{"Origin": []string{"http://localhost:5173"}}})
		if conn != nil {
			conn.CloseNow()
		}
		require(dialErr != nil && response != nil && (response.StatusCode == 401 || response.StatusCode == 409), "mismatched context/session established a WebSocket")
		second.identity(bID)
		missing := first.clone()
		missing.http.Jar.SetCookies(parsed, []*http.Cookie{{Name: "gongming_auth_browser", Path: "/api/v1", MaxAge: -1}})
		missing.call("GET", "/auth/me", nil, 401, nil)
		mixed.auth("POST", "/auth/logout", nil, 200)
		first.identity(aID)
		second.call("GET", "/auth/me", nil, 401, nil)
		mixed.auth("POST", "/auth/login", map[string]string{"email": emailB, "password": password}, 200)
		mixed.identity(bID)
		second.call("GET", "/auth/me", nil, 401, nil)
	})
	check("链与失败尝试有界，失败不写业务结果", func() {
		guest := newClient(base)
		guest.auth("POST", "/auth/wallet/challenge", map[string]string{"purpose": "login", "address": address(key), "chainId": "999999999999999999999999"}, 400)
		ch, headers := challenge(guest, key, "login", "")
		for i := 0; i < 5; i++ {
			r := guest.request("POST", "/auth/wallet/verify", proof(ch, wrong), headers)
			require(r.status == 403 || (i == 4 && r.status == 409), "bad signature attempt behaved unexpectedly")
		}
		guest.call("POST", "/auth/wallet/verify", proof(ch, key), 409, headers)
		guest.call("GET", "/auth/me", nil, 401, nil)
	})
	check("撤销钱包设备废止原 session 挑战，钱包身份仍可新登录", func() {
		ch, headers := challenge(login, wrong, "bind", password)
		rows := login.call("GET", "/me/sessions", nil, 200, nil).data["items"].([]any)
		id := ""
		for _, value := range rows {
			row := value.(map[string]any)
			if row["current"] == true {
				id = row["id"].(string)
			}
		}
		require(id != "", "wallet device public ID missing")
		a.call("DELETE", "/me/sessions/"+id, nil, 200, nil)
		login.call("POST", "/auth/wallet/verify", proof(ch, wrong), 401, headers)
		require(len(bindings(a)) == 1, "revoking device changed wallet ownership")
		walletLogin(login, key, aID)
	})
	check("解绑撤销钱包会话，保留密码并废止旧证明", func() {
		pending := newClient(base)
		ch, headers := challenge(pending, key, "login", "")
		login.auth("DELETE", "/me/wallet-bindings/"+binding, map[string]string{"password": "wrong-password"}, 403)
		login.identity(aID)
		r := a.auth("DELETE", "/me/wallet-bindings/"+binding, map[string]string{"password": password}, 200)
		require(r.data["ok"] == true && r.data["currentSessionRevoked"] == false && r.data["revokedSessions"].(float64) >= 1 && len(r.cookies) == 0, "unlink receipt or cookie policy differs")
		login.call("GET", "/auth/me", nil, 401, nil)
		a.identity(aID)
		require(len(bindings(a)) == 0, "unlink left an active credential")
		binding = bind(a, key, password)
		pending.call("POST", "/auth/wallet/verify", proof(ch, key), 409, headers)
		walletLogin(login, key, aID)
	})
	check("账号停用与恢复不复活旧证明，管理员没有代绑权限", func() {
		admin := newClient(base)
		admin.auth("POST", "/auth/login", map[string]string{"email": "admin@gongming.local", "password": "Admin2026!"}, 200)
		restoreAdmin = admin
		pending := newClient(base)
		ch, headers := challenge(pending, key, "login", "")
		// Mark before the write: a lost response could still have suspended A.
		needsRestore = true
		admin.call("PATCH", "/admin/users/"+aID, map[string]string{"status": "suspended"}, 200, nil)
		// Restore immediately; later checks must not strand this QA account.
		admin.call("PATCH", "/admin/users/"+aID, map[string]string{"status": "active"}, 200, nil)
		needsRestore = false
		pending.call("POST", "/auth/wallet/verify", proof(ch, key), 409, headers)
		login.call("GET", "/auth/me", nil, 401, nil)
		a.auth("POST", "/auth/login", map[string]string{"email": emailA, "password": password}, 200)
		walletLogin(login, key, aID)
		admin.auth("DELETE", "/me/wallet-bindings/"+binding, map[string]string{"password": "Admin2026!"}, 404)
		admin.auth("POST", "/auth/logout", nil, 200)
	})
	check("当前钱包解绑回执与恢复密码登录", func() {
		r := login.auth("DELETE", "/me/wallet-bindings/"+binding, map[string]string{"password": password}, 200)
		require(r.data["currentSessionRevoked"] == true && len(r.cookies) == 0, "current unlink did not revoke its wallet session")
		login.call("GET", "/auth/me", nil, 401, nil)
		a.identity(aID)
		require(len(bindings(a)) == 0, "final unlink failed")
	})
	if failure := cleanup(); failure != nil {
		panic(failure)
	}
	fmt.Println("Wallet identity verification passed: 14 groups; signing keys remained in memory; QA accounts contain no active wallet bindings.")
}
