package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func sent(t *testing.T, h http.Handler, cookie *http.Cookie, conversation, body, clientID string) Message {
	t.Helper()
	input := map[string]string{"body": body}
	if clientID != "" {
		input["clientId"] = clientID
	}
	response := call(t, h, "POST", "/conversations/"+conversation+"/messages", input, cookie)
	requireCode(t, response, 200)
	return payload[Message](t, response)
}
func TestMessageIdempotencyCursorAndReadWatermark(t *testing.T) {
	_, store, h := fixture(t)
	cookie := memberCookie(t, h)
	conversation := "conversation_group"
	first := sent(t, h, cookie, conversation, "第一个可靠消息", "client-message-001")
	repeated := sent(t, h, cookie, conversation, "第一个可靠消息", "client-message-001")
	if first.ID != repeated.ID || first.Seq != repeated.Seq {
		t.Fatal("same client ID created another message")
	}
	requireCode(t, call(t, h, "POST", "/conversations/"+conversation+"/messages", map[string]string{"body": "不同内容", "clientId": "client-message-001"}, cookie), 409)
	other := sent(t, h, cookie, "conversation_direct", "另一会话同一幂等号", "client-message-001")
	if other.ID == first.ID {
		t.Fatal("idempotency leaked across conversations")
	}
	second := sent(t, h, cookie, conversation, "第二个可靠消息", "client-message-002")
	type messagePage struct {
		Items         []Message `json:"items"`
		Total         int       `json:"total"`
		HasMore       bool      `json:"hasMore"`
		NextBeforeID  *string   `json:"nextBeforeId"`
		NextBeforeSeq *int64    `json:"nextBeforeSeq"`
	}
	page := payload[messagePage](t, call(t, h, "GET", "/conversations/"+conversation+"/messages?limit=1", nil, cookie))
	if len(page.Items) != 1 || page.Items[0].ID != second.ID || !page.HasMore || page.NextBeforeID == nil || *page.NextBeforeID != second.ID {
		t.Fatalf("latest page: %+v", page)
	}
	newest := sent(t, h, cookie, conversation, "翻页期间的新消息", "client-message-003")
	older := payload[messagePage](t, call(t, h, "GET", "/conversations/"+conversation+"/messages?limit=1&beforeId="+second.ID, nil, cookie))
	if len(older.Items) != 1 || older.Items[0].ID != first.ID {
		t.Fatal("new message shifted history cursor")
	}
	olderSeq := payload[messagePage](t, call(t, h, "GET", fmt.Sprintf("/conversations/%s/messages?limit=1&beforeSeq=%d", conversation, second.Seq), nil, cookie))
	if len(olderSeq.Items) != 1 || olderSeq.Items[0].ID != first.ID {
		t.Fatal("sequence history differs from ID history")
	}
	after := payload[messagePage](t, call(t, h, "GET", fmt.Sprintf("/conversations/%s/messages?afterSeq=%d", conversation, first.Seq), nil, cookie))
	if len(after.Items) != 2 || after.Items[0].ID != second.ID || after.Items[1].ID != newest.ID {
		t.Fatal("catch-up ordering incorrect")
	}
	requireCode(t, call(t, h, "GET", "/conversations/"+conversation+"/messages?beforeId="+other.ID, nil, cookie), 404)
	requireCode(t, call(t, h, "GET", "/conversations/"+conversation+"/messages?beforeSeq=1&afterSeq=0", nil, cookie), 400)
	requireCode(t, call(t, h, "GET", "/conversations/"+conversation+"/messages?beforeSeq=1&offset=1", nil, cookie), 400)
	receipt := payload[ReadReceipt](t, call(t, h, "POST", "/conversations/"+conversation+"/read", map[string]string{"messageId": second.ID}, cookie))
	if receipt.ReadSeq != second.Seq || receipt.LastReadMessageID != second.ID || receipt.UnreadCount != 0 {
		t.Fatalf("read receipt incorrect: %+v", receipt)
	}
	outbox := len(store.state.Outbox)
	oldReceipt := payload[ReadReceipt](t, call(t, h, "POST", "/conversations/"+conversation+"/read", map[string]string{"messageId": first.ID}, cookie))
	if oldReceipt.ReadSeq != second.Seq || len(store.state.Outbox) != outbox {
		t.Fatal("read watermark regressed or duplicate event emitted")
	}
	requireCode(t, call(t, h, "POST", "/conversations/"+conversation+"/read", map[string]string{"messageId": other.ID}, cookie), 404)
	requireCode(t, call(t, h, "POST", "/conversations/"+conversation+"/read", map[string]string{"messageId": "unknown"}, cookie), 404)
	type convPage struct {
		Items       []Conversation `json:"items"`
		UnreadTotal int            `json:"unreadTotal"`
	}
	all := payload[convPage](t, call(t, h, "GET", "/conversations?limit=1", nil, cookie))
	searched := payload[convPage](t, call(t, h, "GET", "/conversations?q=nothing-matches", nil, cookie))
	if all.UnreadTotal != searched.UnreadTotal || all.UnreadTotal != 2 {
		t.Fatalf("unread total must precede filtering/pagination: %d / %d", all.UnreadTotal, searched.UnreadTotal)
	}
	if len(store.state.Outbox) != 5 {
		t.Fatalf("transactional outbox duplicated retries: %d", len(store.state.Outbox))
	}
}

type callbackRetryStore struct{ *memoryStore }

func (s *callbackRetryStore) Update(ctx context.Context, fn func(*State) error) error {
	if err := s.memoryStore.Read(ctx, fn); err != nil {
		return err
	}
	return s.memoryStore.Update(ctx, fn)
}
func TestWriteRequestBodyIsReplayedForTransactionRetry(t *testing.T) {
	a, store, _ := fixture(t)
	a.store = &callbackRetryStore{store}
	h := a.Handler()
	cookie := memberCookie(t, h)
	message := sent(t, h, cookie, "conversation_group", "序列化事务重试仍能读取 JSON 请求体", "retry-body-message")
	if message.ClientID != "retry-body-message" || len(store.state.Outbox) != 1 {
		t.Fatal("retried callback did not commit exactly once")
	}
}

func socket(t *testing.T, serverURL string, cookie *http.Cookie, after string) (*websocket.Conn, StreamEvent) {
	t.Helper()
	headers := http.Header{"Origin": []string{"http://localhost:5173"}}
	if cookie != nil {
		headers.Set("Cookie", cookie.String())
	}
	url := "ws" + strings.TrimPrefix(serverURL, "http") + "/api/v1/stream"
	if after != "" {
		url += "?after=" + after
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, response, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: headers})
	if err != nil {
		if response != nil {
			t.Fatalf("dial HTTP %d: %v", response.StatusCode, err)
		}
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	return conn, receive(t, conn)
}
func receive(t *testing.T, conn *websocket.Conn) StreamEvent {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var event StreamEvent
	if err := wsjson.Read(ctx, conn, &event); err != nil {
		t.Fatal(err)
	}
	return event
}
func streamFixture(t *testing.T) (*App, *memoryStore, http.Handler, *httptest.Server) {
	t.Helper()
	a, store, h := fixture(t)
	server := httptest.NewServer(h)
	t.Cleanup(server.Close)
	t.Cleanup(a.CloseStreams)
	return a, store, h, server
}
func TestStreamOriginAuthenticationMembershipAndReplay(t *testing.T) {
	_, _, h, server := streamFixture(t)
	cookie := memberCookie(t, h)
	for _, test := range []struct {
		origin string
		cookie *http.Cookie
		code   int
	}{{"", cookie, 403}, {"http://localhost:5999", cookie, 403}, {"https://evil.example", cookie, 403}, {"http://localhost:5173", nil, 401}} {
		headers := http.Header{}
		headers.Set("Origin", test.origin)
		if test.cookie != nil {
			headers.Set("Cookie", test.cookie.String())
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		conn, response, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/api/v1/stream", &websocket.DialOptions{HTTPHeader: headers})
		cancel()
		if conn != nil {
			_ = conn.CloseNow()
		}
		if err == nil || response == nil || response.StatusCode != test.code {
			t.Fatalf("origin/auth accepted unexpected request: %+v %v", response, err)
		}
	}
	conn, ready := socket(t, server.URL, cookie, "")
	if ready.Type != "ready" {
		t.Fatal("missing ready event")
	}
	_ = conn.CloseNow()
	first := sent(t, h, cookie, "conversation_group", "断线期间第一条", "socket-replay-001")
	second := sent(t, h, cookie, "conversation_group", "断线期间第二条", "socket-replay-002")
	replay, reconnected := socket(t, server.URL, cookie, ready.EventID)
	if reconnected.Type != "ready" || reconnected.EventID != ready.EventID {
		t.Fatal("reconnect skipped pending events")
	}
	event1, event2 := receive(t, replay), receive(t, replay)
	if event1.Type != "message.created" || event1.MessageID != first.ID || event2.MessageID != second.ID {
		t.Fatalf("outbox replay incorrect: %+v %+v", event1, event2)
	}
	one, _ := strconv.ParseInt(event1.EventID, 10, 64)
	two, _ := strconv.ParseInt(event2.EventID, 10, 64)
	if one >= two {
		t.Fatal("event order regressed")
	}
	guest := call(t, h, "POST", "/auth/register", map[string]string{"email": "socket@example.org", "password": "SocketGuest12345!", "name": "隔离成员", "handle": "socketguest"}, nil)
	requireCode(t, guest, 201)
	guestID := payload[struct {
		User User `json:"user"`
	}](t, guest).User.ID
	isolated, _ := socket(t, server.URL, guest.Cookies[0], "")
	sent(t, h, cookie, "conversation_group", "只有既有群成员可以收到", "socket-isolation-1")
	created := call(t, h, "POST", "/conversations", map[string]any{"title": "隔离测试", "kind": "direct", "memberIds": []string{guestID}}, cookie)
	requireCode(t, created, 200)
	newConversation := payload[Conversation](t, created)
	event := receive(t, isolated)
	if event.Type != "conversation.created" || event.ConversationID != newConversation.ID || event.MessageID != "" {
		t.Fatalf("nonmember event leaked: %+v", event)
	}
	raw := []byte(fmt.Sprintf("%+v", event))
	if bytes.Contains(raw, []byte(cookie.Value)) {
		t.Fatal("stream leaked cookie")
	}
}

func TestStreamReadIsolationRevocationAndShutdown(t *testing.T) {
	a, _, h, server := streamFixture(t)
	cookie := memberCookie(t, h)
	conn, _ := socket(t, server.URL, cookie, "")
	read := call(t, h, "POST", "/conversations/conversation_group/read", map[string]string{"messageId": "message_group"}, cookie)
	requireCode(t, read, 200)
	event := receive(t, conn)
	if event.Type != "conversation.read" || event.MessageID != "message_group" {
		t.Fatal("read change not delivered to own sessions")
	}
	requireCode(t, call(t, h, "POST", "/auth/logout", map[string]any{}, cookie), 200)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, _, err := conn.Read(ctx)
	if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
		t.Fatalf("revoked socket did not close: %v", err)
	}
	newCookie := memberCookie(t, h)
	shutdown, _ := socket(t, server.URL, newCookie, "")
	a.CloseStreams()
	closeCtx, done := context.WithTimeout(context.Background(), 2*time.Second)
	defer done()
	_, _, err = shutdown.Read(closeCtx)
	if websocket.CloseStatus(err) != websocket.StatusGoingAway {
		t.Fatalf("shutdown did not close hijacked socket: %v", err)
	}
}

func TestStreamExpiredCursorResyncAndConnectionLimit(t *testing.T) {
	_, store, h, server := streamFixture(t)
	cookie := memberCookie(t, h)
	if err := store.Update(context.Background(), func(s *State) error {
		for i := 0; i < outboxRetention+5; i++ {
			appendMessageEvent(s, "message.created", "conversation_group", "message_group", "", time.Now())
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	_, resync := socket(t, server.URL, cookie, "0")
	if resync.Type != "resync" {
		t.Fatal("expired cursor was silently accepted")
	}
	for i := 1; i < 8; i++ {
		socket(t, server.URL, cookie, "")
	}
	headers := http.Header{"Origin": []string{"http://localhost:5173"}, "Cookie": []string{cookie.String()}}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	conn, response, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/api/v1/stream", &websocket.DialOptions{HTTPHeader: headers})
	if conn != nil {
		_ = conn.CloseNow()
	}
	if err == nil || response == nil || response.StatusCode != 429 {
		t.Fatalf("unbounded socket connections: %v %v", response, err)
	}
}

func TestStreamSurvivesOrdinaryHTTPRequestTimeout(t *testing.T) {
	if testing.Short() {
		t.Skip("real socket deadline test requires 13 seconds")
	}
	_, _, h, server := streamFixture(t)
	cookie := memberCookie(t, h)
	conn, _ := socket(t, server.URL, cookie, "")
	timer := time.NewTimer(13 * time.Second)
	defer timer.Stop()
	<-timer.C
	message := sent(t, h, cookie, "conversation_group", "HTTP超时之后实时连接仍然有效", "socket-after-timeout")
	if event := receive(t, conn); event.MessageID != message.ID {
		t.Fatal("healthy stream expired at normal HTTP deadline")
	}
}

func TestPublicUserProfileAndDirectoryIDSearch(t *testing.T) {
	_, _, h := fixture(t)
	cookie := memberCookie(t, h)
	response := call(t, h, "GET", "/users/zhouye", nil, cookie)
	requireCode(t, response, 200)
	if bytes.Contains(response.Data, []byte("email")) || bytes.Contains(response.Data, []byte("role")) {
		t.Fatal("profile exposed private fields")
	}
	public := payload[PublicUser](t, response)
	directory := payload[struct {
		Items []PublicUser `json:"items"`
	}](t, call(t, h, "GET", "/directory?q="+public.ID, nil, cookie))
	if len(directory.Items) != 1 || directory.Items[0].ID != public.ID {
		t.Fatal("directory ID lookup failed")
	}
	requireCode(t, call(t, h, "GET", "/users/zhouye", nil, nil), 401)
}

func TestAccountGuardRejectsStaleTabIdentityWithoutGrantingAccess(t *testing.T) {
	_, _, h := fixture(t)
	cookie := memberCookie(t, h)
	invoke := func(path, expected string, cookie *http.Cookie) response {
		req := httptest.NewRequest("GET", "http://localhost:8080/api/v1"+path, nil)
		req.Header.Set("X-Gongming-Account", expected)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		recorder := httptest.NewRecorder()
		h.ServeHTTP(recorder, req)
		var envelope struct {
			Data  json.RawMessage `json:"data"`
			Error *APIError       `json:"error"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		return response{Code: recorder.Code, Data: envelope.Data, Error: envelope.Error}
	}
	mismatch := invoke("/conversations", "user_admin", cookie)
	requireCode(t, mismatch, 409)
	if mismatch.Error.Code != "account_changed" {
		t.Fatal("missing recoverable account-change code")
	}
	requireCode(t, invoke("/auth/me", "user_admin", cookie), 200)
	requireCode(t, invoke("/conversations", "user_demo", cookie), 200)
	requireCode(t, invoke("/admin/users", "user_demo", cookie), 403)
	requireCode(t, invoke("/conversations", "user_demo", nil), 409)
}

func TestPostgresMessagingIdempotencyAndCrossInstanceStream(t *testing.T) {
	ctx, store, dsn := isolatedPostgres(t)
	a := seedPostgres(t, ctx, store)
	t.Cleanup(a.CloseStreams)
	h := a.Handler()
	cookie := memberCookie(t, h)
	reopened, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(reopened.Close)
	peer := NewApp(reopened, a.cfg)
	t.Cleanup(peer.CloseStreams)
	server := httptest.NewServer(peer.Handler())
	t.Cleanup(server.Close)
	conn, _ := socket(t, server.URL, cookie, "")
	const retries = 6
	replies := make(chan response, retries)
	var workers sync.WaitGroup
	for i := 0; i < retries; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			replies <- call(t, h, "POST", "/conversations/conversation_group/messages", map[string]string{"body": "跨连接同请求必须只投递一次", "clientId": "pg-message-shared-request"}, cookie)
		}()
	}
	workers.Wait()
	close(replies)
	id := ""
	var seq int64
	for reply := range replies {
		requireCode(t, reply, 200)
		message := payload[Message](t, reply)
		if id == "" {
			id = message.ID
			seq = message.Seq
		}
		if message.ID != id || message.Seq != seq {
			t.Fatal("concurrent idempotency created multiple messages")
		}
	}
	event := receive(t, conn)
	if event.MessageID != id || event.Type != "message.created" {
		t.Fatal("committed message did not reach another API instance")
	}
	var count int
	if err = store.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_message_outbox WHERE message_id=$1`, id).Scan(&count); err != nil || count != 1 {
		t.Fatalf("outbox not atomic/deduplicated: %d %v", count, err)
	}
	requireCode(t, call(t, peer.Handler(), "POST", "/conversations/conversation_group/read", map[string]string{"messageId": id}, cookie), 200)
	if err = reopened.Read(ctx, func(s *State) error {
		mark := s.Reads[readKey("conversation_group", "user_demo")]
		if mark.Seq != seq || mark.MessageID != id {
			t.Error("read watermark did not persist")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// SQL stream snapshots must not contain events from another member's private conversation.
	admin := adminCookie(t, h)
	private := call(t, h, "POST", "/conversations", map[string]any{"title": "不可外泄的私聊", "kind": "direct", "memberIds": []string{"user_friend"}}, admin)
	requireCode(t, private, 200)
	privateID := payload[Conversation](t, private).ID
	snapshot, err := reopened.ReadStream(ctx, []StreamRequest{{SessionHash: tokenHash(cookie.Value), UserID: "user_demo", AfterSeq: 0}}, 512)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range snapshot.Events {
		if event.ConversationID == privateID {
			t.Fatal("SQL outbox query exposed nonmember event")
		}
	}
	// Closing an HTTP session is visible to a different instance's live socket.
	if next := receive(t, conn); next.Type != "conversation.read" {
		t.Fatalf("expected private read event: %+v", next)
	}
	requireCode(t, call(t, h, "POST", "/auth/logout", map[string]any{}, cookie), 200)
	closeCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _, err = conn.Read(closeCtx)
	if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
		t.Fatalf("cross-instance session revocation did not close socket: %v", err)
	}
}

func TestStreamDispatcherBoundsBackpressureAndPrivateReadEvents(t *testing.T) {
	a, _, _ := fixture(t)
	defer a.CloseStreams()
	sub := &streamSubscriber{request: StreamRequest{SessionHash: "hash", UserID: "user_demo", AfterSeq: 0}, events: make(chan StreamEvent), stop: make(chan streamClose, 1)}
	snapshot := StreamSnapshot{FirstSequence: 1, LatestSequence: 1, Sessions: map[string]StreamSession{"hash": {UserID: "user_demo", Active: true, ExpiresAt: time.Now().Add(time.Hour), ConversationIDs: map[string]bool{"conversation_group": true}}}, Events: []MessageEvent{{Seq: 1, Type: "conversation.read", ConversationID: "conversation_group", RecipientID: "user_admin", MessageID: "message_group"}}}
	a.streamHub.deliver(sub, snapshot)
	select {
	case <-sub.stop:
		t.Fatal("another user's private read event filled this subscriber's queue")
	default:
	}
	if sub.request.AfterSeq != 1 {
		t.Fatal("invisible event did not advance internal cursor")
	}
	snapshot.LatestSequence = 2
	snapshot.Events = []MessageEvent{{Seq: 2, Type: "message.created", ConversationID: "conversation_group", MessageID: "message_group"}}
	a.streamHub.deliver(sub, snapshot)
	select {
	case close := <-sub.stop:
		if close.code != websocket.StatusTryAgainLater {
			t.Fatal("slow subscriber closed without retry status")
		}
	case <-time.After(time.Second):
		t.Fatal("slow subscriber blocked the dispatcher")
	}
}
