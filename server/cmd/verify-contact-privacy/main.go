// Command verify-contact-privacy checks private contact policies through local HTTP/WS.
// QA credentials stay in memory; the resulting report contains IDs only.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type object = map[string]any

type client struct {
	base       string
	http       *http.Client
	account    string
	browser    bool
	generation string
}

func must(ok bool, message string) {
	if !ok {
		panic(message)
	}
}

func newClient(base string) *client {
	jar, err := cookiejar.New(nil)
	if err != nil {
		panic(err)
	}
	return &client{base: base, http: &http.Client{Jar: jar, Timeout: 20 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return fmt.Errorf("redirect refused") }}}
}

func (c *client) request(method, path string, raw io.Reader, contentType string, extra map[string]string) *http.Response {
	endpoint := c.base + path
	if strings.HasPrefix(path, "/api/v1/") {
		parsed, _ := url.Parse(c.base)
		endpoint = parsed.Scheme + "://" + parsed.Host + path
	}
	r, err := http.NewRequest(method, endpoint, raw)
	if err != nil {
		panic("could not construct local API request")
	}
	r.Header.Set("Origin", "http://localhost:5173")
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	if c.account != "" {
		r.Header.Set("X-Gongming-Account", c.account)
	}
	if c.browser {
		r.Header.Set("X-Gongming-Browser", "1")
		if c.generation != "" {
			r.Header.Set("X-Gongming-Auth-Generation", c.generation)
		}
	}
	for key, value := range extra {
		r.Header.Set(key, value)
	}
	res, err := c.http.Do(r)
	if err != nil {
		panic("local API transport failed")
	}
	return res
}

func responseObject(res *http.Response, method, path string, expected ...int) object {
	defer res.Body.Close()
	accepted := false
	for _, status := range expected {
		accepted = accepted || res.StatusCode == status
	}
	must(accepted, fmt.Sprintf("%s %s status=%d expected=%v", method, path, res.StatusCode, expected))
	var envelope struct {
		Data  object `json:"data"`
		Error object `json:"error"`
	}
	must(json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(&envelope) == nil, "API returned malformed JSON")
	if res.StatusCode >= 400 {
		return envelope.Error
	}
	return envelope.Data
}

func (c *client) call(method, path string, value any, status int) object {
	var raw []byte
	if value != nil {
		var err error
		raw, err = json.Marshal(value)
		must(err == nil, "request encoding failed")
	}
	data := responseObject(c.request(method, path, bytes.NewReader(raw), "application/json", nil), method, path, status)
	if status < 300 && (path == "/auth/login" || path == "/auth/register") {
		c.account = text(record(data["user"])["id"])
		if c.browser {
			c.generation = text(data["authGeneration"])
			must(c.generation != "", "browser authentication did not advance generation")
		}
	}
	return data
}

func (c *client) prepareBrowser() {
	c.browser = true
	c.generation = text(c.call("GET", "/auth/context", nil, 200)["generation"])
	must(c.generation != "", "browser context initialization failed")
}

func (c *client) upload(conversation string, raw []byte, id string, status ...int) object {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	f, err := w.CreateFormFile("file", "../qa-conversation.png")
	must(err == nil, "multipart construction failed")
	_, err = f.Write(raw)
	must(err == nil && w.WriteField("clientId", id) == nil && w.Close() == nil, "multipart encoding failed")
	path := "/media/images"
	if conversation != "" {
		path = "/conversations/" + conversation + "/media/images"
	}
	return responseObject(c.request("POST", path, &body, w.FormDataContentType(), nil), "POST", path, status...)
}

func (c *client) image(path string, status int, method string, headers map[string]string) {
	res := c.request(method, path, nil, "", headers)
	defer res.Body.Close()
	must(res.StatusCode == status, fmt.Sprintf("%s private image status=%d expected=%d", method, res.StatusCode, status))
	_, err := io.Copy(io.Discard, res.Body)
	must(err == nil, "image body failed")
	if status == 200 {
		must(res.Header.Get("Cache-Control") == "no-store", "private image is cacheable")
	}
}

func text(value any) string { result, _ := value.(string); return result }
func number(value any) float64 {
	result, ok := value.(float64)
	must(ok, "missing numeric DTO field")
	return result
}
func record(value any) object {
	result, ok := value.(map[string]any)
	must(ok, "missing object DTO field")
	return result
}
func rows(value any) []any {
	result, ok := value.([]any)
	must(ok, "missing array DTO field")
	return result
}
func id(value object) string {
	result := text(value["id"])
	must(result != "", "missing DTO ID")
	return result
}

func photo(width, height int, noisy bool) []byte {
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	if noisy {
		_, err := rand.Read(img.Pix)
		must(err == nil, "QA image generation failed")
		for i := 3; i < len(img.Pix); i += 4 {
			img.Pix[i] = 255
		}
	} else {
		for y := 0; y < height; y++ {
			for x := 0; x < width; x++ {
				img.SetNRGBA(x, y, color.NRGBA{uint8(145 + 100*x/width), uint8(130 + 100*y/height), 215, 255})
			}
		}
	}
	var encoded bytes.Buffer
	must(png.Encode(&encoded, img) == nil, "QA PNG encoding failed")
	return encoded.Bytes()
}

type event = object
type stream struct {
	conn   *websocket.Conn
	events chan event
	closed chan struct{}
}

func (c *client) dial() *stream {
	u, _ := url.Parse(c.base + "/stream?account=" + url.QueryEscape(c.account))
	u.Scheme = "ws"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, u.String(), &websocket.DialOptions{HTTPClient: c.http, HTTPHeader: http.Header{"Origin": {"http://localhost:5173"}}})
	must(err == nil, "local WebSocket handshake failed")
	s := &stream{conn, make(chan event, 512), make(chan struct{})}
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
	s.await("ready", "", "")
	return s
}

func (s *stream) await(kind, conversation, message string) object {
	timer := time.NewTimer(6 * time.Second)
	defer timer.Stop()
	for {
		select {
		case item := <-s.events:
			if item["type"] == kind && (conversation == "" || item["conversationId"] == conversation) && (message == "" || item["messageId"] == message) {
				return item
			}
		case <-s.closed:
			panic("WebSocket closed before expected event")
		case <-timer.C:
			panic("WebSocket event timeout: " + kind)
		}
	}
}

func same(a, b any, description string) {
	left, e1 := json.Marshal(a)
	right, e2 := json.Marshal(b)
	must(e1 == nil && e2 == nil && bytes.Equal(left, right), description)
}
func contains(values []any, wanted string) bool {
	for _, v := range values {
		if v == wanted {
			return true
		}
	}
	return false
}
func policy(c *client) object { return c.call("GET", "/me/contact-privacy", nil, 200) }
func putPolicy(c *client, direct, invite string, requests, discover bool) object {
	return c.call("PUT", "/me/contact-privacy", object{"directMessagePolicy": direct, "groupInvitePolicy": invite,
		"allowFriendRequests": requests, "discoverableByHandle": discover, "revision": policy(c)["revision"]}, 200)
}
func block(c *client, target string, next bool) object {
	method := "PUT"
	if !next {
		method = "DELETE"
	}
	ack := c.call(method, "/me/blocks/"+target, object{"revision": policy(c)["revision"]}, 200)
	must(len(ack) == 5 && ack["ok"] == true && ack["userId"] == target && ack["blocked"] == next && ack["updatedAt"] != nil, "block receipt differs or exposed extra context")
	return ack
}
func restricted(c *client, method, path string, value any) {
	err := c.call(method, path, value, 403)
	must(err["code"] == "contact_restricted" && err["message"] == "当前联系权限不允许此操作", "contact rejection exposed its cause")
}
func conversation(c *client, target, kind, title string) object {
	return c.call("POST", "/conversations", object{"title": title, "kind": kind, "memberIds": []string{target}}, 200)
}
func send(c *client, conversationID, body, key string) object {
	return c.call("POST", "/conversations/"+conversationID+"/messages", object{"body": body, "clientId": key}, 200)
}
func canSend(c *client, conversationID string, expected bool) {
	must(record(c.call("GET", "/conversations/"+conversationID, nil, 200)["conversation"])["canSend"] == expected, "authoritative detail canSend differs")
	found := false
	for _, row := range rows(c.call("GET", "/conversations?limit=100", nil, 200)["items"]) {
		v := record(row)
		if id(v) == conversationID {
			must(v["canSend"] == expected, "list/detail write permissions differ")
			found = true
		}
	}
	must(found, "known conversation absent from current list")
}
func privateEvent(s *stream) {
	e := s.await("resync", "", "")
	must(len(e) == 2 && e["type"] == "resync" && text(e["eventId"]) != "", "private resync exposed extra fields")
}
func assertNoPrivateKeys(value any) {
	switch v := value.(type) {
	case map[string]any:
		for key, nested := range v {
			for _, forbidden := range []string{"directMessagePolicy", "groupInvitePolicy", "allowFriendRequests", "discoverableByHandle", "blockedByMe", "blockedByThem", "guardVersion", "guard_version", "blockCount", "userBlocks"} {
				must(key != forbidden, "public/admin DTO exposed private key: "+key)
			}
			assertNoPrivateKeys(nested)
		}
	case []any:
		for _, nested := range v {
			assertNoPrivateKeys(nested)
		}
	}
}
func run() {
	base := os.Getenv("API_URL")
	if base == "" {
		base = "http://localhost:5173/api/v1"
	}
	u, err := url.Parse(base)
	must(err == nil && u.Scheme == "http" && u.User == nil && u.Path == "/api/v1" && u.RawQuery == "" && u.Fragment == "" &&
		(u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1") &&
		(u.Port() == "5173" || u.Port() == "5174" || u.Port() == "8080"), "verifier only accepts a local development API")
	var entropy [8]byte
	_, err = rand.Read(entropy[:])
	must(err == nil, "QA ID generation failed")
	stamp := hex.EncodeToString(entropy[:])
	password := "Verify_" + stamp + "!"
	a, b, c, admin, demo, guest := newClient(base), newClient(base), newClient(base), newClient(base), newClient(base), newClient(base)
	var as, bs *stream
	defer func() {
		original := recover()
		failures := 0
		for _, s := range []*stream{as, bs} {
			if s != nil {
				_ = s.conn.CloseNow()
			}
		}
		for _, cl := range []*client{a, b, c, admin, demo} {
			if cl.account != "" {
				func() {
					defer func() {
						if recover() != nil {
							failures++
						}
					}()
					cl.call("POST", "/auth/logout", nil, 200)
				}()
			}
		}
		if failures > 0 {
			fmt.Fprintln(os.Stderr, "Some QA sessions could not be confirmed logged out")
		}
		if original != nil {
			panic(original)
		}
		must(failures == 0, "verification logout cleanup failed")
	}()
	checks := []string{}
	check := func(name string, action func()) { action(); checks = append(checks, name); fmt.Println("✓", name) }
	var pendingA, pendingC, direct, group, channel, rawImage, imageMessage object
	var bHandle, noticeID string
	uploadKey, richKey := "private_upload_"+stamp, "private_message_"+stamp
	check("开发v11、浏览器身份、默认私有设置及三个独立账号", func() {
		admin.call("POST", "/auth/login", object{"email": "admin@gongming.local", "password": "Admin2026!"}, 200)
		system := admin.call("GET", "/admin/system", nil, 200)
		must(system["version"] == "0.11.0" && system["environment"] == "development", "verifier requires development API v0.11.0")
		for _, flag := range []string{"contact-privacy", "private-blocklist", "contact-write-guards", "permission-aware-discovery"} {
			must(contains(rows(system["features"]), flag), "missing private contact feature")
		}
		for i, cl := range []*client{a, b, c} {
			cl.prepareBrowser()
			handle := fmt.Sprintf("privacy%d_%s", i, stamp)
			cl.call("POST", "/auth/register", object{"email": handle + "@example.test", "handle": handle, "name": []string{"联系权限甲 · 开发示例", "联系权限乙 · 开发示例", "联系权限丙 · 开发示例"}[i], "password": password}, 201)
			same(policy(cl), object{"directMessagePolicy": "everyone", "groupInvitePolicy": "everyone", "allowFriendRequests": true, "discoverableByHandle": true, "revision": 0, "updatedAt": nil}, "new account defaults differ")
			if cl == b {
				bHandle = handle
			}
		}
		guest.call("GET", "/me/contact-privacy", nil, 401)
		guest.call("GET", "/me/blocks", nil, 401)
		pendingA = a.call("POST", "/friend-requests", object{"userId": b.account, "note": "关闭新申请之前已经收到的邀请"}, 200)
		pendingC = c.call("POST", "/friend-requests", object{"userId": b.account, "note": "拉黑会取消这条待处理申请"}, 200)
		for _, v := range rows(b.call("GET", "/notifications?category=requests", nil, 200)["items"]) {
			n := record(v)
			if n["kind"] == "friend-request" && n["actor"] != nil && record(n["actor"])["id"] == c.account {
				noticeID = id(n)
			}
		}
		must(noticeID != "", "pending friend notification missing")
		as, bs = a.dial(), b.dial()
	})
	check("全量策略CAS、同值noop、输入校验与陌生目录隐藏", func() {
		b.call("PUT", "/me/contact-privacy", object{"revision": 0, "directMessagePolicy": "nobody"}, 400)
		b.call("PUT", "/me/contact-privacy", object{"revision": 0, "directMessagePolicy": "invalid", "groupInvitePolicy": "everyone", "allowFriendRequests": true, "discoverableByHandle": true}, 400)
		p := putPolicy(b, "nobody", "everyone", false, false)
		privateEvent(bs)
		must(number(p["revision"]) == 1, "policy revision did not advance once")
		same(putPolicy(b, "nobody", "everyone", false, false), p, "same policy changed receipt")
		must(b.call("PUT", "/me/contact-privacy", object{"revision": 0, "directMessagePolicy": "everyone", "groupInvitePolicy": "everyone", "allowFriendRequests": true, "discoverableByHandle": true}, 409)["code"] == "privacy_conflict", "stale CAS was not rejected")
		must(number(c.call("GET", "/directory?q="+bHandle, nil, 200)["total"]) == 0, "hidden account remained discoverable")
		c.call("GET", "/users/"+bHandle, nil, 404)
		must(id(b.call("GET", "/users/"+bHandle, nil, 200)) == b.account, "self profile hidden")
		cap := c.call("GET", "/contact-capabilities/"+b.account, nil, 200)
		must(len(cap) == 6 && cap["blockedByMe"] == false && cap["canMessage"] == false && cap["canRequestFriend"] == false && cap["canInvite"] == true && number(cap["revision"]) == 0, "capability projection differs")
		restricted(a, "POST", "/conversations", object{"title": "不应创建", "kind": "direct", "memberIds": []string{b.account}})
		must(id(c.call("POST", "/friend-requests", object{"userId": b.account}, 200)) == id(pendingC), "policy broke confirmation of an existing pending request")
		restricted(admin, "POST", "/friend-requests", object{"userId": b.account})
	})
	check("入站规则不阻止主动联系、既有私聊可读和旧申请明确接受", func() {
		direct = conversation(b, a.account, "direct", "联系权限 · 开发示例")
		send(b, id(direct), "我限制的是接收新私信，仍可主动联系允许联系我的成员。", "outbound_"+stamp)
		canSend(a, id(direct), false)
		canSend(b, id(direct), true)
		must(id(conversation(a, b.account, "direct", "复用历史私聊")) == id(direct), "restricted reuse duplicated/hid history")
		restricted(a, "POST", "/conversations/"+id(direct)+"/messages", object{"body": "被限制的新消息", "clientId": "denied_" + stamp})
		must(b.call("POST", "/friend-requests/"+id(pendingA)+"/respond", object{"action": "accept"}, 200)["status"] == "accepted", "closed new requests incorrectly denied accepting an old pending request")
		putPolicy(b, "friends", "friends", false, false)
		privateEvent(bs)
		canSend(a, id(direct), true)
		must(id(a.call("GET", "/users/"+bHandle, nil, 200)) == b.account, "real friend could not find hidden profile")
		must(number(a.call("GET", "/directory?q="+bHandle, nil, 200)["total"]) == 1, "real friend directory exception missing")
		must(c.call("GET", "/contact-capabilities/"+b.account, nil, 200)["canInvite"] == false, "stranger treated as friend for invites")
		group = conversation(a, b.account, "group", "共享空间独立 · 开发示例")
		channel = conversation(a, b.account, "channel", "联系权限频道 · 开发示例")
		a.call("POST", "/conversations/"+id(group)+"/members", object{"memberIds": []string{c.account}}, 200)
	})
	check("真实图片和引用为后续只读历史提供原始凭证", func() {
		rawImage = a.upload(id(direct), photo(48, 32, false), uploadKey, 200, 201)
		imageMessage = a.call("POST", "/conversations/"+id(direct)+"/messages", object{"body": "拉黑后仍能阅读的历史图片", "clientId": richKey, "imageIds": []string{id(rawImage)}}, 200)
		b.call("POST", "/conversations/"+id(direct)+"/messages", object{"body": "引用历史按原会话权限保留。", "clientId": "reply_" + stamp, "replyToId": id(imageMessage)}, 200)
		b.image(text(rawImage["url"]), 200, "GET", nil)
	})
	check("双方通用resync、精确拉黑回执、重复操作与双向新写拦截", func() {
		ack := block(b, a.account, true)
		privateEvent(as)
		privateEvent(bs)
		same(block(b, a.account, true), ack, "repeated block advanced revision/time")
		b.call("PUT", "/me/blocks/"+a.account, object{"revision": number(ack["revision"]) - 1}, 409)
		canSend(a, id(direct), false)
		canSend(b, id(direct), false)
		capA := a.call("GET", "/contact-capabilities/"+b.account, nil, 200)
		capB := b.call("GET", "/contact-capabilities/"+a.account, nil, 200)
		must(capA["blockedByMe"] == false && capB["blockedByMe"] == true, "reverse block disclosed or own block absent")
		for _, cl := range []*client{a, b} {
			restricted(cl, "POST", "/conversations/"+id(direct)+"/messages", object{"body": "不应新增", "clientId": "blocked_" + stamp + cl.account})
		}
		denied := a.upload(id(direct), photo(13, 11, false), "blocked_upload_"+stamp, 403)
		must(denied["code"] == "contact_restricted", "new private upload skipped contact guard")
		must(a.call("GET", "/relationships/"+b.account, nil, 200)["status"] == "friends", "block removed accepted friendship")
	})
	check("受限仍读历史原图、编号确认、resolve、已读和既有上传确认", func() {
		must(len(rows(a.call("GET", "/conversations/"+id(direct)+"/messages", nil, 200)["items"])) == 3, "block hid allowed history")
		must(id(a.call("GET", "/conversations/"+id(direct)+"/messages/by-client/"+richKey, nil, 200)) == id(imageMessage), "blocked by-client confirmation failed")
		must(len(rows(b.call("POST", "/conversations/"+id(direct)+"/messages/resolve", object{"ids": []string{id(imageMessage)}}, 200)["items"])) == 1, "blocked resolve failed")
		b.call("POST", "/conversations/"+id(direct)+"/read", object{"messageId": id(imageMessage)}, 200)
		a.image(text(rawImage["url"]), 200, "HEAD", nil)
		b.image(text(rawImage["url"]), 206, "GET", map[string]string{"Range": "bytes=0-8"})
		must(id(a.upload(id(direct), photo(48, 32, false), uploadKey, 200)) == id(rawImage), "block broke upload result confirmation")
		must(id(a.call("POST", "/conversations/"+id(direct)+"/messages", object{"body": "拉黑后仍能阅读的历史图片", "clientId": richKey, "imageIds": []string{id(rawImage)}}, 200)) == id(imageMessage), "block broke committed send confirmation")
	})
	check("共同群发言和频道转交独立、已有成员noop与邀请批次原子", func() {
		send(a, id(group), "共同群仍按成员权限互动。", "group_a_"+stamp)
		send(b, id(group), "拉黑不改变群成员身份。", "group_b_"+stamp)
		a.call("POST", "/conversations/"+id(group)+"/members", object{"memberIds": []string{b.account}}, 200)
		a.call("POST", "/conversations/"+id(channel)+"/owner", object{"userId": b.account}, 200)
		canSend(a, id(channel), false)
		canSend(b, id(channel), true)
		send(b, id(channel), "频道转交继续生效。", "channel_"+stamp)
		cg := conversation(c, a.account, "group", "邀请原子回滚示例")
		restricted(c, "POST", "/conversations/"+id(cg)+"/members", object{"memberIds": []string{admin.account, b.account}})
		members := rows(record(c.call("GET", "/conversations/"+id(cg), nil, 200)["conversation"])["members"])
		must(len(members) == 2 && !contains(members, admin.account), "denied batch partially added a permitted member")
		before := number(c.call("GET", "/conversations", nil, 200)["total"])
		restricted(c, "POST", "/conversations", object{"title": "创建应整体失败", "kind": "channel", "memberIds": []string{a.account, b.account}})
		must(number(c.call("GET", "/conversations", nil, 200)["total"]) == before, "denied creation left a conversation")
	})
	check("拉黑取消pending、旧终态不复活、好友通知动态脱敏", func() {
		block(b, c.account, true)
		cancelled := false
		for _, v := range rows(b.call("GET", "/friend-requests?direction=incoming&status=cancelled", nil, 200)["items"]) {
			r := record(v)
			if id(r) == id(pendingC) {
				cancelled = true
				must(r["status"] == "cancelled", "block did not cancel pending")
			}
		}
		must(cancelled, "cancelled pending receipt disappeared")
		b.call("POST", "/friend-requests/"+id(pendingC)+"/respond", object{"action": "accept"}, 409)
		restricted(c, "POST", "/friend-requests", object{"userId": b.account})
		found := false
		for _, v := range rows(b.call("GET", "/notifications?category=requests", nil, 200)["items"]) {
			n := record(v)
			if id(n) == noticeID {
				found = true
				must(n["available"] == false && n["actor"] == nil && n["context"] == nil && n["target"] == nil, "blocked friend notification exposed context")
			}
		}
		must(found, "block deleted notification evidence")
		must(b.call("POST", "/friend-requests/"+id(pendingA)+"/respond", object{"action": "accept"}, 200)["status"] == "accepted", "accepted terminal receipt was not preserved")
	})
	check("双向名单各自解除、原好友保留、本人盲撤与原图清理", func() {
		block(a, b.account, true)
		block(b, a.account, false)
		canSend(a, id(direct), false)
		block(a, b.account, false)
		canSend(a, id(direct), true)
		must(a.call("GET", "/relationships/"+b.account, nil, 200)["status"] == "friends", "unblock lost accepted friendship")
		block(b, a.account, true)
		ack := a.call("DELETE", "/me/messages/"+id(imageMessage), nil, 200)
		must(len(ack) == 2 && ack["messageId"] == id(imageMessage), "restricted blind cleanup exposed context")
		a.call("DELETE", "/media/images/"+id(rawImage), nil, 200)
		must(a.call("POST", "/conversations/"+id(direct)+"/messages", object{"body": "拉黑后仍能阅读的历史图片", "clientId": richKey, "imageIds": []string{id(rawImage)}}, 200)["status"] == "retracted", "replay revived deleted rich payload")
		block(b, a.account, false)
	})
	check("本人列表快照分页搜索与已停用对象的解除", func() {
		block(a, b.account, true)
		page := a.call("GET", "/me/blocks?userId="+b.account+"&limit=1", nil, 200)
		must(number(page["total"]) == 1 && len(rows(page["items"])) == 1 && record(rows(page["items"])[0])["available"] == true, "exact block query differs")
		admin.call("PATCH", "/admin/users/"+b.account, object{"status": "suspended"}, 200)
		page = a.call("GET", "/me/blocks?userId="+b.account, nil, 200)
		entry := record(rows(page["items"])[0])
		must(entry["available"] == false && entry["user"] == nil && entry["userId"] == b.account, "inactive block exposed profile or vanished")
		a.call("GET", "/contact-capabilities/"+b.account, nil, 404)
		block(a, b.account, false)
		canSend(a, id(direct), false)
		restricted(a, "POST", "/conversations/"+id(direct)+"/messages", object{"body": "停用对象仍有可读历史，但不能新增联系", "clientId": "inactive_" + stamp})
		must(a.upload(id(direct), photo(11, 11, false), "inactive_upload_"+stamp, 403)["code"] == "contact_restricted", "inactive peer upload concealed readable membership")
		a.call("GET", "/conversations/"+id(direct)+"/messages", nil, 200)
		same(block(a, "user_unknown_"+stamp, false), block(a, "user_unknown_"+stamp, false), "unknown unblock was not a private no-op")
		admin.call("PATCH", "/admin/users/"+b.account, object{"status": "active"}, 200)
		// Status changes revoke old sessions. Logging in again uses the same browser CAS.
		b.account = ""
		b.prepareBrowser()
		b.call("POST", "/auth/login", object{"email": "privacy1_" + stamp + "@example.test", "password": password}, 200)
		must(number(policy(b)["revision"]) > 0, "suspension/reset lost private policy")
	})
	check("账号来源与后台边界、公开DTO无私人字段", func() {
		responseObject(a.request("GET", "/me/blocks", nil, "", map[string]string{"X-Gongming-Account": b.account}), "GET", "/me/blocks", 409)
		a.call("PUT", "/me/blocks/"+a.account, object{"revision": policy(a)["revision"]}, 400)
		for _, path := range []string{"/admin/users?q=" + b.account, "/admin/overview", "/admin/audit?q=contact", "/directory?q=" + a.account, "/users/privacy0_" + stamp} {
			assertNoPrivateKeys(admin.call("GET", path, nil, 200))
		}
		for _, path := range []string{"/admin/contact-privacy", "/admin/blocks"} {
			res := admin.request("GET", path, nil, "", nil)
			must(res.StatusCode == 404, "admin private relationship route unexpectedly exists")
			res.Body.Close()
		}
		assertNoPrivateKeys(a.call("GET", "/documents", nil, 200))
		self := a.call("GET", "/contact-capabilities/"+a.account, nil, 200)
		must(self["blockedByMe"] == false && self["canMessage"] == false && self["canRequestFriend"] == false && self["canInvite"] == false, "self capabilities differ")
	})
	var exampleID string
	check("保留可体验的受限私聊示例，设置与解除入口读取真实服务", func() {
		demo.prepareBrowser()
		demo.call("POST", "/auth/login", object{"email": "demo@gongming.local", "password": "Demo2026!"}, 200)
		example := conversation(demo, c.account, "direct", "联系权限 · 开发示例")
		exampleID = id(example)
		send(demo, exampleID, "这是私人联系权限示例：历史仍可阅读。聊天信息或成员资料可以解除本人的拉黑；共同群按原权限互动。", "example_"+stamp)
		block(demo, c.account, true)
		canSend(demo, exampleID, false)
		must(number(demo.call("GET", "/me/blocks?userId="+c.account, nil, 200)["total"]) == 1, "example block was not persisted")
	})
	report, err := json.MarshalIndent(object{"checkedAt": time.Now().UTC(), "checks": checks, "exampleConversationId": exampleID, "accountIds": []string{a.account, b.account, c.account}}, "", "  ")
	must(err == nil, "verification report encoding failed")
	must(os.MkdirAll("../.runtime", 0700) == nil && os.WriteFile("../.runtime/verify-contact-privacy-result.json", append(report, '\n'), 0600) == nil, "ID-only QA report failed")
	fmt.Printf("私人联系权限 HTTP/WebSocket 联调通过，共 %d 组；QA凭证只在内存，报告只保存ID。\n", len(checks))
}
func main() {
	defer func() {
		if failure := recover(); failure != nil {
			fmt.Fprintln(os.Stderr, "私人联系权限联调失败：", failure)
			os.Exit(1)
		}
	}()
	run()
}
