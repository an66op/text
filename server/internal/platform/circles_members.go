package platform

import (
	"net/http"
	"sort"
	"strings"
	"unicode/utf8"
)

func circleActiveCount(s *State, id string) int {
	count := 0
	for _, m := range s.CircleMembers {
		if m.CircleID == id && m.Status == "active" {
			count++
		}
	}
	return count
}
func (a *App) addCircleMember(s *State, circle, user string) error {
	if _, ok := activeCircleMember(s, circle, user); ok {
		return nil
	}
	if m, ok := s.CircleMembers[circleMemberKey(circle, user)]; ok && m.Status == "banned" {
		return forbidden("你已被该圈封禁")
	}
	if circleActiveCount(s, circle) >= 1000 {
		return conflict("圈子已达到1000名成员上限")
	}
	now := a.circleNow()
	s.CircleMembers[circleMemberKey(circle, user)] = StoredCircleMember{CircleID: circle, UserID: user, Role: "member", Status: "active", JoinedAt: now, UpdatedAt: now}
	return nil
}
func (a *App) joinCircle(s *State, u *User, r *http.Request) (any, error) {
	c, ok := s.Circles[r.PathValue("id")]
	if !ok || c.Status != "active" {
		return nil, missing("圈子不存在或暂不可加入")
	}
	var input struct {
		Note        string `json:"note"`
		InviteToken string `json:"inviteToken"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	input.Note = strings.TrimSpace(input.Note)
	if utf8.RuneCountInString(input.Note) > 300 {
		return nil, bad("申请说明最多300字")
	}
	if _, ok := activeCircleMember(s, c.ID, u.ID); ok {
		return CircleJoinResult{Status: "joined", Circle: s.circle(c, u.ID)}, nil
	}
	if m, ok := s.CircleMembers[circleMemberKey(c.ID, u.ID)]; ok && m.Status == "banned" {
		return nil, forbidden("你已被该圈封禁")
	}
	if pending, ok := circlePending(s, c.ID, u.ID); ok {
		request := s.circleRequest(pending, u.ID)
		return CircleJoinResult{Status: "pending", Circle: s.circle(c, u.ID), Request: &request}, nil
	}
	var invite *StoredCircleInvite
	if c.Visibility == "private" || input.InviteToken != "" {
		v, err := a.validCircleInvite(s, input.InviteToken)
		if err != nil || v.CircleID != c.ID {
			return nil, missing("邀请无效或已失效")
		}
		invite = &v
	}
	if c.JoinPolicy == "open" {
		if err := a.addCircleMember(s, c.ID, u.ID); err != nil {
			return nil, err
		}
	} else {
		now := a.circleNow()
		request := StoredCircleJoinRequest{ID: newID("crequest_"), CircleID: c.ID, UserID: u.ID, Note: input.Note, Status: "pending", CreatedAt: now, UpdatedAt: now}
		s.CircleJoinRequests[request.ID] = request
	}
	if invite != nil {
		key := circleRedemptionKey(invite.ID, u.ID)
		if _, redeemed := s.CircleInviteRedemptions[key]; !redeemed {
			invite.Uses++
			s.CircleInvites[invite.ID] = *invite
			s.CircleInviteRedemptions[key] = StoredCircleInviteRedemption{InviteID: invite.ID, UserID: u.ID, CreatedAt: a.circleNow()}
		}
	}
	s.audit(u, "circle.join", c.ID, "加入方式="+c.JoinPolicy, a.circleNow())
	if pending, ok := circlePending(s, c.ID, u.ID); ok {
		request := s.circleRequest(pending, u.ID)
		return CircleJoinResult{Status: "pending", Circle: s.circle(c, u.ID), Request: &request}, nil
	}
	return CircleJoinResult{Status: "joined", Circle: s.circle(c, u.ID)}, nil
}
func circleRequestStatus(r *http.Request) (string, error) {
	status, err := queryEnum(r, "status", "pending", "accepted", "declined", "cancelled")
	if status == "" {
		status = "pending"
	}
	return status, err
}
func (a *App) circleRequests(s *State, u *User, r *http.Request) (any, error) {
	return listCircleRequests(s, u, r, false)
}
func (a *App) incomingCircleRequests(s *State, u *User, r *http.Request) (any, error) {
	if _, _, err := circleAccess(s, u, r.PathValue("id"), false, true); err != nil {
		return nil, err
	}
	return listCircleRequests(s, u, r, true)
}
func listCircleRequests(s *State, u *User, r *http.Request, incoming bool) (any, error) {
	status, err := circleRequestStatus(r)
	if err != nil {
		return nil, err
	}
	items := []CircleJoinRequest{}
	for _, v := range s.CircleJoinRequests {
		if v.Status != status || incoming && v.CircleID != r.PathValue("id") || !incoming && v.UserID != u.ID {
			continue
		}
		if !incoming {
			if _, err := circleIntroduction(s, u, v.CircleID); err != nil {
				continue
			}
		}
		user := s.Accounts[v.UserID].User
		if matches(r, v.ID+" "+v.Note+" "+user.ID+" "+user.Handle+" "+user.Name) {
			items = append(items, s.circleRequest(v, u.ID))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})
	return list(r, items)
}
func (a *App) respondCircleRequest(s *State, u *User, r *http.Request) (any, error) {
	v, ok := s.CircleJoinRequests[r.PathValue("requestId")]
	if !ok || v.CircleID != r.PathValue("id") {
		return nil, missing("申请不存在")
	}
	var input struct {
		Action string `json:"action"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	target := ""
	switch input.Action {
	case "accept":
		target = "accepted"
	case "decline":
		target = "declined"
	case "cancel":
		target = "cancelled"
	default:
		return nil, bad("申请处理方式不正确")
	}
	if input.Action == "cancel" {
		if v.UserID != u.ID {
			return nil, forbidden("只能取消本人申请")
		}
		if _, err := circleIntroduction(s, u, v.CircleID); err != nil {
			return nil, err
		}
	} else {
		if _, _, err := circleAccess(s, u, v.CircleID, true, true); err != nil {
			return nil, err
		}
	}
	if v.Status != "pending" {
		if v.Status == target {
			return s.circleRequest(v, u.ID), nil
		}
		return nil, conflict("申请已被处理，请刷新查看")
	}
	if target == "accepted" {
		account, ok := s.Accounts[v.UserID]
		if !ok || account.User.Status != "active" {
			return nil, bad("申请账号不存在或已停用")
		}
		if err := a.addCircleMember(s, v.CircleID, v.UserID); err != nil {
			return nil, err
		}
	}
	v.Status = target
	v.ReviewerID = u.ID
	v.UpdatedAt = a.circleNow()
	s.CircleJoinRequests[v.ID] = v
	s.audit(u, "circle.request.respond", v.ID, "status="+target, a.circleNow())
	return s.circleRequest(v, u.ID), nil
}
func (a *App) circleMembers(s *State, u *User, r *http.Request) (any, error) {
	c, m, err := circleAccess(s, u, r.PathValue("id"), false, false)
	if err != nil {
		return nil, err
	}
	status, err := queryEnum(r, "status", "active", "removed", "banned")
	if err != nil {
		return nil, err
	}
	if status == "" {
		status = "active"
	}
	if status != "active" && !circleStaff(m.Role) {
		return nil, forbidden("只有圈管理可查看已移除或封禁成员")
	}
	items := []CircleMember{}
	for _, v := range s.CircleMembers {
		account := s.Accounts[v.UserID].User
		if v.CircleID == c.ID && v.Status == status && matches(r, account.ID+" "+account.Name+" "+account.Handle) {
			items = append(items, s.circleMember(v))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].JoinedAt.Equal(items[j].JoinedAt) {
			return items[i].User.ID < items[j].User.ID
		}
		return items[i].JoinedAt.Before(items[j].JoinedAt)
	})
	return list(r, items)
}
func circleManagedTarget(s *State, u *User, r *http.Request) (StoredCircle, StoredCircleMember, StoredCircleMember, error) {
	c, m, err := circleAccess(s, u, r.PathValue("id"), true, true)
	target, ok := s.CircleMembers[circleMemberKey(c.ID, r.PathValue("userId"))]
	if err != nil {
		return c, m, target, err
	}
	if !ok {
		return c, m, target, missing("圈成员不存在")
	}
	if target.Role == "owner" || target.UserID == c.OwnerID {
		return c, m, target, forbidden("请先转交圈主")
	}
	if m.Role != "owner" && target.Role != "member" {
		return c, m, target, forbidden("圈管理员只能管理普通成员")
	}
	return c, m, target, nil
}
func (a *App) updateCircleMember(s *State, u *User, r *http.Request) (any, error) {
	c, m, target, err := circleManagedTarget(s, u, r)
	if err != nil {
		return nil, err
	}
	if m.Role != "owner" {
		return nil, forbidden("只有圈主可任免管理员")
	}
	var input struct {
		Role string `json:"role"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	if input.Role != "admin" && input.Role != "member" {
		return nil, bad("成员角色不正确")
	}
	if target.Status != "active" || s.Accounts[target.UserID].User.Status != "active" {
		return nil, bad("只能调整正常成员角色")
	}
	target.Role = input.Role
	target.UpdatedAt = a.circleNow()
	s.CircleMembers[circleMemberKey(c.ID, target.UserID)] = target
	s.audit(u, "circle.member.role", target.UserID, "circle="+c.ID+", role="+target.Role, a.circleNow())
	return s.circleMember(target), nil
}
func (a *App) removeCircleMember(s *State, u *User, r *http.Request) (any, error) {
	c, _, target, err := circleManagedTarget(s, u, r)
	if err != nil {
		return nil, err
	}
	var input struct {
		Ban *bool `json:"ban"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	if input.Ban == nil {
		return nil, bad("请提供ban布尔值")
	}
	status := "removed"
	if *input.Ban {
		status = "banned"
	}
	if target.Status == status {
		return map[string]bool{"ok": true}, nil
	}
	target.Status = status
	target.UpdatedAt = a.circleNow()
	s.CircleMembers[circleMemberKey(c.ID, target.UserID)] = target
	for id, request := range s.CircleJoinRequests {
		if request.CircleID == c.ID && request.UserID == target.UserID && request.Status == "pending" {
			request.Status = "declined"
			request.ReviewerID = u.ID
			request.UpdatedAt = a.circleNow()
			s.CircleJoinRequests[id] = request
		}
	}
	s.audit(u, "circle.member.remove", target.UserID, "circle="+c.ID+", status="+status, a.circleNow())
	return map[string]bool{"ok": true}, nil
}
func (a *App) unbanCircleMember(s *State, u *User, r *http.Request) (any, error) {
	c, _, target, err := circleManagedTarget(s, u, r)
	if err != nil {
		return nil, err
	}
	var input struct{}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	if target.Status != "banned" {
		return map[string]bool{"ok": true}, nil
	}
	target.Status = "removed"
	target.UpdatedAt = a.circleNow()
	s.CircleMembers[circleMemberKey(c.ID, target.UserID)] = target
	s.audit(u, "circle.member.unban", target.UserID, "circle="+c.ID, a.circleNow())
	return map[string]bool{"ok": true}, nil
}
func (a *App) transferCircleOwner(s *State, u *User, r *http.Request) (any, error) {
	c, m, err := circleAccess(s, u, r.PathValue("id"), true, true)
	if err != nil {
		return nil, err
	}
	if m.Role != "owner" {
		return nil, forbidden("只有当前圈主可转交")
	}
	var input struct {
		UserID string `json:"userId"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	target, ok := activeCircleMember(s, c.ID, input.UserID)
	if !ok || s.Accounts[input.UserID].User.Status != "active" {
		return nil, bad("新圈主必须为正常active圈成员")
	}
	if target.UserID == c.OwnerID {
		return s.circle(c, u.ID), nil
	}
	if circleOwnedCount(s, target.UserID) >= 20 {
		return nil, conflict("目标账号拥有圈子数量已达上限")
	}
	m.Role = "admin"
	m.UpdatedAt = a.circleNow()
	target.Role = "owner"
	target.UpdatedAt = m.UpdatedAt
	s.CircleMembers[circleMemberKey(c.ID, m.UserID)] = m
	s.CircleMembers[circleMemberKey(c.ID, target.UserID)] = target
	c.OwnerID = target.UserID
	c.UpdatedAt = m.UpdatedAt
	s.Circles[c.ID] = c
	s.audit(u, "circle.owner.transfer", c.ID, "newOwner="+target.UserID, a.circleNow())
	return s.circle(c, u.ID), nil
}
func (a *App) leaveCircle(s *State, u *User, r *http.Request) (any, error) {
	var input struct{}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	m, ok := activeCircleMember(s, r.PathValue("id"), u.ID)
	if !ok {
		return map[string]bool{"ok": true}, nil
	}
	c := s.Circles[m.CircleID]
	if m.Role == "owner" {
		return nil, conflict("圈主需要先转交，才能退出")
	}
	if c.Status != "active" {
		return nil, conflict("圈子目前只读，不能修改成员")
	}
	m.Status = "removed"
	m.UpdatedAt = a.circleNow()
	s.CircleMembers[circleMemberKey(c.ID, u.ID)] = m
	s.audit(u, "circle.leave", c.ID, "成员退出", a.circleNow())
	return map[string]bool{"ok": true}, nil
}
