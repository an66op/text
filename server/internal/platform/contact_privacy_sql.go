package platform

import (
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func contactPage(r *http.Request) (int, int, error) {
	limit, offset := 20, 0
	for _, p := range []struct {
		key      string
		dst      *int
		min, max int
	}{{"limit", &limit, 1, 100}, {"offset", &offset, 0, 100000}} {
		if raw := r.URL.Query().Get(p.key); raw != "" {
			v, e := strconv.Atoi(raw)
			if e != nil || v < p.min || v > p.max {
				return 0, 0, bad("分页参数无效")
			}
			*p.dst = v
		}
	}
	return limit, offset, nil
}
func (a *App) readContactSQL(r *http.Request, store *PostgresStore, op string) (any, error) {
	tx, e := store.pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(r.Context())
	u, e := a.messagingSQLActor(r, tx, false)
	if e != nil {
		return nil, e
	}
	privacy, e := readContactPrivacy(r.Context(), tx, u.ID)
	if e != nil {
		return nil, e
	}
	var result any
	switch op {
	case "privacy":
		result = privacy
	case "capabilities":
		id := r.PathValue("userId")
		if !validContactID(id) {
			return nil, bad("成员标识不正确")
		}
		if id == u.ID {
			result = ContactCapabilities{UserID: id, Revision: privacy.Revision}
			break
		}
		targets, e := readContactTargets(r.Context(), tx, u.ID, []string{id})
		if e != nil {
			return nil, e
		}
		v, ok := targets[id]
		if !ok || !v.Active {
			return nil, missing("成员不存在或已停用")
		}
		var pending bool
		e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM gongming_friend_requests WHERE pair_low=LEAST($1::text COLLATE "C",$2::text COLLATE "C") AND pair_high=GREATEST($1::text COLLATE "C",$2::text COLLATE "C") AND status='pending')`, u.ID, id).Scan(&pending)
		if e != nil {
			return nil, e
		}
		result = ContactCapabilities{UserID: id, BlockedByMe: v.BlockedByMe, CanMessage: !v.Blocked && contactAllows(v.DirectMessagePolicy, v.Friended), CanRequestFriend: !v.Blocked && v.AllowFriendRequests && !v.Friended && !pending, CanInvite: !v.Blocked && contactAllows(v.GroupInvitePolicy, v.Friended), Revision: privacy.Revision}
	case "blocks":
		limit, offset, e := contactPage(r)
		if e != nil {
			return nil, e
		}
		id := r.URL.Query().Get("userId")
		if id != "" && !validContactID(id) {
			return nil, bad("成员标识不正确")
		}
		q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
		if strings.ContainsRune(q, 0) {
			q = "\ufffd\ufffd\ufffd"
		}
		args := []any{u.ID, id, q, messagingSQLLowerFrom, messagingSQLLowerTo}
		where := ` WHERE b.owner_id=$1 AND ($2='' OR b.target_id=$2) AND ($3='' OR strpos(translate(b.target_id||CASE WHEN u.status='active' THEN ' '||u.handle||' '||u.name ELSE '' END,$4,$5),$3)>0)`
		var total int
		if e = tx.QueryRow(r.Context(), `SELECT count(*) FROM gongming_user_blocks b JOIN gongming_users u ON u.id=b.target_id`+where, args...).Scan(&total); e != nil {
			return nil, e
		}
		rows, e := tx.Query(r.Context(), `SELECT b.target_id,b.created_at,u.status='active',u.id,u.handle,u.name,u.avatar,u.bio FROM gongming_user_blocks b JOIN gongming_users u ON u.id=b.target_id`+where+` ORDER BY b.created_at DESC,b.target_id LIMIT $6 OFFSET $7`, append(args, limit, offset)...)
		if e != nil {
			return nil, e
		}
		items := []BlockEntry{}
		for rows.Next() {
			v := BlockEntry{}
			person := PublicUser{}
			if e = rows.Scan(&v.UserID, &v.CreatedAt, &v.Available, &person.ID, &person.Handle, &person.Name, &person.Avatar, &person.Bio); e != nil {
				rows.Close()
				return nil, e
			}
			v.CreatedAt = v.CreatedAt.UTC()
			if v.Available {
				v.User = &person
			}
			items = append(items, v)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
		result = map[string]any{"items": items, "total": total, "revision": privacy.Revision, "updatedAt": privacy.UpdatedAt}
	default:
		return nil, bad("未知联系操作")
	}
	return result, tx.Commit(r.Context())
}

type privacyInput struct {
	DirectMessagePolicy  *string `json:"directMessagePolicy"`
	GroupInvitePolicy    *string `json:"groupInvitePolicy"`
	AllowFriendRequests  *bool   `json:"allowFriendRequests"`
	DiscoverableByHandle *bool   `json:"discoverableByHandle"`
	Revision             *int64  `json:"revision"`
}

func (a *App) writeContactSQL(r *http.Request, store *PostgresStore, op string) (any, error) {
	var policy privacyInput
	var revision *int64
	if op == "privacy" {
		if e := decode(r, &policy); e != nil {
			return nil, e
		}
		if policy.DirectMessagePolicy == nil || policy.GroupInvitePolicy == nil || policy.AllowFriendRequests == nil || policy.DiscoverableByHandle == nil || policy.Revision == nil || !validContactPolicy(*policy.DirectMessagePolicy) || !validContactPolicy(*policy.GroupInvitePolicy) {
			return nil, bad("请提供完整有效的四项联系设置和revision")
		}
		revision = policy.Revision
	} else {
		var input struct {
			Revision *int64 `json:"revision"`
		}
		if e := decode(r, &input); e != nil {
			return nil, e
		}
		revision = input.Revision
		if !validContactID(r.PathValue("userId")) {
			return nil, bad("成员标识不正确")
		}
	}
	if revision == nil || *revision < 0 || *revision > maxMessageSequence {
		return nil, bad("revision无效")
	}
	result, e := a.walletTransaction(r, store, func(tx pgx.Tx) (walletCommit, error) {
		u, e := a.messagingSQLActor(r, tx, true)
		if e != nil {
			return walletCommit{}, e
		}
		ids := []string{u.ID}
		target := r.PathValue("userId")
		targetExists, targetActive := false, false
		if op != "privacy" {
			e = tx.QueryRow(r.Context(), `SELECT status='active' FROM gongming_users WHERE id=$1`, target).Scan(&targetActive)
			if e == nil {
				targetExists = true
				ids = append(ids, target)
			} else if !errors.Is(e, pgx.ErrNoRows) {
				return walletCommit{}, e
			}
		}
		if e = lockContactGuards(r.Context(), tx, ids, true); e != nil {
			return walletCommit{}, e
		}
		current, e := readContactPrivacy(r.Context(), tx, u.ID)
		if e != nil {
			return walletCommit{}, e
		}
		if current.Revision != *revision {
			return walletCommit{}, privacyConflict()
		}
		now := a.now().UTC().Truncate(time.Microsecond)
		if op == "privacy" {
			same := current.DirectMessagePolicy == *policy.DirectMessagePolicy && current.GroupInvitePolicy == *policy.GroupInvitePolicy && current.AllowFriendRequests == *policy.AllowFriendRequests && current.DiscoverableByHandle == *policy.DiscoverableByHandle
			if same {
				return walletCommit{Data: current}, nil
			}
			if current.Revision >= maxMessageSequence {
				return walletCommit{}, privacyConflict()
			}
			current.DirectMessagePolicy = *policy.DirectMessagePolicy
			current.GroupInvitePolicy = *policy.GroupInvitePolicy
			current.AllowFriendRequests = *policy.AllowFriendRequests
			current.DiscoverableByHandle = *policy.DiscoverableByHandle
			current.Revision++
			current.UpdatedAt = &now
			e = execRow(r.Context(), tx, `UPDATE gongming_contact_preferences SET direct_message_policy=$2,group_invite_policy=$3,allow_friend_requests=$4,discoverable_by_handle=$5,revision=$6,updated_at=$7 WHERE user_id=$1`, u.ID, current.DirectMessagePolicy, current.GroupInvitePolicy, current.AllowFriendRequests, current.DiscoverableByHandle, current.Revision, now)
			if e != nil {
				return walletCommit{}, e
			}
			if e = bumpContactGuards(r.Context(), tx, ids); e != nil {
				return walletCommit{}, e
			}
			if e = appendContactResync(r, tx, u.ID, now); e != nil {
				return walletCommit{}, e
			}
			return walletCommit{Data: current}, nil
		}
		if target == u.ID {
			return walletCommit{}, bad("不能拉黑自己")
		}
		var exists bool
		if e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM gongming_user_blocks WHERE owner_id=$1 AND target_id=$2)`, u.ID, target).Scan(&exists); e != nil {
			return walletCommit{}, e
		}
		desired := op == "block"
		receipt := func() map[string]any {
			return map[string]any{"ok": true, "userId": target, "blocked": desired, "revision": current.Revision, "updatedAt": current.UpdatedAt}
		}
		if exists == desired {
			return walletCommit{Data: receipt()}, nil
		}
		if current.Revision >= maxMessageSequence {
			return walletCommit{}, privacyConflict()
		}
		if desired {
			if !targetExists || !targetActive {
				return walletCommit{}, missing("成员不存在或已停用")
			}
			var count int
			if e = tx.QueryRow(r.Context(), `SELECT count(*) FROM gongming_user_blocks WHERE owner_id=$1`, u.ID).Scan(&count); e != nil {
				return walletCommit{}, e
			}
			if count >= 500 {
				return walletCommit{}, conflict("黑名单最多500人")
			}
			if e = execRow(r.Context(), tx, `INSERT INTO gongming_user_blocks(owner_id,target_id,created_at) VALUES($1,$2,$3)`, u.ID, target, now); e != nil {
				return walletCommit{}, e
			}
			if e = execRow(r.Context(), tx, `UPDATE gongming_friend_requests SET status='cancelled',updated_at=$3 WHERE status='pending' AND pair_low=LEAST($1::text COLLATE "C",$2::text COLLATE "C") AND pair_high=GREATEST($1::text COLLATE "C",$2::text COLLATE "C")`, u.ID, target, now); e != nil {
				return walletCommit{}, e
			}
		} else {
			if e = execRow(r.Context(), tx, `DELETE FROM gongming_user_blocks WHERE owner_id=$1 AND target_id=$2`, u.ID, target); e != nil {
				return walletCommit{}, e
			}
		}
		current.Revision++
		current.UpdatedAt = &now
		if e = execRow(r.Context(), tx, `UPDATE gongming_contact_preferences SET revision=$2,updated_at=$3 WHERE user_id=$1`, u.ID, current.Revision, now); e != nil {
			return walletCommit{}, e
		}
		if e = bumpContactGuards(r.Context(), tx, ids); e != nil {
			return walletCommit{}, e
		}
		for _, id := range ids {
			if e = appendContactResync(r, tx, id, now); e != nil {
				return walletCommit{}, e
			}
		}
		return walletCommit{Data: receipt()}, nil
	})
	return result.Data, e
}
func appendContactResync(r *http.Request, tx pgx.Tx, user string, now time.Time) error {
	return appendMessagingSQLEvent(r.Context(), tx, "contact.resync", "", "", user, now)
}
