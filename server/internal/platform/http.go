package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const Version = "0.10.0"
const cookieName = "gongming_session"

type Config struct {
	Environment    string
	Origins        []string
	CookieSecure   bool
	SessionTTL     time.Duration
	BcryptCost     int
	MediaDirectory string
	WalletOrigins  []string
	WalletChains   []string
}

func (c Config) Validate() error {
	if c.Environment != "development" && c.Environment != "test" && c.Environment != "production" {
		return errors.New("APP_ENV must be development or production")
	}
	if c.Environment == "production" && (!c.CookieSecure || len(c.Origins) == 0) {
		return errors.New("production requires COOKIE_SECURE=true and ALLOWED_ORIGINS")
	}
	if c.Environment == "production" && c.MediaDirectory == "" {
		return errors.New("production requires MEDIA_DIRECTORY")
	}
	if c.MediaDirectory != "" && !filepath.IsAbs(c.MediaDirectory) {
		return errors.New("MEDIA_DIRECTORY must be an absolute private directory")
	}
	for _, origin := range c.Origins {
		u, err := url.Parse(origin)
		if err != nil || u.Host == "" || u.Path != "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil {
			return fmt.Errorf("invalid allowed origin %q", origin)
		}
		if c.Environment == "production" && u.Scheme != "https" {
			return errors.New("production origins require https")
		}
	}
	return c.validateWalletSettings()
}

type App struct {
	store     Store
	cfg       Config
	started   time.Time
	now       func() time.Time
	limiter   *rateLimiter
	dummyHash string
	streamHub *messageHub
	media     *mediaCoordinator
}
type APIError struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *APIError) Error() string        { return e.Message }
func bad(message string) *APIError       { return &APIError{400, "invalid_request", message} }
func forbidden(message string) *APIError { return &APIError{403, "forbidden", message} }
func missing(message string) *APIError   { return &APIError{404, "not_found", message} }
func conflict(message string) *APIError  { return &APIError{409, "conflict", message} }
func unauthorized() *APIError            { return &APIError{401, "unauthorized", "请先登录"} }
func NewApp(store Store, cfg Config) *App {
	if cfg.SessionTTL == 0 {
		cfg.SessionTTL = 7 * 24 * time.Hour
	}
	if cfg.BcryptCost == 0 {
		cfg.BcryptCost = 12
	}
	a := &App{store: store, cfg: cfg, started: time.Now(), now: time.Now, limiter: &rateLimiter{buckets: map[string]rateBucket{}}}
	a.dummyHash = hashPassword("timing-equivalent-unknown-user", cfg.BcryptCost)
	a.streamHub = newMessageHub(a)
	a.media = newMediaCoordinator()
	return a
}
func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	a.routes(mux)
	return a.middleware(mux)
}
func (a *App) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "same-origin")
		if r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" {
			allowed := false
			for _, origin := range a.cfg.Origins {
				if r.Header.Get("Origin") == origin {
					allowed = true
					break
				}
			}
			if !allowed {
				writeError(w, forbidden("请求来源未被允许"))
				return
			}
			if site := r.Header.Get("Sec-Fetch-Site"); site == "cross-site" {
				writeError(w, forbidden("不允许跨站写入"))
				return
			}
		}
		if !a.limiter.allow("global:"+clientIP(r), 600, time.Minute, a.now()) {
			w.Header().Set("Retry-After", "60")
			writeError(w, &APIError{429, "rate_limited", "请求过于频繁，请稍后重试"})
			return
		}
		bodyLimit := int64(1024 * 1024)
		if r.Method == "POST" && (r.URL.Path == "/api/v1/media/images" || circleMediaUploadPathPattern.MatchString(r.URL.Path) || conversationMediaUploadPathPattern.MatchString(r.URL.Path)) {
			bodyLimit = mediaMultipartLimit
		}
		r.Body = http.MaxBytesReader(w, r.Body, bodyLimit)
		ctx := r.Context()
		cancel := func() {}
		if r.URL.Path != "/api/v1/stream" {
			ctx, cancel = context.WithTimeout(ctx, 12*time.Second)
		}
		defer cancel()
		defer func() {
			if recovered := recover(); recovered != nil {
				slog.Error("request panic", "path", r.URL.Path, "value", recovered)
				writeError(w, &APIError{500, "internal_error", "服务暂时不可用"})
			}
		}()
		r = r.WithContext(ctx)
		if err := a.browserSessionGate(r); err != nil {
			writeError(w, err)
			return
		}
		r = r.WithContext(context.WithValue(r.Context(), browserGateKey{}, browserCredential{SessionHash: sessionRequestHash(r), BrowserHash: browserCredentialHash(r), Bypass: explicitAuthenticationPath(r.URL.Path)}))
		next.ServeHTTP(w, r)
	})
}
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
}
func writeError(w http.ResponseWriter, err error) {
	var api *APIError
	if !errors.As(err, &api) {
		slog.Error("API failure", "error", err)
		api = &APIError{500, "internal_error", "服务暂时不可用，请稍后重试"}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(api.Status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": api})
}
func decode(r *http.Request, dst any) error {
	if media := strings.Split(r.Header.Get("Content-Type"), ";")[0]; strings.TrimSpace(media) != "application/json" {
		return &APIError{415, "unsupported_media_type", "请使用 application/json"}
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var max *http.MaxBytesError
		if errors.As(err, &max) {
			return &APIError{413, "body_too_large", "请求内容过大"}
		}
		return bad("请求内容格式不正确")
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return bad("只允许一个 JSON 对象")
	}
	return nil
}
func (a *App) execute(r *http.Request, write bool, permission string, fn func(*State, *User) (any, error)) (any, error) {
	var result any
	var body []byte
	if write && r.Body != nil {
		var err error
		body, err = io.ReadAll(r.Body)
		if err != nil {
			var max *http.MaxBytesError
			if errors.As(err, &max) {
				return nil, &APIError{413, "body_too_large", "请求内容过大"}
			}
			return nil, bad("无法读取请求内容")
		}
	}
	run := func(s *State) error {
		if write {
			r.Body = io.NopCloser(bytes.NewReader(body))
		}
		var user *User
		if cookie, err := r.Cookie(cookieName); err == nil {
			if session, exists := s.Sessions[tokenHash(cookie.Value)]; exists && session.ExpiresAt.After(a.now()) {
				if account, exists := s.Accounts[session.UserID]; exists && account.User.Status == "active" {
					u := account.User
					user = &u
				}
			}
		}
		if expected := r.Header.Get("X-Gongming-Account"); expected != "" && r.URL.Path != "/api/v1/auth/me" && (user == nil || expected != user.ID) {
			return &APIError{409, "account_changed", "账号已切换，请重新确认后再操作"}
		}
		if permission != "" && user == nil {
			return unauthorized()
		}
		if permission == "staff" && !staff(user) {
			return forbidden("仅运营人员可访问")
		}
		if permission == "admin" && user.Role != "admin" {
			return forbidden("仅管理员可执行")
		}
		var err error
		result, err = fn(s, user)
		return err
	}
	var err error
	if write {
		err = a.store.Update(r.Context(), run)
	} else {
		err = a.store.Read(r.Context(), run)
	}
	return result, err
}
func (a *App) endpoint(write bool, permission string, fn func(*State, *User, *http.Request) (any, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		result, err := a.execute(r, write, permission, func(s *State, u *User) (any, error) { return fn(s, u, r) })
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}
func tokenHash(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
func (a *App) setSessionCookie(w http.ResponseWriter, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: token, Path: "/api/v1", Expires: expires, MaxAge: max(1, int(expires.Sub(a.now()).Seconds())), HttpOnly: true, Secure: a.cfg.CookieSecure, SameSite: http.SameSiteLaxMode})
}
func trimText(value string, max int) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || utf8.RuneCountInString(value) > max {
		return "", bad(fmt.Sprintf("内容不能为空且最多 %d 字", max))
	}
	return value, nil
}
func validImage(raw string) bool {
	if raw == "" {
		return true
	}
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil && len(raw) <= 2048
}

var handlePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{2,29}$`)
var requestPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,100}$`)

func queryEnum(r *http.Request, key string, allowed ...string) (string, error) {
	value := r.URL.Query().Get(key)
	if value == "" {
		return "", nil
	}
	for _, a := range allowed {
		if value == a {
			return value, nil
		}
	}
	return "", bad("筛选参数 " + key + " 不正确")
}
func list[T any](r *http.Request, items []T) (any, error) {
	limit := 30
	offset := 0
	var err error
	if value := r.URL.Query().Get("limit"); value != "" {
		limit, err = strconv.Atoi(value)
		if err != nil || limit < 1 || limit > 100 {
			return nil, bad("limit 必须为 1 到 100")
		}
	}
	if value := r.URL.Query().Get("offset"); value != "" {
		offset, err = strconv.Atoi(value)
		if err != nil || offset < 0 || offset > 100000 {
			return nil, bad("offset 不正确")
		}
	}
	total := len(items)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return map[string]any{"items": items[offset:end], "total": total}, nil
}
func matches(r *http.Request, text string) bool {
	return strings.Contains(strings.ToLower(text), strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q"))))
}

type rateBucket struct {
	Count int
	Reset time.Time
}
type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]rateBucket
}

func (l *rateLimiter) allow(key string, max int, window time.Duration, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.buckets) > 10000 {
		for k, b := range l.buckets {
			if now.After(b.Reset) {
				delete(l.buckets, k)
			}
		}
		if len(l.buckets) > 10000 {
			return false
		}
	}
	b := l.buckets[key]
	if !now.Before(b.Reset) {
		b = rateBucket{Reset: now.Add(window)}
	}
	if b.Count >= max {
		return false
	}
	b.Count++
	l.buckets[key] = b
	return true
}
