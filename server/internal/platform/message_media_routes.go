package platform

import (
	"net/http"
	"time"
)

func (a *App) registerMessageMediaRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/conversations/{id}/media/images", a.uploadConversationMediaImage)
	mux.HandleFunc("GET /api/v1/conversations/{id}/messages/by-client/{clientId}", a.messagingEndpoint(messagingByClient, false, a.messageByClient))
	mux.HandleFunc("GET /api/v1/conversations/{id}/messages/{messageId}", a.messagingEndpoint(messagingMessageDetail, false, a.messageDetail))
	mux.HandleFunc("POST /api/v1/conversations/{id}/messages/resolve", a.messagingEndpoint(messagingResolve, false, a.resolveMessages))
	mux.HandleFunc("DELETE /api/v1/me/messages/{messageId}", a.messagingEndpoint(messagingRetract, true, a.retractMessage))
}
func (a *App) messageDetail(s *State, u *User, r *http.Request) (any, error) {
	if _, err := getConversation(s, u, r.PathValue("id")); err != nil {
		return nil, err
	}
	m, ok := s.Messages[r.PathValue("messageId")]
	if !ok || m.ConversationID != r.PathValue("id") {
		return nil, missing("消息不存在")
	}
	return s.message(m, u.ID), nil
}
func (a *App) messageByClient(s *State, u *User, r *http.Request) (any, error) {
	if _, err := getConversation(s, u, r.PathValue("id")); err != nil {
		return nil, err
	}
	for _, m := range s.Messages {
		if m.ConversationID == r.PathValue("id") && m.SenderID == u.ID && m.ClientID == r.PathValue("clientId") {
			return s.message(m, u.ID), nil
		}
	}
	return nil, missing("消息不存在")
}
func (a *App) resolveMessages(s *State, u *User, r *http.Request) (any, error) {
	if _, err := getConversation(s, u, r.PathValue("id")); err != nil {
		return nil, err
	}
	var input struct {
		IDs []string `json:"ids"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	if len(input.IDs) > 200 {
		return nil, bad("一次最多解析200条消息")
	}
	items := []Message{}
	missing := []string{}
	seen := map[string]bool{}
	for _, id := range input.IDs {
		if id == "" || len(id) > 128 {
			return nil, bad("消息编号无效")
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		if m, ok := s.Messages[id]; ok && m.ConversationID == r.PathValue("id") {
			items = append(items, s.message(m, u.ID))
		} else {
			missing = append(missing, id)
		}
	}
	return map[string]any{"items": items, "missingIds": missing, "mutationVersion": s.ConversationMutations[r.PathValue("id")]}, nil
}
func (a *App) retractMessage(s *State, u *User, r *http.Request) (any, error) {
	m, ok := s.Messages[r.PathValue("messageId")]
	if !ok || m.SenderID != u.ID {
		return nil, missing("消息不存在")
	}
	if m.RetractedAt == nil {
		if m.PayloadHash == "" {
			m.PayloadHash = messageFingerprint(m.Body, m.ImageIDs, m.ReplyToID)
		}
		now := a.now().UTC().Truncate(time.Microsecond)
		m.RetractedAt = &now
		m.Body = ""
		m.ImageIDs = nil
		m.ReplyToID = ""
		s.Messages[m.ID] = m
		if s.ConversationMutations == nil {
			s.ConversationMutations = map[string]int64{}
		}
		if s.ConversationMutations[m.ConversationID] >= maxMessageSequence-1 {
			return nil, conflict("会话变更版本已达到上限")
		}
		s.ConversationMutations[m.ConversationID]++
		appendMessageEvent(s, "message.retracted", m.ConversationID, m.ID, "", now)
	}
	return map[string]any{"ok": true, "messageId": m.ID}, nil
}

func (a *App) conversationManagementEndpoint(fn func(*State, *User, *http.Request) (any, error)) http.HandlerFunc {
	return a.endpoint(true, "member", func(s *State, u *User, r *http.Request) (any, error) {
		result, err := fn(s, u, r)
		if err == nil {
			if _, ok := a.store.(*PostgresStore); ok {
				if conversation, ok := result.(Conversation); ok {
					conversation.LastMessage = nil
					result = conversation
				}
			}
		}
		return result, err
	})
}
