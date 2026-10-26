package platform

import "net/http"

// Management is separate from global operational roles: only the current
// conversation owner may change a group/channel, even when an admin is a member.
func (a *App) registerConversationManagementRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/conversations/{id}", a.messagingEndpoint(messagingDetail, false, a.conversationDetail))
	mux.HandleFunc("PATCH /api/v1/conversations/{id}", a.endpoint(true, "member", a.renameConversation))
	mux.HandleFunc("POST /api/v1/conversations/{id}/members", a.endpoint(true, "member", a.addConversationMembers))
	mux.HandleFunc("DELETE /api/v1/conversations/{id}/members/{userId}", a.endpoint(true, "member", a.removeConversationMember))
	mux.HandleFunc("POST /api/v1/conversations/{id}/owner", a.endpoint(true, "member", a.transferConversationOwner))
	mux.HandleFunc("POST /api/v1/conversations/{id}/leave", a.endpoint(true, "member", a.leaveConversation))
}

func (a *App) conversationDetail(s *State, u *User, r *http.Request) (any, error) {
	c, err := getConversation(s, u, r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	normalizeMessageSequences(s)
	profiles := make([]PublicUser, 0, len(c.Members))
	for _, id := range c.Members {
		if account, exists := s.Accounts[id]; exists {
			profiles = append(profiles, publicUser(account.User))
		}
	}
	return struct {
		Conversation   Conversation `json:"conversation"`
		MemberProfiles []PublicUser `json:"memberProfiles"`
	}{s.conversation(c, u.ID), profiles}, nil
}

func ownedConversation(s *State, u *User, id string) (StoredConversation, error) {
	c, err := getConversation(s, u, id)
	if err != nil {
		return c, err
	}
	if c.Kind == "direct" {
		return c, bad("私聊不能修改名称、成员或所有者")
	}
	if c.OwnerID != u.ID {
		return c, forbidden("只有当前群主或频道主可以管理此会话")
	}
	return c, nil
}

func (a *App) conversationUpdated(s *State, c StoredConversation, viewer string) Conversation {
	s.Conversations[c.ID] = c
	appendMessageEvent(s, "conversation.updated", c.ID, "", "", a.now())
	normalizeMessageSequences(s)
	return s.conversation(c, viewer)
}

func (a *App) renameConversation(s *State, u *User, r *http.Request) (any, error) {
	c, err := ownedConversation(s, u, r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	var input struct {
		Title string `json:"title"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	title, err := trimText(input.Title, 80)
	if err != nil {
		return nil, err
	}
	if c.Title == title {
		return s.conversation(c, u.ID), nil
	}
	c.Title = title
	return a.conversationUpdated(s, c, u.ID), nil
}

func (a *App) addConversationMembers(s *State, u *User, r *http.Request) (any, error) {
	c, err := ownedConversation(s, u, r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	var input struct {
		MemberIDs []string `json:"memberIds"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	if len(input.MemberIDs) == 0 {
		return nil, bad("请选择至少一名成员")
	}
	members := append([]string{}, c.Members...)
	seen := make(map[string]bool, len(members))
	for _, id := range members {
		seen[id] = true
	}
	for _, id := range input.MemberIDs {
		if seen[id] {
			continue
		}
		account, exists := s.Accounts[id]
		if !exists || account.User.Status != "active" {
			return nil, bad("成员不存在或已停用")
		}
		if len(members) >= 200 {
			return nil, bad("会话最多 200 人")
		}
		members = append(members, id)
		seen[id] = true
	}
	if len(members) == len(c.Members) {
		return s.conversation(c, u.ID), nil
	}
	c.Members = members
	return a.conversationUpdated(s, c, u.ID), nil
}

func (a *App) removeConversationMember(s *State, u *User, r *http.Request) (any, error) {
	c, err := ownedConversation(s, u, r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	id := r.PathValue("userId")
	if id == c.OwnerID {
		return nil, conflict("请先转交所有者，再移除或退出")
	}
	if !member(c, id) {
		return s.conversation(c, u.ID), nil
	}
	c.Members = withoutConversationMember(c.Members, id)
	delete(s.Reads, readKey(c.ID, id))
	updated := a.conversationUpdated(s, c, u.ID)
	// This recipient-only event becomes a wire resync with no conversation or
	// message ID. It can invalidate the removed user's list without exposing data.
	appendMessageEvent(s, "membership.revoked", c.ID, "", id, a.now())
	return updated, nil
}

func (a *App) transferConversationOwner(s *State, u *User, r *http.Request) (any, error) {
	c, err := ownedConversation(s, u, r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	var input struct {
		UserID string `json:"userId"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	account, exists := s.Accounts[input.UserID]
	if !exists || !member(c, input.UserID) || account.User.Status != "active" {
		return nil, bad("新所有者必须是当前会话中的正常成员")
	}
	if c.OwnerID == input.UserID {
		return s.conversation(c, u.ID), nil
	}
	c.OwnerID = input.UserID
	return a.conversationUpdated(s, c, u.ID), nil
}

func (a *App) leaveConversation(s *State, u *User, r *http.Request) (any, error) {
	var input struct{}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	c, exists := s.Conversations[r.PathValue("id")]
	// Idempotent leave does not distinguish an unknown conversation from one the
	// requester already left; no private existence/kind information is returned.
	if !exists || !member(c, u.ID) {
		return map[string]bool{"ok": true}, nil
	}
	if c.Kind == "direct" {
		return nil, bad("私聊不能通过此操作退出")
	}
	if c.OwnerID == u.ID {
		return nil, conflict("所有者需要先转交群组或频道，再退出")
	}
	c.Members = withoutConversationMember(c.Members, u.ID)
	delete(s.Reads, readKey(c.ID, u.ID))
	a.conversationUpdated(s, c, u.ID)
	appendMessageEvent(s, "membership.revoked", c.ID, "", u.ID, a.now())
	return map[string]bool{"ok": true}, nil
}

func withoutConversationMember(members []string, userID string) []string {
	result := make([]string, 0, len(members))
	for _, id := range members {
		if id != userID {
			result = append(result, id)
		}
	}
	return result
}
