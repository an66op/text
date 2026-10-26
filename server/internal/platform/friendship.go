package platform

import (
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// Friendships are explicit mutual relationships. A directory entry, channel
// subscription or existing direct conversation never creates a friendship.
type StoredFriendRequest struct {
	ID        string    `json:"id"`
	FromID    string    `json:"fromId"`
	ToID      string    `json:"toId"`
	Note      string    `json:"note"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
type FriendRequest struct {
	ID        string     `json:"id"`
	From      PublicUser `json:"from"`
	To        PublicUser `json:"to"`
	Note      string     `json:"note"`
	Status    string     `json:"status"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
}
type StoredFriendship struct {
	UserA string    `json:"userA"`
	UserB string    `json:"userB"`
	Since time.Time `json:"since"`
}
type Friend struct {
	User  PublicUser `json:"user"`
	Since time.Time  `json:"since"`
}
type Relationship struct {
	Status  string         `json:"status"`
	Request *FriendRequest `json:"request,omitempty"`
	Since   *time.Time     `json:"since,omitempty"`
}

func (a *App) friendshipNow() time.Time { return a.now().UTC().Truncate(time.Microsecond) }

func canonicalFriendPair(first, second string) (string, string) {
	if first < second {
		return first, second
	}
	return second, first
}
func friendshipKey(first, second string) string {
	a, b := canonicalFriendPair(first, second)
	return a + ":" + b
}
func (s *State) friendRequest(request StoredFriendRequest) FriendRequest {
	return FriendRequest{request.ID, publicUser(s.Accounts[request.FromID].User), publicUser(s.Accounts[request.ToID].User), request.Note, request.Status, request.CreatedAt.UTC(), request.UpdatedAt.UTC()}
}
func activeFriendTarget(s *State, id string) (User, error) {
	if id == "" || len(id) > 128 {
		return User{}, bad("成员标识不正确")
	}
	account, exists := s.Accounts[id]
	if !exists || account.User.Status != "active" {
		return User{}, missing("成员不存在或已停用")
	}
	return account.User, nil
}
func pendingFriendRequest(s *State, first, second string) (StoredFriendRequest, bool) {
	for _, request := range s.FriendRequests {
		if request.Status == "pending" && friendshipKey(request.FromID, request.ToID) == friendshipKey(first, second) {
			return request, true
		}
	}
	return StoredFriendRequest{}, false
}
func (a *App) registerFriendshipRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/friends", a.endpoint(false, "member", a.friends))
	mux.HandleFunc("GET /api/v1/friend-requests", a.endpoint(false, "member", a.friendRequests))
	mux.HandleFunc("POST /api/v1/friend-requests", a.endpoint(true, "member", a.createFriendRequest))
	mux.HandleFunc("POST /api/v1/friend-requests/{id}/respond", a.endpoint(true, "member", a.respondFriendRequest))
	mux.HandleFunc("GET /api/v1/relationships/{userId}", a.endpoint(false, "member", a.relationship))
	mux.HandleFunc("DELETE /api/v1/friends/{userId}", a.endpoint(true, "member", a.removeFriend))
}
func (a *App) friends(s *State, u *User, r *http.Request) (any, error) {
	items := []Friend{}
	for _, relationship := range s.Friendships {
		other := ""
		if relationship.UserA == u.ID {
			other = relationship.UserB
		} else if relationship.UserB == u.ID {
			other = relationship.UserA
		} else {
			continue
		}
		account, exists := s.Accounts[other]
		if !exists || account.User.Status != "active" || !matches(r, account.User.Name+" "+account.User.Handle+" "+account.User.ID) {
			continue
		}
		items = append(items, Friend{publicUser(account.User), relationship.Since.UTC()})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Since.Equal(items[j].Since) {
			return items[i].User.ID < items[j].User.ID
		}
		return items[i].Since.After(items[j].Since)
	})
	return list(r, items)
}
func (a *App) friendRequests(s *State, u *User, r *http.Request) (any, error) {
	direction, err := queryEnum(r, "direction", "incoming", "outgoing")
	if err != nil {
		return nil, err
	}
	if direction == "" {
		direction = "incoming"
	}
	status, err := queryEnum(r, "status", "pending", "accepted", "declined", "cancelled")
	if err != nil {
		return nil, err
	}
	if status == "" {
		status = "pending"
	}
	items := []FriendRequest{}
	for _, request := range s.FriendRequests {
		if request.Status != status || direction == "incoming" && request.ToID != u.ID || direction == "outgoing" && request.FromID != u.ID {
			continue
		}
		from, fromExists := s.Accounts[request.FromID]
		to, toExists := s.Accounts[request.ToID]
		if !fromExists || !toExists || !matches(r, from.User.Name+" "+from.User.Handle+" "+to.User.Name+" "+to.User.Handle+" "+request.Note) {
			continue
		}
		items = append(items, s.friendRequest(request))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})
	return list(r, items)
}
func (a *App) createFriendRequest(s *State, u *User, r *http.Request) (any, error) {
	var input struct {
		UserID string `json:"userId"`
		Note   string `json:"note"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	input.UserID = strings.TrimSpace(input.UserID)
	input.Note = strings.TrimSpace(input.Note)
	if utf8.RuneCountInString(input.Note) > 300 {
		return nil, bad("好友申请备注最多 300 字")
	}
	target, err := activeFriendTarget(s, input.UserID)
	if err != nil {
		return nil, err
	}
	if target.ID == u.ID {
		return nil, bad("不能向自己发送好友申请")
	}
	if _, exists := s.Friendships[friendshipKey(u.ID, target.ID)]; exists {
		return nil, conflict("你们已经是好友")
	}
	if existing, pending := pendingFriendRequest(s, u.ID, target.ID); pending {
		if existing.FromID == u.ID {
			return s.friendRequest(existing), nil
		}
		return nil, conflict("对方已向你发送好友申请，请先处理收到的申请")
	}
	now := a.friendshipNow()
	request := StoredFriendRequest{newID("friend_request_"), u.ID, target.ID, input.Note, "pending", now, now}
	if s.FriendRequests == nil {
		s.FriendRequests = map[string]StoredFriendRequest{}
	}
	s.FriendRequests[request.ID] = request
	return s.friendRequest(request), nil
}
func (a *App) respondFriendRequest(s *State, u *User, r *http.Request) (any, error) {
	request, exists := s.FriendRequests[r.PathValue("id")]
	if !exists || request.FromID != u.ID && request.ToID != u.ID {
		return nil, missing("好友申请不存在")
	}
	var input struct {
		Action string `json:"action"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	next := ""
	switch input.Action {
	case "accept":
		next = "accepted"
	case "decline":
		next = "declined"
	case "cancel":
		next = "cancelled"
	default:
		return nil, bad("请选择 accept、decline 或 cancel")
	}
	if input.Action == "cancel" && request.FromID != u.ID || input.Action != "cancel" && request.ToID != u.ID {
		return nil, forbidden("你无权执行此申请操作")
	}
	if request.Status != "pending" {
		if request.Status == next {
			return s.friendRequest(request), nil
		}
		return nil, conflict("此好友申请已处理，请刷新查看结果")
	}
	if input.Action == "accept" {
		if _, err := activeFriendTarget(s, request.FromID); err != nil {
			return nil, err
		}
		if _, err := activeFriendTarget(s, request.ToID); err != nil {
			return nil, err
		}
		first, second := canonicalFriendPair(request.FromID, request.ToID)
		key := friendshipKey(first, second)
		if s.Friendships == nil {
			s.Friendships = map[string]StoredFriendship{}
		}
		if _, exists := s.Friendships[key]; !exists {
			s.Friendships[key] = StoredFriendship{first, second, a.friendshipNow()}
		}
	}
	request.Status = next
	request.UpdatedAt = a.friendshipNow()
	s.FriendRequests[request.ID] = request
	return s.friendRequest(request), nil
}
func (a *App) relationship(s *State, u *User, r *http.Request) (any, error) {
	target, err := activeFriendTarget(s, r.PathValue("userId"))
	if err != nil {
		return nil, err
	}
	if target.ID == u.ID {
		return Relationship{Status: "self"}, nil
	}
	if friendship, exists := s.Friendships[friendshipKey(u.ID, target.ID)]; exists {
		since := friendship.Since.UTC()
		return Relationship{Status: "friends", Since: &since}, nil
	}
	if request, exists := pendingFriendRequest(s, u.ID, target.ID); exists {
		result := s.friendRequest(request)
		status := "incoming"
		if request.FromID == u.ID {
			status = "outgoing"
		}
		return Relationship{Status: status, Request: &result}, nil
	}
	return Relationship{Status: "none"}, nil
}
func (a *App) removeFriend(s *State, u *User, r *http.Request) (any, error) {
	id := r.PathValue("userId")
	if id == "" || len(id) > 128 {
		return nil, bad("成员标识不正确")
	}
	if id == u.ID {
		return nil, bad("不能移除自己")
	}
	delete(s.Friendships, friendshipKey(u.ID, id))
	return map[string]bool{"ok": true}, nil
}
