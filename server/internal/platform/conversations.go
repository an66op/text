package platform

import (
	"net/http"
	"sort"
	"strconv"
	"time"
)

func (a *App) conversations(s *State, u *User, r *http.Request) (any, error) {
	normalizeMessageSequences(s)
	items := []Conversation{}
	unreadTotal := 0
	for _, c := range s.Conversations {
		if member(c, u.ID) {
			item := s.conversation(c, u.ID)
			unreadTotal += item.UnreadCount
			if matches(r, c.Title) {
				items = append(items, item)
			}
		}
	}
	newest(items, func(c Conversation) time.Time {
		if c.LastMessage != nil {
			return c.LastMessage.CreatedAt
		}
		return c.CreatedAt
	})
	result, err := list(r, items)
	if err != nil {
		return nil, err
	}
	result.(map[string]any)["unreadTotal"] = unreadTotal
	return result, nil
}
func (a *App) createConversation(s *State, u *User, r *http.Request) (any, error) {
	var input struct {
		Title     string   `json:"title"`
		Kind      string   `json:"kind"`
		MemberIDs []string `json:"memberIds"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	title, err := trimText(input.Title, 80)
	if err != nil {
		return nil, err
	}
	if input.Kind != "direct" && input.Kind != "group" && input.Kind != "channel" {
		return nil, bad("会话类型不正确")
	}
	if len(input.MemberIDs) > 199 {
		return nil, bad("会话最多 200 人")
	}
	members := []string{u.ID}
	seen := map[string]bool{u.ID: true}
	for _, id := range input.MemberIDs {
		account, exists := s.Accounts[id]
		if !exists || account.User.Status != "active" {
			return nil, bad("成员不存在或已停用")
		}
		if !seen[id] {
			members = append(members, id)
			seen[id] = true
		}
	}
	if input.Kind == "direct" && len(members) != 2 {
		return nil, bad("私聊需要且只能有两名成员")
	}
	if input.Kind == "direct" {
		for _, c := range s.Conversations {
			if c.Kind == "direct" && len(c.Members) == 2 && member(c, members[0]) && member(c, members[1]) {
				return s.conversation(c, u.ID), nil
			}
		}
	}
	c := StoredConversation{newID("conversation_"), title, input.Kind, members, u.ID, a.now()}
	s.Conversations[c.ID] = c
	appendMessageEvent(s, "conversation.created", c.ID, "", "", a.now())
	return s.conversation(c, u.ID), nil
}
func getConversation(s *State, u *User, id string) (StoredConversation, error) {
	c, exists := s.Conversations[id]
	if !exists || !member(c, u.ID) {
		return c, missing("会话不存在或你尚未加入")
	}
	return c, nil
}
func (a *App) messages(s *State, u *User, r *http.Request) (any, error) {
	c, err := getConversation(s, u, r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	normalizeMessageSequences(s)
	query := r.URL.Query()
	before, after := int64(0), int64(0)
	var parseErr error
	for key, target := range map[string]*int64{"beforeSeq": &before, "afterSeq": &after} {
		if value := query.Get(key); value != "" {
			*target, parseErr = strconv.ParseInt(value, 10, 64)
			if parseErr != nil || *target < 0 || *target > maxMessageSequence || key == "beforeSeq" && *target == 0 {
				return nil, bad(key + " 必须为有效消息游标")
			}
		}
	}
	if id := query.Get("beforeId"); id != "" {
		if before != 0 {
			return nil, bad("beforeId 与 beforeSeq 不能同时使用")
		}
		message, exists := s.Messages[id]
		if !exists || message.ConversationID != c.ID {
			return nil, missing("历史消息游标不存在")
		}
		before = message.Seq
	}
	if before > 0 && query.Get("afterSeq") != "" {
		return nil, bad("不能同时向前和向后翻页")
	}
	if (before > 0 || query.Get("afterSeq") != "") && query.Get("offset") != "" && query.Get("offset") != "0" {
		return nil, bad("游标分页不能与 offset 混用")
	}
	limit := 30
	if value := query.Get("limit"); value != "" {
		limit, parseErr = strconv.Atoi(value)
		if parseErr != nil || limit < 1 || limit > 100 {
			return nil, bad("limit 必须为 1 到 100")
		}
	}
	items := []Message{}
	total := 0
	for _, m := range s.Messages {
		if m.ConversationID == c.ID && matches(r, m.Body) {
			total++
			if (before == 0 || m.Seq < before) && (query.Get("afterSeq") == "" || m.Seq > after) {
				items = append(items, s.message(m, u.ID))
			}
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Seq < items[j].Seq })
	offset := 0
	if value := query.Get("offset"); value != "" {
		offset, parseErr = strconv.Atoi(value)
		if parseErr != nil || offset < 0 || offset > 100000 {
			return nil, bad("offset 不正确")
		}
	}
	if offset > len(items) {
		offset = len(items)
	}
	if query.Get("afterSeq") == "" {
		items = items[:len(items)-offset]
		start := len(items) - limit
		if start < 0 {
			start = 0
		}
		hasMore := start > 0
		items = items[start:]
		var nextID any
		var nextSeq any
		if hasMore && len(items) > 0 {
			nextID = items[0].ID
			nextSeq = items[0].Seq
		}
		return map[string]any{"mutationVersion": s.ConversationMutations[c.ID], "items": items, "total": total, "hasMore": hasMore, "nextBeforeId": nextID, "nextBeforeSeq": nextSeq}, nil
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	return map[string]any{"mutationVersion": s.ConversationMutations[c.ID], "items": items, "total": total, "hasMore": hasMore, "nextBeforeId": nil, "nextBeforeSeq": nil}, nil
}
func (a *App) sendMessage(s *State, u *User, r *http.Request) (any, error) {
	c, err := getConversation(s, u, r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	if c.Kind == "channel" && c.OwnerID != u.ID {
		return nil, forbidden("频道仅允许当前频道主发布")
	}
	input, hash, err := decodeMessageInput(r)
	if err != nil {
		return nil, err
	}
	normalizeMessageSequences(s)
	seq := int64(0)
	for _, existing := range s.Messages {
		if existing.ConversationID != c.ID {
			continue
		}
		if input.ClientID != "" && existing.ClientID == input.ClientID && existing.SenderID == u.ID {
			original := existing.PayloadHash
			if original == "" {
				original = messageFingerprint(existing.Body, existing.ImageIDs, existing.ReplyToID)
			}
			if original != hash {
				return nil, conflict("clientId 已用于不同的消息内容")
			}
			return s.message(existing, u.ID), nil
		}
		if existing.Seq > seq {
			seq = existing.Seq
		}
	}
	if seq >= maxMessageSequence {
		return nil, conflict("会话消息序列已达到上限")
	}
	if input.ReplyToID != "" {
		source, ok := s.Messages[input.ReplyToID]
		if !ok || source.ConversationID != c.ID || source.RetractedAt != nil {
			return nil, missing("引用消息不存在或已撤回")
		}
	}
	for _, id := range input.ImageIDs {
		asset, ok := s.Media[id]
		if !ok || asset.OwnerID != u.ID || asset.Scope != "conversation" || asset.ConversationID != c.ID || asset.Status != "ready" || asset.DeletedAt != nil {
			return nil, bad("只能使用本人在本会话的可用图片")
		}
	}
	m := StoredMessage{ID: newID("message_"), ConversationID: c.ID, SenderID: u.ID, Body: input.Body, PayloadHash: hash, ImageIDs: input.ImageIDs, ReplyToID: input.ReplyToID, CreatedAt: a.now().UTC().Truncate(time.Microsecond), Seq: seq + 1, ClientID: input.ClientID}
	s.Messages[m.ID] = m
	appendMessageEvent(s, "message.created", c.ID, m.ID, "", a.now())
	return s.message(m, u.ID), nil
}
func (a *App) directory(s *State, _ *User, r *http.Request) (any, error) {
	type entry struct {
		ID     string `json:"id"`
		Handle string `json:"handle"`
		Name   string `json:"name"`
		Avatar string `json:"avatar"`
		Bio    string `json:"bio"`
	}
	items := []entry{}
	for _, account := range s.Accounts {
		u := account.User
		if u.Status == "active" && matches(r, u.ID+" "+u.Name+" "+u.Handle) {
			items = append(items, entry{u.ID, u.Handle, u.Name, u.Avatar, u.Bio})
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Handle < items[j].Handle })
	return list(r, items)
}

func (a *App) userProfile(s *State, _ *User, r *http.Request) (any, error) {
	for _, account := range s.Accounts {
		if account.User.Handle == r.PathValue("handle") && account.User.Status == "active" {
			return publicUser(account.User), nil
		}
	}
	return nil, missing("用户不存在或已停用")
}
