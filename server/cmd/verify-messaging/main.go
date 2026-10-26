// Command verify-messaging exercises the running development API through Vite.
// It creates local QA accounts and messages; never point it at production.
package main

import (
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
	return &client{base, &http.Client{Jar: jar, Timeout: 10 * time.Second}}
}
func must(ok bool, detail string) {
	if !ok {
		panic(detail)
	}
}
func (c *client) call(method, path string, body any, status int, extra map[string]string) map[string]any {
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
		panic(fmt.Sprintf("%s %s status=%d expected=%d %s", method, path, response.StatusCode, status, data))
	}
	var envelope map[string]json.RawMessage
	if err = json.Unmarshal(data, &envelope); err != nil {
		panic(err)
	}
	var result map[string]any
	if value := envelope["data"]; value != nil {
		_ = json.Unmarshal(value, &result)
	}
	return result
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
	must(err == nil && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"), "Verifier only accepts a local development API")
	token := make([]byte, 7)
	_, err = rand.Read(token)
	if err != nil {
		panic(err)
	}
	stamp := hex.EncodeToString(token)
	a, b, outsider := newClient(base), newClient(base), newClient(base)
	aUser := a.call("POST", "/auth/register", map[string]string{"email": "ws_a_" + stamp + "@example.test", "handle": "wsa_" + stamp, "name": "实时联调甲", "password": "Verify_" + stamp + "!"}, 201, nil)["user"].(map[string]any)
	bUser := b.call("POST", "/auth/register", map[string]string{"email": "ws_b_" + stamp + "@example.test", "handle": "wsb_" + stamp, "name": "实时联调乙", "password": "Verify_" + stamp + "!"}, 201, nil)["user"].(map[string]any)
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
	fmt.Println("6 组通过：真实 API、PostgreSQL、Vite WebSocket 代理；本地 QA 示例保留供查看。")
}
