package platform

import (
	"bytes"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Test registration stays independent from routes.go, which the integrating
// agent owns. The production router calls the same registration helper.
func friendshipTestHandler(a *App) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/auth/login", a.login)
	mux.HandleFunc("POST /api/v1/auth/register", a.register)
	a.registerFriendshipRoutes(mux)
	return a.middleware(mux)
}
func friendshipFixture(t *testing.T) (*App, *memoryStore, http.Handler, *http.Cookie, *http.Cookie) {
	t.Helper()
	a, store, _ := fixture(t)
	account := store.state.Accounts["user_friend"]
	account.PasswordHash = hashPassword("Friend2026!", bcrypt.MinCost)
	store.state.Accounts["user_friend"] = account
	h := friendshipTestHandler(a)
	return a, store, h, memberCookie(t, h), loginAs(t, h, "zhouye@gongming.local", "Friend2026!")
}
func friendRequestCall(t *testing.T, h http.Handler, target string, cookie *http.Cookie) FriendRequest {
	t.Helper()
	res := call(t, h, "POST", "/friend-requests", map[string]string{"userId": target, "note": "我们一起去看展吧"}, cookie)
	requireCode(t, res, 200)
	return payload[FriendRequest](t, res)
}
func respondFriendCall(t *testing.T, h http.Handler, id, action string, cookie *http.Cookie) response {
	t.Helper()
	return call(t, h, "POST", "/friend-requests/"+id+"/respond", map[string]string{"action": action}, cookie)
}
func friendPage(t *testing.T, res response) ([]Friend, int) {
	t.Helper()
	requireCode(t, res, 200)
	page := payload[struct {
		Items []Friend `json:"items"`
		Total int      `json:"total"`
	}](t, res)
	return page.Items, page.Total
}
func TestFriendshipRequiresExplicitMutualAcceptance(t *testing.T) {
	_, store, h, from, to := friendshipFixture(t)
	items, total := friendPage(t, call(t, h, "GET", "/friends", nil, from))
	if len(items) != 0 || total != 0 {
		t.Fatal("seed directory/direct chats must not become friends")
	}
	relation := payload[Relationship](t, call(t, h, "GET", "/relationships/user_friend", nil, from))
	if relation.Status != "none" {
		t.Fatal("existing private conversation became friendship")
	}
	self := payload[Relationship](t, call(t, h, "GET", "/relationships/user_demo", nil, from))
	if self.Status != "self" {
		t.Fatal("self relationship")
	}
	first := friendRequestCall(t, h, "user_friend", from)
	second := friendRequestCall(t, h, "user_friend", from)
	if first.ID != second.ID || first.Status != "pending" {
		t.Fatal("same-direction duplicate must return original pending request")
	}
	requireCode(t, call(t, h, "POST", "/friend-requests", map[string]string{"userId": "user_demo"}, to), 409)
	outgoing := payload[Relationship](t, call(t, h, "GET", "/relationships/user_friend", nil, from))
	incoming := payload[Relationship](t, call(t, h, "GET", "/relationships/user_demo", nil, to))
	if outgoing.Status != "outgoing" || incoming.Status != "incoming" || incoming.Request.ID != first.ID {
		t.Fatal("directional relationship status")
	}
	requireCode(t, respondFriendCall(t, h, first.ID, "accept", to), 200)
	requireCode(t, respondFriendCall(t, h, first.ID, "accept", to), 200)
	requireCode(t, respondFriendCall(t, h, first.ID, "decline", to), 409)
	items, total = friendPage(t, call(t, h, "GET", "/friends", nil, from))
	if total != 1 || items[0].User.ID != "user_friend" {
		t.Fatal("accepted friend is not mutual")
	}
	items, total = friendPage(t, call(t, h, "GET", "/friends", nil, to))
	if total != 1 || items[0].User.ID != "user_demo" {
		t.Fatal("recipient did not receive mutual friendship")
	}
	if len(store.state.Friendships) != 1 {
		t.Fatal("idempotent accept duplicated friendship")
	}
	requireCode(t, call(t, h, "POST", "/friend-requests", map[string]string{"userId": "user_friend"}, from), 409)
	beforeMessages := len(store.state.Messages)
	beforeConversations := len(store.state.Conversations)
	requireCode(t, call(t, h, "DELETE", "/friends/user_friend", nil, from), 200)
	requireCode(t, call(t, h, "DELETE", "/friends/user_friend", nil, from), 200)
	if len(store.state.Friendships) != 0 || len(store.state.Messages) != beforeMessages || len(store.state.Conversations) != beforeConversations {
		t.Fatal("friend removal must not remove message history")
	}
	requireCode(t, respondFriendCall(t, h, first.ID, "accept", to), 200)
	if len(store.state.Friendships) != 0 {
		t.Fatal("replaying old accepted request resurrected removed friendship")
	}
	next := friendRequestCall(t, h, "user_friend", from)
	if next.ID == first.ID {
		t.Fatal("re-adding requires a new request")
	}
	requireCode(t, respondFriendCall(t, h, next.ID, "accept", to), 200)
}
func TestFriendRequestAuthorizationFiltersAndPublicProjection(t *testing.T) {
	_, _, h, from, to := friendshipFixture(t)
	admin := adminCookie(t, h)
	request := friendRequestCall(t, h, "user_friend", from)
	requireCode(t, respondFriendCall(t, h, request.ID, "accept", from), 403)
	requireCode(t, respondFriendCall(t, h, request.ID, "cancel", to), 403)
	requireCode(t, respondFriendCall(t, h, request.ID, "accept", admin), 404)
	requireCode(t, call(t, h, "GET", "/friends", nil, nil), 401)
	incoming := call(t, h, "GET", "/friend-requests", nil, to)
	requireCode(t, incoming, 200)
	page := payload[struct {
		Items []FriendRequest
		Total int
	}](t, incoming)
	if page.Total != 1 || page.Items[0].ID != request.ID {
		t.Fatal("incoming pending defaults")
	}
	page = payload[struct {
		Items []FriendRequest
		Total int
	}](t, call(t, h, "GET", "/friend-requests?direction=outgoing", nil, from))
	if page.Total != 1 {
		t.Fatal("outgoing request not visible")
	}
	page = payload[struct {
		Items []FriendRequest
		Total int
	}](t, call(t, h, "GET", "/friend-requests?direction=outgoing", nil, to))
	if page.Total != 0 {
		t.Fatal("unrelated outgoing records leaked")
	}
	for _, path := range []string{"/friend-requests?direction=all", "/friend-requests?status=all", "/friend-requests?limit=0", "/friends?limit=101"} {
		requireCode(t, call(t, h, "GET", path, nil, from), 400)
	}
	for _, res := range []response{incoming, call(t, h, "GET", "/relationships/user_friend", nil, from), respondFriendCall(t, h, request.ID, "accept", to), call(t, h, "GET", "/friends", nil, from)} {
		requireCode(t, res, 200)
		for _, sensitive := range []string{`"email"`, `"role"`, `"passwordHash"`, `"status":"active"`} {
			if bytes.Contains(res.Data, []byte(sensitive)) {
				t.Fatalf("friend response leaked %s", sensitive)
			}
		}
	}
}
func TestFriendRequestDeclineCancelAndActiveAccountRules(t *testing.T) {
	_, store, h, from, to := friendshipFixture(t)
	requireCode(t, call(t, h, "POST", "/friend-requests", map[string]string{"userId": "user_demo"}, from), 400)
	requireCode(t, call(t, h, "POST", "/friend-requests", map[string]string{"userId": "missing"}, from), 404)
	requireCode(t, call(t, h, "POST", "/friend-requests", map[string]string{"userId": "user_friend", "note": strings.Repeat("字", 301)}, from), 400)
	first := friendRequestCall(t, h, "user_friend", from)
	requireCode(t, respondFriendCall(t, h, first.ID, "decline", to), 200)
	requireCode(t, respondFriendCall(t, h, first.ID, "decline", to), 200)
	requireCode(t, respondFriendCall(t, h, first.ID, "accept", to), 409)
	second := friendRequestCall(t, h, "user_friend", from)
	requireCode(t, respondFriendCall(t, h, second.ID, "cancel", from), 200)
	requireCode(t, respondFriendCall(t, h, second.ID, "cancel", from), 200)
	requireCode(t, respondFriendCall(t, h, second.ID, "accept", to), 409)
	third := friendRequestCall(t, h, "user_friend", from)
	account := store.state.Accounts["user_demo"]
	account.User.Status = "suspended"
	store.state.Accounts["user_demo"] = account
	requireCode(t, respondFriendCall(t, h, third.ID, "accept", to), 404)
	requireCode(t, respondFriendCall(t, h, third.ID, "decline", to), 200)
	requireCode(t, call(t, h, "POST", "/friend-requests", map[string]string{"userId": "user_demo"}, to), 404)
	requireCode(t, call(t, h, "GET", "/relationships/user_demo", nil, to), 404)
	requireCode(t, call(t, h, "GET", "/friends", nil, from), 401)
}
func TestFriendshipStableOrderingAndSearch(t *testing.T) {
	a, store, h, from, to := friendshipFixture(t)
	same := time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)
	a.now = func() time.Time { return same }
	admin := adminCookie(t, h)
	first := friendRequestCall(t, h, "user_friend", from)
	second := friendRequestCall(t, h, "user_admin", from)
	requireCode(t, respondFriendCall(t, h, first.ID, "accept", to), 200)
	requireCode(t, respondFriendCall(t, h, second.ID, "accept", admin), 200)
	items, total := friendPage(t, call(t, h, "GET", "/friends?limit=1", nil, from))
	if total != 2 || len(items) != 1 || items[0].User.ID != "user_admin" {
		t.Fatal("friends ordering is not stable since DESC/user ID ASC")
	}
	items, total = friendPage(t, call(t, h, "GET", "/friends?q=zhouye", nil, from))
	if total != 1 || items[0].User.ID != "user_friend" {
		t.Fatal("friend search")
	}
	page := payload[struct {
		Items []FriendRequest
		Total int
	}](t, call(t, h, "GET", "/friend-requests?direction=outgoing&status=accepted", nil, from))
	if page.Total != 2 || page.Items[0].ID > page.Items[1].ID {
		t.Fatal("request ordering tie is not ID ASC")
	}
	account := store.state.Accounts["user_friend"]
	account.User.Status = "suspended"
	store.state.Accounts["user_friend"] = account
	_, total = friendPage(t, call(t, h, "GET", "/friends", nil, from))
	if total != 1 {
		t.Fatal("friend list must hide suspended account")
	}
	requireCode(t, call(t, h, "DELETE", "/friends/user_friend", nil, from), 200)
}
func TestConcurrentFriendAcceptAndCancelConverge(t *testing.T) {
	_, store, h, from, to := friendshipFixture(t)
	request := friendRequestCall(t, h, "user_friend", from)
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for _, actor := range []struct {
		cookie *http.Cookie
		action string
	}{{to, "accept"}, {from, "cancel"}} {
		wg.Add(1)
		go func(cookie *http.Cookie, action string) {
			defer wg.Done()
			codes <- respondFriendCall(t, h, request.ID, action, cookie).Code
		}(actor.cookie, actor.action)
	}
	wg.Wait()
	close(codes)
	success, conflicts := 0, 0
	for code := range codes {
		if code == 200 {
			success++
		} else if code == 409 {
			conflicts++
		} else {
			t.Fatalf("unexpected response %d", code)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatal("two conflicting terminal decisions both committed")
	}
	stored := store.state.FriendRequests[request.ID]
	_, friends := store.state.Friendships[friendshipKey("user_demo", "user_friend")]
	if friends != (stored.Status == "accepted") {
		t.Fatal("request decision and friendship diverged")
	}
}
