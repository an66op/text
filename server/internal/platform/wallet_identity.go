package platform

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

type WalletBinding struct {
	ID      string    `json:"id"`
	Address string    `json:"address"`
	BoundAt time.Time `json:"boundAt"`
}
type WalletChallenge struct {
	ID        string    `json:"id"`
	Purpose   string    `json:"purpose"`
	Message   string    `json:"message"`
	Address   string    `json:"address"`
	ChainID   string    `json:"chainId"`
	Origin    string    `json:"origin"`
	URI       string    `json:"uri"`
	IssuedAt  time.Time `json:"issuedAt"`
	ExpiresAt time.Time `json:"expiresAt"`
}
type storedWalletChallenge struct {
	WalletChallenge
	RawAddress                                              []byte
	BrowserHash, Generation, UserID, SessionHash, BindingID string
	AccountVersion                                          int64
	Attempts                                                int
	ConsumedAt                                              *time.Time
}
type walletCommit struct {
	Data    any
	Error   error
	Token   string
	Expires time.Time
}

func walletProofFailed() *APIError {
	return &APIError{403, "wallet_proof_failed", "钱包签名或密码复核未通过"}
}
func walletChallengeInvalid() *APIError {
	return &APIError{409, "wallet_challenge_invalid", "钱包确认已失效，请重新发起"}
}

func (a *App) registerWalletIdentityRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/auth/context", a.authContext)
	mux.HandleFunc("GET /api/v1/auth/wallet/config", func(w http.ResponseWriter, r *http.Request) {
		origins, chains := a.cfg.walletSettings()
		if origins == nil {
			origins = []string{}
		}
		if chains == nil {
			chains = []string{}
		}
		writeJSON(w, 200, map[string]any{"enabled": len(origins) > 0 && len(chains) > 0, "origins": origins, "chains": chains, "maxBindings": 5, "challengeTTLSeconds": 300, "contractWallets": false})
	})
	mux.HandleFunc("POST /api/v1/auth/wallet/challenge", a.walletChallenge)
	mux.HandleFunc("POST /api/v1/auth/wallet/verify", a.walletVerify)
	mux.HandleFunc("GET /api/v1/me/wallet-bindings", a.walletBindings)
	mux.HandleFunc("DELETE /api/v1/me/wallet-bindings/{id}", a.walletUnbind)
}
func (a *App) walletStore(w http.ResponseWriter) *PostgresStore {
	s, ok := a.store.(*PostgresStore)
	if !ok {
		writeError(w, &APIError{503, "unavailable", "钱包身份需要 PostgreSQL"})
		return nil
	}
	return s
}
func (a *App) walletOrigin(r *http.Request) (string, error) {
	origins, chains := a.cfg.walletSettings()
	if len(origins) == 0 || len(chains) == 0 {
		return "", forbidden("钱包身份未启用")
	}
	for _, origin := range origins {
		if origin == r.Header.Get("Origin") {
			return origin, nil
		}
	}
	return "", forbidden("此来源不提供钱包身份验证")
}
func (a *App) walletTransaction(r *http.Request, s *PostgresStore, fn func(pgx.Tx) (walletCommit, error)) (walletCommit, error) {
	for attempt := 0; attempt < 20; attempt++ {
		tx, e := s.pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
		if e != nil {
			return walletCommit{}, e
		}
		result, e := fn(tx)
		if e == nil {
			e = tx.Commit(r.Context())
		} else {
			_ = tx.Rollback(r.Context())
		}
		if e == nil {
			return result, nil
		}
		_ = tx.Rollback(r.Context())
		if !retryableTransaction(e) {
			return walletCommit{}, e
		}
		timer := time.NewTimer(time.Duration(min(150, 5*(attempt+1))) * time.Millisecond)
		select {
		case <-r.Context().Done():
			timer.Stop()
			return walletCommit{}, r.Context().Err()
		case <-timer.C:
		}
	}
	return walletCommit{}, &APIError{503, "transaction_conflict", "操作繁忙，请稍后重试"}
}
func writeWalletCommit(w http.ResponseWriter, result walletCommit, err error) {
	if err != nil {
		writeError(w, err)
		return
	}
	if result.Error != nil {
		writeError(w, result.Error)
		return
	}
	writeJSON(w, 200, result.Data)
}
func (a *App) walletChallenge(w http.ResponseWriter, r *http.Request) {
	s := a.walletStore(w)
	if s == nil {
		return
	}
	origin, err := a.walletOrigin(r)
	if err != nil {
		writeError(w, err)
		return
	}
	r, m, err := prepareBrowserMutation(r, a.now(), true)
	if err != nil {
		writeError(w, err)
		return
	}
	var input struct {
		Purpose  string `json:"purpose"`
		Address  string `json:"address"`
		ChainID  string `json:"chainId"`
		Password string `json:"password"`
	}
	if err = decode(r, &input); err != nil {
		writeError(w, err)
		return
	}
	if input.Purpose != "login" && input.Purpose != "bind" {
		writeError(w, bad("钱包确认用途无效"))
		return
	}
	if input.Purpose == "login" && input.Password != "" {
		writeError(w, bad("钱包登录不接收密码"))
		return
	}
	address, err := parseWalletAddress(input.Address)
	if err != nil {
		writeError(w, err)
		return
	}
	_, chains := a.cfg.walletSettings()
	found := false
	for _, chain := range chains {
		if chain == input.ChainID {
			found = true
		}
	}
	if !found || !canonicalChainPattern.MatchString(input.ChainID) {
		writeError(w, bad("此网络不提供钱包身份验证"))
		return
	}
	if len(input.Password) > 72 {
		writeError(w, walletProofFailed())
		return
	}
	if !a.limiter.allow("wallet-challenge:"+clientIP(r), 30, 15*time.Minute, a.now()) {
		writeError(w, &APIError{429, "rate_limited", "钱包确认请求过于频繁"})
		return
	}
	result, err := a.walletTransaction(r, s, func(tx pgx.Tx) (walletCommit, error) {
		if e := lockBrowserMutation(r.Context(), tx, m); e != nil {
			return walletCommit{}, e
		}
		now := a.now().UTC().Truncate(time.Second)
		expires := now.Add(5 * time.Minute)
		if expires.After(m.ExpiresAt) {
			expires = m.ExpiresAt
		}
		expires = expires.Truncate(time.Second)
		if !expires.After(now) {
			return walletCommit{}, authContextChanged()
		}
		var user, session, binding string
		var version int64
		if input.Purpose == "bind" {
			actor, e := a.messagingSQLActor(r, tx, false)
			if e != nil {
				return walletCommit{}, e
			}
			user = actor.ID
			session = sessionRequestHash(r)
			var hash string
			if e = tx.QueryRow(r.Context(), `SELECT password_hash,wallet_auth_version FROM gongming_users WHERE id=$1 FOR UPDATE`, user).Scan(&hash, &version); e != nil {
				return walletCommit{}, e
			}
			if _, e = a.messagingSQLActor(r, tx, true); e != nil {
				return walletCommit{}, e
			}
			if bcrypt.CompareHashAndPassword([]byte(hash), []byte(input.Password)) != nil {
				return walletCommit{}, walletProofFailed()
			}
			var count int
			if e = tx.QueryRow(r.Context(), `SELECT count(*) FROM gongming_wallet_bindings WHERE user_id=$1 AND revoked_at IS NULL`, user).Scan(&count); e != nil {
				return walletCommit{}, e
			}
			if count >= 5 {
				return walletCommit{}, conflict("最多绑定5个钱包")
			}
			var exists bool
			if e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM gongming_wallet_bindings WHERE address=$1 AND revoked_at IS NULL)`, address).Scan(&exists); e != nil {
				return walletCommit{}, e
			}
			if exists {
				return walletCommit{}, conflict("该钱包无法绑定")
			}
		} else {
			e := tx.QueryRow(r.Context(), `SELECT b.id,u.id,u.wallet_auth_version FROM gongming_wallet_bindings b JOIN gongming_users u ON u.id=b.user_id WHERE b.address=$1 AND b.revoked_at IS NULL`, address).Scan(&binding, &user, &version)
			if e != nil && !errors.Is(e, pgx.ErrNoRows) {
				return walletCommit{}, e
			}
		}
		var count int
		if e := tx.QueryRow(r.Context(), `SELECT count(*) FROM gongming_siwe_challenges WHERE issued_at>$1 AND (browser_hash=$2 OR address=$3 OR ($4<>'' AND user_id=$4))`, now.Add(-time.Hour), m.Hash, address, user).Scan(&count); e != nil {
			return walletCommit{}, e
		}
		if count >= 30 {
			return walletCommit{}, &APIError{429, "rate_limited", "钱包确认请求过于频繁，请稍后重试"}
		}
		id := newID("challenge_")
		nonce := newID("") + newID("")
		uri := origin + "/login/wallet"
		if input.Purpose == "bind" {
			uri = origin + "/account/wallets"
		}
		dto := WalletChallenge{ID: id, Purpose: input.Purpose, Address: walletChecksum(address), ChainID: input.ChainID, Origin: origin, URI: uri, IssuedAt: now, ExpiresAt: expires}
		dto.Message = canonicalWalletMessage(id, input.Purpose, origin, uri, dto.Address, input.ChainID, nonce, user, now, expires)
		_, e := tx.Exec(r.Context(), `INSERT INTO gongming_siwe_challenges(id,purpose,address,chain_id,origin,uri,message,nonce,issued_at,expires_at,browser_hash,generation,user_id,session_hash,account_version,binding_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, id, input.Purpose, address, input.ChainID, origin, uri, dto.Message, nonce, now, expires, m.Hash, m.Expected, nullString(user), nullString(session), version, nullString(binding))
		return walletCommit{Data: dto}, e
	})
	writeWalletCommit(w, result, err)
}
func scanWalletChallenge(row messagingSQLScanner) (storedWalletChallenge, error) {
	c := storedWalletChallenge{}
	err := row.Scan(&c.ID, &c.Purpose, &c.RawAddress, &c.ChainID, &c.Origin, &c.URI, &c.Message, &c.IssuedAt, &c.ExpiresAt, &c.BrowserHash, &c.Generation, &c.UserID, &c.SessionHash, &c.AccountVersion, &c.BindingID, &c.Attempts, &c.ConsumedAt)
	c.Address = walletChecksum(c.RawAddress)
	return c, err
}
func (a *App) walletVerify(w http.ResponseWriter, r *http.Request) {
	s := a.walletStore(w)
	if s == nil {
		return
	}
	origin, err := a.walletOrigin(r)
	if err != nil {
		writeError(w, err)
		return
	}
	r, m, err := prepareBrowserMutation(r, a.now(), true)
	if err != nil {
		writeError(w, err)
		return
	}
	var input struct {
		ID        string `json:"id"`
		Message   string `json:"message"`
		Signature string `json:"signature"`
	}
	if err = decode(r, &input); err != nil {
		writeError(w, err)
		return
	}
	if !strings.HasPrefix(input.ID, "challenge_") || len(input.ID) != 42 || len(input.Message) > 2048 {
		writeError(w, bad("钱包确认格式无效"))
		return
	}
	if !a.limiter.allow("wallet-verify:"+clientIP(r), 60, 15*time.Minute, a.now()) {
		writeError(w, &APIError{429, "rate_limited", "钱包验证过于频繁"})
		return
	}
	result, err := a.walletTransaction(r, s, func(tx pgx.Tx) (walletCommit, error) {
		if e := lockBrowserMutation(r.Context(), tx, m); e != nil {
			return walletCommit{}, e
		}
		// Read the account identity before locking the challenge, then recheck every
		// immutable field after the account lock to share one lock order with unlink.
		var account string
		e := tx.QueryRow(r.Context(), `SELECT COALESCE(user_id,'') FROM gongming_siwe_challenges WHERE id=$1 AND browser_hash=$2`, input.ID, m.Hash).Scan(&account)
		if errors.Is(e, pgx.ErrNoRows) {
			return walletCommit{}, walletChallengeInvalid()
		}
		if e != nil {
			return walletCommit{}, e
		}
		var user User
		var version int64
		if account != "" {
			e = tx.QueryRow(r.Context(), `SELECT id,handle,name,email,avatar,bio,role,status,created_at,wallet_auth_version FROM gongming_users WHERE id=$1 FOR UPDATE`, account).Scan(&user.ID, &user.Handle, &user.Name, &user.Email, &user.Avatar, &user.Bio, &user.Role, &user.Status, &user.CreatedAt, &version)
			if e != nil {
				return walletCommit{}, e
			}
		}
		c, e := scanWalletChallenge(tx.QueryRow(r.Context(), `SELECT id,purpose,address,chain_id,origin,uri,message,issued_at,expires_at,browser_hash,generation,COALESCE(user_id,''),COALESCE(session_hash,''),account_version,COALESCE(binding_id,''),attempts,consumed_at FROM gongming_siwe_challenges WHERE id=$1 FOR UPDATE`, input.ID))
		if e != nil {
			return walletCommit{}, e
		}
		now := a.now().UTC().Truncate(time.Microsecond)
		if c.ConsumedAt != nil || c.Attempts >= 5 || !c.ExpiresAt.After(now) || now.Before(c.IssuedAt) || c.BrowserHash != m.Hash || c.Generation != m.Expected || c.Origin != origin {
			return walletCommit{}, walletChallengeInvalid()
		}
		if account != "" && (version != c.AccountVersion || user.Status != "active") {
			return walletCommit{}, walletChallengeInvalid()
		}
		if c.Purpose == "bind" {
			actor, e := a.messagingSQLActor(r, tx, true)
			if e != nil {
				return walletCommit{}, e
			}
			if actor.ID != c.UserID || sessionRequestHash(r) != c.SessionHash {
				return walletCommit{}, walletChallengeInvalid()
			}
		}
		valid := false
		var proofErr error
		if input.Message == c.Message {
			valid, proofErr = verifyWalletSignature(c.Message, input.Signature, c.RawAddress)
		}
		if !valid {
			if _, e = tx.Exec(r.Context(), `UPDATE gongming_siwe_challenges SET attempts=attempts+1 WHERE id=$1`, c.ID); e != nil {
				return walletCommit{}, e
			}
			if proofErr == nil {
				proofErr = walletProofFailed()
			}
			return walletCommit{Error: proofErr}, nil
		}
		if c.Purpose == "bind" {
			var count int
			var exists bool
			if e = tx.QueryRow(r.Context(), `SELECT count(*),EXISTS(SELECT 1 FROM gongming_wallet_bindings WHERE address=$2 AND revoked_at IS NULL) FROM gongming_wallet_bindings WHERE user_id=$1 AND revoked_at IS NULL`, user.ID, c.RawAddress).Scan(&count, &exists); e != nil {
				return walletCommit{}, e
			}
			if count >= 5 || exists {
				return walletCommit{}, conflict("该钱包无法绑定")
			}
			binding := WalletBinding{ID: newID("binding_"), Address: c.Address, BoundAt: now}
			if _, e = tx.Exec(r.Context(), `INSERT INTO gongming_wallet_bindings(id,user_id,address,bound_at) VALUES($1,$2,$3,$4)`, binding.ID, user.ID, c.RawAddress, now); e != nil {
				return walletCommit{}, e
			}
			if _, e = tx.Exec(r.Context(), `UPDATE gongming_users SET wallet_auth_version=wallet_auth_version+1 WHERE id=$1`, user.ID); e != nil {
				return walletCommit{}, e
			}
			if e = walletAudit(r.Context(), tx, user.ID, "wallet.bind", binding.ID, "EOA wallet credential added", now); e != nil {
				return walletCommit{}, e
			}
			if _, e = tx.Exec(r.Context(), `UPDATE gongming_siwe_challenges SET consumed_at=$2 WHERE id=$1`, c.ID, now); e != nil {
				return walletCommit{}, e
			}
			return walletCommit{Data: map[string]any{"binding": binding}}, nil
		}
		if c.BindingID == "" || user.ID == "" {
			if _, e = tx.Exec(r.Context(), `UPDATE gongming_siwe_challenges SET attempts=attempts+1 WHERE id=$1`, c.ID); e != nil {
				return walletCommit{}, e
			}
			return walletCommit{Error: walletProofFailed()}, nil
		}
		var active bool
		if e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM gongming_wallet_bindings WHERE id=$1 AND user_id=$2 AND address=$3 AND revoked_at IS NULL FOR UPDATE)`, c.BindingID, user.ID, c.RawAddress).Scan(&active); e != nil {
			return walletCommit{}, e
		}
		if !active {
			return walletCommit{}, walletChallengeInvalid()
		}
		token := newID("") + newID("")
		expiry := now.Add(a.cfg.SessionTTL)
		if expiry.After(m.ExpiresAt) {
			expiry = m.ExpiresAt
		}
		if _, e = tx.Exec(r.Context(), `INSERT INTO gongming_sessions(token_hash,user_id,expires_at,public_id,device,created_at,last_seen_at,legacy,auth_method,browser_context_hash) VALUES($1,$2,$3,$4,$5,$6,$6,false,'wallet',$7)`, tokenHash(token), user.ID, expiry, newID("session_"), sessionDevice(r.UserAgent()), now, m.Hash); e != nil {
			return walletCommit{}, e
		}
		if _, e = tx.Exec(r.Context(), `INSERT INTO gongming_wallet_session_proofs(token_hash,binding_id,chain_id) VALUES($1,$2,$3)`, tokenHash(token), c.BindingID, c.ChainID); e != nil {
			return walletCommit{}, e
		}
		m.NextSession = tokenHash(token)
		if e = finishBrowserMutation(r.Context(), tx, m); e != nil {
			return walletCommit{}, e
		}
		if e = walletAudit(r.Context(), tx, user.ID, "wallet.login", c.BindingID, "EOA wallet sign-in", now); e != nil {
			return walletCommit{}, e
		}
		if _, e = tx.Exec(r.Context(), `UPDATE gongming_siwe_challenges SET consumed_at=$2 WHERE id=$1`, c.ID, now); e != nil {
			return walletCommit{}, e
		}
		return walletCommit{Data: map[string]any{"user": user, "expiresAt": expiry, "authGeneration": m.Generation}, Token: token, Expires: expiry}, nil
	})
	if err == nil && result.Error == nil && result.Token != "" {
		a.setSessionCookie(w, result.Token, result.Expires)
	}
	writeWalletCommit(w, result, err)
}
func walletAudit(ctx context.Context, tx pgx.Tx, user, action, target, note string, now time.Time) error {
	_, e := tx.Exec(ctx, `INSERT INTO gongming_audits(id,actor_id,actor_name,action,target_id,detail,created_at) SELECT $1,$2,name,$3,$4,$5,$6 FROM gongming_users WHERE id=$2`, newID("audit_"), user, action, target, note, now)
	return e
}
func (a *App) walletBindings(w http.ResponseWriter, r *http.Request) {
	s := a.walletStore(w)
	if s == nil {
		return
	}
	result, err := a.walletTransaction(r, s, func(tx pgx.Tx) (walletCommit, error) {
		actor, e := a.messagingSQLActor(r, tx, false)
		if e != nil {
			return walletCommit{}, e
		}
		rows, e := tx.Query(r.Context(), `SELECT id,address,bound_at FROM gongming_wallet_bindings WHERE user_id=$1 AND revoked_at IS NULL ORDER BY bound_at DESC,id`, actor.ID)
		if e != nil {
			return walletCommit{}, e
		}
		defer rows.Close()
		items := []WalletBinding{}
		for rows.Next() {
			var item WalletBinding
			var address []byte
			if e = rows.Scan(&item.ID, &address, &item.BoundAt); e != nil {
				return walletCommit{}, e
			}
			item.Address = walletChecksum(address)
			item.BoundAt = item.BoundAt.UTC()
			items = append(items, item)
		}
		return walletCommit{Data: map[string]any{"items": items, "maxBindings": 5, "hasPassword": true}}, rows.Err()
	})
	writeWalletCommit(w, result, err)
}
func (a *App) walletUnbind(w http.ResponseWriter, r *http.Request) {
	s := a.walletStore(w)
	if s == nil {
		return
	}
	r, m, err := prepareBrowserMutation(r, a.now(), true)
	if err != nil {
		writeError(w, err)
		return
	}
	var input struct {
		Password string `json:"password"`
	}
	if err = decode(r, &input); err != nil {
		writeError(w, err)
		return
	}
	if len(input.Password) > 72 {
		writeError(w, walletProofFailed())
		return
	}
	if !a.limiter.allow("wallet-unbind:"+clientIP(r), 15, 15*time.Minute, a.now()) {
		writeError(w, &APIError{429, "rate_limited", "钱包解绑过于频繁"})
		return
	}
	result, err := a.walletTransaction(r, s, func(tx pgx.Tx) (walletCommit, error) {
		if e := lockBrowserMutation(r.Context(), tx, m); e != nil {
			return walletCommit{}, e
		}
		actor, e := a.messagingSQLActor(r, tx, false)
		if e != nil {
			return walletCommit{}, e
		}
		var hash string
		if e = tx.QueryRow(r.Context(), `SELECT password_hash FROM gongming_users WHERE id=$1 FOR UPDATE`, actor.ID).Scan(&hash); e != nil {
			return walletCommit{}, e
		}
		if _, e = a.messagingSQLActor(r, tx, true); e != nil {
			return walletCommit{}, e
		}
		if bcrypt.CompareHashAndPassword([]byte(hash), []byte(input.Password)) != nil {
			return walletCommit{}, walletProofFailed()
		}
		var revoked *time.Time
		e = tx.QueryRow(r.Context(), `SELECT revoked_at FROM gongming_wallet_bindings WHERE id=$1 AND user_id=$2 FOR UPDATE`, r.PathValue("id"), actor.ID).Scan(&revoked)
		if errors.Is(e, pgx.ErrNoRows) {
			return walletCommit{}, missing("钱包绑定不存在")
		}
		if e != nil {
			return walletCommit{}, e
		}
		if revoked != nil {
			return walletCommit{Data: map[string]any{"ok": true, "revokedSessions": 0, "currentSessionRevoked": false}}, nil
		}
		now := a.now().UTC().Truncate(time.Microsecond)
		var current bool
		if e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM gongming_wallet_session_proofs WHERE binding_id=$1 AND token_hash=$2)`, r.PathValue("id"), sessionRequestHash(r)).Scan(&current); e != nil {
			return walletCommit{}, e
		}
		tag, e := tx.Exec(r.Context(), `DELETE FROM gongming_sessions WHERE token_hash IN (SELECT token_hash FROM gongming_wallet_session_proofs WHERE binding_id=$1)`, r.PathValue("id"))
		if e != nil {
			return walletCommit{}, e
		}
		if _, e = tx.Exec(r.Context(), `UPDATE gongming_wallet_bindings SET revoked_at=$2 WHERE id=$1`, r.PathValue("id"), now); e != nil {
			return walletCommit{}, e
		}
		if _, e = tx.Exec(r.Context(), `UPDATE gongming_users SET wallet_auth_version=wallet_auth_version+1 WHERE id=$1`, actor.ID); e != nil {
			return walletCommit{}, e
		}
		if e = walletAudit(r.Context(), tx, actor.ID, "wallet.unbind", r.PathValue("id"), "EOA wallet credential revoked", now); e != nil {
			return walletCommit{}, e
		}
		return walletCommit{Data: map[string]any{"ok": true, "revokedSessions": tag.RowsAffected(), "currentSessionRevoked": current}}, nil
	})
	writeWalletCommit(w, result, err)
}
