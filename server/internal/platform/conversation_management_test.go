package platform

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type conversationDetails struct {
	Conversation   Conversation `json:"conversation"`
	MemberProfiles []PublicUser `json:"memberProfiles"`
}

func createdConversation(t *testing.T, h http.Handler, cookie *http.Cookie, kind string, members ...string) Conversation {
	t.Helper()
	response := call(t, h, "POST", "/conversations", map[string]any{"title": "管理测试", "kind": kind, "memberIds": members}, cookie)
	requireCode(t, response, 200)
	return payload[Conversation](t, response)
}

func TestConversationDetailIsIndependentOfListPaginationAndPrivate(t *testing.T) {
	_, store, h := fixture(t)
	cookie, admin := memberCookie(t, h), adminCookie(t, h)
	if err := store.Update(context.Background(), func(s *State) error {
		for i := 0; i < 105; i++ {
			id := fmt.Sprintf("other_conversation_%03d", i)
			s.Conversations[id] = StoredConversation{ID: id, Title: id, Kind: "group", Members: []string{"user_demo"}, OwnerID: "user_demo", CreatedAt: time.Now().Add(time.Hour)}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	page := payload[struct {
		Items []Conversation `json:"items"`
	}](t, call(t, h, "GET", "/conversations?limit=1", nil, cookie))
	if len(page.Items) != 1 || page.Items[0].ID == "conversation_group" {
		t.Fatal("fixture did not put requested conversation outside the first page")
	}
	response := call(t, h, "GET", "/conversations/conversation_group", nil, cookie)
	requireCode(t, response, 200)
	detail := payload[conversationDetails](t, response)
	if detail.Conversation.ID != "conversation_group" || len(detail.MemberProfiles) != 3 {
		t.Fatal("detail depended on list page")
	}
	if bytes.Contains(response.Data, []byte(`"email"`)) || bytes.Contains(response.Data, []byte(`"role"`)) {
		t.Fatal("member profiles exposed private fields")
	}
	private := createdConversation(t, h, cookie, "group", "user_friend")
	requireCode(t, call(t, h, "GET", "/conversations/"+private.ID, nil, admin), 404)
	requireCode(t, call(t, h, "GET", "/conversations/"+private.ID, nil, nil), 401)
	requireCode(t, call(t, h, "PATCH", "/conversations/"+private.ID, map[string]string{"title": "越权"}, admin), 404)
	// A global administrator who is a member still cannot replace the owner.
	withAdmin := createdConversation(t, h, cookie, "channel", "user_admin")
	requireCode(t, call(t, h, "PATCH", "/conversations/"+withAdmin.ID, map[string]string{"title": "管理员越权"}, admin), 403)
	requireCode(t, call(t, h, "POST", "/conversations/"+withAdmin.ID+"/owner", map[string]string{"userId": "user_admin"}, admin), 403)
	requireCode(t, call(t, h, "POST", "/conversations/"+withAdmin.ID+"/messages", map[string]string{"body": "全局管理员普通订阅者不能发布"}, admin), 403)
	sent(t, h, cookie, withAdmin.ID, "频道主可以发布", "member-channel-owner")
}

func TestConversationManagementLifecyclePermissionsAndReadCleanup(t *testing.T) {
	_, store, h := fixture(t)
	admin, memberCookie := adminCookie(t, h), memberCookie(t, h)
	created := createdConversation(t, h, admin, "channel", "user_demo", "user_friend")
	base := "/conversations/" + created.ID
	message := sent(t, h, admin, created.ID, "历史消息需要保留", "management-history-message")
	requireCode(t, call(t, h, "POST", base+"/read", map[string]string{"messageId": message.ID}, memberCookie), 200)
	initialMessages := len(store.state.Messages)
	renamed := call(t, h, "PATCH", base, map[string]string{"title": "  新的频道名  "}, admin)
	requireCode(t, renamed, 200)
	if payload[Conversation](t, renamed).Title != "新的频道名" {
		t.Fatal("rename not normalized")
	}
	requireCode(t, call(t, h, "PATCH", base, map[string]string{"title": ""}, admin), 400)
	requireCode(t, call(t, h, "PATCH", base, map[string]string{"title": strings.Repeat("字", 81)}, admin), 400)
	requireCode(t, call(t, h, "PATCH", base, map[string]string{"title": "偷改", "ownerId": "user_demo"}, admin), 400)
	requireCode(t, call(t, h, "PATCH", base, map[string]string{"title": "普通成员"}, memberCookie), 403)
	requireCode(t, call(t, h, "POST", base+"/members", map[string]any{"memberIds": []string{"user_friend"}}, memberCookie), 403)
	requireCode(t, call(t, h, "DELETE", base+"/members/user_admin", nil, admin), 409)
	requireCode(t, call(t, h, "POST", base+"/leave", map[string]any{}, admin), 409)
	if err := store.Update(context.Background(), func(s *State) error {
		friend := s.Accounts["user_friend"]
		friend.User.Status = "suspended"
		s.Accounts["user_friend"] = friend
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	requireCode(t, call(t, h, "POST", base+"/owner", map[string]string{"userId": "user_friend"}, admin), 400)
	requireCode(t, call(t, h, "POST", base+"/owner", map[string]string{"userId": "not-a-member"}, admin), 400)
	requireCode(t, call(t, h, "DELETE", base+"/members/user_demo", nil, admin), 200)
	if _, exists := store.state.Reads[readKey(created.ID, "user_demo")]; exists {
		t.Fatal("removed member retained read watermark")
	}
	if len(store.state.Messages) != initialMessages || store.state.Messages[message.ID].Body != "历史消息需要保留" {
		t.Fatal("member removal changed historical messages")
	}
	requireCode(t, call(t, h, "GET", base, nil, memberCookie), 404)
	requireCode(t, call(t, h, "GET", base+"/messages", nil, memberCookie), 404)
	requireCode(t, call(t, h, "POST", base+"/messages", map[string]string{"body": "移除后发言"}, memberCookie), 404)
	requireCode(t, call(t, h, "POST", base+"/read", map[string]string{"messageId": message.ID}, memberCookie), 404)
	noOpEvents := len(store.state.Outbox)
	requireCode(t, call(t, h, "DELETE", base+"/members/user_demo", nil, admin), 200)
	requireCode(t, call(t, h, "POST", base+"/leave", map[string]any{}, memberCookie), 200)
	requireCode(t, call(t, h, "POST", "/conversations/missing/leave", map[string]any{}, memberCookie), 200)
	if len(store.state.Outbox) != noOpEvents {
		t.Fatal("idempotent removal/leave emitted duplicate updates")
	}
	added := call(t, h, "POST", base+"/members", map[string]any{"memberIds": []string{"user_demo", "user_demo", "user_admin"}}, admin)
	requireCode(t, added, 200)
	if len(payload[Conversation](t, added).Members) != 3 {
		t.Fatal("added duplicate members")
	}
	transferred := call(t, h, "POST", base+"/owner", map[string]string{"userId": "user_demo"}, admin)
	requireCode(t, transferred, 200)
	if payload[Conversation](t, transferred).OwnerID != "user_demo" {
		t.Fatal("owner not transferred")
	}
	requireCode(t, call(t, h, "POST", base+"/messages", map[string]string{"body": "原管理员频道主转交后不能发布"}, admin), 403)
	sent(t, h, memberCookie, created.ID, "新频道主可以发布", "transferred-channel-owner")
	requireCode(t, call(t, h, "PATCH", base, map[string]string{"title": "旧owner越权"}, admin), 403)
	requireCode(t, call(t, h, "POST", base+"/leave", map[string]any{}, memberCookie), 409)
	requireCode(t, call(t, h, "POST", base+"/leave", map[string]any{}, admin), 200)
	requireCode(t, call(t, h, "POST", base+"/leave", map[string]any{}, admin), 200)
	requireCode(t, call(t, h, "GET", base, nil, admin), 404)
	requireCode(t, call(t, h, "PATCH", base, map[string]string{"title": "新owner可修改"}, memberCookie), 200)
	requireCode(t, call(t, h, "POST", "/auth/logout", map[string]any{}, memberCookie), 200)
	requireCode(t, call(t, h, "PATCH", base, map[string]string{"title": "退出登录后"}, memberCookie), 401)
}

func TestDirectConversationManagementIsRejectedAndMemberLimitDeduplicates(t *testing.T) {
	_, store, h := fixture(t)
	cookie := memberCookie(t, h)
	base := "/conversations/conversation_direct"
	for _, test := range []struct {
		method, path string
		body         any
	}{
		{"PATCH", base, map[string]string{"title": "改私聊"}},
		{"POST", base + "/members", map[string]any{"memberIds": []string{"user_admin"}}},
		{"DELETE", base + "/members/user_friend", nil},
		{"POST", base + "/owner", map[string]string{"userId": "user_friend"}},
		{"POST", base + "/leave", map[string]any{}},
	} {
		requireCode(t, call(t, h, test.method, test.path, test.body, cookie), 400)
	}
	// Nonmembers cannot use leave to distinguish private direct conversations.
	admin := adminCookie(t, h)
	requireCode(t, call(t, h, "POST", base+"/leave", map[string]any{}, admin), 200)
	group := createdConversation(t, h, cookie, "group")
	ids := []string{}
	if err := store.Update(context.Background(), func(s *State) error {
		for i := 0; i < 200; i++ {
			id := fmt.Sprintf("limit_member_%03d", i)
			ids = append(ids, id)
			s.Accounts[id] = Account{User: User{ID: id, Name: id, Handle: id, Status: "active", Role: "member", Email: id + "@example.test", CreatedAt: time.Now()}}
		}
		s.Accounts["inactive_candidate"] = Account{User: User{ID: "inactive_candidate", Status: "suspended"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	base = "/conversations/" + group.ID
	requireCode(t, call(t, h, "POST", base+"/members", map[string]any{"memberIds": []string{ids[0], "inactive_candidate"}}, cookie), 400)
	if len(store.state.Conversations[group.ID].Members) != 1 {
		t.Fatal("invalid member batch partially committed")
	}
	requireCode(t, call(t, h, "POST", base+"/members", map[string]any{"memberIds": []string{"missing_candidate"}}, cookie), 400)
	input := append(append([]string{}, ids[:199]...), ids[:199]...)
	response := call(t, h, "POST", base+"/members", map[string]any{"memberIds": input}, cookie)
	requireCode(t, response, 200)
	if len(payload[Conversation](t, response).Members) != 200 {
		t.Fatal("unique member count incorrect")
	}
	requireCode(t, call(t, h, "POST", base+"/members", map[string]any{"memberIds": []string{ids[199]}}, cookie), 400)
	if len(store.state.Conversations[group.ID].Members) != 200 {
		t.Fatal("overflow partially committed")
	}
	requireCode(t, call(t, h, "POST", base+"/members", map[string]any{"memberIds": []string{}}, cookie), 400)
	before := len(store.state.Outbox)
	requireCode(t, call(t, h, "POST", base+"/members", map[string]any{"memberIds": input}, cookie), 200)
	if len(store.state.Outbox) != before {
		t.Fatal("duplicate add emitted an update")
	}
}

// Blocking before the final authorization query simulates an event already in
// a socket's queue while membership is removed by another request.
type queuedAuthorizationStore struct {
	*memoryStore
	conversation string
	entered      chan struct{}
	release      chan struct{}
	once         sync.Once
}

func (s *queuedAuthorizationStore) AuthorizeStream(ctx context.Context, request StreamRequest, conversationID string) (bool, bool, error) {
	if conversationID == s.conversation {
		s.once.Do(func() {
			close(s.entered)
			select {
			case <-s.release:
			case <-ctx.Done():
			}
		})
	}
	valid, allowed := false, false
	err := s.memoryStore.Read(ctx, func(state *State) error {
		session, exists := state.Sessions[request.SessionHash]
		if !exists || session.UserID != request.UserID || !session.ExpiresAt.After(time.Now()) {
			return nil
		}
		account, exists := state.Accounts[session.UserID]
		if !exists || account.User.Status != "active" {
			return nil
		}
		valid = true
		allowed = conversationID == "" || member(state.Conversations[conversationID], request.UserID)
		return nil
	})
	return valid, allowed, err
}

func TestRemovedMemberReceivesOnlySafeResyncAndOtherConversationsContinue(t *testing.T) {
	a, store, _ := fixture(t)
	barrier := &queuedAuthorizationStore{memoryStore: store, conversation: "conversation_group", entered: make(chan struct{}), release: make(chan struct{})}
	a.store = barrier
	h := a.Handler()
	server := httptest.NewServer(h)
	t.Cleanup(server.Close)
	t.Cleanup(a.CloseStreams)
	memberCookie, admin := memberCookie(t, h), adminCookie(t, h)
	conn, _ := socket(t, server.URL, memberCookie, "")
	sent(t, h, admin, "conversation_group", "已经排队的私有消息", "queued-private-message")
	select {
	case <-barrier.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("socket write did not reach final authorization")
	}
	requireCode(t, call(t, h, "DELETE", "/conversations/conversation_group/members/user_demo", nil, admin), 200)
	close(barrier.release)
	event := receive(t, conn)
	if event.Type != "resync" || event.ConversationID != "" || event.MessageID != "" {
		t.Fatalf("removed member received queued private data: %+v", event)
	}
	sent(t, h, admin, "conversation_group", "移除之后的消息绝不能收到", "after-removal-private")
	allowed := sent(t, h, memberCookie, "conversation_direct", "其它合法会话继续工作", "after-removal-allowed")
	event = receive(t, conn)
	if event.Type != "message.created" || event.MessageID != allowed.ID || event.ConversationID != "conversation_direct" {
		t.Fatalf("stream lost isolation or valid subscriptions: %+v", event)
	}
	valid, authorized, err := a.authorizeStream(context.Background(), StreamRequest{SessionHash: tokenHash(memberCookie.Value), UserID: "user_demo"}, "conversation_group")
	if err != nil || !valid || authorized {
		t.Fatal("removed member remained authorized")
	}
}

func TestRecipientOnlyRevocationDoesNotBypassOrdinaryMessageMembership(t *testing.T) {
	a, _, _ := fixture(t)
	defer a.CloseStreams()
	sub := &streamSubscriber{request: StreamRequest{SessionHash: "hash", UserID: "user_demo"}, events: make(chan StreamEvent, 10), stop: make(chan streamClose, 1)}
	snapshot := StreamSnapshot{FirstSequence: 1, LatestSequence: 3, Sessions: map[string]StreamSession{"hash": {UserID: "user_demo", Active: true, ExpiresAt: time.Now().Add(time.Hour), ConversationIDs: map[string]bool{}}}, Events: []MessageEvent{
		{Seq: 1, Type: "message.created", ConversationID: "private", MessageID: "secret", RecipientID: "user_demo"},
		{Seq: 2, Type: "membership.revoked", ConversationID: "private", MessageID: "secret", RecipientID: "someone_else"},
		{Seq: 3, Type: "membership.revoked", ConversationID: "private", MessageID: "secret", RecipientID: "user_demo"},
	}}
	a.streamHub.deliver(sub, snapshot)
	if len(sub.events) != 1 {
		t.Fatalf("recipient bypass leaked an ordinary event: %d", len(sub.events))
	}
	if event := <-sub.events; event.Type != "resync" || event.ConversationID != "" || event.MessageID != "" {
		t.Fatalf("revocation was not sanitized: %+v", event)
	}
}

func TestPostgresConversationManagementPersistenceAndConcurrentOwnerTransfer(t *testing.T) {
	ctx, store, dsn := isolatedPostgres(t)
	a := seedPostgres(t, ctx, store)
	t.Cleanup(a.CloseStreams)
	h := a.Handler()
	admin, memberCookie := adminCookie(t, h), memberCookie(t, h)
	group := createdConversation(t, h, admin, "group", "user_demo", "user_friend")
	base := "/conversations/" + group.ID
	message := sent(t, h, admin, group.ID, "离开后历史保持完整", "management-pg-history")
	requireCode(t, call(t, h, "POST", base+"/read", map[string]string{"messageId": message.ID}, memberCookie), 200)
	peerStore, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(peerStore.Close)
	peer := NewApp(peerStore, a.cfg)
	t.Cleanup(peer.CloseStreams)
	server := httptest.NewServer(peer.Handler())
	t.Cleanup(server.Close)
	conn, _ := socket(t, server.URL, memberCookie, "")
	requireCode(t, call(t, h, "DELETE", base+"/members/user_demo", nil, admin), 200)
	event := receive(t, conn)
	if event.Type != "resync" || event.ConversationID != "" || event.MessageID != "" {
		t.Fatalf("cross-instance removal leaked private data: %+v", event)
	}
	var reads, messages int
	if err = peerStore.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_conversation_reads WHERE conversation_id=$1 AND user_id='user_demo'`, group.ID).Scan(&reads); err != nil || reads != 0 {
		t.Fatalf("read watermark CASCADE cleanup failed: %d %v", reads, err)
	}
	if err = peerStore.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_messages WHERE id=$1`, message.ID).Scan(&messages); err != nil || messages != 1 {
		t.Fatal("member removal deleted historical message")
	}
	requireCode(t, call(t, peer.Handler(), "GET", base, nil, memberCookie), 404)
	requireCode(t, call(t, h, "POST", base+"/members", map[string]any{"memberIds": []string{"user_demo"}}, admin), 200)
	requireCode(t, call(t, h, "POST", base+"/owner", map[string]string{"userId": "user_demo"}, admin), 200)
	if detail := payload[conversationDetails](t, call(t, peer.Handler(), "GET", base, nil, memberCookie)); detail.Conversation.OwnerID != "user_demo" || detail.Conversation.ReadSeq != 0 {
		t.Fatal("owner/read reset did not persist across repositories")
	}
	ids := []string{}
	for i := 0; i < 2; i++ {
		created := call(t, h, "POST", "/auth/register", map[string]string{"email": fmt.Sprintf("management%d@example.test", i), "password": "ManagementUser12345!", "name": fmt.Sprintf("管理成员%d", i), "handle": fmt.Sprintf("management%d", i)}, nil)
		requireCode(t, created, 201)
		ids = append(ids, payload[struct {
			User User `json:"user"`
		}](t, created).User.ID)
	}
	results := make(chan response, 2)
	var workers sync.WaitGroup
	for _, id := range ids {
		workers.Add(1)
		go func(id string) {
			defer workers.Done()
			results <- call(t, peer.Handler(), "POST", base+"/members", map[string]any{"memberIds": []string{id}}, memberCookie)
		}(id)
	}
	workers.Wait()
	for i := 0; i < 2; i++ {
		requireCode(t, <-results, 200)
	}
	detail := payload[conversationDetails](t, call(t, h, "GET", base, nil, memberCookie))
	if len(detail.Conversation.Members) != 5 || len(detail.MemberProfiles) != 5 {
		t.Fatal("concurrent member additions lost a member")
	}
	for _, id := range ids {
		workers.Add(1)
		go func(id string) {
			defer workers.Done()
			results <- call(t, peer.Handler(), "POST", base+"/owner", map[string]string{"userId": id}, memberCookie)
		}(id)
	}
	workers.Wait()
	success, denied := 0, 0
	for i := 0; i < 2; i++ {
		result := <-results
		if result.Code == 200 {
			success++
		} else if result.Code == 403 {
			denied++
		} else {
			t.Fatalf("unexpected transfer result: %d %v", result.Code, result.Error)
		}
	}
	if success != 1 || denied != 1 {
		t.Fatal("competing ownership transfers did not serialize")
	}
	final := payload[conversationDetails](t, call(t, h, "GET", base, nil, admin))
	if final.Conversation.OwnerID != ids[0] && final.Conversation.OwnerID != ids[1] {
		t.Fatal("invalid persisted owner")
	}
	requireCode(t, call(t, h, "PATCH", base, map[string]string{"title": "全局管理员不可越权"}, admin), 403)
}
