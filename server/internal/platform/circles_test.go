package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func circleCreateInput(visibility, policy string) map[string]any {
	return map[string]any{"name": "圈子权限测试", "description": "服务器真实圈子", "icon": "🌿", "cover": "", "category": "测试", "visibility": visibility, "joinPolicy": policy, "clientId": newID("circle-client-")}
}
func createdCircle(t *testing.T, h http.Handler, cookie *http.Cookie, visibility, policy string) Circle {
	t.Helper()
	res := call(t, h, "POST", "/circles", circleCreateInput(visibility, policy), cookie)
	requireCode(t, res, 200)
	return payload[Circle](t, res)
}
func circleFirstChannel(t *testing.T, h http.Handler, cookie *http.Cookie, circle string) CircleChannel {
	t.Helper()
	res := call(t, h, "GET", "/circles/"+circle+"/channels?limit=100", nil, cookie)
	requireCode(t, res, 200)
	page := payload[struct{ Items []CircleChannel }](t, res)
	if len(page.Items) == 0 {
		t.Fatal("missing default channel")
	}
	return page.Items[0]
}
func circleUser(t *testing.T, h http.Handler, suffix string) (PublicUser, *http.Cookie) {
	t.Helper()
	res := call(t, h, "POST", "/auth/register", map[string]string{"email": suffix + "@example.test", "handle": suffix, "name": suffix, "password": "CircleMember12345!"}, nil)
	requireCode(t, res, 201)
	data := payload[struct{ User PublicUser }](t, res)
	return data.User, res.Cookies[0]
}
func circleCreatedPost(t *testing.T, h http.Handler, cookie *http.Cookie, circle, channel string, images []string) CirclePost {
	t.Helper()
	res := call(t, h, "POST", "/circles/"+circle+"/posts", map[string]any{"channelId": channel, "title": "真实圈帖", "body": "成员自己的讨论内容", "images": images, "clientId": newID("post-client-")}, cookie)
	requireCode(t, res, 200)
	return payload[CirclePost](t, res)
}
func TestCirclePublicPrivateRolesAndAnnouncementInteraction(t *testing.T) {
	_, _, h := fixture(t)
	owner, admin := memberCookie(t, h), adminCookie(t, h)
	user, member := circleUser(t, h, "circlemember")
	c := createdCircle(t, h, owner, "public", "open")
	base := "/circles/" + c.ID
	intro := call(t, h, "GET", base, nil, nil)
	requireCode(t, intro, 200)
	if bytes.Contains(intro.Data, []byte(`"email"`)) || bytes.Contains(intro.Data, []byte(`"token"`)) {
		t.Fatal("circle introduction leaked private identity/invites")
	}
	requireCode(t, call(t, h, "GET", "/circles?scope=mine", nil, nil), 401)
	for _, cookie := range []*http.Cookie{admin, member} {
		requireCode(t, call(t, h, "GET", base+"/channels", nil, cookie), 404)
	}
	requireCode(t, call(t, h, "POST", base+"/join", map[string]any{}, member), 200)
	channel := circleFirstChannel(t, h, owner, c.ID)
	res := call(t, h, "POST", base+"/channels", map[string]string{"name": "私密管理", "kind": "forum", "access": "staff"}, owner)
	requireCode(t, res, 200)
	staff := payload[CircleChannel](t, res)
	res = call(t, h, "POST", base+"/channels", map[string]string{"name": "公告", "kind": "announcement", "access": "members"}, owner)
	requireCode(t, res, 200)
	ann := payload[CircleChannel](t, res)
	page := payload[struct {
		Items []CircleChannel
		Total int
	}](t, call(t, h, "GET", base+"/channels?limit=100", nil, member))
	if page.Total != 2 {
		t.Fatal("staff channel count leaked")
	}
	requireCode(t, call(t, h, "GET", base+"/posts?channelId="+staff.ID, nil, member), 404)
	post := circleCreatedPost(t, h, owner, c.ID, ann.ID, nil)
	requireCode(t, call(t, h, "POST", base+"/posts", map[string]any{"channelId": ann.ID, "title": "越权公告", "body": "不应成功", "clientId": "announcement-invalid"}, member), 403)
	liked := call(t, h, "POST", base+"/posts/"+post.ID+"/like", map[string]bool{"liked": true}, member)
	requireCode(t, liked, 200)
	if payload[CirclePost](t, liked).LikeCount != 1 {
		t.Fatal("announcement subscriber cannot like")
	}
	requireCode(t, call(t, h, "POST", base+"/posts/"+post.ID+"/comments", map[string]string{"body": "公告讨论"}, member), 200)
	requireCode(t, call(t, h, "PATCH", base+"/members/"+user.ID, map[string]string{"role": "admin"}, owner), 200)
	secret := circleCreatedPost(t, h, member, c.ID, staff.ID, nil)
	requireCode(t, call(t, h, "PATCH", base+"/members/"+user.ID, map[string]string{"role": "member"}, owner), 200)
	requireCode(t, call(t, h, "GET", base+"/posts/"+secret.ID, nil, member), 404)
	requireCode(t, call(t, h, "POST", base+"/members/"+user.ID+"/remove", map[string]bool{"ban": true}, owner), 200)
	requireCode(t, call(t, h, "POST", base+"/join", map[string]any{}, member), 403)
	requireCode(t, call(t, h, "POST", base+"/members/"+user.ID+"/unban", map[string]any{}, owner), 200)
	requireCode(t, call(t, h, "GET", base+"/posts", nil, member), 404)
	requireCode(t, call(t, h, "POST", base+"/join", map[string]any{}, member), 200)
	requireCode(t, call(t, h, "POST", base+"/owner", map[string]string{"userId": user.ID}, owner), 200)
	requireCode(t, call(t, h, "POST", base+"/members/"+user.ID+"/remove", map[string]bool{"ban": true}, owner), 403)
	requireCode(t, call(t, h, "POST", base+"/owner", map[string]string{"userId": "user_demo"}, member), 200)
	requireCode(t, call(t, h, "PATCH", base+"/channels/"+channel.ID, map[string]bool{"archived": true}, owner), 200)
	requireCode(t, call(t, h, "POST", base+"/posts", map[string]any{"channelId": channel.ID, "title": "归档", "body": "不能发", "clientId": "archived-channel-post"}, member), 409)
}
func TestCircleInvitesApprovalAndTerminalRequestPrivacy(t *testing.T) {
	a, s, h := fixture(t)
	owner, admin := memberCookie(t, h), adminCookie(t, h)
	user, member := circleUser(t, h, "circleapplicant")
	c := createdCircle(t, h, owner, "private", "approval")
	base := "/circles/" + c.ID
	requireCode(t, call(t, h, "GET", base, nil, member), 404)
	res := call(t, h, "POST", base+"/invites", map[string]int{"expiresInHours": 1, "maxUses": 1}, owner)
	requireCode(t, res, 200)
	invite := payload[struct {
		CircleInvite
		Token string
	}](t, res)
	raw, _ := json.Marshal(s.state)
	if bytes.Contains(raw, []byte(invite.Token)) {
		t.Fatal("plain invitation secret persisted")
	}
	requireCode(t, call(t, h, "POST", "/circle-invites/preview", map[string]string{"token": invite.Token}, member), 200)
	first := call(t, h, "POST", base+"/join", map[string]string{"inviteToken": invite.Token}, member)
	requireCode(t, first, 200)
	request := payload[CircleJoinResult](t, first).Request
	if request == nil {
		t.Fatal("private approval did not create request")
	}
	retry := call(t, h, "POST", base+"/join", map[string]string{"inviteToken": invite.Token}, member)
	requireCode(t, retry, 200)
	if payload[CircleJoinResult](t, retry).Request.ID != request.ID || s.state.CircleInvites[invite.ID].Uses != 1 {
		t.Fatal("pending retry consumed another invitation")
	}
	requireCode(t, call(t, h, "DELETE", base+"/invites/"+invite.ID, nil, owner), 200)
	requireCode(t, call(t, h, "POST", base+"/requests/"+request.ID+"/respond", map[string]string{"action": "accept"}, admin), 404)
	requireCode(t, call(t, h, "POST", base+"/requests/"+request.ID+"/respond", map[string]string{"action": "accept"}, owner), 200)
	requireCode(t, call(t, h, "POST", base+"/members/"+user.ID+"/remove", map[string]bool{"ban": false}, owner), 200)
	requireCode(t, call(t, h, "PATCH", base, map[string]string{"name": "不应从旧申请泄露的私密新名字"}, owner), 200)
	requireCode(t, call(t, h, "POST", base+"/requests/"+request.ID+"/respond", map[string]string{"action": "accept"}, owner), 200)
	requireCode(t, call(t, h, "GET", base+"/channels", nil, member), 404)
	old := payload[struct {
		Items []CircleJoinRequest
		Total int
	}](t, call(t, h, "GET", "/circle-requests?status=accepted", nil, member))
	if old.Total != 0 {
		t.Fatal("old accepted request leaked private circle's latest metadata")
	}
	requireCode(t, call(t, h, "POST", base+"/requests/"+request.ID+"/respond", map[string]string{"action": "cancel"}, member), 404)
	// Cancellation is visible once while pending; later replays cannot keep
	// revealing a private circle after that introduction permission is gone.
	res = call(t, h, "POST", base+"/invites", map[string]int{"expiresInHours": 1, "maxUses": 2}, owner)
	requireCode(t, res, 200)
	next := payload[struct {
		CircleInvite
		Token string
	}](t, res)
	pending := payload[CircleJoinResult](t, call(t, h, "POST", base+"/join", map[string]string{"inviteToken": next.Token}, member)).Request
	requireCode(t, call(t, h, "POST", base+"/requests/"+pending.ID+"/respond", map[string]string{"action": "cancel"}, member), 200)
	requireCode(t, call(t, h, "POST", base+"/requests/"+pending.ID+"/respond", map[string]string{"action": "cancel"}, member), 404)
	a.now = func() time.Time { return time.Now().Add(2 * time.Hour) }
	requireCode(t, call(t, h, "POST", "/circle-invites/preview", map[string]string{"token": next.Token}, member), 404)
}
func TestCircleCreationIdempotencyDoesNotRetainFormerOwnerAccess(t *testing.T) {
	_, _, h := fixture(t)
	owner := memberCookie(t, h)
	target, member := circleUser(t, h, "circlenewowner")
	input := circleCreateInput("private", "open")
	first := call(t, h, "POST", "/circles", input, owner)
	requireCode(t, first, 200)
	c := payload[Circle](t, first)
	base := "/circles/" + c.ID
	requireCode(t, call(t, h, "POST", "/circles", input, owner), 200)
	invite := payload[struct{ Token string }](t, call(t, h, "POST", base+"/invites", map[string]int{"maxUses": 1}, owner))
	requireCode(t, call(t, h, "POST", base+"/join", map[string]string{"inviteToken": invite.Token}, member), 200)
	requireCode(t, call(t, h, "POST", base+"/owner", map[string]string{"userId": target.ID}, owner), 200)
	requireCode(t, call(t, h, "POST", base+"/leave", map[string]any{}, owner), 200)
	requireCode(t, call(t, h, "PATCH", base, map[string]string{"name": "新的私密名称", "description": "旧创建者不能再读"}, member), 200)
	requireCode(t, call(t, h, "POST", "/circles", input, owner), 404)
}
func TestCircleGovernanceArchiveAndPostTombstones(t *testing.T) {
	_, s, h := fixture(t)
	owner, admin := memberCookie(t, h), adminCookie(t, h)
	_, member := circleUser(t, h, "circlegoverned")
	c := createdCircle(t, h, owner, "public", "open")
	base := "/circles/" + c.ID
	requireCode(t, call(t, h, "POST", base+"/join", map[string]any{}, member), 200)
	channel := circleFirstChannel(t, h, owner, c.ID)
	input := map[string]any{"channelId": channel.ID, "title": "治理", "body": "讨论", "clientId": "circle-tombstone-client"}
	res := call(t, h, "POST", base+"/posts", input, owner)
	requireCode(t, res, 200)
	p := payload[CirclePost](t, res)
	requireCode(t, call(t, h, "GET", base+"/posts?status=pending", nil, member), 403)
	requireCode(t, call(t, h, "POST", "/reports", map[string]string{"targetType": "circle-post", "targetId": p.ID, "reason": "测试圈帖举报"}, admin), 404)
	requireCode(t, call(t, h, "POST", "/reports", map[string]string{"targetType": "circle-post", "targetId": p.ID, "reason": "测试圈帖举报"}, member), 200)
	requireCode(t, call(t, h, "PATCH", "/admin/circles/"+c.ID, map[string]string{"status": "suspended", "note": "平台暂停"}, admin), 200)
	requireCode(t, call(t, h, "GET", base+"/posts/"+p.ID, nil, member), 404)
	requireCode(t, call(t, h, "GET", base, nil, member), 200)
	requireCode(t, call(t, h, "GET", "/admin/circle-posts?circleId="+c.ID, nil, admin), 200)
	requireCode(t, call(t, h, "PATCH", "/admin/circle-posts/"+p.ID, map[string]string{"status": "published", "note": "暂停不能发布"}, admin), 409)
	requireCode(t, call(t, h, "PATCH", "/admin/circles/"+c.ID, map[string]string{"status": "active", "note": "平台恢复"}, admin), 200)
	requireCode(t, call(t, h, "DELETE", base, nil, owner), 200)
	requireCode(t, call(t, h, "GET", base+"/posts/"+p.ID, nil, member), 200)
	requireCode(t, call(t, h, "POST", base+"/posts/"+p.ID+"/like", map[string]bool{"liked": true}, member), 409)
	requireCode(t, call(t, h, "PATCH", "/admin/circles/"+c.ID, map[string]string{"status": "active", "note": "不能替圈主恢复"}, admin), 409)
	requireCode(t, call(t, h, "DELETE", base+"/posts/"+p.ID, nil, owner), 200)
	requireCode(t, call(t, h, "DELETE", base+"/posts/"+p.ID, nil, owner), 200)
	if s.state.CirclePosts[p.ID].DeletedAt == nil {
		t.Fatal("post deletion lacks immutable tombstone")
	}
	requireCode(t, call(t, h, "POST", base+"/posts", input, owner), 409)
	if err := s.Read(context.Background(), func(state *State) error {
		for _, audit := range state.Audits {
			if strings.Contains(audit.Action, "circle.") && audit.ActorID == "" {
				t.Fatal("circle audit actor missing")
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
