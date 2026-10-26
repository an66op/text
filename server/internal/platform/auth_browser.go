package platform

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"time"
)

const browserCookieName = "gongming_auth_browser"
const browserLifetime = 30 * 24 * time.Hour

type browserMutationKey struct{}
type browserGateKey struct{}
type browserCredential struct {
	SessionHash, BrowserHash string
	Bypass                   bool
}

func explicitAuthenticationPath(path string) bool {
	switch path {
	case "/api/v1/auth/context", "/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/logout", "/api/v1/auth/wallet/config", "/api/v1/auth/wallet/challenge", "/api/v1/auth/wallet/verify":
		return true
	}
	return false
}
func verifyBrowserSnapshot(ctx context.Context, tx pgx.Tx) error {
	c, ok := ctx.Value(browserGateKey{}).(browserCredential)
	if !ok || c.Bypass || c.SessionHash == "" {
		return nil
	}
	var exists, valid bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gongming_sessions WHERE token_hash=$1),EXISTS(SELECT 1 FROM gongming_sessions s WHERE s.token_hash=$1 AND `+browserSessionPredicate("s", "$2")+`)`, c.SessionHash, c.BrowserHash).Scan(&exists, &valid); err != nil {
		return err
	}
	if exists && !valid {
		return unauthorized()
	}
	return nil
}

type browserMutation struct {
	Hash, Expected, Generation, NextSession, RequestSession string
	ExpiresAt                                               time.Time
	Now                                                     time.Time
}

func authContextChanged() *APIError {
	return &APIError{409, "auth_context_changed", "浏览器身份状态已更新，请刷新后重新确认"}
}
func sessionAuthMethod(s Session) string {
	if s.AuthMethod == "password" || s.AuthMethod == "wallet" {
		return s.AuthMethod
	}
	return "unknown"
}
func browserHash(r *http.Request) string {
	if c, e := r.Cookie(browserCookieName); e == nil && walletGenerationPattern.MatchString(c.Value) {
		return tokenHash(c.Value)
	}
	return ""
}
func browserCredentialHash(r *http.Request) string {
	hash := browserHash(r)
	if hash == "" && browserMode(r) {
		return "!invalid-browser-context"
	}
	return hash
}
func sessionRequestHash(r *http.Request) string {
	if c, e := r.Cookie(cookieName); e == nil {
		return tokenHash(c.Value)
	}
	return ""
}
func browserMode(r *http.Request) bool {
	_, e := r.Cookie(browserCookieName)
	return e == nil || r.Header.Get("X-Gongming-Browser") != "" || r.Header.Get("X-Gongming-Auth-Generation") != ""
}
func prepareBrowserMutation(r *http.Request, now time.Time, required bool) (*http.Request, *browserMutation, error) {
	if !required && !browserMode(r) {
		return r, nil, nil
	}
	hash := browserHash(r)
	gen := r.Header.Get("X-Gongming-Auth-Generation")
	if r.Header.Get("X-Gongming-Browser") != "1" || hash == "" || !walletGenerationPattern.MatchString(gen) {
		return r, nil, authContextChanged()
	}
	m := &browserMutation{Hash: hash, Expected: gen, RequestSession: sessionRequestHash(r), Now: now}
	return r.WithContext(context.WithValue(r.Context(), browserMutationKey{}, m)), m, nil
}
func lockBrowserMutation(ctx context.Context, tx pgx.Tx, m *browserMutation) error {
	if m == nil {
		return nil
	}
	var generation string
	err := tx.QueryRow(ctx, `SELECT generation,expires_at FROM gongming_auth_browser_contexts WHERE hash=$1 FOR UPDATE`, m.Hash).Scan(&generation, &m.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return authContextChanged()
	}
	if err != nil {
		return err
	}
	if generation != m.Expected || !m.ExpiresAt.After(m.Now) {
		return authContextChanged()
	}
	m.NextSession = ""
	m.Generation = ""
	return nil
}
func finishBrowserMutation(ctx context.Context, tx pgx.Tx, m *browserMutation) error {
	if m == nil {
		return nil
	}
	if _, err := tx.Exec(ctx, `DELETE FROM gongming_sessions WHERE token_hash<>$2 AND (token_hash=(SELECT current_session_hash FROM gongming_auth_browser_contexts WHERE hash=$1) OR (token_hash=$3 AND browser_context_hash IS NULL))`, m.Hash, m.NextSession, m.RequestSession); err != nil {
		return err
	}
	if m.NextSession != "" {
		tag, err := tx.Exec(ctx, `UPDATE gongming_sessions SET browser_context_hash=$2,expires_at=LEAST(expires_at,$3) WHERE token_hash=$1`, m.NextSession, m.Hash, m.ExpiresAt)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return errors.New("browser authentication session missing")
		}
	}
	m.Generation = newID("") + newID("")
	var pointer any
	if m.NextSession != "" {
		pointer = m.NextSession
	}
	_, err := tx.Exec(ctx, `UPDATE gongming_auth_browser_contexts SET current_session_hash=$2,generation=$3 WHERE hash=$1`, m.Hash, pointer, m.Generation)
	return err
}
func applyBrowserPasswordSession(r *http.Request, s *State, raw string, expires time.Time) time.Time {
	if m, ok := r.Context().Value(browserMutationKey{}).(*browserMutation); ok {
		m.NextSession = tokenHash(raw)
		if expires.After(m.ExpiresAt) {
			expires = m.ExpiresAt
			v := s.Sessions[m.NextSession]
			v.ExpiresAt = expires
			s.Sessions[m.NextSession] = v
		}
	}
	return expires
}

// Every HTTP surface, including public media and upgrades, shares this gate.
// A browser cookie is never itself a session and never recovers a stale session.
func (a *App) browserSessionGate(r *http.Request) error {
	switch r.URL.Path {
	case "/api/v1/auth/context", "/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/logout", "/api/v1/auth/wallet/config", "/api/v1/auth/wallet/challenge", "/api/v1/auth/wallet/verify":
		return nil
	}
	if _, ok := a.store.(*PostgresStore); !ok && browserMode(r) {
		return &APIError{503, "unavailable", "浏览器身份需要 PostgreSQL"}
	}
	if browserMode(r) && browserHash(r) == "" && sessionRequestHash(r) != "" {
		return unauthorized()
	}
	if sessionRequestHash(r) == "" {
		return nil
	}
	s, ok := a.store.(*PostgresStore)
	if !ok {
		return nil
	}
	var valid bool
	err := s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM gongming_sessions s WHERE s.token_hash=$1 AND `+browserSessionPredicate("s", "$2")+`)`, sessionRequestHash(r), browserHash(r)).Scan(&valid)
	if err != nil {
		return err
	}
	if !valid {
		// A nonexistent/expired credential keeps the existing optional-auth behavior;
		// an existing mismatched credential must not be used by any read/write domain.
		var exists bool
		if err = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM gongming_sessions WHERE token_hash=$1)`, sessionRequestHash(r)).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return unauthorized()
		}
	}
	return nil
}
func browserSessionPredicate(alias, param string) string {
	return `((` + param + `='' AND ` + alias + `.browser_context_hash IS NULL AND ` + alias + `.auth_method<>'wallet') OR (` + param + `<>'' AND ` + alias + `.browser_context_hash=` + param + ` AND EXISTS(SELECT 1 FROM gongming_auth_browser_contexts b WHERE b.hash=` + param + ` AND b.current_session_hash=` + alias + `.token_hash AND b.expires_at>now())))`
}
func (a *App) authContext(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Gongming-Browser") != "1" || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		writeError(w, authContextChanged())
		return
	}
	s, ok := a.store.(*PostgresStore)
	if !ok {
		writeError(w, &APIError{503, "unavailable", "浏览器身份需要 PostgreSQL"})
		return
	}
	var generation string
	var expiry time.Time
	if hash := browserHash(r); hash != "" {
		err := s.pool.QueryRow(r.Context(), `SELECT generation,expires_at FROM gongming_auth_browser_contexts WHERE hash=$1 AND expires_at>$2`, hash, a.now()).Scan(&generation, &expiry)
		if err == nil {
			writeJSON(w, 200, map[string]any{"generation": generation, "expiresAt": expiry.UTC()})
			return
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			writeError(w, err)
			return
		}
	}
	if !a.limiter.allow("auth-context:"+clientIP(r), 60, time.Hour, a.now()) {
		writeError(w, &APIError{429, "rate_limited", "浏览器身份初始化过于频繁"})
		return
	}
	raw := newID("") + newID("")
	generation = newID("") + newID("")
	expiry = a.now().UTC().Truncate(time.Microsecond).Add(browserLifetime)
	if _, err := s.pool.Exec(r.Context(), `INSERT INTO gongming_auth_browser_contexts(hash,generation,expires_at) VALUES($1,$2,$3)`, tokenHash(raw), generation, expiry); err != nil {
		writeError(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: browserCookieName, Value: raw, Path: "/api/v1", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: a.cfg.CookieSecure, Expires: expiry, MaxAge: int(browserLifetime.Seconds())})
	writeJSON(w, 200, map[string]any{"generation": generation, "expiresAt": expiry})
}
