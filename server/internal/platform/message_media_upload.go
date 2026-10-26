package platform

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"regexp"
	"time"
)

var conversationMediaUploadPathPattern = regexp.MustCompile(`^/api/v1/conversations/[^/]+/media/images$`)

func stateConversationMember(s *State, id, user string) bool {
	c, ok := s.Conversations[id]
	if !ok {
		return false
	}
	for _, member := range c.Members {
		if member == user {
			return true
		}
	}
	return false
}
func (a *App) uploadConversationMediaImage(w http.ResponseWriter, r *http.Request) {
	store, ok := a.store.(*PostgresStore)
	if !ok {
		writeError(w, mediaUnavailable())
		return
	}
	if a.cfg.MediaDirectory == "" {
		writeError(w, mediaUnavailable())
		return
	}
	id := r.PathValue("id")
	authorize := func(tx pgx.Tx, lock bool) (PublicUser, error) {
		u, e := a.messagingSQLActor(r, tx, lock)
		if e != nil {
			return u, e
		}
		mode := ""
		if lock {
			if e = prepareDirectContact(r.Context(), tx, id, u.ID); e != nil {
				return u, e
			}
			mode = "send"
		}
		c, e := messagingSQLConversation(r.Context(), tx, id, u.ID, mode)
		if e != nil {
			return u, e
		}
		if c.Kind == "channel" && c.OwnerID != u.ID {
			return u, forbidden("只有频道所有者可以发布消息")
		}
		return u, nil
	}
	tx, err := store.pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		writeError(w, err)
		return
	}
	actor, err := authorize(tx, false)
	_ = tx.Rollback(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	select {
	case a.media.uploads <- struct{}{}:
		defer func() { <-a.media.uploads }()
	default:
		w.Header().Set("Retry-After", "1")
		writeError(w, &APIError{429, "media_busy", "图片上传繁忙，请稍后重试"})
		return
	}
	unlock, err := a.media.account(r.Context(), actor.ID)
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
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])
	existing := func(tx pgx.Tx, u PublicUser) (*MediaAsset, error) {
		v, e := scanStoredMedia(tx.QueryRow(r.Context(), `SELECT `+mediaSQLFields+` FROM gongming_media_assets WHERE owner_id=$1 AND client_id=$2`, u.ID, clientID))
		if errors.Is(e, pgx.ErrNoRows) {
			return nil, nil
		}
		if e != nil {
			return nil, e
		}
		if v.SourceHash != hash || v.Scope != "conversation" || v.ConversationID != id {
			return nil, conflict("clientId 已用于不同的图片内容或作用域")
		}
		if v.DeletedAt != nil {
			return nil, conflict("图片已删除，请使用新的clientId")
		}
		return &v.MediaAsset, nil
	}
	tx, err = store.pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		writeError(w, err)
		return
	}
	u, err := authorize(tx, false)
	var old *MediaAsset
	if err == nil {
		old, err = existing(tx, u)
	}
	_ = tx.Rollback(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	if old != nil {
		writeJSON(w, 200, *old)
		return
	}

	tx, err = store.pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		writeError(w, err)
		return
	}
	_, err = authorize(tx, false)
	if err == nil {
		var c StoredConversation
		c, err = messagingSQLConversation(r.Context(), tx, id, actor.ID, "")
		if err == nil {
			err = checkDirectContact(r.Context(), tx, c, actor.ID)
		}
	}
	_ = tx.Rollback(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	if !a.limiter.allow("media:"+actor.ID, 30, time.Hour, a.now()) {
		w.Header().Set("Retry-After", "3600")
		writeError(w, &APIError{429, "rate_limited", "每小时最多上传30次"})
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
	assetID := newID("media_")
	v := StoredMediaAsset{MediaAsset: MediaAsset{ID: assetID, URL: mediaURLPrefix + assetID, ContentType: contentType, Width: width, Height: height, Bytes: int64(len(encoded)), CreatedAt: now, Scope: "conversation", ConversationID: id}, OwnerID: actor.ID, ClientID: clientID, SourceHash: hash, Status: "ready", UpdatedAt: now}
	if err = writeMediaFile(a.cfg.MediaDirectory, v, encoded); err != nil {
		writeError(w, mediaUnavailable())
		return
	}
	result, err := a.walletTransaction(r, store, func(tx pgx.Tx) (walletCommit, error) {
		u, e := authorize(tx, true)
		if e != nil {
			return walletCommit{}, e
		}
		if u.ID != actor.ID {
			return walletCommit{}, conflict("账号已切换，请重新上传")
		}
		old, e := existing(tx, u)
		if e != nil {
			return walletCommit{}, e
		}
		if old != nil {
			return walletCommit{Data: *old}, nil
		}
		c, e := messagingSQLConversation(r.Context(), tx, id, u.ID, "")
		if e != nil {
			return walletCommit{}, e
		}
		if e = checkDirectContact(r.Context(), tx, c, u.ID); e != nil {
			return walletCommit{}, e
		}
		var count int
		var size int64
		e = tx.QueryRow(r.Context(), `SELECT count(*),COALESCE(sum(bytes),0) FROM gongming_media_assets WHERE owner_id=$1 AND deleted_at IS NULL`, u.ID).Scan(&count, &size)
		if e != nil {
			return walletCommit{}, e
		}
		if count >= mediaAccountCount || size+v.Bytes > mediaAccountBytes {
			return walletCommit{}, &APIError{409, "media_quota_exceeded", "图片额度已满"}
		}
		e = execRow(r.Context(), tx, `INSERT INTO gongming_media_assets(id,owner_id,client_id,source_hash,content_type,width,height,bytes,status,note,created_at,updated_at,deleted_at,scope,circle_id,conversation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ready','',$9,$9,NULL,'conversation',NULL,$10)`, v.ID, v.OwnerID, v.ClientID, v.SourceHash, v.ContentType, v.Width, v.Height, v.Bytes, v.CreatedAt, id)
		return walletCommit{Data: v.MediaAsset}, e
	})
	if err != nil {
		a.compensateMediaFile(v, err)
		writeError(w, err)
		return
	}
	saved := result.Data.(MediaAsset)
	status := 201
	if saved.ID != v.ID {
		_ = removeMediaFile(a.cfg.MediaDirectory, v)
		status = 200
	}
	writeJSON(w, status, saved)
}
