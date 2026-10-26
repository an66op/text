package platform

import (
	"net/http"
	"sort"
	"strings"
	"time"
)

const unknownSessionDevice = "未知设备"

// sessionDevice is only a coarse, untrusted user-agent hint. Never store or
// return the original header, IP address, token, or its authentication digest.
func sessionDevice(userAgent string) string {
	if len(userAgent) > 2048 {
		userAgent = userAgent[:2048]
	}
	value := strings.ToLower(userAgent)
	os := ""
	switch {
	case strings.Contains(value, "iphone") || strings.Contains(value, "ipad") || strings.Contains(value, "ipod"):
		os = "iOS"
	case strings.Contains(value, "android"):
		os = "Android"
	case strings.Contains(value, "cros"):
		os = "ChromeOS"
	case strings.Contains(value, "windows"):
		os = "Windows"
	case strings.Contains(value, "macintosh") || strings.Contains(value, "mac os x"):
		os = "macOS"
	case strings.Contains(value, "linux"):
		os = "Linux"
	}
	browser := ""
	switch {
	case strings.Contains(value, "edg/") || strings.Contains(value, "edga/") || strings.Contains(value, "edgios/"):
		browser = "Edge"
	case strings.Contains(value, "opr/") || strings.Contains(value, "opera"):
		browser = "Opera"
	case strings.Contains(value, "firefox/") || strings.Contains(value, "fxios/"):
		browser = "Firefox"
	case strings.Contains(value, "chrome/") || strings.Contains(value, "crios/") || strings.Contains(value, "chromium/"):
		browser = "Chrome"
	case strings.Contains(value, "safari/"):
		browser = "Safari"
	}
	if os == "" && browser == "" {
		return unknownSessionDevice
	}
	if os == "" {
		os = "未知系统"
	}
	if browser == "" {
		browser = "未知浏览器"
	}
	return os + " · " + browser
}

// Only imported sessions lacking the new metadata are assigned a public ID.
// Unknown historical creation/validation times remain null instead of now().
func normalizeLegacySessionMetadata(s *State) {
	for hash, session := range s.Sessions {
		if session.ID != "" {
			continue
		}
		session.ID = newID("session_")
		session.Device = unknownSessionDevice
		session.CreatedAt = nil
		session.LastSeenAt = nil
		session.Legacy = true
		s.Sessions[hash] = session
	}
}

type DeviceSession struct {
	ID         string     `json:"id"`
	Device     string     `json:"device"`
	CreatedAt  *time.Time `json:"createdAt"`
	LastSeenAt *time.Time `json:"lastSeenAt"`
	ExpiresAt  time.Time  `json:"expiresAt"`
	Current    bool       `json:"current"`
	Legacy     bool       `json:"legacy"`
}

func utcSessionTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	utc := value.UTC()
	return &utc
}

func (a *App) registerDeviceSessionRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/me/sessions", a.endpoint(false, "member", a.deviceSessions))
	mux.HandleFunc("DELETE /api/v1/me/sessions/{id}", a.revokeDeviceSession)
	mux.HandleFunc("POST /api/v1/me/sessions/revoke-others", a.endpoint(true, "member", a.revokeOtherDeviceSessions))
}

func (a *App) deviceSessions(s *State, u *User, r *http.Request) (any, error) {
	cookie, _ := r.Cookie(cookieName)
	currentHash := tokenHash(cookie.Value)
	items := []DeviceSession{}
	for hash, session := range s.Sessions {
		if session.UserID != u.ID || !session.ExpiresAt.After(a.now()) {
			continue
		}
		items = append(items, DeviceSession{ID: session.ID, Device: session.Device, CreatedAt: utcSessionTime(session.CreatedAt), LastSeenAt: utcSessionTime(session.LastSeenAt), ExpiresAt: session.ExpiresAt.UTC(), Current: hash == currentHash, Legacy: session.Legacy})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Current != items[j].Current {
			return items[i].Current
		}
		if items[i].CreatedAt == nil && items[j].CreatedAt != nil {
			return false
		}
		if items[i].CreatedAt != nil && items[j].CreatedAt == nil {
			return true
		}
		if items[i].CreatedAt != nil && items[j].CreatedAt != nil && !items[i].CreatedAt.Equal(*items[j].CreatedAt) {
			return items[i].CreatedAt.After(*items[j].CreatedAt)
		}
		return items[i].ID < items[j].ID
	})
	return map[string]any{"items": items, "total": len(items)}, nil
}

type DeviceSessionRevocation struct {
	OK      bool `json:"ok"`
	Current bool `json:"current"`
}

func (a *App) revokeDeviceSession(w http.ResponseWriter, r *http.Request) {
	result, err := a.execute(r, true, "member", func(s *State, u *User) (any, error) {
		cookie, _ := r.Cookie(cookieName)
		currentHash := tokenHash(cookie.Value)
		for hash, session := range s.Sessions {
			if session.UserID == u.ID && session.ID == r.PathValue("id") && session.ExpiresAt.After(a.now()) {
				delete(s.Sessions, hash)
				return DeviceSessionRevocation{OK: true, Current: hash == currentHash}, nil
			}
		}
		return nil, missing("登录会话不存在或已撤销")
	})
	if err != nil {
		writeError(w, err)
		return
	}
	receipt := result.(DeviceSessionRevocation)
	if receipt.Current {
		a.clearSessionCookie(w)
	}
	writeJSON(w, 200, receipt)
}

func (a *App) revokeOtherDeviceSessions(s *State, u *User, r *http.Request) (any, error) {
	var input struct{}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	cookie, _ := r.Cookie(cookieName)
	currentHash := tokenHash(cookie.Value)
	revoked := 0
	for hash, session := range s.Sessions {
		if hash != currentHash && session.UserID == u.ID && session.ExpiresAt.After(a.now()) {
			delete(s.Sessions, hash)
			revoked++
		}
	}
	return map[string]int{"revoked": revoked}, nil
}
