package platform

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"sort"
	"time"
)

type User struct {
	ID        string    `json:"id"`
	Handle    string    `json:"handle"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	Avatar    string    `json:"avatar"`
	Bio       string    `json:"bio"`
	Role      string    `json:"role"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

// PublicUser is safe to embed in public posts and member-visible messages.
// Authentication and admin endpoints deliberately return the full User instead.
type PublicUser struct {
	ID     string `json:"id"`
	Handle string `json:"handle"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
	Bio    string `json:"bio"`
}

func publicUser(user User) PublicUser {
	return PublicUser{user.ID, user.Handle, user.Name, user.Avatar, user.Bio}
}

type Account struct {
	User         User   `json:"user"`
	PasswordHash string `json:"passwordHash"`
}
type Session struct {
	UserID    string    `json:"userId"`
	ExpiresAt time.Time `json:"expiresAt"`
}
type StoredPost struct {
	ID        string          `json:"id"`
	AuthorID  string          `json:"authorId"`
	Body      string          `json:"body"`
	Images    []string        `json:"images"`
	Topic     string          `json:"topic"`
	Status    string          `json:"status"`
	CreatedAt time.Time       `json:"createdAt"`
	Likes     map[string]bool `json:"likes"`
}
type Post struct {
	ID           string     `json:"id"`
	Author       PublicUser `json:"author"`
	Body         string     `json:"body"`
	Images       []string   `json:"images"`
	Topic        string     `json:"topic"`
	Status       string     `json:"status"`
	CreatedAt    time.Time  `json:"createdAt"`
	LikeCount    int        `json:"likeCount"`
	Liked        bool       `json:"liked"`
	CommentCount int        `json:"commentCount"`
}
type StoredComment struct {
	ID        string    `json:"id"`
	PostID    string    `json:"postId"`
	AuthorID  string    `json:"authorId"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
}
type Comment struct {
	ID        string     `json:"id"`
	PostID    string     `json:"postId"`
	Author    PublicUser `json:"author"`
	Body      string     `json:"body"`
	CreatedAt time.Time  `json:"createdAt"`
}
type StoredConversation struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Kind      string    `json:"kind"`
	Members   []string  `json:"members"`
	OwnerID   string    `json:"ownerId"`
	CreatedAt time.Time `json:"createdAt"`
}
type Conversation struct {
	StoredConversation
	LastMessage *Message `json:"lastMessage,omitempty"`
}
type StoredMessage struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversationId"`
	SenderID       string    `json:"senderId"`
	Body           string    `json:"body"`
	CreatedAt      time.Time `json:"createdAt"`
}
type Message struct {
	ID             string     `json:"id"`
	ConversationID string     `json:"conversationId"`
	Sender         PublicUser `json:"sender"`
	Body           string     `json:"body"`
	CreatedAt      time.Time  `json:"createdAt"`
}
type Document struct {
	Key       string          `json:"key"`
	Value     json.RawMessage `json:"value"`
	Revision  int64           `json:"revision"`
	UpdatedAt time.Time       `json:"updatedAt"`
}
type Report struct {
	ID         string    `json:"id"`
	ReporterID string    `json:"reporterId"`
	TargetType string    `json:"targetType"`
	TargetID   string    `json:"targetId"`
	Reason     string    `json:"reason"`
	Status     string    `json:"status"`
	Note       string    `json:"note"`
	CreatedAt  time.Time `json:"createdAt"`
}
type Audit struct {
	ID        string    `json:"id"`
	ActorID   string    `json:"actorId"`
	ActorName string    `json:"actorName"`
	Action    string    `json:"action"`
	TargetID  string    `json:"targetId"`
	Detail    string    `json:"detail"`
	CreatedAt time.Time `json:"createdAt"`
}
type LedgerEntry struct {
	ID           string    `json:"id"`
	Kind         string    `json:"kind"`
	Amount       string    `json:"amount"`
	Symbol       string    `json:"symbol"`
	Counterparty string    `json:"counterparty"`
	CreatedAt    time.Time `json:"createdAt"`
	RequestID    string    `json:"requestId"`
}
type Asset struct {
	Symbol   string `json:"symbol"`
	Name     string `json:"name"`
	Balance  string `json:"balance"`
	Decimals int    `json:"decimals"`
}
type Wallet struct {
	Network      string        `json:"network"`
	Assets       []Asset       `json:"assets"`
	Address      string        `json:"address"`
	Transactions []LedgerEntry `json:"transactions"`
}
type StoredWallet struct {
	Balance      int64         `json:"balance"`
	Address      string        `json:"address"`
	Transactions []LedgerEntry `json:"transactions"`
	LastFaucet   time.Time     `json:"lastFaucet"`
}
type Idempotency struct {
	Fingerprint string `json:"fingerprint"`
	Result      Wallet `json:"result"`
}
type State struct {
	Accounts      map[string]Account             `json:"accounts"`
	Sessions      map[string]Session             `json:"sessions"`
	Posts         map[string]StoredPost          `json:"posts"`
	Comments      map[string]StoredComment       `json:"comments"`
	Conversations map[string]StoredConversation  `json:"conversations"`
	Messages      map[string]StoredMessage       `json:"messages"`
	Documents     map[string]map[string]Document `json:"documents"`
	Reports       map[string]Report              `json:"reports"`
	Audits        []Audit                        `json:"audits"`
	Wallets       map[string]StoredWallet        `json:"wallets"`
	Idempotency   map[string]Idempotency         `json:"idempotency"`
}

func NewState() *State {
	return &State{Accounts: map[string]Account{}, Sessions: map[string]Session{}, Posts: map[string]StoredPost{}, Comments: map[string]StoredComment{}, Conversations: map[string]StoredConversation{}, Messages: map[string]StoredMessage{}, Documents: map[string]map[string]Document{}, Reports: map[string]Report{}, Audits: []Audit{}, Wallets: map[string]StoredWallet{}, Idempotency: map[string]Idempotency{}}
}
func newID(prefix string) string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return prefix + hex.EncodeToString(b)
}
func (s *State) post(p StoredPost, viewer string) Post {
	count := 0
	for _, c := range s.Comments {
		if c.PostID == p.ID {
			count++
		}
	}
	likes := 0
	for _, liked := range p.Likes {
		if liked {
			likes++
		}
	}
	images := p.Images
	if images == nil {
		images = []string{}
	}
	return Post{p.ID, publicUser(s.Accounts[p.AuthorID].User), p.Body, images, p.Topic, p.Status, p.CreatedAt, likes, p.Likes[viewer], count}
}
func (s *State) message(m StoredMessage) Message {
	return Message{m.ID, m.ConversationID, publicUser(s.Accounts[m.SenderID].User), m.Body, m.CreatedAt}
}
func (s *State) conversation(c StoredConversation) Conversation {
	result := Conversation{StoredConversation: c}
	for _, m := range s.Messages {
		if m.ConversationID == c.ID && (result.LastMessage == nil || m.CreatedAt.After(result.LastMessage.CreatedAt)) {
			v := s.message(m)
			result.LastMessage = &v
		}
	}
	return result
}
func member(c StoredConversation, id string) bool {
	for _, m := range c.Members {
		if m == id {
			return true
		}
	}
	return false
}
func staff(u *User) bool { return u != nil && (u.Role == "admin" || u.Role == "moderator") }
func (s *State) audit(u *User, action, target, detail string, now time.Time) {
	s.Audits = append(s.Audits, Audit{newID("audit_"), u.ID, u.Name, action, target, detail, now})
}
func newest[T any](items []T, at func(T) time.Time) {
	sort.SliceStable(items, func(i, j int) bool { return at(items[i]).After(at(items[j])) })
}
