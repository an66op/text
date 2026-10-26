package platform

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// StreamStore is the normalized store's narrow outbox read path. Polling must not
// hydrate every post, message or wallet when no event has been committed.
type StreamRequest struct {
	SessionHash string
	UserID      string
	AfterSeq    int64
}
type StreamSession struct {
	UserID          string
	ExpiresAt       time.Time
	Active          bool
	ConversationIDs map[string]bool
}
type StreamSnapshot struct {
	Events         []MessageEvent
	FirstSequence  int64
	LatestSequence int64
	Sessions       map[string]StreamSession
}
type StreamStore interface {
	ReadStream(context.Context, []StreamRequest, int) (StreamSnapshot, error)
}

// A queued notification is re-authorized immediately before the socket write.
// Poll-time authorization alone could leave stale private events in its queue.
type StreamEventAuthorizer interface {
	AuthorizeStream(context.Context, StreamRequest, string) (sessionValid bool, conversationMember bool, err error)
}

var errStreamSessionExpired = errors.New("stream session expired")

// StreamEvent deliberately omits sender, member lists, bodies, email and tokens.
type StreamEvent struct {
	Type           string `json:"type"`
	EventID        string `json:"eventId"`
	ConversationID string `json:"conversationId,omitempty"`
	MessageID      string `json:"messageId,omitempty"`
}
type streamClose struct {
	code   websocket.StatusCode
	reason string
}
type streamSubscriber struct {
	request StreamRequest
	events  chan StreamEvent
	stop    chan streamClose
}

func (s *streamSubscriber) close(code websocket.StatusCode, reason string) {
	select {
	case s.stop <- streamClose{code, reason}:
	default:
	}
}

type messageHub struct {
	app         *App
	mu          sync.Mutex
	subscribers map[*streamSubscriber]struct{}
	running     bool
	closed      bool
	ctx         context.Context
	cancel      context.CancelFunc
}

func newMessageHub(a *App) *messageHub {
	ctx, cancel := context.WithCancel(context.Background())
	return &messageHub{app: a, subscribers: map[*streamSubscriber]struct{}{}, ctx: ctx, cancel: cancel}
}
func (h *messageHub) add(request StreamRequest) (*streamSubscriber, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil, &APIError{503, "unavailable", "实时服务正在关闭，请稍后重连"}
	}
	count := 0
	for s := range h.subscribers {
		if s.request.UserID == request.UserID {
			count++
		}
	}
	if len(h.subscribers) >= 256 || count >= 8 {
		return nil, &APIError{429, "stream_limit", "实时连接过多，请关闭多余页面"}
	}
	sub := &streamSubscriber{request: request, events: make(chan StreamEvent, 128), stop: make(chan streamClose, 1)}
	h.subscribers[sub] = struct{}{}
	if !h.running {
		h.running = true
		go h.run()
	}
	return sub, nil
}
func (h *messageHub) remove(sub *streamSubscriber) {
	h.mu.Lock()
	delete(h.subscribers, sub)
	h.mu.Unlock()
}

// CloseStreams is called by the HTTP server shutdown hook because upgraded
// connections are not closed by net/http.Server.Shutdown itself.
func (a *App) CloseStreams() {
	h := a.streamHub
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return
	}
	h.closed = true
	h.cancel()
	for sub := range h.subscribers {
		sub.close(websocket.StatusGoingAway, "server shutdown")
	}
}

func (h *messageHub) run() {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		h.mu.Lock()
		if h.closed || len(h.subscribers) == 0 {
			h.running = false
			h.mu.Unlock()
			return
		}
		subscribers := make([]*streamSubscriber, 0, len(h.subscribers))
		requests := make([]StreamRequest, 0, len(h.subscribers))
		for sub := range h.subscribers {
			subscribers = append(subscribers, sub)
			requests = append(requests, sub.request)
		}
		h.mu.Unlock()
		ctx, cancel := context.WithTimeout(h.ctx, 3*time.Second)
		snapshot, err := h.app.readStream(ctx, requests, 512)
		cancel()
		if err != nil {
			for _, sub := range subscribers {
				sub.close(websocket.StatusInternalError, "stream temporarily unavailable")
			}
		} else {
			for _, sub := range subscribers {
				h.deliver(sub, snapshot)
			}
		}
		select {
		case <-h.ctx.Done():
			h.mu.Lock()
			h.running = false
			h.mu.Unlock()
			return
		case <-ticker.C:
		}
	}
}

func (h *messageHub) deliver(sub *streamSubscriber, snapshot StreamSnapshot) {
	session, exists := snapshot.Sessions[sub.request.SessionHash]
	if !exists || session.UserID != sub.request.UserID || !session.Active || !session.ExpiresAt.After(h.app.now()) {
		sub.close(websocket.StatusPolicyViolation, "session expired")
		return
	}
	cursor := sub.request.AfterSeq
	resync := cursor > snapshot.LatestSequence || (snapshot.FirstSequence > 0 && cursor < snapshot.FirstSequence-1)
	pending := []StreamEvent{}
	for _, event := range snapshot.Events {
		if event.Seq <= cursor {
			continue
		}
		if event.Type == "membership.revoked" {
			if event.RecipientID == session.UserID {
				pending = append(pending, StreamEvent{Type: "resync", EventID: strconv.FormatInt(event.Seq, 10)})
			}
			continue
		}
		if session.ConversationIDs[event.ConversationID] && (event.RecipientID == "" || event.RecipientID == session.UserID) {
			pending = append(pending, StreamEvent{event.Type, strconv.FormatInt(event.Seq, 10), event.ConversationID, event.MessageID})
		}
	}
	if len(pending) > 64 {
		resync = true
	}
	if resync {
		pending = []StreamEvent{{Type: "resync", EventID: strconv.FormatInt(snapshot.LatestSequence, 10)}}
		cursor = snapshot.LatestSequence
	} else {
		if len(snapshot.Events) < 512 {
			cursor = snapshot.LatestSequence
		} else if last := snapshot.Events[len(snapshot.Events)-1].Seq; last > cursor {
			cursor = last
		}
	}
	for _, event := range pending {
		select {
		case sub.events <- event:
		default:
			sub.close(websocket.StatusTryAgainLater, "slow connection; reconnect to resynchronize")
			return
		}
	}
	// Cursor mutation is protected by the same mutex used to snapshot requests.
	h.mu.Lock()
	sub.request.AfterSeq = cursor
	h.mu.Unlock()
}

func (a *App) authorizeStream(ctx context.Context, request StreamRequest, conversationID string) (bool, bool, error) {
	if store, ok := a.store.(StreamEventAuthorizer); ok {
		return store.AuthorizeStream(ctx, request, conversationID)
	}
	valid, allowed := false, false
	err := a.store.Read(ctx, func(s *State) error {
		session, exists := s.Sessions[request.SessionHash]
		if !exists || session.UserID != request.UserID || !session.ExpiresAt.After(a.now()) {
			return nil
		}
		account, exists := s.Accounts[session.UserID]
		if !exists || account.User.Status != "active" {
			return nil
		}
		valid = true
		if conversationID == "" {
			allowed = true
		} else {
			allowed = member(s.Conversations[conversationID], request.UserID)
		}
		return nil
	})
	return valid, allowed, err
}

func (a *App) readStream(ctx context.Context, requests []StreamRequest, limit int) (StreamSnapshot, error) {
	if store, ok := a.store.(StreamStore); ok {
		return store.ReadStream(ctx, requests, limit)
	}
	// In-memory unit-test stores preserve the exact authorization semantics.
	snapshot := StreamSnapshot{Events: []MessageEvent{}, Sessions: map[string]StreamSession{}}
	err := a.store.Read(ctx, func(s *State) error {
		snapshot.LatestSequence = s.EventSequence
		after := s.EventSequence
		for _, request := range requests {
			if request.AfterSeq < after {
				after = request.AfterSeq
			}
			session, exists := s.Sessions[request.SessionHash]
			if !exists {
				continue
			}
			account, exists := s.Accounts[session.UserID]
			if !exists {
				continue
			}
			active := StreamSession{UserID: session.UserID, ExpiresAt: session.ExpiresAt, Active: account.User.Status == "active", ConversationIDs: map[string]bool{}}
			for _, c := range s.Conversations {
				if member(c, session.UserID) {
					active.ConversationIDs[c.ID] = true
				}
			}
			snapshot.Sessions[request.SessionHash] = active
		}
		for _, event := range s.Outbox {
			if snapshot.FirstSequence == 0 || event.Seq < snapshot.FirstSequence {
				snapshot.FirstSequence = event.Seq
			}
			if event.Seq > snapshot.LatestSequence {
				snapshot.LatestSequence = event.Seq
			}
			if event.Seq > after {
				snapshot.Events = append(snapshot.Events, event)
			}
		}
		sort.Slice(snapshot.Events, func(i, j int) bool { return snapshot.Events[i].Seq < snapshot.Events[j].Seq })
		if len(snapshot.Events) > limit {
			snapshot.Events = snapshot.Events[:limit]
		}
		return nil
	})
	return snapshot, err
}

func (a *App) stream(w http.ResponseWriter, r *http.Request) {
	allowed := false
	for _, origin := range a.cfg.Origins {
		if r.Header.Get("Origin") == origin {
			allowed = true
			break
		}
	}
	if !allowed || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		writeError(w, forbidden("实时连接来源未被允许"))
		return
	}
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		writeError(w, unauthorized())
		return
	}
	after, parseErr := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	invalidCursor := parseErr != nil || after < 0
	fresh := r.URL.Query().Get("after") == ""
	var userID string
	var latest, first int64
	_, err = a.execute(r, false, "member", func(s *State, u *User) (any, error) {
		if expected := r.URL.Query().Get("account"); expected != "" && expected != u.ID {
			return nil, &APIError{409, "account_changed", "账号已切换，请重新确认后再连接"}
		}
		userID = u.ID
		latest = s.EventSequence
		for _, event := range s.Outbox {
			if first == 0 || event.Seq < first {
				first = event.Seq
			}
			if event.Seq > latest {
				latest = event.Seq
			}
		}
		return nil, nil
	})
	if err != nil {
		writeError(w, err)
		return
	}
	initial := StreamEvent{Type: "ready"}
	if fresh {
		after = latest
	} else if invalidCursor || after > latest || (first > 0 && after < first-1) {
		after = latest
		initial.Type = "resync"
	}
	initial.EventID = strconv.FormatInt(after, 10)
	sub, err := a.streamHub.add(StreamRequest{SessionHash: tokenHash(cookie.Value), UserID: userID, AfterSeq: after})
	if err != nil {
		writeError(w, err)
		return
	}
	defer a.streamHub.remove(sub)
	// Upgrade owns its own bounded lifetime; normal HTTP request timeouts must not
	// terminate a healthy socket after twelve seconds.
	_ = http.NewResponseController(w).SetReadDeadline(time.Time{})
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: a.cfg.Origins, CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		return
	}
	defer connection.CloseNow()
	connection.SetReadLimit(1024)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	ctx = connection.CloseRead(ctx)
	closeConnection := func(code websocket.StatusCode, reason string) {
		timer := time.AfterFunc(time.Second, func() { _ = connection.CloseNow() })
		_ = connection.Close(code, reason)
		timer.Stop()
	}
	write := func(event StreamEvent) error {
		authCtx, done := context.WithTimeout(ctx, 3*time.Second)
		valid, allowed, err := a.authorizeStream(authCtx, StreamRequest{SessionHash: sub.request.SessionHash, UserID: sub.request.UserID}, event.ConversationID)
		done()
		if err != nil {
			return err
		}
		if !valid {
			closeConnection(websocket.StatusPolicyViolation, "session expired")
			return errStreamSessionExpired
		}
		if !allowed {
			return nil
		}
		sendCtx, done := context.WithTimeout(ctx, 5*time.Second)
		defer done()
		return wsjson.Write(sendCtx, connection, event)
	}
	if err = write(initial); err != nil {
		return
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case shutdown := <-sub.stop:
			closeConnection(shutdown.code, shutdown.reason)
			return
		case event := <-sub.events:
			if err = write(event); err != nil {
				return
			}
		case <-heartbeat.C:
			pingCtx, done := context.WithTimeout(ctx, 5*time.Second)
			err = connection.Ping(pingCtx)
			done()
			if err != nil {
				return
			}
		}
	}
}
