package platform

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"slices"
	"strings"
	"time"
)

type ContactPrivacy struct {
	DirectMessagePolicy  string     `json:"directMessagePolicy"`
	GroupInvitePolicy    string     `json:"groupInvitePolicy"`
	AllowFriendRequests  bool       `json:"allowFriendRequests"`
	DiscoverableByHandle bool       `json:"discoverableByHandle"`
	Revision             int64      `json:"revision"`
	UpdatedAt            *time.Time `json:"updatedAt"`
}
type BlockEntry struct {
	UserID    string      `json:"userId"`
	User      *PublicUser `json:"user"`
	Available bool        `json:"available"`
	CreatedAt time.Time   `json:"createdAt"`
}
type ContactCapabilities struct {
	UserID           string `json:"userId"`
	BlockedByMe      bool   `json:"blockedByMe"`
	CanMessage       bool   `json:"canMessage"`
	CanRequestFriend bool   `json:"canRequestFriend"`
	CanInvite        bool   `json:"canInvite"`
	Revision         int64  `json:"revision"`
}
type contactTarget struct {
	ContactPrivacy
	Active, Friended, BlockedByMe, Blocked bool
}
type contactCheck struct{ Actor, Target, Kind string }
type contactConversationResult struct {
	Viewer       string
	Conversation *Conversation
}

const contactPrivacyFields = `direct_message_policy,group_invite_policy,allow_friend_requests,discoverable_by_handle,revision,updated_at`

func defaultContactPrivacy() ContactPrivacy {
	return ContactPrivacy{DirectMessagePolicy: "everyone", GroupInvitePolicy: "everyone", AllowFriendRequests: true, DiscoverableByHandle: true}
}
func contactRestricted() error {
	return &APIError{403, "contact_restricted", "当前联系权限不允许此操作"}
}
func privacyConflict() error {
	return &APIError{409, "privacy_conflict", "联系隐私状态已变化，请刷新后重试"}
}
func validContactID(id string) bool {
	return id != "" && len(id) <= 128 && !strings.ContainsRune(id, 0)
}
func validContactPolicy(p string) bool { return p == "everyone" || p == "friends" || p == "nobody" }
func contactAllows(policy string, friend bool) bool {
	return policy == "everyone" || policy == "friends" && friend
}
func readContactPrivacy(ctx context.Context, tx pgx.Tx, id string) (ContactPrivacy, error) {
	v := defaultContactPrivacy()
	e := tx.QueryRow(ctx, `SELECT `+contactPrivacyFields+` FROM gongming_contact_preferences WHERE user_id=$1`, id).Scan(&v.DirectMessagePolicy, &v.GroupInvitePolicy, &v.AllowFriendRequests, &v.DiscoverableByHandle, &v.Revision, &v.UpdatedAt)
	if errors.Is(e, pgx.ErrNoRows) {
		return defaultContactPrivacy(), nil
	}
	if v.UpdatedAt != nil {
		v.UpdatedAt = utcSessionTime(v.UpdatedAt)
	}
	return v, e
}
func readContactTargets(ctx context.Context, tx pgx.Tx, actor string, ids []string) (map[string]contactTarget, error) {
	result := map[string]contactTarget{}
	if len(ids) == 0 {
		return result, nil
	}
	rows, e := tx.Query(ctx, `SELECT u.id,u.status='active',COALESCE(p.direct_message_policy,'everyone'),COALESCE(p.group_invite_policy,'everyone'),COALESCE(p.allow_friend_requests,true),COALESCE(p.discoverable_by_handle,true),EXISTS(SELECT 1 FROM gongming_friendships f WHERE f.user_a=LEAST(u.id COLLATE "C",$1::text COLLATE "C") AND f.user_b=GREATEST(u.id COLLATE "C",$1::text COLLATE "C")),EXISTS(SELECT 1 FROM gongming_user_blocks b WHERE b.owner_id=$1 AND b.target_id=u.id),EXISTS(SELECT 1 FROM gongming_user_blocks b WHERE (b.owner_id=$1 AND b.target_id=u.id) OR (b.owner_id=u.id AND b.target_id=$1)) FROM gongming_users u LEFT JOIN gongming_contact_preferences p ON p.user_id=u.id WHERE u.id=ANY($2::text[])`, actor, ids)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		v := contactTarget{}
		if e = rows.Scan(&id, &v.Active, &v.DirectMessagePolicy, &v.GroupInvitePolicy, &v.AllowFriendRequests, &v.DiscoverableByHandle, &v.Friended, &v.BlockedByMe, &v.Blocked); e != nil {
			return nil, e
		}
		result[id] = v
	}
	return result, rows.Err()
}

// Every dependent write locks guards in stable order. A real version update by
// policy/block/friend/status writes forces an older serializable snapshot to
// retry instead of authorizing with pre-lock policy data. Reads never create rows.
func lockContactGuards(ctx context.Context, tx pgx.Tx, ids []string, write bool) error {
	ids = slices.Clone(ids)
	slices.Sort(ids)
	ids = slices.Compact(ids)
	for _, id := range ids {
		if _, e := tx.Exec(ctx, `INSERT INTO gongming_contact_preferences(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING`, id); e != nil {
			return e
		}
	}
	mode := "SHARE"
	if write {
		mode = "UPDATE"
	}
	for _, id := range ids {
		var version int64
		if e := tx.QueryRow(ctx, `SELECT guard_version FROM gongming_contact_preferences WHERE user_id=$1 FOR `+mode, id).Scan(&version); e != nil {
			return e
		}
	}
	return nil
}
func bumpContactGuards(ctx context.Context, tx pgx.Tx, ids []string) error {
	ids = slices.Clone(ids)
	slices.Sort(ids)
	ids = slices.Compact(ids)
	for _, id := range ids {
		tag, e := tx.Exec(ctx, `UPDATE gongming_contact_preferences SET guard_version=guard_version+1 WHERE user_id=$1 AND guard_version<9007199254740991`, id)
		if e != nil {
			return e
		}
		if tag.RowsAffected() != 1 {
			return privacyConflict()
		}
	}
	return nil
}
func checkContactSQL(ctx context.Context, tx pgx.Tx, c contactCheck) error {
	targets, e := readContactTargets(ctx, tx, c.Actor, []string{c.Target})
	if e != nil {
		return e
	}
	v, ok := targets[c.Target]
	if !ok || !v.Active {
		return missing("成员不存在或已停用")
	}
	allowed := !v.Blocked
	switch c.Kind {
	case "message":
		allowed = allowed && contactAllows(v.DirectMessagePolicy, v.Friended)
	case "invite":
		allowed = allowed && contactAllows(v.GroupInvitePolicy, v.Friended)
	case "friend-request":
		allowed = allowed && v.AllowFriendRequests
	case "friend-accept":
	default:
		return bad("未知联系操作")
	}
	if !allowed {
		return contactRestricted()
	}
	return nil
}
func (a *App) registerContactPrivacyRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/me/contact-privacy", a.contactEndpoint("privacy", false))
	mux.HandleFunc("PUT /api/v1/me/contact-privacy", a.contactEndpoint("privacy", true))
	mux.HandleFunc("GET /api/v1/me/blocks", a.contactEndpoint("blocks", false))
	mux.HandleFunc("PUT /api/v1/me/blocks/{userId}", a.contactEndpoint("block", true))
	mux.HandleFunc("DELETE /api/v1/me/blocks/{userId}", a.contactEndpoint("unblock", true))
	mux.HandleFunc("GET /api/v1/contact-capabilities/{userId}", a.contactEndpoint("capabilities", false))
}
func (a *App) contactEndpoint(op string, write bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		store, ok := a.store.(*PostgresStore)
		if !ok {
			writeError(w, &APIError{503, "contact_privacy_unavailable", "联系隐私服务暂不可用"})
			return
		}
		var data any
		var e error
		if write {
			data, e = a.writeContactSQL(r, store, op)
		} else {
			data, e = a.readContactSQL(r, store, op)
		}
		if e != nil {
			writeError(w, e)
			return
		}
		writeJSON(w, 200, data)
	}
}
