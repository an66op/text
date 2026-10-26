package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestMessagingSQLDoesNotTouchUnrelatedTables(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	a := seedPostgres(t, ctx, s)
	h := a.Handler()
	cookie := memberCookie(t, h)
	lock, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback(ctx)
	if _, err = lock.Exec(ctx, `LOCK TABLE gongming_posts,gongming_comments,gongming_wallets,gongming_ledger,gongming_documents,gongming_friend_requests,gongming_reports,gongming_audits IN ACCESS EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}
	// Each real HTTP operation gets its own short deadline while all unrelated
	// tables remain exclusively locked. A full State load cannot pass this test.
	bounded := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCtx, cancel := context.WithTimeout(r.Context(), 1500*time.Millisecond)
		defer cancel()
		h.ServeHTTP(w, r.WithContext(requestCtx))
	})
	for _, path := range []string{"/conversations?limit=1", "/conversations/conversation_group", "/conversations/conversation_group/messages?limit=1"} {
		requireCode(t, call(t, bounded, "GET", path, nil, cookie), 200)
	}
	m := sent(t, bounded, cookie, "conversation_group", "无关领域锁不阻断发消息", "isolated-sql-message")
	requireCode(t, call(t, bounded, "POST", "/conversations/conversation_group/read", map[string]string{"messageId": m.ID}, cookie), 200)
	// The counter and outbox are both visible in the same narrow snapshot.
	snapshot, err := s.ReadStream(ctx, []StreamRequest{{SessionHash: tokenHash(cookie.Value), UserID: "user_demo"}}, 512)
	if err != nil || snapshot.LatestSequence != 2 || len(snapshot.Events) != 2 {
		t.Fatalf("SQL domain writes missed the transactional outbox: %+v %v", snapshot, err)
	}
}

func TestMessagingSQLHistoryAndPublicProjectionMatchState(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	a := seedPostgres(t, ctx, s)
	h := a.Handler()
	cookie := memberCookie(t, h)
	admin := adminCookie(t, h)
	if err := s.Update(ctx, func(state *State) error {
		group := state.Conversations["conversation_group"]
		group.Title += " ÄİΣK𐐀"
		state.Conversations[group.ID] = group
		for index := 2; index <= 9; index++ {
			sender := "user_demo"
			if index%2 == 0 {
				sender = "user_friend"
			}
			id := fmt.Sprintf("sql-parity-%02d", index)
			state.Messages[id] = StoredMessage{ID: id, ConversationID: "conversation_group", SenderID: sender, Body: fmt.Sprintf("记录 %d 100%%_ 字母ABC ÄİΣK𐐀", index), Seq: int64(index), CreatedAt: time.Date(2026, 10, 1, 0, index, 0, 0, time.UTC)}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var baseline *State
	if err := s.Read(ctx, func(state *State) error { baseline = state; return nil }); err != nil {
		t.Fatal(err)
	}
	memory := NewApp(&memoryStore{state: baseline}, a.cfg).Handler()
	paths := []string{
		"/conversations?q=软件", "/conversations?q=absent&limit=1", "/conversations?offset=9999",
		"/conversations?q=äİσk𐐨", "/conversations?q=%00",
		"/conversations/conversation_group", "/conversations/conversation_direct",
		"/conversations/conversation_group/messages", "/conversations/conversation_group/messages?limit=2",
		"/conversations/conversation_group/messages?limit=2&offset=2", "/conversations/conversation_group/messages?offset=100000",
		"/conversations/conversation_group/messages?limit=2&beforeId=sql-parity-07",
		"/conversations/conversation_group/messages?limit=2&beforeSeq=7", "/conversations/conversation_group/messages?afterSeq=3&limit=2",
		"/conversations/conversation_group/messages?afterSeq=0", "/conversations/conversation_group/messages?afterSeq=&offset=1",
		"/conversations/conversation_group/messages?q=100%25_&limit=3", "/conversations/conversation_group/messages?q=abc&limit=2",
		"/conversations/conversation_group/messages?q=äİσk𐐨&limit=2", "/conversations/conversation_group/messages?q=%00",
		"/conversations/conversation_group/messages?beforeId=message_direct", "/conversations/conversation_group/messages?beforeId=absent",
		"/conversations/conversation_group/messages?beforeSeq=0", "/conversations/conversation_group/messages?afterSeq=-1",
		"/conversations/conversation_group/messages?beforeSeq=9007199254740992", "/conversations/conversation_group/messages?afterSeq=no",
		"/conversations/conversation_group/messages?beforeSeq=7&afterSeq=0", "/conversations/conversation_group/messages?beforeId=sql-parity-07&beforeSeq=7",
		"/conversations/conversation_group/messages?afterSeq=0&offset=00", "/conversations/conversation_group/messages?limit=101",
		"/conversations/conversation_group/messages?offset=-1", "/conversations/unknown/messages", "/conversations/unknown",
	}
	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			actual, expected := call(t, h, "GET", path, nil, cookie), call(t, memory, "GET", path, nil, cookie)
			var actualData, expectedData any
			_ = json.Unmarshal(actual.Data, &actualData)
			_ = json.Unmarshal(expected.Data, &expectedData)
			if actual.Code != expected.Code || !reflect.DeepEqual(actual.Error, expected.Error) || !reflect.DeepEqual(actualData, expectedData) {
				t.Fatalf("SQL/State mismatch:\nSQL %d %s %+v\nState %d %s %+v", actual.Code, actual.Data, actual.Error, expected.Code, expected.Data, expected.Error)
			}
			if bytes.Contains(actual.Data, []byte(`"email"`)) || bytes.Contains(actual.Data, []byte(`"role"`)) {
				t.Fatal("private account projection leaked")
			}
		})
	}
	all := payload[struct {
		Total       int `json:"total"`
		UnreadTotal int `json:"unreadTotal"`
	}](t, call(t, h, "GET", "/conversations?limit=1", nil, cookie))
	filtered := payload[struct {
		Total       int `json:"total"`
		UnreadTotal int `json:"unreadTotal"`
	}](t, call(t, h, "GET", "/conversations?q=never-matches&limit=1", nil, cookie))
	if all.Total != 3 || all.UnreadTotal != 7 || filtered.Total != 0 || filtered.UnreadTotal != all.UnreadTotal {
		t.Fatalf("unreadTotal was filtered/paginated: %+v %+v", all, filtered)
	}
	for _, path := range []string{"/conversations/conversation_direct", "/conversations/conversation_direct/messages"} {
		requireCode(t, call(t, h, "GET", path, nil, admin), 404)
		requireCode(t, call(t, h, "GET", path, nil, nil), 401)
	}
	requireCode(t, call(t, h, "POST", "/conversations/conversation_channel/messages", map[string]string{"body": "普通订阅者"}, cookie), 403)
	// A stale expected account must fail before anonymous/permission errors.
	for _, cookie := range []*http.Cookie{cookie, nil} {
		req := httptest.NewRequest("GET", "http://localhost:8080/api/v1/conversations", nil)
		req.Header.Set("X-Gongming-Account", "another_account")
		if cookie != nil {
			req.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != 409 || !strings.Contains(w.Body.String(), "account_changed") {
			t.Fatal("SQL authentication bypassed account guard")
		}
	}
	a.now = func() time.Time { return time.Now().Add(8 * 24 * time.Hour) }
	requireCode(t, call(t, h, "GET", "/conversations", nil, cookie), 401)
}

func TestMessagingSQLIdempotencyPreservesEntireResponse(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	a := seedPostgres(t, ctx, s)
	h := a.Handler()
	cookie := memberCookie(t, h)
	fixed := time.Now().In(time.FixedZone("UTC+8", 8*60*60)).Truncate(time.Second).Add(123456789)
	a.now = func() time.Time { return fixed }
	body := map[string]string{"body": "重试返回完整对象相同", "clientId": "sql-full-response-retry"}
	first := call(t, h, "POST", "/conversations/conversation_group/messages", body, cookie)
	requireCode(t, first, 200)
	retried := call(t, h, "POST", "/conversations/conversation_group/messages", body, cookie)
	requireCode(t, retried, 200)
	if !bytes.Equal(first.Data, retried.Data) {
		t.Fatalf("entire idempotent response differs:\n%s\n%s", first.Data, retried.Data)
	}
	message := payload[Message](t, first)
	if !message.CreatedAt.Equal(fixed.UTC().Truncate(time.Microsecond)) || !strings.Contains(string(first.Data), "123456Z") {
		t.Fatal("message timestamp was not normalized to UTC microseconds")
	}
}

func TestMessagingSQLConcurrentWritesAndStateManagementInteroperate(t *testing.T) {
	ctx, s, dsn := isolatedPostgres(t)
	a := seedPostgres(t, ctx, s)
	h := a.Handler()
	cookie, admin := memberCookie(t, h), adminCookie(t, h)
	other, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	b := NewApp(other, a.cfg)
	second := b.Handler()
	var wg sync.WaitGroup
	ids := make(chan string, 8)
	for index := 0; index < 8; index++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			handler := h
			if index%2 != 0 {
				handler = second
			}
			res := call(t, handler, "POST", "/conversations/conversation_group/messages", map[string]string{"body": "跨实例幂等发布", "clientId": "sql-concurrent-shared"}, cookie)
			if res.Code != 200 {
				t.Errorf("concurrent send: %d %v", res.Code, res.Error)
				return
			}
			ids <- payload[Message](t, res).ID
		}(index)
	}
	wg.Wait()
	close(ids)
	id := ""
	for next := range ids {
		if id != "" && id != next {
			t.Fatal("clientId deduplication diverged across instances")
		}
		id = next
	}
	requireCode(t, call(t, h, "POST", "/conversations/conversation_group/messages", map[string]string{"body": "同键不同内容", "clientId": "sql-concurrent-shared"}, cookie), 409)
	// A management transaction that loaded before SQL send must retry from its
	// fresh snapshot; it cannot overwrite the newly committed message/event.
	loaded, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	var callbacks atomic.Int32
	management := make(chan error, 1)
	go func() {
		management <- other.Update(ctx, func(state *State) error {
			callbacks.Add(1)
			once.Do(func() { close(loaded); <-release })
			c := state.Conversations["conversation_group"]
			c.Title = "并发管理后的群聊"
			c.Members = withoutConversationMember(c.Members, "user_demo")
			delete(state.Reads, readKey(c.ID, "user_demo"))
			state.Conversations[c.ID] = c
			appendMessageEvent(state, "conversation.updated", c.ID, "", "", time.Now())
			appendMessageEvent(state, "membership.revoked", c.ID, "", "user_demo", time.Now())
			return nil
		})
	}()
	<-loaded
	m := sent(t, h, cookie, "conversation_group", "管理快照加载后提交的消息", "sql-before-member-removal")
	requireCode(t, call(t, h, "POST", "/conversations/conversation_group/read", map[string]string{"messageId": m.ID}, cookie), 200)
	close(release)
	if err = <-management; err != nil {
		t.Fatal(err)
	}
	if callbacks.Load() < 2 {
		t.Fatal("stale State management snapshot was not retried")
	}
	for _, path := range []string{"/conversations/conversation_group", "/conversations/conversation_group/messages"} {
		requireCode(t, call(t, second, "GET", path, nil, cookie), 404)
	}
	requireCode(t, call(t, h, "POST", "/conversations/conversation_group/messages", map[string]string{"body": "移除后禁止发言"}, cookie), 404)
	requireCode(t, call(t, h, "POST", "/conversations/conversation_group/read", map[string]string{"messageId": m.ID}, cookie), 404)
	page := payload[struct{ Items []Message }](t, call(t, second, "GET", "/conversations/conversation_group/messages", nil, admin))
	if len(page.Items) != 3 || page.Items[2].ID != m.ID {
		t.Fatal("State management overwrote committed SQL messages")
	}
	var eventCount int
	var maxSeq, counter int64
	if err = s.pool.QueryRow(ctx, `SELECT count(*),max(seq),(SELECT value FROM gongming_sequences WHERE name='message_events') FROM gongming_message_outbox`).Scan(&eventCount, &maxSeq, &counter); err != nil || eventCount != 5 || maxSeq != 5 || counter != 5 {
		t.Fatalf("lost or duplicate concurrent outbox events: count=%d max=%d counter=%d %v", eventCount, maxSeq, counter, err)
	}
	var marks int
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_conversation_reads WHERE conversation_id='conversation_group' AND user_id='user_demo'`).Scan(&marks); err != nil || marks != 0 {
		t.Fatal("concurrent removal left or recreated a private readmark")
	}
}

func TestMessagingSQLRollbackReadRacesAndOwnerTransfer(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	a := seedPostgres(t, ctx, s)
	h := a.Handler()
	cookie, admin := memberCookie(t, h), adminCookie(t, h)
	// Fail only the event insert: both the message and incremented global cursor
	// must roll back, with no partially visible successful operation.
	_, err := s.pool.Exec(ctx, `CREATE FUNCTION reject_test_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced event failure' USING ERRCODE='23514'; END $$; CREATE TRIGGER reject_test_event BEFORE INSERT ON gongming_message_outbox FOR EACH ROW EXECUTE FUNCTION reject_test_event()`)
	if err != nil {
		t.Fatal(err)
	}
	requireCode(t, call(t, h, "POST", "/conversations/conversation_group/messages", map[string]string{"body": "必须原子回滚", "clientId": "sql-forced-rollback"}, cookie), 500)
	var messages, sequence int
	if err = s.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM gongming_messages WHERE client_id='sql-forced-rollback'),(SELECT value FROM gongming_sequences WHERE name='message_events')`).Scan(&messages, &sequence); err != nil || messages != 0 || sequence != 0 {
		t.Fatal("failed outbox insert committed message or cursor")
	}
	requireCode(t, call(t, h, "POST", "/conversations/conversation_group/read", map[string]string{"messageId": "message_group"}, cookie), 500)
	if err = s.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM gongming_conversation_reads WHERE user_id='user_demo'),(SELECT value FROM gongming_sequences WHERE name='message_events')`).Scan(&messages, &sequence); err != nil || messages != 0 || sequence != 0 {
		t.Fatal("failed outbox insert committed readmark or cursor")
	}
	if _, err = s.pool.Exec(ctx, `DROP TRIGGER reject_test_event ON gongming_message_outbox;DROP FUNCTION reject_test_event()`); err != nil {
		t.Fatal(err)
	}
	latest := sent(t, h, admin, "conversation_group", "接收者并发推进已读", "sql-read-races-message")
	var wg sync.WaitGroup
	for index := 0; index < 8; index++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			id := latest.ID
			if index%2 == 0 {
				id = "message_group"
			}
			requireCode(t, call(t, h, "POST", "/conversations/conversation_group/read", map[string]string{"messageId": id}, cookie), 200)
		}(index)
	}
	wg.Wait()
	mark := payload[ReadReceipt](t, call(t, h, "POST", "/conversations/conversation_group/read", map[string]string{"messageId": "message_group"}, cookie))
	if mark.ReadSeq != latest.Seq || mark.LastReadMessageID != latest.ID || mark.UnreadCount != 0 {
		t.Fatal("concurrent read watermark regressed")
	}
	requireCode(t, call(t, h, "POST", "/conversations/conversation_channel/owner", map[string]string{"userId": "user_demo"}, admin), 200)
	requireCode(t, call(t, h, "POST", "/conversations/conversation_channel/messages", map[string]string{"body": "原频道主不可再发"}, admin), 403)
	sent(t, h, cookie, "conversation_channel", "新频道主发布", "sql-transferred-owner")
}

func TestMessagingSQLConcurrentOwnerTransferKeepsAuthorization(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	a := seedPostgres(t, ctx, s)
	h := a.Handler()
	cookie, admin := memberCookie(t, h), adminCookie(t, h)
	loaded, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	var attempts atomic.Int32
	done := make(chan error, 1)
	go func() {
		done <- s.Update(ctx, func(state *State) error {
			attempts.Add(1)
			once.Do(func() { close(loaded); <-release })
			c := state.Conversations["conversation_channel"]
			c.OwnerID = "user_demo"
			state.Conversations[c.ID] = c
			appendMessageEvent(state, "conversation.updated", c.ID, "", "", time.Now())
			return nil
		})
	}()
	<-loaded
	old := sent(t, h, admin, "conversation_channel", "转交提交前由当前频道主发布", "sql-concurrent-owner-before")
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if attempts.Load() < 2 {
		t.Fatal("owner transfer overwrote a stale message/outbox snapshot")
	}
	requireCode(t, call(t, h, "POST", "/conversations/conversation_channel/messages", map[string]string{"body": old.Body, "clientId": old.ClientID}, admin), 403)
	newMessage := sent(t, h, cookie, "conversation_channel", "转交提交后仅新频道主发布", "sql-concurrent-owner-after")
	if newMessage.Seq != old.Seq+1 {
		t.Fatal("owner transfer lost a committed message sequence")
	}
}

func TestMessagingSQLCrossInstanceSocketReplay(t *testing.T) {
	ctx, s, dsn := isolatedPostgres(t)
	a := seedPostgres(t, ctx, s)
	h := a.Handler()
	cookie := memberCookie(t, h)
	other, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	b := NewApp(other, a.cfg)
	server := httptest.NewServer(b.Handler())
	t.Cleanup(server.Close)
	t.Cleanup(b.CloseStreams)
	conn, ready := socket(t, server.URL, cookie, "")
	first := sent(t, h, cookie, "conversation_group", "另一个实例实时交付", "sql-cross-instance-event")
	event := receive(t, conn)
	if event.Type != "message.created" || event.MessageID != first.ID {
		t.Fatal("SQL commit did not reach the other instance's socket")
	}
	_ = conn.CloseNow()
	second := sent(t, h, cookie, "conversation_group", "离线后按游标重放", "sql-cross-instance-replay")
	reconnected, replayReady := socket(t, server.URL, cookie, event.EventID)
	if replayReady.EventID != event.EventID || ready.Type != "ready" {
		t.Fatal("socket cursor changed before replay")
	}
	if next := receive(t, reconnected); next.MessageID != second.ID || next.EventID == event.EventID {
		t.Fatal("cross-instance cursor replay skipped or duplicated an event")
	}
}

// Retention must match the State adapter even if old timestamps are not ordered.
func TestMessagingSQLOutboxRetentionParity(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	seedPostgres(t, ctx, s)
	now := time.Now().UTC()
	state := NewState()
	for index := 0; index < outboxRetention+3; index++ {
		created := now.Add(-8 * 24 * time.Hour)
		if index == outboxRetention || index == outboxRetention+2 {
			created = now
		}
		state.Outbox = append(state.Outbox, MessageEvent{ID: fmt.Sprintf("retention-%d", index), Seq: int64(index + 1), Type: "message.created", ConversationID: "conversation_group", MessageID: "message_group", CreatedAt: created})
	}
	state.EventSequence = int64(len(state.Outbox))
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	for _, e := range state.Outbox {
		if _, err = tx.Exec(ctx, `INSERT INTO gongming_message_outbox(id,seq,type,conversation_id,message_id,created_at) VALUES($1,$2,$3,$4,$5,$6)`, e.ID, e.Seq, e.Type, e.ConversationID, e.MessageID, e.CreatedAt); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE gongming_sequences SET value=$1 WHERE name='message_events'`, state.EventSequence); err != nil {
		t.Fatal(err)
	}
	appendMessageEvent(state, "message.created", "conversation_group", "message_group", "", now)
	if err = appendMessagingSQLEvent(ctx, tx, "message.created", "conversation_group", "message_group", "", now); err != nil {
		t.Fatal(err)
	}
	var count int
	var first, last int64
	if err = tx.QueryRow(ctx, `SELECT count(*),min(seq),max(seq) FROM gongming_message_outbox`).Scan(&count, &first, &last); err != nil || count != len(state.Outbox) || first != state.Outbox[0].Seq || last != state.EventSequence {
		t.Fatalf("SQL and State retention differ: %d %d %d vs %+v (%v)", count, first, last, state.Outbox, err)
	}
}
