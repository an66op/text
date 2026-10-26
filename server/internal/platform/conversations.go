package platform

import (
	"net/http"
	"sort"
	"time"
)

func (a *App) conversations(s *State, u *User, r *http.Request) (any, error) {
	items := []Conversation{}
	for _, c := range s.Conversations {
		if member(c, u.ID) && matches(r, c.Title) {
			items = append(items, s.conversation(c))
		}
	}
	newest(items, func(c Conversation) time.Time {
		if c.LastMessage != nil {
			return c.LastMessage.CreatedAt
		}
		return c.CreatedAt
	})
	return list(r, items)
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
				return s.conversation(c), nil
			}
		}
	}
	c := StoredConversation{newID("conversation_"), title, input.Kind, members, u.ID, a.now()}
	s.Conversations[c.ID] = c
	return s.conversation(c), nil
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
	items := []Message{}
	for _, m := range s.Messages {
		if m.ConversationID == c.ID && matches(r, m.Body) {
			items = append(items, s.message(m))
		}
	}
	newest(items, func(m Message) time.Time { return m.CreatedAt })
	result, err := list(r, items)
	if err != nil {
		return nil, err
	}
	page := result.(map[string]any)
	messages := page["items"].([]Message)
	sort.SliceStable(messages, func(i, j int) bool { return messages[i].CreatedAt.Before(messages[j].CreatedAt) })
	return page, nil
}
func (a *App) sendMessage(s *State, u *User, r *http.Request) (any, error) {
	c, err := getConversation(s, u, r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	if c.Kind == "channel" && c.OwnerID != u.ID && u.Role != "admin" {
		return nil, forbidden("频道仅允许频道主或管理员发布")
	}
	var input struct {
		Body string `json:"body"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	body, err := trimText(input.Body, 5000)
	if err != nil {
		return nil, err
	}
	m := StoredMessage{newID("message_"), c.ID, u.ID, body, a.now()}
	s.Messages[m.ID] = m
	return s.message(m), nil
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
		if u.Status == "active" && matches(r, u.Name+" "+u.Handle) {
			items = append(items, entry{u.ID, u.Handle, u.Name, u.Avatar, u.Bio})
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Handle < items[j].Handle })
	return list(r, items)
}
