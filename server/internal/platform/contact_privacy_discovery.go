package platform

import (
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
)

func (a *App) contactDiscoveryEndpoint(profile bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		store, ok := a.store.(*PostgresStore)
		if !ok {
			fn := a.directory
			if profile {
				fn = a.userProfile
			}
			a.endpoint(false, "member", fn)(w, r)
			return
		}
		data, e := a.contactDiscoverySQL(r, store, profile)
		if e != nil {
			writeError(w, e)
			return
		}
		writeJSON(w, 200, data)
	}
}
func (a *App) contactDiscoverySQL(r *http.Request, store *PostgresStore, profile bool) (any, error) {
	tx, e := store.pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(r.Context())
	actor, e := a.messagingSQLActor(r, tx, false)
	if e != nil {
		return nil, e
	}
	where := ` FROM gongming_users u LEFT JOIN gongming_contact_preferences p ON p.user_id=u.id WHERE u.status='active' AND (u.id=$1 OR COALESCE(p.discoverable_by_handle,true) OR EXISTS(SELECT 1 FROM gongming_friendships f WHERE f.user_a=LEAST($1::text COLLATE "C",u.id COLLATE "C") AND f.user_b=GREATEST($1::text COLLATE "C",u.id COLLATE "C")))`
	if profile {
		handle := r.PathValue("handle")
		if !validContactID(handle) {
			return nil, missing("用户不存在或已停用")
		}
		u := PublicUser{}
		e = tx.QueryRow(r.Context(), `SELECT u.id,u.handle,u.name,u.avatar,u.bio`+where+` AND u.handle=$2`, actor.ID, handle).Scan(&u.ID, &u.Handle, &u.Name, &u.Avatar, &u.Bio)
		if errors.Is(e, pgx.ErrNoRows) {
			return nil, missing("用户不存在或已停用")
		}
		if e != nil {
			return nil, e
		}
		return u, tx.Commit(r.Context())
	}
	limit, offset, e := messagingSQLPage(r)
	if e != nil {
		return nil, e
	}
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	if strings.ContainsRune(q, 0) {
		return map[string]any{"items": []PublicUser{}, "total": 0}, tx.Commit(r.Context())
	}
	where += ` AND strpos(translate(u.id||' '||u.handle||' '||u.name,$3,$4),$2)>0`
	var total int
	if e = tx.QueryRow(r.Context(), `SELECT count(*)`+where, actor.ID, q, messagingSQLLowerFrom, messagingSQLLowerTo).Scan(&total); e != nil {
		return nil, e
	}
	items := []PublicUser{}
	e = collectMediaRows(r.Context(), tx, `SELECT u.id,u.handle,u.name,u.avatar,u.bio`+where+` ORDER BY u.handle LIMIT $5 OFFSET $6`, func(rows pgx.Rows) error {
		u := PublicUser{}
		if e := rows.Scan(&u.ID, &u.Handle, &u.Name, &u.Avatar, &u.Bio); e != nil {
			return e
		}
		items = append(items, u)
		return nil
	}, actor.ID, q, messagingSQLLowerFrom, messagingSQLLowerTo, limit, offset)
	if e != nil {
		return nil, e
	}
	return map[string]any{"items": items, "total": total}, tx.Commit(r.Context())
}
