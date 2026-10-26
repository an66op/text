package platform

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func privacy(t *testing.T, h http.Handler, cookie *http.Cookie) ContactPrivacy {
	t.Helper()
	r := call(t, h, "GET", "/me/contact-privacy", nil, cookie)
	requireCode(t, r, 200)
	return payload[ContactPrivacy](t, r)
}
func savePrivacy(t *testing.T, h http.Handler, cookie *http.Cookie, p ContactPrivacy) ContactPrivacy {
	t.Helper()
	r := call(t, h, "PUT", "/me/contact-privacy", map[string]any{"directMessagePolicy": p.DirectMessagePolicy, "groupInvitePolicy": p.GroupInvitePolicy, "allowFriendRequests": p.AllowFriendRequests, "discoverableByHandle": p.DiscoverableByHandle, "revision": p.Revision}, cookie)
	requireCode(t, r, 200)
	return payload[ContactPrivacy](t, r)
}

type blockReceipt struct {
	OK        bool       `json:"ok"`
	UserID    string     `json:"userId"`
	Blocked   bool       `json:"blocked"`
	Revision  int64      `json:"revision"`
	UpdatedAt *time.Time `json:"updatedAt"`
}

func blockContact(t *testing.T, h http.Handler, cookie *http.Cookie, id string, revision int64, blocked bool) blockReceipt {
	t.Helper()
	method := "PUT"
	if !blocked {
		method = "DELETE"
	}
	r := call(t, h, method, "/me/blocks/"+id, map[string]int64{"revision": revision}, cookie)
	requireCode(t, r, 200)
	var shape map[string]any
	_ = json.Unmarshal(r.Data, &shape)
	if len(shape) != 5 {
		t.Fatal("block receipt contract", shape)
	}
	return payload[blockReceipt](t, r)
}
func contactCaps(t *testing.T, h http.Handler, cookie *http.Cookie, id string) ContactCapabilities {
	t.Helper()
	r := call(t, h, "GET", "/contact-capabilities/"+id, nil, cookie)
	requireCode(t, r, 200)
	return payload[ContactCapabilities](t, r)
}
func directContact(t *testing.T, h http.Handler, cookie *http.Cookie, id string) Conversation {
	t.Helper()
	r := call(t, h, "POST", "/conversations", map[string]any{"title": "联系测试", "kind": "direct", "memberIds": []string{id}}, cookie)
	requireCode(t, r, 200)
	return payload[Conversation](t, r)
}
func acceptContactFriend(t *testing.T, h http.Handler, from, to *http.Cookie, id string) FriendRequest {
	t.Helper()
	r := call(t, h, "POST", "/friend-requests", map[string]string{"userId": id, "note": "联系服务真实请求"}, from)
	requireCode(t, r, 200)
	request := payload[FriendRequest](t, r)
	res := call(t, h, "POST", "/friend-requests/"+request.ID+"/respond", map[string]string{"action": "accept"}, to)
	requireCode(t, res, 200)
	return payload[FriendRequest](t, res)
}
func requireContactDenied(t *testing.T, r response) {
	t.Helper()
	requireCode(t, r, 403)
	if r.Error == nil || r.Error.Code != "contact_restricted" || r.Error.Message != "当前联系权限不允许此操作" {
		t.Fatalf("private denial leaked %+v", r.Error)
	}
}
func TestContactPrivacyPostgresDefaultsCASAndPrivateProjection(t *testing.T) {
	ctx, s, _, _, h := postgresMediaFixture(t)
	a := memberCookie(t, h)
	admin := adminCookie(t, h)
	var count int
	for _, path := range []string{"/me/contact-privacy", "/me/blocks", "/contact-capabilities/user_friend", "/conversations", "/directory", "/users/zhouye"} {
		requireCode(t, call(t, h, "GET", path, nil, a), 200)
	}
	if e := s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_contact_preferences`).Scan(&count); e != nil || count != 0 {
		t.Fatal("read created defaults", count, e)
	}
	p := privacy(t, h, a)
	if p.Revision != 0 || p.UpdatedAt != nil || p.DirectMessagePolicy != "everyone" || !p.AllowFriendRequests {
		t.Fatal(p)
	}
	same := savePrivacy(t, h, a, p)
	if same.Revision != 0 || same.UpdatedAt != nil {
		t.Fatal("noop advanced", same)
	}
	p.DirectMessagePolicy = "friends"
	p.GroupInvitePolicy = "nobody"
	p.DiscoverableByHandle = false
	p = savePrivacy(t, h, a, p)
	if p.Revision != 1 || p.UpdatedAt == nil {
		t.Fatal(p)
	}
	old := p
	old.Revision = 0
	r := call(t, h, "PUT", "/me/contact-privacy", map[string]any{"directMessagePolicy": old.DirectMessagePolicy, "groupInvitePolicy": old.GroupInvitePolicy, "allowFriendRequests": old.AllowFriendRequests, "discoverableByHandle": old.DiscoverableByHandle, "revision": old.Revision}, a)
	requireCode(t, r, 409)
	if r.Error.Code != "privacy_conflict" {
		t.Fatal(r.Error)
	}
	requireCode(t, call(t, h, "PUT", "/me/contact-privacy", map[string]any{"revision": 1, "directMessagePolicy": "everyone"}, a), 400)
	own := payload[ContactPrivacy](t, call(t, h, "GET", "/me/contact-privacy?userId=user_demo", nil, admin))
	if own.Revision != 0 || own.DirectMessagePolicy != "everyone" {
		t.Fatal("privacy IDOR")
	}
	for _, path := range []string{"/admin/users", "/admin/overview", "/admin/audit"} {
		res := call(t, h, "GET", path, nil, admin)
		requireCode(t, res, 200)
		for _, field := range []string{"directMessagePolicy", "groupInvitePolicy", "guard_version", "blockedByMe", "discoverableByHandle"} {
			if bytes.Contains(res.Data, []byte(field)) {
				t.Fatal("operator private-field disclosure", path, field)
			}
		}
	}
}
func TestContactPrivacyPostgresInboundPoliciesAndHistoricalConfirmation(t *testing.T) {
	_, _, _, _, h := postgresMediaFixture(t)
	a := memberCookie(t, h)
	b, bc := circleUser(t, h, "contactpolicyb")
	c := directContact(t, h, a, b.ID)
	first := payload[Message](t, call(t, h, "POST", "/conversations/"+c.ID+"/messages", map[string]string{"body": "已提交确认", "clientId": "contact-known-message"}, a))
	uploaded := uploadChatImage(t, h, c.ID, "contact-known-upload", a)
	requireCode(t, uploaded, 201)
	asset := payload[MediaAsset](t, uploaded)
	p := privacy(t, h, bc)
	p.DirectMessagePolicy = "nobody"
	p = savePrivacy(t, h, bc, p)
	requireContactDenied(t, call(t, h, "POST", "/conversations/"+c.ID+"/messages", map[string]string{"body": "new", "clientId": "contact-denied-message"}, a))
	requireContactDenied(t, uploadChatImage(t, h, c.ID, "contact-denied-upload", a))
	retry := call(t, h, "POST", "/conversations/"+c.ID+"/messages", map[string]string{"body": "已提交确认", "clientId": "contact-known-message"}, a)
	requireCode(t, retry, 200)
	if payload[Message](t, retry).ID != first.ID {
		t.Fatal("confirmation changed")
	}
	requireCode(t, uploadChatImage(t, h, c.ID, "contact-known-upload", a), 200)
	for _, path := range []string{"/conversations/" + c.ID, "/conversations/" + c.ID + "/messages", "/conversations/" + c.ID + "/messages/" + first.ID, "/conversations/" + c.ID + "/messages/by-client/contact-known-message"} {
		requireCode(t, call(t, h, "GET", path, nil, a), 200)
	}
	detail := payload[struct{ Conversation Conversation }](t, call(t, h, "GET", "/conversations/"+c.ID, nil, a))
	if detail.Conversation.CanSend {
		t.Fatal("history incorrectly writable")
	}
	reused := directContact(t, h, a, b.ID)
	if reused.ID != c.ID || reused.CanSend {
		t.Fatal("reuse did not preserve read-only history")
	}
	// Own inbound nobody does not prohibit outbound to an everyone recipient.
	requireCode(t, call(t, h, "POST", "/conversations/"+c.ID+"/messages", map[string]string{"body": "outbound allowed"}, bc), 200)
	if readMedia(t, h, "GET", asset.URL, a).Code != 200 {
		t.Fatal("historical owner preview denied")
	}
	requireCode(t, call(t, h, "DELETE", "/me/messages/"+first.ID, nil, a), 200)
	p.DirectMessagePolicy = "friends"
	p = savePrivacy(t, h, bc, p)
	if contactCaps(t, h, a, b.ID).CanMessage {
		t.Fatal("direct membership treated as friendship")
	}
	acceptContactFriend(t, h, a, bc, b.ID)
	if !contactCaps(t, h, a, b.ID).CanMessage {
		t.Fatal("accepted friends denied")
	}
	requireCode(t, call(t, h, "POST", "/conversations/"+c.ID+"/messages", map[string]string{"body": "friend allowed"}, a), 200)
	requireCode(t, call(t, h, "DELETE", "/friends/"+b.ID, nil, a), 200)
	requireContactDenied(t, call(t, h, "POST", "/conversations/"+c.ID+"/messages", map[string]string{"body": "removed friend denied"}, a))
}
func TestContactPrivacyPostgresBlocksPreserveFriendsAndCancelPending(t *testing.T) {
	_, _, _, _, h := postgresMediaFixture(t)
	a := memberCookie(t, h)
	b, bc := circleUser(t, h, "contactblockb")
	accepted := acceptContactFriend(t, h, a, bc, b.ID)
	receipt := blockContact(t, h, a, b.ID, 0, true)
	if receipt.Revision != 1 || !receipt.Blocked {
		t.Fatal(receipt)
	}
	relationship := payload[Relationship](t, call(t, h, "GET", "/relationships/"+b.ID, nil, a))
	if relationship.Status != "friends" {
		t.Fatal("block removed accepted friendship")
	}
	cap := contactCaps(t, h, bc, "user_demo")
	if cap.BlockedByMe || cap.CanMessage || cap.CanInvite || cap.CanRequestFriend {
		t.Fatal("reverse private capability", cap)
	}
	same := blockContact(t, h, a, b.ID, 1, true)
	if same.Revision != 1 || !same.UpdatedAt.Equal(*receipt.UpdatedAt) {
		t.Fatal("noop modified receipt")
	}
	stale := call(t, h, "PUT", "/me/blocks/"+b.ID, map[string]int64{"revision": 0}, a)
	requireCode(t, stale, 409)
	if stale.Error.Code != "privacy_conflict" {
		t.Fatal(stale.Error)
	}
	requireCode(t, call(t, h, "DELETE", "/friends/"+b.ID, nil, a), 200)
	unblocked := blockContact(t, h, a, b.ID, 1, false)
	if unblocked.Revision != 2 {
		t.Fatal(unblocked)
	}
	requireCode(t, call(t, h, "POST", "/friend-requests/"+accepted.ID+"/respond", map[string]string{"action": "accept"}, bc), 200)
	if payload[Relationship](t, call(t, h, "GET", "/relationships/"+b.ID, nil, a)).Status != "none" {
		t.Fatal("old accepted receipt restored removed friendship")
	}
	pending := payload[FriendRequest](t, call(t, h, "POST", "/friend-requests", map[string]string{"userId": b.ID}, a))
	blockContact(t, h, bc, "user_demo", 0, true)
	incoming := payload[struct{ Items []FriendRequest }](t, call(t, h, "GET", "/friend-requests?status=cancelled", nil, bc))
	if len(incoming.Items) != 1 || incoming.Items[0].ID != pending.ID {
		t.Fatal("pending not atomically cancelled")
	}
	requireCode(t, call(t, h, "POST", "/friend-requests/"+pending.ID+"/respond", map[string]string{"action": "accept"}, bc), 409)
	requireContactDenied(t, call(t, h, "POST", "/friend-requests", map[string]string{"userId": b.ID}, a))
	blockContact(t, h, bc, "user_demo", 1, false)
	if payload[Relationship](t, call(t, h, "GET", "/relationships/"+b.ID, nil, a)).Status != "none" {
		t.Fatal("unblock restored pending")
	}
}
func TestContactPrivacyPostgresRequestsDisabledAndDiscovery(t *testing.T) {
	_, _, _, _, h := postgresMediaFixture(t)
	a := memberCookie(t, h)
	b, bc := circleUser(t, h, "contactdiscoverb")
	request := payload[FriendRequest](t, call(t, h, "POST", "/friend-requests", map[string]string{"userId": b.ID}, a))
	p := privacy(t, h, bc)
	p.AllowFriendRequests = false
	p.DiscoverableByHandle = false
	p = savePrivacy(t, h, bc, p)
	requireCode(t, call(t, h, "GET", "/users/"+b.Handle, nil, a), 404)
	directory := payload[struct{ Total int }](t, call(t, h, "GET", "/directory?q="+b.ID, nil, a))
	if directory.Total != 0 {
		t.Fatal("hidden directory target")
	}
	requireCode(t, call(t, h, "GET", "/users/"+b.Handle, nil, bc), 200)
	requireCode(t, call(t, h, "POST", "/friend-requests/"+request.ID+"/respond", map[string]string{"action": "accept"}, bc), 200)
	requireCode(t, call(t, h, "GET", "/users/"+b.Handle, nil, a), 200)
	directory = payload[struct{ Total int }](t, call(t, h, "GET", "/directory?q="+b.ID, nil, a))
	if directory.Total != 1 {
		t.Fatal("friend discovery denied")
	}
	requireCode(t, call(t, h, "DELETE", "/friends/"+b.ID, nil, a), 200)
	requireContactDenied(t, call(t, h, "POST", "/friend-requests", map[string]string{"userId": b.ID}, a))
}
func TestContactPrivacyPostgresInvitationBatchAndSharedSpaces(t *testing.T) {
	_, _, _, _, h := postgresMediaFixture(t)
	a := memberCookie(t, h)
	b, bc := circleUser(t, h, "contactinviteb")
	c, cc := circleUser(t, h, "contactinvitec")
	p := privacy(t, h, bc)
	p.GroupInvitePolicy = "friends"
	savePrivacy(t, h, bc, p)
	body := map[string]any{"title": "批次", "kind": "group", "memberIds": []string{c.ID, b.ID}}
	requireContactDenied(t, call(t, h, "POST", "/conversations", body, a))
	acceptContactFriend(t, h, a, bc, b.ID)
	group := payload[Conversation](t, call(t, h, "POST", "/conversations", body, a))
	if !group.CanSend {
		t.Fatal("group canSend")
	}
	blockContact(t, h, a, b.ID, 0, true)
	requireCode(t, call(t, h, "POST", "/conversations/"+group.ID+"/messages", map[string]string{"body": "shared members still talk"}, a), 200)
	requireCode(t, call(t, h, "POST", "/conversations/"+group.ID+"/messages", map[string]string{"body": "shared members still reply"}, bc), 200)
	requireCode(t, call(t, h, "POST", "/conversations/"+group.ID+"/members", map[string]any{"memberIds": []string{b.ID}}, a), 200)
	// A third party may invite both blocked users if each permits that inviter.
	p = privacy(t, h, bc)
	p.GroupInvitePolicy = "everyone"
	savePrivacy(t, h, bc, p)
	third := payload[Conversation](t, call(t, h, "POST", "/conversations", map[string]any{"title": "共同空间独立", "kind": "channel", "memberIds": []string{"user_demo", b.ID}}, cc))
	if !third.CanSend {
		t.Fatal("channel owner denied")
	}
	other := payload[Conversation](t, call(t, h, "POST", "/conversations", map[string]any{"title": "atomic add", "kind": "group", "memberIds": []string{c.ID}}, a))
	requireContactDenied(t, call(t, h, "POST", "/conversations/"+other.ID+"/members", map[string]any{"memberIds": []string{b.ID}}, a))
}
func TestContactPrivacyPostgresNotificationRedactionAndResync(t *testing.T) {
	ctx, s, _, a, h := postgresMediaFixture(t)
	ac := memberCookie(t, h)
	b, bc := circleUser(t, h, "contactnoticeb")
	request := payload[FriendRequest](t, call(t, h, "POST", "/friend-requests", map[string]string{"userId": b.ID, "note": "private request note"}, ac))
	before := payload[NotificationsPage](t, call(t, h, "GET", "/notifications?category=requests", nil, bc))
	if len(before.Items) != 1 || !before.Items[0].Available {
		t.Fatal(before)
	}
	blockContact(t, h, ac, b.ID, 0, true)
	after := payload[NotificationsPage](t, call(t, h, "GET", "/notifications?category=requests", nil, bc))
	if len(after.Items) != 1 || after.Items[0].Available || after.Items[0].Actor != nil || after.Items[0].Context != nil || after.Items[0].Target != nil {
		t.Fatal("friend notification leaked", after)
	}
	snapshot, e := s.ReadStream(ctx, []StreamRequest{{SessionHash: tokenHash(bc.Value), UserID: b.ID}}, 512)
	if e != nil {
		t.Fatal(e)
	}
	count := 0
	for _, event := range snapshot.Events {
		if event.Type == "contact.resync" {
			count++
			if event.ConversationID != "" || event.MessageID != "" || event.RecipientID != b.ID {
				t.Fatal("private resync row payload", event)
			}
		}
	}
	if count != 1 {
		t.Fatal("missing targeted resync", snapshot)
	}
	// No account/relationship fields are projected onto the generic wire event.
	sub := &streamSubscriber{request: StreamRequest{SessionHash: tokenHash(bc.Value), UserID: b.ID}, events: make(chan StreamEvent, 64), stop: make(chan streamClose, 1)}
	a.streamHub.deliver(sub, snapshot)
	select {
	case event := <-sub.events:
		raw, _ := json.Marshal(event)
		if event.Type != "resync" || bytes.Contains(raw, []byte("conversationId")) || bytes.Contains(raw, []byte("userId")) {
			t.Fatal("wire private leak", string(raw))
		}
	default:
		t.Fatal("no resync delivered")
	}
	var status string
	if e = s.pool.QueryRow(ctx, `SELECT status FROM gongming_friend_requests WHERE id=$1`, request.ID).Scan(&status); e != nil || status != "cancelled" {
		t.Fatal(status, e)
	}
}
