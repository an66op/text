// Command verify-message-media exercises rich messages against a local dev API.
// It creates clearly labelled QA data and leaves one readable product example.
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
	"unicode/utf8"

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

type event struct {
	Type         string `json:"type"`
	Conversation string `json:"conversationId"`
	Message      string `json:"messageId"`
}
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

func (s *stream) await(kind, conversation, message string) {
	timer := time.NewTimer(6 * time.Second)
	defer timer.Stop()
	for {
		select {
		case item := <-s.events:
			if item.Type == kind && (conversation == "" || item.Conversation == conversation) && (message == "" || item.Message == message) {
				return
			}
		case <-s.closed:
			panic("WebSocket closed before expected event")
		case <-timer.C:
			panic("WebSocket event timeout: " + kind)
		}
	}
}

func version(c *client, conversation string) float64 {
	return number(record(c.call("GET", "/conversations/"+conversation, nil, 200)["conversation"])["mutationVersion"])
}

func blind(c *client, message string) object {
	ack := c.call("DELETE", "/me/messages/"+message, nil, 200)
	must(len(ack) == 2 && ack["ok"] == true && ack["messageId"] == message, "blind retraction exposed extra context")
	return ack
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
	var random [8]byte
	_, err = rand.Read(random[:])
	must(err == nil, "random request ID failed")
	stamp := hex.EncodeToString(random[:])
	a, b, admin, guest := newClient(base), newClient(base), newClient(base), newClient(base)
	var as, bs, admins *stream
	defer func() {
		original := recover()
		for _, connection := range []*stream{as, bs, admins} {
			if connection != nil {
				_ = connection.conn.CloseNow()
			}
		}
		cleanupFailures := 0
		for _, c := range []*client{a, b, admin} {
			if c.account != "" {
				func() {
					defer func() {
						if recover() != nil {
							cleanupFailures++
						}
					}()
					res := c.request("POST", "/auth/logout", nil, "application/json", nil)
					_, readErr := io.Copy(io.Discard, res.Body)
					closeErr := res.Body.Close()
					if res.StatusCode != 200 || readErr != nil || closeErr != nil {
						cleanupFailures++
					}
				}()
			}
		}
		if cleanupFailures > 0 {
			fmt.Fprintln(os.Stderr, "Some verification sessions could not be confirmed logged out")
		}
		if original != nil {
			panic(original)
		}
		must(cleanupFailures == 0, "verification logout cleanup failed")
	}()
	checks := []string{}
	check := func(name string, action func()) { action(); checks = append(checks, name); fmt.Println("✓", name) }
	var group, other, channel string
	var imageAsset, imageMessage, reply, withdrawn object
	check("本机开发版本、真实账号与三个独立 WebSocket", func() {
		admin.call("POST", "/auth/login", object{"email": "admin@gongming.local", "password": "Admin2026!"}, 200)
		system := admin.call("GET", "/admin/system", nil, 200)
		must(system["version"] == "0.10.0" && system["environment"] == "development", "verifier requires development API v0.10.0")
		a.prepareBrowser()
		b.prepareBrowser()
		a.call("POST", "/auth/login", object{"email": "demo@gongming.local", "password": "Demo2026!"}, 200)
		b.call("POST", "/auth/register", object{"email": "rich_" + stamp + "@example.test", "handle": "rich_" + stamp, "name": "消息图片联调", "password": "Verify_" + stamp + "!"}, 201)
		as, bs, admins = a.dial(), b.dial(), admin.dial()
		group = id(a.call("POST", "/conversations", object{"title": "图片引用联调 " + stamp, "kind": "group", "memberIds": []string{b.account}}, 200))
		other = id(a.call("POST", "/conversations", object{"title": "隔离会话 " + stamp, "kind": "group", "memberIds": []string{b.account}}, 200))
		as.await("conversation.created", group, "")
		bs.await("conversation.created", group, "")
	})
	path := func(suffix string) string { return "/conversations/" + group + suffix }
	check("托管图片上传、精确恢复筛选、去重和当前成员预览", func() {
		key, raw := "upload_"+stamp, photo(80, 60, false)
		imageAsset = a.upload(group, raw, key, 200, 201)
		must(imageAsset["scope"] == "conversation" && imageAsset["conversationId"] == group, "upload scope differs")
		must(id(a.upload(group, raw, key, 200)) == id(imageAsset), "upload retry duplicated asset")
		a.upload(other, raw, key, 409)
		own := a.call("GET", "/me/media?clientId="+key+"&scope=conversation&conversationId="+group, nil, 200)
		must(len(rows(own["items"])) == 1 && id(record(rows(own["items"])[0])) == id(imageAsset), "exact recovery query differs")
		must(number(a.call("GET", "/me/media?clientId="+key+"&scope=conversation&conversationId="+other, nil, 200)["total"]) == 0, "recovery crossed conversation")
		a.image(text(imageAsset["url"]), 200, "GET", nil)
		b.image(text(imageAsset["url"]), 404, "GET", nil)
		admin.image(text(imageAsset["url"]), 404, "HEAD", map[string]string{"Range": "bytes=0-4"})
		admin.image(text(imageAsset["url"]), 404, "GET", nil)
		guest.image(text(imageAsset["url"]), 404, "GET", nil)
	})
	check("仅图片消息、同编号去重、跨域/跨账号附件拒绝", func() {
		payload := object{"body": "", "imageIds": []string{id(imageAsset)}, "clientId": "image_" + stamp}
		imageMessage = a.call("POST", path("/messages"), payload, 200)
		must(imageMessage["body"] == "" && imageMessage["status"] == "sent" && len(rows(imageMessage["images"])) == 1, "image-only message differs")
		must(id(a.call("POST", path("/messages"), payload, 200)) == id(imageMessage), "message retry duplicated")
		a.call("POST", path("/messages"), object{"body": "changed", "imageIds": []string{id(imageAsset)}, "clientId": "image_" + stamp}, 409)
		a.call("POST", path("/messages"), object{"body": "", "imageIds": []string{id(imageAsset)}}, 400)
		a.call("POST", path("/messages"), object{"body": "", "imageIds": []string{id(imageAsset), id(imageAsset)}, "clientId": "dup_" + stamp}, 400)
		b.call("POST", path("/messages"), object{"body": "", "imageIds": []string{id(imageAsset)}, "clientId": "foreign_" + stamp}, 400)
		a.call("POST", "/conversations/"+other+"/messages", object{"body": "", "imageIds": []string{id(imageAsset)}, "clientId": "cross_" + stamp}, 400)
		world := a.upload("", photo(20, 20, false), "world_"+stamp, 200, 201)
		a.call("POST", path("/messages"), object{"body": "", "imageIds": []string{id(world)}, "clientId": "world_" + stamp}, 400)
		a.call("POST", "/posts", object{"body": "不能公开私聊图", "images": []string{text(imageAsset["url"])}}, 400)
		a.call("DELETE", "/media/images/"+id(world), nil, 200)
		b.image(text(imageAsset["url"]), 200, "GET", nil)
		bs.await("message.created", group, id(imageMessage))
	})
	check("详情、本人编号与批量 resolve 顺序/缺失/上限", func() {
		must(id(a.call("GET", path("/messages/by-client/image_"+stamp), nil, 200)) == id(imageMessage), "own client lookup failed")
		b.call("GET", path("/messages/by-client/image_"+stamp), nil, 404)
		a.call("GET", "/conversations/"+other+"/messages/"+id(imageMessage), nil, 404)
		otherMessage := a.call("POST", "/conversations/"+other+"/messages", object{"body": "另一个会话", "clientId": "other_" + stamp}, 200)
		missing := "message_" + strings.Repeat("0", 32)
		resolved := b.call("POST", path("/messages/resolve"), object{"ids": []string{id(imageMessage), id(imageMessage), id(otherMessage), missing}}, 200)
		must(len(rows(resolved["items"])) == 1 && id(record(rows(resolved["items"])[0])) == id(imageMessage), "resolve order/dedupe differs")
		lost := rows(resolved["missingIds"])
		must(len(lost) == 2 && lost[0] == id(otherMessage) && lost[1] == missing, "resolve leaked foreign existence")
		tooMany := make([]string, 201)
		for i := range tooMany {
			tooMany[i] = fmt.Sprintf("message_%032x", i)
		}
		b.call("POST", path("/messages/resolve"), object{"ids": tooMany}, 400)
		must(number(record(rows(resolved["items"])[0])["revision"]) == number(resolved["mutationVersion"])+1, "resolve revision lacks shared snapshot")
	})
	check("单层引用动态投影与后台私聊隔离", func() {
		reply = b.call("POST", path("/messages"), object{"body": "已看到这张图片", "replyToId": id(imageMessage), "clientId": "reply_" + stamp}, 200)
		quote := record(reply["replyTo"])
		must(quote["available"] == true && quote["id"] == id(imageMessage) && number(quote["imageCount"]) == 1, "quote projection differs")
		must(quote["images"] == nil && quote["url"] == nil && quote["replyTo"] == nil, "quote recursively exposes images")
		longSource := a.call("POST", path("/messages"), object{"body": strings.Repeat("🌙", 240), "clientId": "unicode_" + stamp}, 200)
		longReply := b.call("POST", path("/messages"), object{"body": "Unicode引用", "replyToId": id(longSource), "clientId": "unicodereply_" + stamp}, 200)
		must(utf8.RuneCountInString(text(record(longReply["replyTo"])["body"])) == 200, "quote excerpt is not bounded by Unicode characters")
		blind(a, id(longSource))
		must(record(b.call("GET", path("/messages/"+id(longReply)), nil, 200)["replyTo"])["body"] == nil, "quote kept withdrawn Unicode body")
		a.call("POST", "/conversations/"+other+"/messages", object{"body": "跨会话引用", "replyToId": id(imageMessage), "clientId": "crossreply_" + stamp}, 404)
		media := admin.call("GET", "/admin/media?q="+id(imageAsset), nil, 200)
		item := record(rows(media["items"])[0])
		allowed := map[string]bool{"id": true, "url": true, "scope": true, "contentType": true, "width": true, "height": true, "bytes": true, "createdAt": true, "circleId": true, "conversationId": true, "owner": true, "status": true, "note": true, "referenceCount": true, "worldReferenceCount": true, "messageReferenceCount": true, "publishedReferenceCount": true, "posts": true, "circleReferenceCount": true, "circlePublishedReferenceCount": true, "circlePosts": true, "updatedAt": true}
		for key := range item {
			must(allowed[key], "admin media exposed an unexpected private field")
		}
		value, present := item["url"]
		must(present && value == nil, "admin conversation URL was not cleared")
		value, present = item["conversationId"]
		must(!present || value == nil || value == "", "admin media disclosed private conversation identity")
		must(len(rows(item["posts"])) == 0 && len(rows(item["circlePosts"])) == 0, "chat asset has unrelated content previews")
		must(number(item["messageReferenceCount"]) == 1 && number(item["worldReferenceCount"]) == 0 && number(item["circleReferenceCount"]) == 0, "admin reference domains differ")
		must(number(admin.call("GET", "/admin/media?q="+id(imageMessage), nil, 200)["total"]) == 0, "admin search accepts private message ID")
		must(number(admin.call("GET", "/admin/media?q="+group, nil, 200)["total"]) == 0, "admin search accepts private conversation ID")
		admin.call("GET", path("/messages/"+id(imageMessage)), nil, 404)
		admin.call("POST", path("/messages/resolve"), object{"ids": []string{id(imageMessage)}}, 404)
	})
	check("图片屏蔽/恢复的版本、实时失效与所有读取鉴权", func() {
		before := version(a, group)
		admin.call("PATCH", "/admin/media/"+id(imageAsset), object{"status": "blocked", "note": "开发联调：私聊图片屏蔽"}, 200)
		bs.await("conversation.messages.invalidated", group, "")
		must(version(a, group) == before+1, "block did not advance mutation version exactly once")
		for _, c := range []*client{a, b, admin} {
			c.image(text(imageAsset["url"]), 404, "GET", map[string]string{"Range": "bytes=0-8", "If-None-Match": "*"})
			c.image(text(imageAsset["url"]), 404, "HEAD", nil)
		}
		blocked := b.call("GET", path("/messages/"+id(imageMessage)), nil, 200)
		attachment := record(rows(blocked["images"])[0])
		must(attachment["available"] == false && attachment["url"] == nil, "blocked attachment still has URL")
		admin.call("PATCH", "/admin/media/"+id(imageAsset), object{"status": "blocked", "note": "开发联调：仅修改说明"}, 200)
		must(version(a, group) == before+1, "same status advanced mutation version")
		admin.call("PATCH", "/admin/media/"+id(imageAsset), object{"status": "ready", "note": "开发联调：恢复当前成员附件"}, 200)
		bs.await("conversation.messages.invalidated", group, "")
		must(version(a, group) == before+2, "unblock version differs")
		b.image(text(imageAsset["url"]), 200, "GET", nil)
	})
	check("作者撤回、引用脱敏、未读排除和幂等墓碑", func() {
		before := version(a, group)
		unreadBefore := number(record(b.call("GET", "/conversations/"+group, nil, 200)["conversation"])["unreadCount"])
		ack := blind(a, id(imageMessage))
		withdrawn = ack
		bs.await("message.retracted", group, id(imageMessage))
		must(version(a, group) == before+1, "retract version differs")
		tombstone := b.call("GET", path("/messages/"+id(imageMessage)), nil, 200)
		must(tombstone["status"] == "retracted" && tombstone["body"] == "" && len(rows(tombstone["images"])) == 0 && tombstone["replyTo"] == nil && tombstone["canRetract"] == false && tombstone["seq"] == imageMessage["seq"], "retraction did not produce terminal tombstone")
		quote := record(b.call("GET", path("/messages/"+id(reply)), nil, 200)["replyTo"])
		must(quote["available"] == false && quote["body"] == nil && quote["sender"] == nil && number(quote["imageCount"]) == 0, "withdrawn quote retained private preview")
		must(number(record(b.call("GET", "/conversations/"+group, nil, 200)["conversation"])["unreadCount"]) == unreadBefore-1, "tombstone counts as unread")
		b.call("DELETE", "/me/messages/"+id(imageMessage), nil, 404)
		blind(a, id(imageMessage))
		must(version(a, group) == before+1, "repeated retract advanced version")
		a.call("DELETE", "/media/images/"+id(imageAsset), nil, 200)
		replay := a.call("POST", path("/messages"), object{"body": "", "imageIds": []string{id(imageAsset)}, "clientId": "image_" + stamp}, 200)
		must(replay["status"] == "retracted" && id(replay) == id(imageMessage), "deleted image caused replay resurrection")
		a.call("POST", path("/messages"), object{"body": "changed", "imageIds": []string{id(imageAsset)}, "clientId": "image_" + stamp}, 409)
		a.call("POST", path("/messages"), object{"body": "不能引用撤回消息", "replyToId": id(imageMessage), "clientId": "deadquote_" + stamp}, 404)
	})
	check("移除成员后无本人预览，只能盲清理本人引用", func() {
		asset := b.upload(group, photo(32, 24, false), "leaveupload_"+stamp, 200, 201)
		message := b.call("POST", path("/messages"), object{"body": "离群清理验证", "imageIds": []string{id(asset)}, "clientId": "leave_" + stamp}, 200)
		a.call("DELETE", path("/members/"+b.account), nil, 200)
		b.call("GET", path("/messages"), nil, 404)
		b.image(text(asset["url"]), 404, "GET", nil)
		own := record(rows(b.call("GET", "/me/media?clientId=leaveupload_"+stamp, nil, 200)["items"])[0])
		must(own["previewAvailable"] == false && text(own["url"]) == "" && number(own["messageReferenceCount"]) == 1, "former member upload projection differs")
		must(len(rows(own["messageReferences"])) == 1 && len(record(rows(own["messageReferences"])[0])) == 1, "cleanup exposed conversation context")
		must(record(rows(own["messageReferences"])[0])["messageId"] == id(message), "cleanup reference does not point to the author's message")
		blind(b, id(message))
		b.call("DELETE", "/media/images/"+id(asset), nil, 200)
		must(len(blind(a, id(imageMessage))) == len(withdrawn), "repeat blind receipt changed shape")
		a.call("POST", path("/members"), object{"memberIds": []string{b.account}}, 200)
		b.call("GET", path("/messages/"+id(message)), nil, 200)
		b.image(text(asset["url"]), 404, "GET", nil)
	})
	check("超过十条本人引用逐批清理，计数来自服务器", func() {
		asset := a.upload(group, photo(24, 24, false), "batchupload_"+stamp, 200, 201)
		for i := 0; i < 12; i++ {
			a.call("POST", path("/messages"), object{"body": "批量引用清理", "imageIds": []string{id(asset)}, "clientId": fmt.Sprintf("batch_%s_%d", stamp, i)}, 200)
		}
		a.call("DELETE", "/media/images/"+id(asset), nil, 409)
		for remaining := 12; remaining > 0; {
			own := record(rows(a.call("GET", "/me/media?clientId=batchupload_"+stamp, nil, 200)["items"])[0])
			must(number(own["messageReferenceCount"]) == float64(remaining), "reference count drifted")
			refs := rows(own["messageReferences"])
			must(len(refs) > 0 && len(refs) <= 10, "cleanup batch size differs")
			for _, ref := range refs {
				blind(a, text(record(ref)["messageId"]))
				remaining--
			}
		}
		a.call("DELETE", "/media/images/"+id(asset), nil, 200)
	})
	check("广播频道上传/发送权限和转交后的作者撤回", func() {
		channel = id(a.call("POST", "/conversations", object{"title": "附件频道联调 " + stamp, "kind": "channel", "memberIds": []string{b.account}}, 200))
		b.upload(channel, photo(10, 10, false), "subscriber_"+stamp, 403)
		asset := a.upload(channel, photo(32, 24, false), "channel_"+stamp, 200, 201)
		message := a.call("POST", "/conversations/"+channel+"/messages", object{"body": "频道图片", "imageIds": []string{id(asset)}, "clientId": "channelmsg_" + stamp}, 200)
		a.call("POST", "/conversations/"+channel+"/owner", object{"userId": b.account}, 200)
		a.upload(channel, photo(10, 10, false), "formerowner_"+stamp, 403)
		blind(a, id(message))
		a.call("DELETE", "/media/images/"+id(asset), nil, 200)
	})
	check("seed 会话大于 1MiB multipart 走正确限额", func() {
		raw := photo(1024, 512, true)
		must(len(raw) > 1<<20, "large PNG fixture is too small")
		asset := a.upload("conversation_group", raw, "large_"+stamp, 200, 201)
		a.call("DELETE", "/media/images/"+id(asset), nil, 200)
	})
	var example string
	check("保留可体验的图文、引用与撤回开发示例", func() {
		example = id(a.call("POST", "/conversations", object{"title": "图片与引用 · 开发示例 " + stamp[:6], "kind": "group", "memberIds": []string{b.account}}, 200))
		asset := a.upload(example, photo(640, 400, false), "exampleupload_"+stamp, 200, 201)
		first := a.call("POST", "/conversations/"+example+"/messages", object{"body": "开发示例：这张渐变图由 Go 服务重编码保存，只有当前群成员可读取。点图片可查看原图。", "imageIds": []string{id(asset)}, "clientId": "example_" + stamp}, 200)
		b.call("POST", "/conversations/"+example+"/messages", object{"body": "这是引用回复。原消息若撤回，这里的引用预览也会变成不可用。", "replyToId": id(first), "clientId": "examplereply_" + stamp}, 200)
		removed := a.call("POST", "/conversations/"+example+"/messages", object{"body": "这条开发示例将撤回", "clientId": "exampleretract_" + stamp}, 200)
		blind(a, id(removed))
		b.call("POST", "/conversations/"+example+"/messages", object{"body": "上方保留撤回占位和原顺序；图片、引用与撤回均来自真实服务。", "clientId": "exampleend_" + stamp}, 200)
	})
	select {
	case <-time.After(300 * time.Millisecond):
	}
	for {
		select {
		case e := <-admins.events:
			must(e.Conversation != group && e.Conversation != other && e.Conversation != channel && e.Conversation != example, "non-member staff received private event")
		default:
			goto isolated
		}
	}
isolated:
	must(os.MkdirAll("../.runtime", 0700) == nil, "could not create private result directory")
	result, _ := json.MarshalIndent(object{"verifiedAt": time.Now().UTC().Format(time.RFC3339), "checks": checks, "exampleConversationId": example, "ownerId": a.account}, "", "  ")
	must(os.WriteFile("../.runtime/verify-message-media-result.json", append(result, '\n'), 0600) == nil, "could not save private ID-only result")
	fmt.Printf("%d 组真实消息图片/引用/撤回联调通过；成员示例账号内保留可体验群聊。\n", len(checks))
}

func main() {
	defer func() {
		if err := recover(); err != nil {
			fmt.Fprintln(os.Stderr, "Message media verification failed:", err)
			os.Exit(1)
		}
	}()
	run()
}
