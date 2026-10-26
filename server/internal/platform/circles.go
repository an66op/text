package platform

import (
	"encoding/json"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

type Circle struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Cover       string     `json:"cover"`
	Icon        string     `json:"icon"`
	Category    string     `json:"category"`
	Visibility  string     `json:"visibility"`
	JoinPolicy  string     `json:"joinPolicy"`
	Status      string     `json:"status"`
	Owner       PublicUser `json:"owner"`
	Role        string     `json:"role"`
	Membership  string     `json:"membership"`
	MemberCount int        `json:"memberCount"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}
type CircleMember struct {
	User     PublicUser `json:"user"`
	Role     string     `json:"role"`
	Status   string     `json:"status"`
	JoinedAt time.Time  `json:"joinedAt"`
}
type CircleJoinRequest struct {
	ID        string     `json:"id"`
	Circle    Circle     `json:"circle"`
	User      PublicUser `json:"user"`
	Note      string     `json:"note"`
	Status    string     `json:"status"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
}
type CircleJoinResult struct {
	Status  string             `json:"status"`
	Circle  Circle             `json:"circle"`
	Request *CircleJoinRequest `json:"request,omitempty"`
}
type CircleChannel struct {
	ID          string    `json:"id"`
	CircleID    string    `json:"circleId"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Kind        string    `json:"kind"`
	Access      string    `json:"access"`
	Archived    bool      `json:"archived"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
type CirclePost struct {
	ID           string     `json:"id"`
	CircleID     string     `json:"circleId"`
	ChannelID    string     `json:"channelId"`
	Author       PublicUser `json:"author"`
	Title        string     `json:"title"`
	Body         string     `json:"body"`
	Images       []string   `json:"images"`
	Status       string     `json:"status"`
	Featured     bool       `json:"featured"`
	Pinned       bool       `json:"pinned"`
	LikeCount    int        `json:"likeCount"`
	Liked        bool       `json:"liked"`
	CommentCount int        `json:"commentCount"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}
type CircleComment struct {
	ID        string     `json:"id"`
	PostID    string     `json:"postId"`
	Author    PublicUser `json:"author"`
	Body      string     `json:"body"`
	CreatedAt time.Time  `json:"createdAt"`
}
type CircleInvite struct {
	ID        string    `json:"id"`
	CircleID  string    `json:"circleId"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `json:"expiresAt"`
	MaxUses   int       `json:"maxUses"`
	Uses      int       `json:"uses"`
	Revoked   bool      `json:"revoked"`
}
type AdminCircle struct {
	Circle
	ChannelCount   int    `json:"channelCount"`
	PostCount      int    `json:"postCount"`
	ModerationNote string `json:"moderationNote"`
}
type AdminCirclePost struct {
	CirclePost
	CircleName     string `json:"circleName"`
	ChannelName    string `json:"channelName"`
	ModerationNote string `json:"moderationNote"`
}

func (a *App) circleNow() time.Time { return a.now().UTC().Truncate(time.Microsecond) }
func circleStaff(role string) bool  { return role == "owner" || role == "admin" }
func activeCircleMember(s *State, circle, user string) (StoredCircleMember, bool) {
	v, ok := s.CircleMembers[circleMemberKey(circle, user)]
	return v, ok && v.Status == "active"
}
func circlePending(s *State, circle, user string) (StoredCircleJoinRequest, bool) {
	for _, v := range s.CircleJoinRequests {
		if v.CircleID == circle && v.UserID == user && v.Status == "pending" {
			return v, true
		}
	}
	return StoredCircleJoinRequest{}, false
}
func (s *State) circle(c StoredCircle, viewer string) Circle {
	result := Circle{ID: c.ID, Name: c.Name, Description: c.Description, Cover: c.Cover, Icon: c.Icon, Category: c.Category, Visibility: c.Visibility, JoinPolicy: c.JoinPolicy, Status: c.Status, Owner: publicUser(s.Accounts[c.OwnerID].User), Role: "guest", Membership: "none", CreatedAt: c.CreatedAt.UTC(), UpdatedAt: c.UpdatedAt.UTC()}
	for _, v := range s.CircleMembers {
		if v.CircleID == c.ID && v.Status == "active" {
			result.MemberCount++
		}
	}
	if v, ok := s.CircleMembers[circleMemberKey(c.ID, viewer)]; ok {
		if v.Status == "active" {
			result.Role, result.Membership = v.Role, "active"
		} else if v.Status == "banned" {
			result.Membership = "banned"
		}
	}
	if result.Membership == "none" {
		if _, ok := circlePending(s, c.ID, viewer); ok {
			result.Membership = "pending"
		}
	}
	return result
}
func (s *State) circleMember(v StoredCircleMember) CircleMember {
	return CircleMember{publicUser(s.Accounts[v.UserID].User), v.Role, v.Status, v.JoinedAt.UTC()}
}
func (s *State) circleRequest(v StoredCircleJoinRequest, viewer string) CircleJoinRequest {
	return CircleJoinRequest{v.ID, s.circle(s.Circles[v.CircleID], viewer), publicUser(s.Accounts[v.UserID].User), v.Note, v.Status, v.CreatedAt.UTC(), v.UpdatedAt.UTC()}
}
func circleChannel(v StoredCircleChannel) CircleChannel {
	return CircleChannel{v.ID, v.CircleID, v.Name, v.Description, v.Kind, v.Access, v.Archived, v.CreatedAt.UTC(), v.UpdatedAt.UTC()}
}
func circleInvite(v StoredCircleInvite) CircleInvite {
	return CircleInvite{v.ID, v.CircleID, v.CreatedAt.UTC(), v.ExpiresAt.UTC(), v.MaxUses, v.Uses, v.RevokedAt != nil}
}
func (s *State) circlePost(p StoredCirclePost, viewer string) CirclePost {
	images := p.Images
	if images == nil {
		images = []string{}
	}
	v := CirclePost{ID: p.ID, CircleID: p.CircleID, ChannelID: p.ChannelID, Author: publicUser(s.Accounts[p.AuthorID].User), Title: p.Title, Body: p.Body, Images: images, Status: p.Status, Featured: p.Featured, Pinned: p.Pinned, Liked: p.Likes[viewer], CreatedAt: p.CreatedAt.UTC(), UpdatedAt: p.UpdatedAt.UTC()}
	for _, liked := range p.Likes {
		if liked {
			v.LikeCount++
		}
	}
	for _, comment := range s.CircleComments {
		if comment.PostID == p.ID {
			v.CommentCount++
		}
	}
	return v
}
func circleIntroduction(s *State, u *User, id string) (StoredCircle, error) {
	c, ok := s.Circles[id]
	if !ok {
		return c, missing("圈子不存在或不可见")
	}
	user := ""
	if u != nil {
		user = u.ID
	}
	_, joined := activeCircleMember(s, id, user)
	_, pending := circlePending(s, id, user)
	if !joined && !pending && (c.Visibility != "public" || c.Status != "active") {
		return c, missing("圈子不存在或不可见")
	}
	return c, nil
}
func circleAccess(s *State, u *User, id string, write bool, manage bool) (StoredCircle, StoredCircleMember, error) {
	c, ok := s.Circles[id]
	m, joined := activeCircleMember(s, id, u.ID)
	if !ok || !joined || c.Status == "suspended" {
		return c, m, missing("圈子不存在或你已无访问权限")
	}
	if write && c.Status != "active" {
		return c, m, conflict("圈子已归档，只能阅读历史")
	}
	if manage && !circleStaff(m.Role) {
		return c, m, forbidden("只有圈主或圈管理员可执行")
	}
	return c, m, nil
}
func circleChannelAccess(s *State, u *User, circle, id string, write, publish bool) (StoredCircle, StoredCircleMember, StoredCircleChannel, error) {
	c, m, err := circleAccess(s, u, circle, write, false)
	ch, ok := s.CircleChannels[id]
	if err != nil {
		return c, m, ch, err
	}
	if !ok || ch.CircleID != circle || ch.Access == "staff" && !circleStaff(m.Role) {
		return c, m, ch, missing("频道不存在或不可见")
	}
	if write && ch.Archived {
		return c, m, ch, conflict("频道已归档，只能阅读历史")
	}
	if publish && ch.Kind == "announcement" && !circleStaff(m.Role) {
		return c, m, ch, forbidden("公告主帖仅圈主和圈管理员可发布")
	}
	return c, m, ch, nil
}
func visibleCirclePost(s *State, u *User, circle, id string) (StoredCirclePost, StoredCircleMember, error) {
	p, ok := s.CirclePosts[id]
	if !ok || p.CircleID != circle || p.DeletedAt != nil {
		return p, StoredCircleMember{}, missing("圈帖不存在或不可见")
	}
	_, m, _, err := circleChannelAccess(s, u, circle, p.ChannelID, false, false)
	if err != nil {
		return p, m, err
	}
	if p.Status != "published" && p.AuthorID != u.ID && !circleStaff(m.Role) {
		return p, m, missing("圈帖不存在或不可见")
	}
	return p, m, nil
}

func (a *App) registerCircleRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/circles", a.endpoint(false, "", a.circles))
	mux.HandleFunc("POST /api/v1/circles", a.endpoint(true, "member", a.createCircle))
	mux.HandleFunc("GET /api/v1/circles/{id}", a.endpoint(false, "", a.circleDetail))
	mux.HandleFunc("PATCH /api/v1/circles/{id}", a.endpoint(true, "member", a.updateCircle))
	mux.HandleFunc("DELETE /api/v1/circles/{id}", a.endpoint(true, "member", a.archiveCircle))
	mux.HandleFunc("POST /api/v1/circles/{id}/join", a.endpoint(true, "member", a.joinCircle))
	mux.HandleFunc("POST /api/v1/circles/{id}/leave", a.endpoint(true, "member", a.leaveCircle))
	mux.HandleFunc("POST /api/v1/circles/{id}/owner", a.endpoint(true, "member", a.transferCircleOwner))
	mux.HandleFunc("GET /api/v1/circle-requests", a.endpoint(false, "member", a.circleRequests))
	mux.HandleFunc("GET /api/v1/circles/{id}/requests", a.endpoint(false, "member", a.incomingCircleRequests))
	mux.HandleFunc("POST /api/v1/circles/{id}/requests/{requestId}/respond", a.endpoint(true, "member", a.respondCircleRequest))
	mux.HandleFunc("GET /api/v1/circles/{id}/members", a.endpoint(false, "member", a.circleMembers))
	mux.HandleFunc("PATCH /api/v1/circles/{id}/members/{userId}", a.endpoint(true, "member", a.updateCircleMember))
	mux.HandleFunc("POST /api/v1/circles/{id}/members/{userId}/remove", a.endpoint(true, "member", a.removeCircleMember))
	mux.HandleFunc("POST /api/v1/circles/{id}/members/{userId}/unban", a.endpoint(true, "member", a.unbanCircleMember))
	mux.HandleFunc("GET /api/v1/circles/{id}/channels", a.endpoint(false, "member", a.circleChannels))
	mux.HandleFunc("POST /api/v1/circles/{id}/channels", a.endpoint(true, "member", a.createCircleChannel))
	mux.HandleFunc("PATCH /api/v1/circles/{id}/channels/{channelId}", a.endpoint(true, "member", a.updateCircleChannel))
	mux.HandleFunc("GET /api/v1/circles/{id}/posts", a.endpoint(false, "member", a.circlePosts))
	mux.HandleFunc("POST /api/v1/circles/{id}/posts", a.endpoint(true, "member", a.createCirclePost))
	mux.HandleFunc("GET /api/v1/circles/{id}/posts/{postId}", a.endpoint(false, "member", a.circlePostDetail))
	mux.HandleFunc("PATCH /api/v1/circles/{id}/posts/{postId}", a.endpoint(true, "member", a.updateCirclePost))
	mux.HandleFunc("DELETE /api/v1/circles/{id}/posts/{postId}", a.endpoint(true, "member", a.deleteCirclePost))
	mux.HandleFunc("POST /api/v1/circles/{id}/posts/{postId}/like", a.endpoint(true, "member", a.likeCirclePost))
	mux.HandleFunc("GET /api/v1/circles/{id}/posts/{postId}/comments", a.endpoint(false, "member", a.circleComments))
	mux.HandleFunc("POST /api/v1/circles/{id}/posts/{postId}/comments", a.endpoint(true, "member", a.createCircleComment))
	mux.HandleFunc("POST /api/v1/circles/{id}/invites", a.endpoint(true, "member", a.createCircleInvite))
	mux.HandleFunc("GET /api/v1/circles/{id}/invites", a.endpoint(false, "member", a.circleInvites))
	mux.HandleFunc("DELETE /api/v1/circles/{id}/invites/{inviteId}", a.endpoint(true, "member", a.revokeCircleInvite))
	mux.HandleFunc("POST /api/v1/circle-invites/preview", a.endpoint(false, "member", a.previewCircleInvite))
	mux.HandleFunc("POST /api/v1/circles/{id}/media/images", a.uploadCircleMediaImage)
	mux.HandleFunc("GET /api/v1/admin/circles", a.endpoint(false, "staff", a.adminCircles))
	mux.HandleFunc("PATCH /api/v1/admin/circles/{id}", a.endpoint(true, "staff", a.adminUpdateCircle))
	mux.HandleFunc("GET /api/v1/admin/circle-posts", a.endpoint(false, "staff", a.adminCirclePosts))
	mux.HandleFunc("PATCH /api/v1/admin/circle-posts/{id}", a.endpoint(true, "staff", a.adminUpdateCirclePost))
}

type circleInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Cover       string `json:"cover"`
	Icon        string `json:"icon"`
	Category    string `json:"category"`
	Visibility  string `json:"visibility"`
	JoinPolicy  string `json:"joinPolicy"`
	ClientID    string `json:"clientId,omitempty"`
}

func (a *App) cleanCircleInput(input circleInput, r *http.Request) (circleInput, error) {
	var err error
	input.Name, err = trimText(input.Name, 40)
	if err != nil {
		return input, err
	}
	input.Description = strings.TrimSpace(input.Description)
	input.Category = strings.TrimSpace(input.Category)
	input.Icon = strings.TrimSpace(input.Icon)
	input.Cover = strings.TrimSpace(input.Cover)
	if utf8.RuneCountInString(input.Description) > 600 || utf8.RuneCountInString(input.Category) > 30 || utf8.RuneCountInString(input.Icon) > 16 {
		return input, bad("简介最多600字、分类30字、图标16字")
	}
	if input.Visibility != "public" && input.Visibility != "private" || input.JoinPolicy != "open" && input.JoinPolicy != "approval" {
		return input, bad("圈子可见性或加入方式不正确")
	}
	if input.Cover != "" {
		parsed, _ := url.Parse(input.Cover)
		if !validImage(input.Cover) || parsed != nil && strings.HasPrefix(parsed.Path, mediaURLPrefix) && a.sameMediaOrigin(parsed, r) {
			return input, bad("圈子封面只允许外站http(s)图片地址")
		}
	}
	return input, nil
}
func circleOwnedCount(s *State, user string) int {
	count := 0
	for _, c := range s.Circles {
		if c.OwnerID == user && c.Status != "archived" {
			count++
		}
	}
	return count
}
func (a *App) circles(s *State, u *User, r *http.Request) (any, error) {
	scope, err := queryEnum(r, "scope", "discover", "mine")
	if err != nil {
		return nil, err
	}
	if scope == "" {
		scope = "discover"
	}
	if scope == "mine" && u == nil {
		return nil, unauthorized()
	}
	viewer := ""
	if u != nil {
		viewer = u.ID
	}
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	if utf8.RuneCountInString(category) > 30 {
		return nil, bad("分类最多30字")
	}
	items := []Circle{}
	for _, c := range s.Circles {
		_, joined := activeCircleMember(s, c.ID, viewer)
		if scope == "mine" && !joined || scope == "discover" && (c.Visibility != "public" || c.Status != "active") || category != "" && c.Category != category || !matches(r, c.ID+" "+c.Name+" "+c.Description+" "+c.Category) {
			continue
		}
		items = append(items, s.circle(c, viewer))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})
	return list(r, items)
}
func (a *App) createCircle(s *State, u *User, r *http.Request) (any, error) {
	var input circleInput
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	if !requestPattern.MatchString(input.ClientID) {
		return nil, bad("clientId格式不正确")
	}
	input, err := a.cleanCircleInput(input, r)
	if err != nil {
		return nil, err
	}
	clientID := input.ClientID
	input.ClientID = ""
	raw, _ := json.Marshal(input)
	fingerprint := string(raw)
	for _, c := range s.Circles {
		if c.CreatorID == u.ID && c.ClientID == clientID {
			if c.Fingerprint != fingerprint {
				return nil, conflict("clientId已用于不同的圈子内容")
			}
			if _, err := circleIntroduction(s, u, c.ID); err != nil {
				return nil, err
			}
			return s.circle(c, u.ID), nil
		}
	}
	if circleOwnedCount(s, u.ID) >= 20 {
		return nil, conflict("每个账号最多拥有20个未归档圈子")
	}
	initializeCircles(s)
	now := a.circleNow()
	id := newID("circle_")
	c := StoredCircle{ID: id, CreatorID: u.ID, ClientID: clientID, Fingerprint: fingerprint, OwnerID: u.ID, Name: input.Name, Description: input.Description, Cover: input.Cover, Icon: input.Icon, Category: input.Category, Visibility: input.Visibility, JoinPolicy: input.JoinPolicy, Status: "active", CreatedAt: now, UpdatedAt: now}
	s.Circles[id] = c
	s.CircleMembers[circleMemberKey(id, u.ID)] = StoredCircleMember{CircleID: id, UserID: u.ID, Role: "owner", Status: "active", JoinedAt: now, UpdatedAt: now}
	channelID := newID("cchannel_")
	s.CircleChannels[channelID] = StoredCircleChannel{ID: channelID, CircleID: id, Name: "讨论", Kind: "forum", Access: "members", CreatedAt: now, UpdatedAt: now}
	s.audit(u, "circle.create", id, "创建圈子", now)
	return s.circle(c, u.ID), nil
}
func (a *App) circleDetail(s *State, u *User, r *http.Request) (any, error) {
	c, err := circleIntroduction(s, u, r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	viewer := ""
	if u != nil {
		viewer = u.ID
	}
	return s.circle(c, viewer), nil
}
func (a *App) updateCircle(s *State, u *User, r *http.Request) (any, error) {
	c, _, err := circleAccess(s, u, r.PathValue("id"), true, true)
	if err != nil {
		return nil, err
	}
	var patch struct{ Name, Description, Cover, Icon, Category, Visibility, JoinPolicy *string }
	if err = decode(r, &patch); err != nil {
		return nil, err
	}
	input := circleInput{Name: c.Name, Description: c.Description, Cover: c.Cover, Icon: c.Icon, Category: c.Category, Visibility: c.Visibility, JoinPolicy: c.JoinPolicy}
	changed := false
	for _, field := range []struct {
		from *string
		to   *string
	}{{patch.Name, &input.Name}, {patch.Description, &input.Description}, {patch.Cover, &input.Cover}, {patch.Icon, &input.Icon}, {patch.Category, &input.Category}, {patch.Visibility, &input.Visibility}, {patch.JoinPolicy, &input.JoinPolicy}} {
		if field.from != nil {
			*field.to = *field.from
			changed = true
		}
	}
	if !changed {
		return nil, bad("请选择需要修改的圈子字段")
	}
	input, err = a.cleanCircleInput(input, r)
	if err != nil {
		return nil, err
	}
	c.Name, c.Description, c.Cover, c.Icon, c.Category, c.Visibility, c.JoinPolicy = input.Name, input.Description, input.Cover, input.Icon, input.Category, input.Visibility, input.JoinPolicy
	c.UpdatedAt = a.circleNow()
	s.Circles[c.ID] = c
	s.audit(u, "circle.update", c.ID, "修改圈子资料", a.circleNow())
	return s.circle(c, u.ID), nil
}
func (a *App) archiveCircle(s *State, u *User, r *http.Request) (any, error) {
	c, ok := s.Circles[r.PathValue("id")]
	m, joined := activeCircleMember(s, c.ID, u.ID)
	if !ok || !joined {
		return nil, missing("圈子不存在")
	}
	if m.Role != "owner" {
		return nil, forbidden("只有当前圈主可归档")
	}
	if c.Status == "archived" {
		return map[string]bool{"ok": true}, nil
	}
	if c.Status == "suspended" {
		return nil, conflict("圈子已暂停，请通过平台处理")
	}
	c.Status = "archived"
	c.UpdatedAt = a.circleNow()
	s.Circles[c.ID] = c
	s.audit(u, "circle.archive", c.ID, "圈主归档", a.circleNow())
	return map[string]bool{"ok": true}, nil
}
