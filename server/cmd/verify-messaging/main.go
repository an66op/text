// Command verify-messaging exercises the running development API through Vite.
// It creates local QA accounts and messages; never point it at production.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type client struct {
	base string
	http *http.Client
}

func newClient(base string) *client {
	jar, _ := cookiejar.New(nil)
	return &client{base, &http.Client{Jar: jar, Timeout: 10 * time.Second, CheckRedirect: func(request *http.Request, _ []*http.Request) error {
		if !localURL(request.URL) {
			return fmt.Errorf("verifier refused a non-local redirect")
		}
		return nil
	}}}
}
func localURL(u *url.URL) bool {
	return u != nil && (u.Scheme == "http" || u.Scheme == "https") && u.User == nil && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1")
}
func must(ok bool, detail string) {
	if !ok {
		panic(detail)
	}
}
func (c *client) call(method, path string, body any, status int, extra map[string]string) map[string]any {
	result, _ := c.callResponse(method, path, body, status, extra)
	return result
}
func (c *client) callResponse(method, path string, body any, status int, extra map[string]string) (map[string]any, *http.Response) {
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	request, err := http.NewRequest(method, c.base+path, bytes.NewReader(raw))
	if err != nil {
		panic(err)
	}
	request.Header.Set("Origin", "http://localhost:5173")
	request.Header.Set("Content-Type", "application/json")
	for k, v := range extra {
		request.Header.Set(k, v)
	}
	response, err := c.http.Do(request)
	if err != nil {
		panic(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		panic(err)
	}
	if response.StatusCode != status {
		// Response payloads may contain session metadata; keep failures redacted.
		panic(fmt.Sprintf("%s %s status=%d expected=%d", method, path, response.StatusCode, status))
	}
	var envelope map[string]json.RawMessage
	if err = json.Unmarshal(data, &envelope); err != nil {
		panic(err)
	}
	var result map[string]any
	if value := envelope["data"]; value != nil {
		_ = json.Unmarshal(value, &result)
	}
	return result, response
}
func (c *client) cookies() map[string]string {
	u, _ := url.Parse(c.base)
	result := map[string]string{}
	for _, cookie := range c.http.Jar.Cookies(u) {
		result[cookie.Name] = cookie.Value
	}
	return result
}
func (c *client) requireCookies(expected map[string]string) {
	actual := c.cookies()
	must(len(actual) == len(expected), "Action changed the caller's cookies")
	for name, value := range expected {
		must(actual[name] == value, "Action changed the caller's cookies")
	}
}

// Validate the exact public projection without printing the returned rows.
func sessionList(c *client, expected int, secrets []string) (map[string]map[string]any, string) {
	data := c.call("GET", "/me/sessions", nil, 200, nil)
	items, ok := data["items"].([]any)
	must(ok && len(items) > 0 && data["total"] == float64(len(items)), "Device session list has invalid items/total")
	if expected >= 0 {
		must(len(items) == expected, "Device session list includes missing or foreign sessions")
	}
	allowed := map[string]bool{"id": true, "device": true, "createdAt": true, "lastSeenAt": true, "expiresAt": true, "current": true, "legacy": true}
	rows := map[string]map[string]any{}
	currentID, currentCount := "", 0
	for _, raw := range items {
		row, ok := raw.(map[string]any)
		must(ok && len(row) == len(allowed), "Device session public projection differs")
		for key := range row {
			must(allowed[key], "Device session exposes an unexpected field")
		}
		id, idOK := row["id"].(string)
		must(idOK && strings.HasPrefix(id, "session_") && len(id) == len("session_")+32, "Device session lacks a public random ID")
		_, err := hex.DecodeString(strings.TrimPrefix(id, "session_"))
		must(err == nil && rows[id] == nil, "Device session public IDs are invalid or duplicated")
		device, deviceOK := row["device"].(string)
		must(deviceOK && device != "" && len([]rune(device)) <= 80, "Device session description is invalid")
		current, currentOK := row["current"].(bool)
		legacy, legacyOK := row["legacy"].(bool)
		must(currentOK && legacyOK, "Device session flags are invalid")
		for _, key := range []string{"createdAt", "lastSeenAt", "expiresAt"} {
			if row[key] == nil {
				must(legacy && key != "expiresAt", "New session lacks establishment metadata")
				continue
			}
			value, ok := row[key].(string)
			_, parseErr := time.Parse(time.RFC3339Nano, value)
			must(ok && parseErr == nil, "Device session timestamp is invalid")
		}
		if current {
			currentID, currentCount = id, currentCount+1
		}
		rows[id] = row
	}
	must(currentCount == 1, "Device session list must have exactly one current session")
	encoded, err := json.Marshal(data)
	must(err == nil, "Device session projection could not be checked")
	for _, secret := range secrets {
		if secret != "" {
			must(!bytes.Contains(encoded, []byte(secret)), "Device session response exposes private credential or raw user-agent data")
		}
	}
	return rows, currentID
}

type event struct {
	Type         string `json:"type"`
	ID           string `json:"eventId"`
	Conversation string `json:"conversationId"`
	Message      string `json:"messageId"`
}
type stream struct {
	conn   *websocket.Conn
	events chan event
	closed chan struct{}
}

func (c *client) dial(after string, origin string) (*stream, error) {
	u, _ := url.Parse(c.base + "/stream")
	u.Scheme = strings.Replace(u.Scheme, "http", "ws", 1)
	query := u.Query()
	if after != "" {
		query.Set("after", after)
	}
	u.RawQuery = query.Encode()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, u.String(), &websocket.DialOptions{HTTPClient: c.http, HTTPHeader: http.Header{"Origin": []string{origin}}})
	if err != nil {
		return nil, err
	}
	s := &stream{conn, make(chan event, 64), make(chan struct{})}
	go func() {
		defer close(s.closed)
		for {
			var value event
			if wsjson.Read(context.Background(), conn, &value) != nil {
				return
			}
			select {
			case s.events <- value:
			case <-time.After(time.Second):
				return
			}
		}
	}()
	return s, nil
}
func (s *stream) await(kind, conversation, message string) event {
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	for {
		select {
		case value := <-s.events:
			if value.Type == kind && (conversation == "" || value.Conversation == conversation) && (message == "" || value.Message == message) {
				return value
			}
		case <-s.closed:
			panic("WebSocket closed before expected event")
		case <-timer.C:
			panic("WebSocket event timeout: " + kind)
		}
	}
}
func (s *stream) awaitClosed() {
	select {
	case <-s.closed:
	case <-time.After(4 * time.Second):
		panic("Revoked device retained a live WebSocket")
	}
}
func main() {
	defer func() {
		if problem := recover(); problem != nil {
			fmt.Fprintln(os.Stderr, "Messaging verification failed:", problem)
			os.Exit(1)
		}
	}()
	base := os.Getenv("API_URL")
	if base == "" {
		base = "http://localhost:5173/api/v1"
	}
	u, err := url.Parse(base)
	must(err == nil && localURL(u), "Verifier only accepts a local development API")
	token := make([]byte, 7)
	_, err = rand.Read(token)
	if err != nil {
		panic(err)
	}
	stamp := hex.EncodeToString(token)
	aEmail, password := "ws_a_"+stamp+"@example.test", "Verify_"+stamp+"!"
	a, b, outsider := newClient(base), newClient(base), newClient(base)
	aUser := a.call("POST", "/auth/register", map[string]string{"email": aEmail, "handle": "wsa_" + stamp, "name": "实时联调甲", "password": password}, 201, nil)["user"].(map[string]any)
	bUser := b.call("POST", "/auth/register", map[string]string{"email": "ws_b_" + stamp + "@example.test", "handle": "wsb_" + stamp, "name": "实时联调乙", "password": password}, 201, nil)["user"].(map[string]any)
	outsider.call("POST", "/auth/login", map[string]string{"email": "admin@gongming.local", "password": "Admin2026!"}, 200, nil)
	as, err := a.dial("", "http://localhost:5173")
	if err != nil {
		panic(err)
	}
	defer as.conn.CloseNow()
	as.await("ready", "", "")
	bs, err := b.dial("", "http://localhost:5173")
	if err != nil {
		panic(err)
	}
	defer bs.conn.CloseNow()
	bs.await("ready", "", "")
	osStream, err := outsider.dial("", "http://localhost:5173")
	if err != nil {
		panic(err)
	}
	defer osStream.conn.CloseNow()
	osStream.await("ready", "", "")
	fmt.Println("✓ Vite 代理真实 WebSocket 握手与 Cookie 鉴权")
	group := a.call("POST", "/conversations", map[string]any{"title": "实时联调示例 " + stamp, "kind": "group", "memberIds": []string{bUser["id"].(string)}}, 200, nil)["id"].(string)
	as.await("conversation.created", group, "")
	bs.await("conversation.created", group, "")
	first := a.call("POST", "/conversations/"+group+"/messages", map[string]string{"body": "这条消息来自真实实时联调", "clientId": "msg_" + stamp}, 200, nil)
	repeated := a.call("POST", "/conversations/"+group+"/messages", map[string]string{"body": "这条消息来自真实实时联调", "clientId": "msg_" + stamp}, 200, nil)
	must(first["id"] == repeated["id"] && first["seq"] == repeated["seq"], "Duplicate request created another message")
	a.call("POST", "/conversations/"+group+"/messages", map[string]string{"body": "冲突内容", "clientId": "msg_" + stamp}, 409, nil)
	replayCursor := bs.await("message.created", group, first["id"].(string)).ID
	fmt.Println("✓ 实时消息送达与 clientId 重试去重 / 冲突拒绝")
	list := b.call("GET", "/conversations?limit=100", nil, 200, nil)["items"].([]any)
	found := false
	for _, raw := range list {
		entry := raw.(map[string]any)
		if entry["id"] == group {
			found = true
			must(entry["unreadCount"] == float64(1), "Unread count differs")
		}
	}
	must(found, "Conversation missing from recipient inbox")
	read := b.call("POST", "/conversations/"+group+"/read", map[string]string{"messageId": first["id"].(string)}, 200, nil)
	must(read["unreadCount"] == float64(0), "Read receipt did not clear unread")
	fmt.Println("✓ 服务端未读与已读水位")
	_ = bs.conn.CloseNow()
	second := a.call("POST", "/conversations/"+group+"/messages", map[string]string{"body": "离线期间的第二条消息", "clientId": "msg2_" + stamp}, 200, nil)
	third := a.call("POST", "/conversations/"+group+"/messages", map[string]string{"body": "离线期间的第三条消息", "clientId": "msg3_" + stamp}, 200, nil)
	page := b.call("GET", fmt.Sprintf("/conversations/%s/messages?beforeSeq=%.0f&limit=1", group, third["seq"].(float64)), nil, 200, nil)["items"].([]any)
	must(len(page) == 1 && page[0].(map[string]any)["id"] == second["id"], "Stable beforeSeq history differs")
	again, err := b.dial(replayCursor, "http://localhost:5173")
	if err != nil {
		panic(err)
	}
	defer again.conn.CloseNow()
	again.await("message.created", group, second["id"].(string))
	again.await("message.created", group, third["id"].(string))
	fmt.Println("✓ seq 稳定历史与 WebSocket 断线重放")
	deadline := time.NewTimer(700 * time.Millisecond)
checkIsolation:
	for {
		select {
		case value := <-osStream.events:
			must(value.Conversation != group, "Non-member received a private conversation event")
		case <-deadline.C:
			break checkIsolation
		}
	}
	outsider.call("GET", "/conversations/"+group+"/messages", nil, 404, nil)
	rejected, err := a.dial("", "https://untrusted.example")
	if rejected != nil {
		_ = rejected.conn.CloseNow()
	}
	must(err != nil, "Untrusted Origin connected")
	a.call("POST", "/conversations/"+group+"/messages", map[string]string{"body": "不应写入", "clientId": "wrong_" + stamp}, 409, map[string]string{"X-Gongming-Account": bUser["id"].(string)})
	a.call("GET", "/stream?account="+url.QueryEscape(bUser["id"].(string)), nil, 409, nil)
	must(aUser["id"] != bUser["id"], "Synthetic accounts overlap")
	fmt.Println("✓ 非成员隔离、Origin 与账号切换保护")
	b.call("POST", "/auth/logout", nil, 200, nil)
	select {
	case <-again.closed:
	case <-time.After(4 * time.Second):
		panic("Revoked session retained a live stream")
	}
	fmt.Println("✓ 注销后实时连接撤销")

	// Reuse A instead of registering more accounts. Distinct cookies represent
	// two extra devices; user-agent hints are never authentication evidence.
	a2, a3 := newClient(base), newClient(base)
	a2UA := "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15 QA-A2"
	a3UA := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 QA-A3"
	for _, login := range []struct {
		client *client
		ua     string
	}{{a2, a2UA}, {a3, a3UA}} {
		user := login.client.call("POST", "/auth/login", map[string]string{"email": aEmail, "password": password}, 200, map[string]string{"User-Agent": login.ua})["user"].(map[string]any)
		must(user["id"] == aUser["id"], "Extra device logged into a different account")
	}
	secrets := []string{a2UA, a3UA, aEmail, password}
	for _, device := range []*client{a, a2, a3, outsider} {
		for _, value := range device.cookies() {
			secrets = append(secrets, value)
			hash := sha256.Sum256([]byte(value))
			secrets = append(secrets, hex.EncodeToString(hash[:]))
		}
	}
	aRows, aID := sessionList(a, 3, secrets)
	a2Rows, a2ID := sessionList(a2, 3, secrets)
	a3Rows, a3ID := sessionList(a3, 3, secrets)
	must(aID != a2ID && aID != a3ID && a2ID != a3ID, "Independent device cookies share a public session ID")
	must(aRows[a2ID] != nil && aRows[a3ID] != nil && a2Rows[aID] != nil && a3Rows[aID] != nil, "Own devices disagree about session membership")
	must(aRows[a2ID]["device"] == "macOS · Safari" && aRows[a3ID]["device"] == "Windows · Chrome", "User-agent hints were not reduced to coarse device labels")
	adminRows, _ := sessionList(outsider, -1, secrets)
	for id := range adminRows {
		must(aRows[id] == nil, "Admin session list exposes another account's devices")
	}
	fmt.Println("✓ 设备列表归属、当前会话唯一标记与公开字段隐私")

	adminCookies, aCookies := outsider.cookies(), a.cookies()
	_, rejectedDelete := outsider.callResponse("DELETE", "/me/sessions/"+a2ID, nil, 404, nil)
	must(len(rejectedDelete.Cookies()) == 0, "Rejected cross-account revocation changed response cookies")
	outsider.requireCookies(adminCookies)
	outsider.call("GET", "/auth/me", nil, 200, nil)
	for _, failure := range []struct {
		status int
		extra  map[string]string
	}{{409, map[string]string{"X-Gongming-Account": bUser["id"].(string)}}, {403, map[string]string{"Origin": "https://untrusted.example"}}} {
		_, response := a.callResponse("DELETE", "/me/sessions/"+a2ID, nil, failure.status, failure.extra)
		must(len(response.Cookies()) == 0, "Rejected device revocation changed response cookies")
		a.requireCookies(aCookies)
	}
	a2.call("GET", "/auth/me", nil, 200, nil)
	fmt.Println("✓ 跨账号撤销拒绝、Origin / 账号保护与失败 Cookie 保持")

	a2Stream, err := a2.dial("", "http://localhost:5173")
	if err != nil {
		panic(err)
	}
	defer a2Stream.conn.CloseNow()
	a2Stream.await("ready", "", "")
	a3Stream, err := a3.dial("", "http://localhost:5173")
	if err != nil {
		panic(err)
	}
	defer a3Stream.conn.CloseNow()
	a3Stream.await("ready", "", "")
	revoked, response := a.callResponse("DELETE", "/me/sessions/"+a2ID, nil, 200, nil)
	must(revoked["ok"] == true && revoked["current"] == false && len(response.Cookies()) == 0, "Other-device revocation cleared the current cookie")
	a.requireCookies(aCookies)
	a2.call("GET", "/auth/me", nil, 401, nil)
	a2Stream.awaitClosed()
	_, repeatedDelete := a.callResponse("DELETE", "/me/sessions/"+a2ID, nil, 404, nil)
	must(len(repeatedDelete.Cookies()) == 0, "Repeated device revocation changed response cookies")
	a.requireCookies(aCookies)
	continued := a.call("POST", "/conversations/"+group+"/messages", map[string]string{"body": "撤销另一设备后，原设备仍接收实时消息", "clientId": "device_keep_" + stamp}, 200, nil)
	as.await("message.created", group, continued["id"].(string))
	a3Stream.await("message.created", group, continued["id"].(string))
	fmt.Println("✓ 单设备撤销使 Cookie 失效、连接关闭且保留其它设备实时消息")

	batch, batchResponse := a.callResponse("POST", "/me/sessions/revoke-others", map[string]any{}, 200, nil)
	must(batch["revoked"] == float64(1) && len(batchResponse.Cookies()) == 0, "Revoke-others removed the wrong devices or cleared the current cookie")
	a.requireCookies(aCookies)
	a3.call("GET", "/auth/me", nil, 401, nil)
	a3Stream.awaitClosed()
	remaining, currentID := sessionList(a, 1, secrets)
	must(currentID == aID && remaining[aID] != nil, "Revoke-others did not retain exactly the caller's session")
	a.call("GET", "/auth/me", nil, 200, nil)
	continued = a.call("POST", "/conversations/"+group+"/messages", map[string]string{"body": "批量撤销后，当前设备继续接收实时消息", "clientId": "device_batch_" + stamp}, 200, nil)
	as.await("message.created", group, continued["id"].(string))
	outsider.requireCookies(adminCookies)
	outsider.call("GET", "/auth/me", nil, 200, nil)
	fmt.Println("✓ 批量撤销仅保留本人当前设备并保持连接有效")

	self, selfResponse := a.callResponse("DELETE", "/me/sessions/"+aID, nil, 200, nil)
	must(self["ok"] == true && self["current"] == true, "Current-device revocation returned the wrong receipt")
	cleared := false
	for _, cookie := range selfResponse.Cookies() {
		if cookie.Name == "gongming_session" {
			cleared = cookie.Value == "" && cookie.MaxAge < 0 && cookie.Path == "/api/v1" && cookie.HttpOnly
		}
	}
	must(cleared && a.cookies()["gongming_session"] == "", "Current-device revocation did not clear the authentication cookie")
	as.awaitClosed()
	a.call("GET", "/auth/me", nil, 401, nil)
	fmt.Println("✓ 撤销当前设备后清空 Cookie 并关闭原实时连接")
	fmt.Println("11 组通过：真实 API、PostgreSQL、Vite WebSocket 代理与设备会话管理；本地 QA 示例保留供查看。")
}
