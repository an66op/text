package platform

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
	"time"
)

func (a *App) mediaListEndpoint(own bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		store, ok := a.store.(*PostgresStore)
		if !ok {
			role := "staff"
			fn := a.adminMedia
			if own {
				role = "member"
				fn = a.myMedia
			}
			a.endpoint(false, role, fn)(w, r)
			return
		}
		data, err := a.readMediaListSQL(r, store, own, "")
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, 200, data)
	}
}
func (a *App) readMediaListSQL(r *http.Request, store *PostgresStore, own bool, one string) (any, error) {
	tx, e := store.pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(r.Context())
	u, e := a.messagingSQLActor(r, tx, false)
	if e != nil {
		return nil, e
	}
	owner := ""
	if own {
		owner = u.ID
	} else {
		var yes bool
		if e = tx.QueryRow(r.Context(), `SELECT role IN ('admin','moderator') FROM gongming_users WHERE id=$1`, u.ID).Scan(&yes); e != nil {
			return nil, e
		}
		if !yes {
			return nil, forbidden("需要管理权限")
		}
	}
	status, e := queryEnum(r, "status", "ready", "blocked")
	if e != nil {
		return nil, e
	}
	scope, e := queryEnum(r, "scope", "world", "circle", "conversation")
	if e != nil {
		return nil, e
	}
	limit, offset, e := messagingSQLPage(r)
	if e != nil {
		return nil, e
	}
	clientID, conversationID := "", ""
	if own {
		clientID = r.URL.Query().Get("clientId")
		conversationID = r.URL.Query().Get("conversationId")
		if clientID != "" && !requestPattern.MatchString(clientID) {
			return nil, bad("clientId不正确")
		}
		if strings.ContainsRune(conversationID, 0) || len(conversationID) > 128 {
			return nil, bad("会话编号不正确")
		}
	}
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	if strings.ContainsRune(q, 0) {
		q = "\ufffd\ufffd\ufffd"
	}
	// Search contains no conversation/message identifiers or private chat text.
	where := ` WHERE a.deleted_at IS NULL AND ($1='' OR a.owner_id=$1) AND ($2='' OR a.status=$2) AND ($3='' OR a.scope=$3) AND ($4='' OR a.client_id=$4) AND ($5='' OR a.conversation_id=$5) AND ($6='' OR strpos(translate(a.id||' '||u.id||' '||u.handle||' '||u.name,$8,$9),$6)>0 OR EXISTS(SELECT 1 FROM gongming_post_media ref WHERE ref.media_id=a.id AND strpos(translate(ref.post_id,$8,$9),$6)>0) OR EXISTS(SELECT 1 FROM gongming_circle_post_media ref JOIN gongming_circle_posts p ON p.id=ref.post_id WHERE ref.media_id=a.id AND strpos(translate(p.id||' '||p.circle_id,$8,$9),$6)>0)) AND ($7='' OR a.id=$7)`
	args := []any{owner, status, scope, clientID, conversationID, q, one, messagingSQLLowerFrom, messagingSQLLowerTo}
	var total int
	if e = tx.QueryRow(r.Context(), `SELECT count(*) FROM gongming_media_assets a JOIN gongming_users u ON u.id=a.owner_id`+where, args...).Scan(&total); e != nil {
		return nil, e
	}
	rows, e := tx.Query(r.Context(), `SELECT a.id FROM gongming_media_assets a JOIN gongming_users u ON u.id=a.owner_id`+where+` ORDER BY a.created_at DESC,a.id LIMIT $10 OFFSET $11`, append(args, limit, offset)...)
	if e != nil {
		return nil, e
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return nil, e
		}
		ids = append(ids, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	items := []AdminMediaAsset{}
	// At most 100 indexed asset projections. Each preview is bounded to ten rows;
	// no State snapshots or private message text are read for media management.
	for _, id := range ids {
		v, e := scanStoredMedia(tx.QueryRow(r.Context(), `SELECT `+mediaSQLFields+` FROM gongming_media_assets WHERE id=$1`, id))
		if e != nil {
			return nil, e
		}
		item := AdminMediaAsset{MediaAsset: v.MediaAsset, Status: v.Status, Note: v.Note, UpdatedAt: v.UpdatedAt, Posts: []AdminMediaPost{}, CirclePosts: []AdminMediaCirclePost{}, Own: own, MessageReferences: []OwnedMessageReference{}}
		if e = tx.QueryRow(r.Context(), `SELECT id,handle,name,avatar,bio FROM gongming_users WHERE id=$1`, v.OwnerID).Scan(&item.Owner.ID, &item.Owner.Handle, &item.Owner.Name, &item.Owner.Avatar, &item.Owner.Bio); e != nil {
			return nil, e
		}
		if e = tx.QueryRow(r.Context(), `SELECT count(*),count(*) FILTER(WHERE p.status='published') FROM gongming_post_media ref JOIN gongming_posts p ON p.id=ref.post_id WHERE ref.media_id=$1`, id).Scan(&item.WorldReferenceCount, &item.PublishedReferenceCount); e != nil {
			return nil, e
		}
		if e = tx.QueryRow(r.Context(), `SELECT count(*),count(*) FILTER(WHERE p.status='published') FROM gongming_circle_post_media ref JOIN gongming_circle_posts p ON p.id=ref.post_id WHERE ref.media_id=$1`, id).Scan(&item.CircleReferenceCount, &item.CirclePublishedReferenceCount); e != nil {
			return nil, e
		}
		if e = tx.QueryRow(r.Context(), `SELECT count(*) FROM gongming_message_media WHERE media_id=$1`, id).Scan(&item.MessageReferenceCount); e != nil {
			return nil, e
		}
		item.ReferenceCount = item.WorldReferenceCount + item.CircleReferenceCount + item.MessageReferenceCount
		e = collectMediaRows(r.Context(), tx, `SELECT p.id,left(p.body,200),p.status FROM gongming_post_media ref JOIN gongming_posts p ON p.id=ref.post_id WHERE ref.media_id=$1 ORDER BY p.created_at DESC,p.id LIMIT 10`, func(rows pgx.Rows) error {
			var p AdminMediaPost
			if e := rows.Scan(&p.ID, &p.Body, &p.Status); e != nil {
				return e
			}
			item.Posts = append(item.Posts, p)
			return nil
		}, id)
		if e != nil {
			return nil, e
		}
		e = collectMediaRows(r.Context(), tx, `SELECT p.circle_id,p.channel_id,p.id,CASE WHEN NOT $2 OR c.status IN ('active','archived') AND EXISTS(SELECT 1 FROM gongming_circle_members m WHERE m.circle_id=c.id AND m.user_id=$3 AND m.status='active' AND (ch.access='members' OR m.role IN ('owner','admin'))) THEN left(p.body,200) ELSE '' END,p.status FROM gongming_circle_post_media ref JOIN gongming_circle_posts p ON p.id=ref.post_id JOIN gongming_circles c ON c.id=p.circle_id JOIN gongming_circle_channels ch ON ch.id=p.channel_id WHERE ref.media_id=$1 ORDER BY p.created_at DESC,p.id LIMIT 10`, func(rows pgx.Rows) error {
			var p AdminMediaCirclePost
			if e := rows.Scan(&p.CircleID, &p.ChannelID, &p.ID, &p.Body, &p.Status); e != nil {
				return e
			}
			item.CirclePosts = append(item.CirclePosts, p)
			return nil
		}, id, own, u.ID)
		if e != nil {
			return nil, e
		}
		item.PreviewAvailable = v.Status == "ready"
		if v.Scope == "conversation" {
			var member bool
			if own {
				if e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM gongming_conversation_members WHERE conversation_id=$1 AND user_id=$2)`, v.ConversationID, u.ID).Scan(&member); e != nil {
					return nil, e
				}
				e = collectMediaRows(r.Context(), tx, `SELECT m.id FROM gongming_message_media ref JOIN gongming_messages m ON m.id=ref.message_id WHERE ref.media_id=$1 ORDER BY m.created_at DESC,m.id LIMIT 10`, func(rows pgx.Rows) error {
					var ref OwnedMessageReference
					if e := rows.Scan(&ref.MessageID); e != nil {
						return e
					}
					item.MessageReferences = append(item.MessageReferences, ref)
					return nil
				}, id)
				if e != nil {
					return nil, e
				}
			}
			item.PreviewAvailable = item.PreviewAvailable && own && member
		}
		items = append(items, item)
	}
	if e = tx.Commit(r.Context()); e != nil {
		return nil, e
	}
	if one != "" {
		if len(items) == 0 {
			return nil, missing("图片不存在")
		}
		return items[0], nil
	}
	return map[string]any{"items": items, "total": total}, nil
}
func (a *App) deleteMediaImageSQL(w http.ResponseWriter, r *http.Request, store *PostgresStore) {
	var removed StoredMediaAsset
	result, e := a.walletTransaction(r, store, func(tx pgx.Tx) (walletCommit, error) {
		u, e := a.messagingSQLActor(r, tx, true)
		if e != nil {
			return walletCommit{}, e
		}
		v, e := scanStoredMedia(tx.QueryRow(r.Context(), `SELECT `+mediaSQLFields+` FROM gongming_media_assets WHERE id=$1 AND owner_id=$2`, r.PathValue("id"), u.ID))
		if errors.Is(e, pgx.ErrNoRows) {
			return walletCommit{}, missing("图片不存在")
		}
		if e != nil {
			return walletCommit{}, e
		}
		if v.Scope == "conversation" {
			if _, e = tx.Exec(r.Context(), `SELECT 1 FROM gongming_conversations WHERE id=$1 FOR UPDATE`, v.ConversationID); e != nil {
				return walletCommit{}, e
			}
		}
		v, e = scanStoredMedia(tx.QueryRow(r.Context(), `SELECT `+mediaSQLFields+` FROM gongming_media_assets WHERE id=$1 FOR UPDATE`, v.ID))
		if e != nil {
			return walletCommit{}, e
		}
		removed = v
		if v.DeletedAt != nil {
			return walletCommit{Data: map[string]bool{"ok": true}}, nil
		}
		var refs bool
		e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM gongming_post_media WHERE media_id=$1) OR EXISTS(SELECT 1 FROM gongming_circle_post_media WHERE media_id=$1) OR EXISTS(SELECT 1 FROM gongming_message_media WHERE media_id=$1)`, v.ID).Scan(&refs)
		if e != nil {
			return walletCommit{}, e
		}
		if refs {
			return walletCommit{}, conflict("图片仍被引用，请先删除或撤回相关内容")
		}
		now := a.now().UTC().Truncate(time.Microsecond)
		e = execRow(r.Context(), tx, `UPDATE gongming_media_assets SET deleted_at=$2,updated_at=$2 WHERE id=$1`, v.ID, now)
		if e == nil {
			e = eventSQLAudit(r.Context(), tx, u, "media.delete", v.ID, "本人删除未引用图片", now)
		}
		return walletCommit{Data: map[string]bool{"ok": true}}, e
	})
	if e != nil {
		writeError(w, e)
		return
	}
	if a.cfg.MediaDirectory != "" {
		_ = removeMediaFile(a.cfg.MediaDirectory, removed)
	}
	writeJSON(w, 200, result.Data)
}

func collectMediaRows(ctx context.Context, tx pgx.Tx, query string, fn func(pgx.Rows) error, args ...any) error {
	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err = fn(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}
