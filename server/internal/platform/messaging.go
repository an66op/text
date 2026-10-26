package platform

import (
	"net/http"
	"sort"
	"time"
)

const maxMessageSequence int64 = 9007199254740991
const outboxRetention = 2000

func readKey(conversationID, userID string) string { return conversationID + ":" + userID }

// Legacy records had no sequence. Deterministic migration keeps refreshes and
// cursor lookups stable; the normalized store persists these values on import.
func normalizeMessageSequences(s *State) {
	groups := map[string][]StoredMessage{}
	for _, m := range s.Messages {
		groups[m.ConversationID] = append(groups[m.ConversationID], m)
	}
	for _, messages := range groups {
		sort.Slice(messages, func(i, j int) bool {
			if messages[i].CreatedAt.Equal(messages[j].CreatedAt) {
				return messages[i].ID < messages[j].ID
			}
			return messages[i].CreatedAt.Before(messages[j].CreatedAt)
		})
		max := int64(0)
		for _, m := range messages {
			if m.Seq > max {
				max = m.Seq
			}
		}
		for _, m := range messages {
			if m.Seq == 0 {
				max++
				m.Seq = max
				s.Messages[m.ID] = m
			}
		}
	}
	if s.Reads == nil {
		s.Reads = map[string]ConversationRead{}
	}
	if s.Outbox == nil {
		s.Outbox = []MessageEvent{}
	}
}

func appendMessageEvent(s *State, kind, conversationID, messageID, recipientID string, now time.Time) {
	for _, event := range s.Outbox {
		if event.Seq > s.EventSequence {
			s.EventSequence = event.Seq
		}
	}
	s.EventSequence++
	s.Outbox = append(s.Outbox, MessageEvent{ID: newID("event_"), Seq: s.EventSequence, Type: kind, ConversationID: conversationID, MessageID: messageID, RecipientID: recipientID, CreatedAt: now})
	sort.Slice(s.Outbox, func(i, j int) bool { return s.Outbox[i].Seq < s.Outbox[j].Seq })
	start := 0
	if len(s.Outbox) > outboxRetention {
		start = len(s.Outbox) - outboxRetention
	}
	cutoff := now.Add(-7 * 24 * time.Hour)
	for start < len(s.Outbox)-1 && s.Outbox[start].CreatedAt.Before(cutoff) {
		start++
	}
	if start > 0 {
		s.Outbox = append([]MessageEvent{}, s.Outbox[start:]...)
	}
}

type ReadReceipt struct {
	ConversationID    string `json:"conversationId"`
	LastReadMessageID string `json:"lastReadMessageId,omitempty"`
	ReadSeq           int64  `json:"readSeq"`
	UnreadCount       int    `json:"unreadCount"`
}

func (a *App) readConversation(s *State, u *User, r *http.Request) (any, error) {
	c, err := getConversation(s, u, r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	var input struct {
		MessageID string `json:"messageId"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	normalizeMessageSequences(s)
	message, exists := s.Messages[input.MessageID]
	if !exists || message.ConversationID != c.ID {
		return nil, missing("已读消息不存在于此会话")
	}
	key := readKey(c.ID, u.ID)
	mark := s.Reads[key]
	if message.Seq > mark.Seq {
		mark = ConversationRead{ConversationID: c.ID, UserID: u.ID, MessageID: message.ID, Seq: message.Seq, UpdatedAt: a.now()}
		s.Reads[key] = mark
		appendMessageEvent(s, "conversation.read", c.ID, message.ID, u.ID, a.now())
	}
	conversation := s.conversation(c, u.ID)
	return ReadReceipt{ConversationID: c.ID, LastReadMessageID: conversation.LastReadMessageID, ReadSeq: conversation.ReadSeq, UnreadCount: conversation.UnreadCount}, nil
}
