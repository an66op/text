package platform

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const mediaURLPrefix = "/api/v1/media/images/"
const mediaMaxBytes int64 = 8 * 1024 * 1024
const mediaMultipartLimit int64 = mediaMaxBytes + 64*1024
const mediaAccountBytes int64 = 100 * 1024 * 1024
const mediaAccountCount = 100

var mediaIDPattern = regexp.MustCompile(`^media_[a-f0-9]{32}$`)

type MediaAsset struct {
	ID             string    `json:"id"`
	URL            string    `json:"url"`
	ContentType    string    `json:"contentType"`
	Width          int       `json:"width"`
	Height         int       `json:"height"`
	Bytes          int64     `json:"bytes"`
	CreatedAt      time.Time `json:"createdAt"`
	Scope          string    `json:"scope"`
	CircleID       string    `json:"circleId,omitempty"`
	ConversationID string    `json:"conversationId,omitempty"`
}

type StoredMediaAsset struct {
	MediaAsset
	OwnerID    string     `json:"ownerId"`
	ClientID   string     `json:"clientId"`
	SourceHash string     `json:"sourceHash"`
	Status     string     `json:"status"`
	Note       string     `json:"note"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	DeletedAt  *time.Time `json:"deletedAt,omitempty"`
}

type AdminMediaPost struct {
	ID     string `json:"id"`
	Body   string `json:"body"`
	Status string `json:"status"`
}
type OwnedMessageReference struct {
	MessageID string `json:"messageId"`
}
type AdminMediaAsset struct {
	MediaAsset
	Owner                         PublicUser              `json:"owner"`
	Status                        string                  `json:"status"`
	Note                          string                  `json:"note"`
	ReferenceCount                int                     `json:"referenceCount"`
	PublishedReferenceCount       int                     `json:"publishedReferenceCount"`
	Posts                         []AdminMediaPost        `json:"posts"`
	UpdatedAt                     time.Time               `json:"updatedAt"`
	CircleReferenceCount          int                     `json:"circleReferenceCount"`
	CirclePublishedReferenceCount int                     `json:"circlePublishedReferenceCount"`
	CirclePosts                   []AdminMediaCirclePost  `json:"circlePosts"`
	WorldReferenceCount           int                     `json:"worldReferenceCount"`
	MessageReferenceCount         int                     `json:"messageReferenceCount"`
	Own                           bool                    `json:"-"`
	PreviewAvailable              bool                    `json:"-"`
	MessageReferences             []OwnedMessageReference `json:"-"`
}

// A staff list cannot expose conversation URLs or IDs. The owner projection
// carries only blind message IDs and an explicit permission-dependent preview.
func (v AdminMediaAsset) MarshalJSON() ([]byte, error) {
	type alias AdminMediaAsset
	var url *string
	if !v.Own && v.Scope != "conversation" || v.Own && v.PreviewAvailable {
		value := v.URL
		url = &value
	}
	conversationID := ""
	if v.Own {
		conversationID = v.ConversationID
	}
	var preview *bool
	var refs *[]OwnedMessageReference
	if v.Own {
		preview = &v.PreviewAvailable
		if v.MessageReferences == nil {
			v.MessageReferences = []OwnedMessageReference{}
		}
		refs = &v.MessageReferences
	}
	return json.Marshal(struct {
		alias
		URL            *string                  `json:"url"`
		ConversationID string                   `json:"conversationId,omitempty"`
		Preview        *bool                    `json:"previewAvailable,omitempty"`
		References     *[]OwnedMessageReference `json:"messageReferences,omitempty"`
	}{alias(v), url, conversationID, preview, refs})
}

type mediaAccountGate struct {
	busy       chan struct{}
	references int
}
type mediaCoordinator struct {
	mu       sync.Mutex
	accounts map[string]*mediaAccountGate
	decoders chan struct{}
	uploads  chan struct{}
}

func newMediaCoordinator() *mediaCoordinator {
	return &mediaCoordinator{accounts: map[string]*mediaAccountGate{}, decoders: make(chan struct{}, 2), uploads: make(chan struct{}, 4)}
}
func (m *mediaCoordinator) account(ctx context.Context, id string) (func(), error) {
	m.mu.Lock()
	gate := m.accounts[id]
	if gate == nil {
		gate = &mediaAccountGate{busy: make(chan struct{}, 1)}
		m.accounts[id] = gate
	}
	gate.references++
	m.mu.Unlock()
	drop := func() {
		m.mu.Lock()
		gate.references--
		if gate.references == 0 {
			delete(m.accounts, id)
		}
		m.mu.Unlock()
	}
	select {
	case gate.busy <- struct{}{}:
		return func() { <-gate.busy; drop() }, nil
	case <-ctx.Done():
		drop()
		return nil, ctx.Err()
	}
}
func mediaIDFromURL(value string) (string, bool) {
	if !strings.HasPrefix(value, mediaURLPrefix) {
		return "", false
	}
	id := strings.TrimPrefix(value, mediaURLPrefix)
	return id, mediaIDPattern.MatchString(id)
}
func mediaFilename(v StoredMediaAsset) string {
	if v.ContentType == "image/jpeg" {
		return v.ID + ".jpg"
	}
	return v.ID + ".png"
}
func mediaUnavailable() error { return &APIError{503, "media_unavailable", "图片存储暂不可用"} }

func (a *App) registerMediaRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/media/images", a.uploadMediaImage)
	mux.HandleFunc("GET /api/v1/media/images/{id}", a.readMediaImage)
	mux.HandleFunc("HEAD /api/v1/media/images/{id}", a.readMediaImage)
	mux.HandleFunc("DELETE /api/v1/media/images/{id}", a.deleteMediaImage)
	mux.HandleFunc("GET /api/v1/me/media", a.mediaListEndpoint(true))
	mux.HandleFunc("GET /api/v1/admin/media", a.mediaListEndpoint(false))
	mux.HandleFunc("PATCH /api/v1/admin/media/{id}", a.mediaModerationEndpoint())
}

func (a *App) uploadMediaImage(w http.ResponseWriter, r *http.Request) {
	a.uploadMediaImageScoped(w, r, "")
}
func (a *App) uploadMediaImageScoped(w http.ResponseWriter, r *http.Request, circleID string) {
	scope := "world"
	if circleID != "" {
		scope = "circle"
	}
	identity, err := a.execute(r, false, "member", func(s *State, u *User) (any, error) {
		if circleID != "" {
			if _, _, err := circleAccess(s, u, circleID, true, false); err != nil {
				return nil, err
			}
		}
		return u.ID, nil
	})
	if err != nil {
		writeError(w, err)
		return
	}
	if a.cfg.MediaDirectory == "" {
		writeError(w, mediaUnavailable())
		return
	}
	// Admission precedes multipart buffering, not merely decoding: at most four
	// authenticated uploads can retain raw bytes or wait for a decoder per app.
	select {
	case a.media.uploads <- struct{}{}:
		defer func() { <-a.media.uploads }()
	default:
		w.Header().Set("Retry-After", "1")
		writeError(w, &APIError{429, "media_busy", "图片上传繁忙，请稍后重试"})
		return
	}
	unlock, err := a.media.account(r.Context(), identity.(string))
	if err != nil {
		writeError(w, err)
		return
	}
	defer unlock()
	raw, clientID, err := parseMediaMultipart(r)
	if err != nil {
		writeError(w, err)
		return
	}
	hash := sha256.Sum256(raw)
	sourceHash := hex.EncodeToString(hash[:])
	// Check a committed retry before spending decoder/file resources. The write
	// transaction below repeats this check and authorization for concurrent calls.
	existing, err := a.execute(r, false, "member", func(s *State, u *User) (any, error) {
		if circleID != "" {
			if _, _, err := circleAccess(s, u, circleID, true, false); err != nil {
				return nil, err
			}
		}
		return existingMediaUpload(s, u.ID, clientID, sourceHash, scope, circleID)
	})
	if err != nil {
		writeError(w, err)
		return
	}
	if existing != nil {
		writeJSON(w, 200, existing)
		return
	}
	if !a.limiter.allow("media:"+identity.(string), 30, time.Hour, a.now()) {
		w.Header().Set("Retry-After", "3600")
		writeError(w, &APIError{429, "rate_limited", "每小时最多上传30次，请稍后重试"})
		return
	}
	select {
	case a.media.decoders <- struct{}{}:
	case <-r.Context().Done():
		writeError(w, r.Context().Err())
		return
	}
	encoded, contentType, width, height, err := normalizeMediaImage(raw)
	<-a.media.decoders
	if err != nil {
		writeError(w, err)
		return
	}
	now := a.now().UTC().Truncate(time.Microsecond)
	id := newID("media_")
	v := StoredMediaAsset{MediaAsset: MediaAsset{ID: id, URL: mediaURLPrefix + id, ContentType: contentType, Width: width, Height: height, Bytes: int64(len(encoded)), CreatedAt: now, Scope: scope, CircleID: circleID}, OwnerID: identity.(string), ClientID: clientID, SourceHash: sourceHash, Status: "ready", UpdatedAt: now}
	if err = writeMediaFile(a.cfg.MediaDirectory, v, encoded); err != nil {
		writeError(w, mediaUnavailable())
		return
	}
	// This callback performs DB/state operations only, and may be replayed. The
	// exclusive random file already exists, but no row exposes it until commit.
	result, err := a.execute(r, true, "member", func(s *State, u *User) (any, error) {
		if u.ID != v.OwnerID {
			return nil, &APIError{409, "account_changed", "账号已切换，请重新上传"}
		}
		if circleID != "" {
			if _, _, err := circleAccess(s, u, circleID, true, false); err != nil {
				return nil, err
			}
		}
		if original, err := existingMediaUpload(s, u.ID, clientID, sourceHash, scope, circleID); err != nil || original != nil {
			return original, err
		}
		count := 0
		var size int64
		for _, asset := range s.Media {
			if asset.OwnerID == u.ID && asset.DeletedAt == nil {
				count++
				size += asset.Bytes
			}
		}
		if count >= mediaAccountCount || size+v.Bytes > mediaAccountBytes {
			return nil, &APIError{409, "media_quota_exceeded", "图片额度已满（最多100张、100MiB）"}
		}
		if s.Media == nil {
			s.Media = map[string]StoredMediaAsset{}
		}
		s.Media[v.ID] = v
		return v.MediaAsset, nil
	})
	if err != nil {
		// An unknown DB/COMMIT error can race a still-finishing commit. A fresh
		// negative read is insufficient proof. Retain that private candidate for
		// offline reconciliation; only known callback rejection is safe to undo.
		a.compensateMediaFile(v, err)
		writeError(w, err)
		return
	}
	asset := result.(MediaAsset)
	if asset.ID != v.ID {
		_ = removeMediaFile(a.cfg.MediaDirectory, v)
	}
	writeJSON(w, 200, asset)
}

func existingMediaUpload(s *State, owner, clientID, sourceHash, scope, circleID string) (any, error) {
	for _, v := range s.Media {
		if v.OwnerID != owner || v.ClientID != clientID {
			continue
		}
		if v.SourceHash != sourceHash || effectiveMediaScope(v) != scope || v.CircleID != circleID {
			return nil, conflict("clientId 已用于不同的图片内容")
		}
		if v.DeletedAt != nil {
			return nil, conflict("图片已删除，请使用新的clientId")
		}
		return v.MediaAsset, nil
	}
	return nil, nil
}
func (a *App) compensateMediaFile(v StoredMediaAsset, err error) {
	var api *APIError
	if errors.As(err, &api) {
		_ = removeMediaFile(a.cfg.MediaDirectory, v)
	}
}

func mediaReferences(s *State, id string) []StoredPost {
	posts := []StoredPost{}
	for _, p := range s.Posts {
		for _, image := range p.Images {
			if image == mediaURLPrefix+id {
				posts = append(posts, p)
				break
			}
		}
	}
	sort.Slice(posts, func(i, j int) bool {
		if posts[i].CreatedAt.Equal(posts[j].CreatedAt) {
			return posts[i].ID < posts[j].ID
		}
		return posts[i].CreatedAt.After(posts[j].CreatedAt)
	})
	return posts
}
func adminMediaAsset(s *State, v StoredMediaAsset) AdminMediaAsset {
	result := AdminMediaAsset{MediaAsset: v.MediaAsset, Owner: publicUser(s.Accounts[v.OwnerID].User), Status: v.Status, Note: v.Note, UpdatedAt: v.UpdatedAt, Posts: []AdminMediaPost{}}
	for _, p := range mediaReferences(s, v.ID) {
		result.ReferenceCount++
		result.WorldReferenceCount++
		if p.Status == "published" {
			result.PublishedReferenceCount++
		}
		if len(result.Posts) < 10 {
			body := []rune(p.Body)
			if len(body) > 200 {
				body = body[:200]
			}
			result.Posts = append(result.Posts, AdminMediaPost{p.ID, string(body), p.Status})
		}
	}
	result.CirclePosts = []AdminMediaCirclePost{}
	for _, p := range circleMediaReferences(s, v.ID) {
		result.ReferenceCount++
		result.CircleReferenceCount++
		if p.Status == "published" {
			result.CirclePublishedReferenceCount++
		}
		if len(result.CirclePosts) < 10 {
			body := []rune(p.Body)
			if len(body) > 200 {
				body = body[:200]
			}
			result.CirclePosts = append(result.CirclePosts, AdminMediaCirclePost{p.CircleID, p.ChannelID, p.ID, string(body), p.Status})
		}
	}

	for _, m := range s.Messages {
		if m.RetractedAt != nil {
			continue
		}
		for _, id := range m.ImageIDs {
			if id == v.ID {
				result.ReferenceCount++
				result.MessageReferenceCount++
				if len(result.MessageReferences) < 10 {
					result.MessageReferences = append(result.MessageReferences, OwnedMessageReference{m.ID})
				}
			}
		}
	}
	return result
}
func (a *App) adminMedia(s *State, _ *User, r *http.Request) (any, error) {
	return listMediaAssets(s, "", r)
}
func (a *App) myMedia(s *State, u *User, r *http.Request) (any, error) {
	return listMediaAssets(s, u.ID, r)
}
func listMediaAssets(s *State, owner string, r *http.Request) (any, error) {
	status, err := queryEnum(r, "status", "ready", "blocked")
	if err != nil {
		return nil, err
	}
	scope, err := queryEnum(r, "scope", "world", "circle", "conversation")
	if err != nil {
		return nil, err
	}
	items := []AdminMediaAsset{}
	for _, v := range s.Media {
		if v.DeletedAt != nil || status != "" && v.Status != status || owner != "" && v.OwnerID != owner || scope != "" && effectiveMediaScope(v) != scope || owner != "" && r.URL.Query().Get("clientId") != "" && v.ClientID != r.URL.Query().Get("clientId") || owner != "" && r.URL.Query().Get("conversationId") != "" && v.ConversationID != r.URL.Query().Get("conversationId") {
			continue
		}
		u := s.Accounts[v.OwnerID].User
		search := v.ID + " " + u.ID + " " + u.Handle + " " + u.Name
		for _, p := range mediaReferences(s, v.ID) {
			search += " " + p.ID
		}
		for _, p := range circleMediaReferences(s, v.ID) {
			search += " " + p.ID + " " + p.CircleID
		}
		if matches(r, search) {
			item := adminMediaAsset(s, v)
			item.Own = owner != ""
			item.PreviewAvailable = v.Status == "ready" && (effectiveMediaScope(v) != "conversation" || stateConversationMember(s, v.ConversationID, owner))
			if owner != "" {
				for i := range item.CirclePosts {
					p := item.CirclePosts[i]
					if _, _, _, err := circleChannelAccess(s, &u, p.CircleID, p.ChannelID, false, false); err != nil {
						item.CirclePosts[i].Body = ""
					}
				}
			}
			items = append(items, item)
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
func (a *App) adminUpdateMedia(s *State, u *User, r *http.Request) (any, error) {
	v, exists := s.Media[r.PathValue("id")]
	if !exists || v.DeletedAt != nil {
		return nil, missing("图片不存在")
	}
	var input struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	if input.Status != "ready" && input.Status != "blocked" {
		return nil, bad("图片状态不正确")
	}
	note, err := trimText(input.Note, 1000)
	if err != nil {
		return nil, err
	}
	if v.Status != input.Status {
		s.notifyChange("media-review", u.ID, v.OwnerID, v.ID, input.Status, a.now())
	}
	v.Status, v.Note, v.UpdatedAt = input.Status, note, a.now().UTC().Truncate(time.Microsecond)
	s.Media[v.ID] = v
	if v.Status == "blocked" {
		for _, p := range mediaReferences(s, v.ID) {
			if p.Status == "published" {
				s.notifyChange("world-review", u.ID, p.AuthorID, p.ID, "hidden", a.now())
				p.Status = "hidden"
				s.Posts[p.ID] = p
				s.audit(u, "post.moderate", p.ID, "status=hidden, blocked_media="+v.ID, a.now())
			}
		}
		for _, p := range circleMediaReferences(s, v.ID) {
			if p.Status == "published" {
				s.notifyChange("circle-review", u.ID, p.AuthorID, p.ID, "hidden", a.circleNow())
				p.Status = "hidden"
				p.UpdatedAt = a.circleNow()
				p.Note = "关联图片被平台屏蔽：" + v.ID
				s.CirclePosts[p.ID] = p
				s.audit(u, "circle.post.govern", p.ID, "status=hidden, blocked_media="+v.ID, a.circleNow())
			}
		}
	}
	s.audit(u, "media.moderate", v.ID, "status="+v.Status+", note="+v.Note, a.now())
	return adminMediaAsset(s, v), nil
}
func (a *App) deleteMediaImage(w http.ResponseWriter, r *http.Request) {
	if !mediaIDPattern.MatchString(r.PathValue("id")) {
		writeError(w, missing("图片不存在"))
		return
	}
	if store, ok := a.store.(*PostgresStore); ok {
		a.deleteMediaImageSQL(w, r, store)
		return
	}
	var removed StoredMediaAsset
	_, err := a.execute(r, true, "member", func(s *State, u *User) (any, error) {
		v, exists := s.Media[r.PathValue("id")]
		if !exists || v.OwnerID != u.ID {
			return nil, missing("图片不存在")
		}
		removed = v
		if v.DeletedAt != nil {
			return nil, nil
		}
		if len(mediaReferences(s, v.ID)) != 0 || len(circleMediaReferences(s, v.ID)) != 0 || adminMediaAsset(s, v).MessageReferenceCount != 0 {
			return nil, conflict("图片仍被动态引用，请先删除相关动态")
		}
		now := a.now().UTC().Truncate(time.Microsecond)
		v.DeletedAt = &now
		v.UpdatedAt = now
		s.Media[v.ID] = v
		removed = v
		s.audit(u, "media.delete", v.ID, "本人删除未引用图片", a.now())
		return nil, nil
	})
	if err != nil {
		writeError(w, err)
		return
	}
	// Logical deletion commits first. A filesystem failure retains an inaccessible
	// orphan for later reconciliation; it never exposes an uncommitted deletion.
	if a.cfg.MediaDirectory != "" {
		_ = removeMediaFile(a.cfg.MediaDirectory, removed)
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *App) readMediaImage(w http.ResponseWriter, r *http.Request) {
	if !mediaIDPattern.MatchString(r.PathValue("id")) {
		writeError(w, missing("图片不存在"))
		return
	}
	if a.cfg.MediaDirectory == "" {
		writeError(w, mediaUnavailable())
		return
	}
	var v StoredMediaAsset
	var err error
	if s, ok := a.store.(*PostgresStore); ok {
		v, err = a.authorizeMediaSQL(r, s)
	} else {
		var value any
		value, err = a.execute(r, false, "", func(s *State, u *User) (any, error) {
			asset, exists := s.Media[r.PathValue("id")]
			if !exists || asset.DeletedAt != nil || asset.Status == "blocked" && !staff(u) {
				return nil, missing("图片不存在或不可见")
			}
			allowed := staff(u) || u != nil && u.ID == asset.OwnerID
			if effectiveMediaScope(asset) == "conversation" {
				allowed = asset.Status == "ready" && u != nil && stateConversationMember(s, asset.ConversationID, u.ID) && (u.ID == asset.OwnerID || adminMediaAsset(s, asset).MessageReferenceCount > 0)
				if !allowed {
					return nil, missing("图片不存在或不可见")
				}
				return asset, nil
			}
			if !allowed {
				if effectiveMediaScope(asset) == "world" {
					for _, p := range mediaReferences(s, asset.ID) {
						if p.Status == "published" {
							allowed = true
							break
						}
					}
				} else {
					allowed = canReadCircleMedia(s, asset, u)
				}
			}
			if !allowed {
				return nil, missing("图片不存在或不可见")
			}
			return asset, nil
		})
		if err == nil {
			v = value.(StoredMediaAsset)
		}
	}
	if err != nil {
		writeError(w, err)
		return
	}
	file, err := openMediaFile(a.cfg.MediaDirectory, v)
	if err != nil {
		writeError(w, mediaUnavailable())
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", v.ContentType)
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(mediaNoStoreResponse{w}, r, mediaFilename(v), v.CreatedAt, file)
}

// ServeContent drops Cache-Control on some range/conditional errors by default;
// media authorization remains dynamic, so every status must retain no-store.
type mediaNoStoreResponse struct{ http.ResponseWriter }

func (w mediaNoStoreResponse) WriteHeader(status int) {
	w.Header().Set("Cache-Control", "no-store")
	w.ResponseWriter.WriteHeader(status)
}

// Validate all hosted references on creation/publication, while retaining old
// absolute HTTP image URLs. Hosted references are canonical relative URLs only.
func (a *App) validatePostMedia(s *State, owner string, images []string, r *http.Request) ([]string, bool, error) {
	result := []string{}
	seen := map[string]bool{}
	hosted := false
	for _, value := range images {
		if seen[value] {
			continue
		}
		seen[value] = true
		if id, ok := mediaIDFromURL(value); ok {
			v, exists := s.Media[id]
			if !exists || v.OwnerID != owner || v.DeletedAt != nil || v.Status != "ready" || effectiveMediaScope(v) != "world" {
				return nil, false, bad("只能使用本人正常可用的托管图片")
			}
			hosted = true
		} else {
			parsed, _ := url.Parse(value)
			if !validImage(value) || parsed != nil && strings.HasPrefix(parsed.Path, mediaURLPrefix) && a.sameMediaOrigin(parsed, r) {
				return nil, false, bad("图片必须为有效的http(s)地址，托管图片须使用规范相对地址")
			}
		}
		result = append(result, value)
	}
	return result, hosted, nil
}
func (a *App) sameMediaOrigin(parsed *url.URL, r *http.Request) bool {
	if strings.EqualFold(parsed.Host, r.Host) {
		return true
	}
	for _, origin := range a.cfg.Origins {
		allowed, err := url.Parse(origin)
		if err == nil && strings.EqualFold(allowed.Host, parsed.Host) && strings.EqualFold(allowed.Scheme, parsed.Scheme) {
			return true
		}
	}
	return false
}
