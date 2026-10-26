package platform

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func messageMutationVersion(ctx context.Context, tx pgx.Tx, conversation string) (int64, error) {
	var v int64
	err := tx.QueryRow(ctx, `SELECT mutation_version FROM gongming_conversations WHERE id=$1`, conversation).Scan(&v)
	return v, err
}
func advanceMessageMutation(ctx context.Context, tx pgx.Tx, conversation string) (int64, error) {
	var v int64
	err := tx.QueryRow(ctx, `UPDATE gongming_conversations SET mutation_version=mutation_version+1 WHERE id=$1 AND mutation_version<9007199254740990 RETURNING mutation_version`, conversation).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, conflict("会话变更版本已达到上限")
	}
	return v, err
}

// At most one batch for images and one batch for source messages/images. All
// rows and the supplied conversation version belong to the caller's snapshot.
func projectMessagesSQL(ctx context.Context, tx pgx.Tx, items []Message, viewer string, version int64) ([]Message, error) {
	ids := []string{}
	for i := range items {
		m := &items[i]
		m.CreatedAt = m.CreatedAt.UTC()
		m.Status = "sent"
		m.Revision = version + 1
		m.Images = []MessageImage{}
		m.CanRetract = m.Sender.ID == viewer && m.RetractedAt == nil
		if m.RetractedAt != nil {
			m.Status = "retracted"
			m.Body = ""
			m.CanRetract = false
			m.ReplyTo = nil
			utc := m.RetractedAt.UTC()
			m.RetractedAt = &utc
		} else {
			ids = append(ids, m.ID)
		}
	}
	if len(ids) == 0 {
		return items, nil
	}
	indices := map[string]int{}
	for i, m := range items {
		indices[m.ID] = i
	}
	rows, err := tx.Query(ctx, `SELECT r.message_id,a.id,a.content_type,a.width,a.height,a.bytes,(a.status='ready' AND a.deleted_at IS NULL) FROM gongming_message_media r JOIN gongming_media_assets a ON a.id=r.media_id WHERE r.message_id=ANY($1::text[]) ORDER BY r.message_id,r.position`, ids)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var image MessageImage
		if err = rows.Scan(&id, &image.ID, &image.ContentType, &image.Width, &image.Height, &image.Bytes, &image.Available); err != nil {
			rows.Close()
			return nil, err
		}
		if image.Available {
			url := mediaURLPrefix + image.ID
			image.URL = &url
		}
		i := indices[id]
		items[i].Images = append(items[i].Images, image)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return nil, err
	}
	replies, err := tx.Query(ctx, `SELECT p.id,s.id,s.body,s.retracted_at,s.conversation_id=p.conversation_id,u.id,u.handle,u.name,u.avatar,u.bio,(SELECT count(*) FROM gongming_message_media r WHERE r.message_id=s.id) FROM gongming_messages p JOIN gongming_messages s ON s.id=p.reply_to_id JOIN gongming_users u ON u.id=s.sender_id WHERE p.id=ANY($1::text[])`, ids)
	if err != nil {
		return nil, err
	}
	for replies.Next() {
		var parent, id, body string
		var retracted *time.Time
		var same bool
		var sender PublicUser
		var count int
		if err = replies.Scan(&parent, &id, &body, &retracted, &same, &sender.ID, &sender.Handle, &sender.Name, &sender.Avatar, &sender.Bio, &count); err != nil {
			replies.Close()
			return nil, err
		}
		reply := &MessageReply{ID: id, Revision: version + 1}
		if same && retracted == nil {
			body = shortMessageText(body)
			reply.Available = true
			reply.Sender = &sender
			reply.Body = &body
			reply.ImageCount = count
		}
		items[indices[parent]].ReplyTo = reply
	}
	replies.Close()
	return items, replies.Err()
}
func messageSQLByIDs(ctx context.Context, tx pgx.Tx, conversation string, ids []string, viewer string, version int64) ([]Message, error) {
	rows, err := tx.Query(ctx, `SELECT `+messagingSQLMessageFields+` FROM gongming_messages m JOIN gongming_users u ON u.id=m.sender_id WHERE m.conversation_id=$1 AND m.id=ANY($2::text[])`, conversation, ids)
	if err != nil {
		return nil, err
	}
	items := []Message{}
	for rows.Next() {
		m, e := scanMessagingSQLMessage(rows)
		if e != nil {
			rows.Close()
			return nil, e
		}
		items = append(items, m)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return projectMessagesSQL(ctx, tx, items, viewer, version)
}
func messagingSQLMessageDetail(r *http.Request, tx pgx.Tx, u PublicUser, byClient bool) (any, error) {
	key := r.PathValue("messageId")
	if byClient {
		key = r.PathValue("clientId")
	}
	if key == "" || len(key) > 128 || strings.ContainsRune(key, 0) {
		return nil, bad("消息编号不正确")
	}
	c, err := messagingSQLConversation(r.Context(), tx, r.PathValue("id"), u.ID, "")
	if err != nil {
		return nil, err
	}
	version, err := messageMutationVersion(r.Context(), tx, c.ID)
	if err != nil {
		return nil, err
	}
	where := `m.id=$2`
	args := []any{c.ID, r.PathValue("messageId")}
	if byClient {
		where = `m.client_id=$2 AND m.sender_id=$3`
		args = []any{c.ID, r.PathValue("clientId"), u.ID}
	}
	m, err := scanMessagingSQLMessage(tx.QueryRow(r.Context(), `SELECT `+messagingSQLMessageFields+` FROM gongming_messages m JOIN gongming_users u ON u.id=m.sender_id WHERE m.conversation_id=$1 AND `+where, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, missing("消息不存在")
	}
	if err != nil {
		return nil, err
	}
	items, err := projectMessagesSQL(r.Context(), tx, []Message{m}, u.ID, version)
	if err != nil {
		return nil, err
	}
	return items[0], nil
}
func messagingSQLResolve(r *http.Request, tx pgx.Tx, u PublicUser) (any, error) {
	c, err := messagingSQLConversation(r.Context(), tx, r.PathValue("id"), u.ID, "")
	if err != nil {
		return nil, err
	}
	var input struct {
		IDs []string `json:"ids"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	if len(input.IDs) > 200 {
		return nil, bad("一次最多解析200条消息")
	}
	ids := []string{}
	seen := map[string]bool{}
	for _, id := range input.IDs {
		if id == "" || len(id) > 128 || strings.ContainsRune(id, 0) {
			return nil, bad("消息编号无效")
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	version, err := messageMutationVersion(r.Context(), tx, c.ID)
	if err != nil {
		return nil, err
	}
	items, err := messageSQLByIDs(r.Context(), tx, c.ID, ids, u.ID, version)
	if err != nil {
		return nil, err
	}
	byID := map[string]Message{}
	for _, m := range items {
		byID[m.ID] = m
	}
	ordered := []Message{}
	missing := []string{}
	for _, id := range ids {
		if m, ok := byID[id]; ok {
			ordered = append(ordered, m)
		} else {
			missing = append(missing, id)
		}
	}
	return map[string]any{"items": ordered, "missingIds": missing, "mutationVersion": version}, nil
}
func (a *App) messagingSQLRetract(r *http.Request, tx pgx.Tx, u PublicUser) (any, error) {
	id := r.PathValue("messageId")
	if id == "" || len(id) > 128 || strings.ContainsRune(id, 0) {
		return nil, bad("消息编号不正确")
	}
	var conversation string
	if err := tx.QueryRow(r.Context(), `SELECT conversation_id FROM gongming_messages WHERE id=$1 AND sender_id=$2`, id, u.ID).Scan(&conversation); errors.Is(err, pgx.ErrNoRows) {
		return nil, missing("消息不存在")
	} else if err != nil {
		return nil, err
	}
	// No membership/owner predicate: authors retain blind erasure rights after
	// removal, but the receipt never exposes conversation identity or its version.
	var version int64
	if err := tx.QueryRow(r.Context(), `SELECT mutation_version FROM gongming_conversations WHERE id=$1 FOR UPDATE`, conversation).Scan(&version); err != nil {
		return nil, err
	}
	var body, hash string
	var retracted *time.Time
	if err := tx.QueryRow(r.Context(), `SELECT body,COALESCE(payload_hash,''),retracted_at FROM gongming_messages WHERE id=$1 AND sender_id=$2 FOR UPDATE`, id, u.ID).Scan(&body, &hash, &retracted); err != nil {
		return nil, err
	}
	if retracted != nil {
		return map[string]any{"ok": true, "messageId": id}, nil
	}
	if hash == "" {
		hash = messageFingerprint(body, []string{}, "")
	}
	if _, err := tx.Exec(r.Context(), `UPDATE gongming_messages SET body='',reply_to_id=NULL,payload_hash=$2,retracted_at=$3 WHERE id=$1`, id, hash, a.now().UTC().Truncate(time.Microsecond)); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(r.Context(), `DELETE FROM gongming_message_media WHERE message_id=$1`, id); err != nil {
		return nil, err
	}
	if _, err := advanceMessageMutation(r.Context(), tx, conversation); err != nil {
		return nil, err
	}
	if err := appendMessagingSQLEvent(r.Context(), tx, "message.retracted", conversation, id, "", a.now()); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "messageId": id}, nil
}
func sortedMessageMedia(ids []string) []string {
	result := slices.Clone(ids)
	slices.Sort(result)
	return result
}
