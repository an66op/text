package platform

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

func (a *App) messagingSQLSend(r *http.Request, tx pgx.Tx, u PublicUser) (any, error) {
	c, err := messagingSQLConversation(r.Context(), tx, r.PathValue("id"), u.ID, "send")
	if err != nil {
		return nil, err
	}
	if c.Kind == "channel" && c.OwnerID != u.ID {
		return nil, forbidden("频道仅允许当前频道主发布")
	}
	input, hash, err := decodeMessageInput(r)
	if err != nil {
		return nil, err
	}
	version, err := messageMutationVersion(r.Context(), tx, c.ID)
	if err != nil {
		return nil, err
	}
	if input.ClientID != "" {
		m, e := scanMessagingSQLMessage(tx.QueryRow(r.Context(), `SELECT `+messagingSQLMessageFields+` FROM gongming_messages m JOIN gongming_users u ON u.id=m.sender_id WHERE m.conversation_id=$1 AND m.sender_id=$2 AND m.client_id=$3`, c.ID, u.ID, input.ClientID))
		if e == nil {
			var original string
			if e = tx.QueryRow(r.Context(), `SELECT COALESCE(payload_hash,'') FROM gongming_messages WHERE id=$1`, m.ID).Scan(&original); e != nil {
				return nil, e
			}
			if original == "" {
				original = messageFingerprint(m.Body, []string{}, "")
			}
			if original != hash {
				return nil, conflict("clientId已用于不同消息载荷")
			}
			items, e := projectMessagesSQL(r.Context(), tx, []Message{m}, u.ID, version)
			if e != nil {
				return nil, e
			}
			return items[0], nil
		}
		if !errors.Is(e, pgx.ErrNoRows) {
			return nil, e
		}
	}
	if input.ReplyToID != "" {
		var source int64
		err = tx.QueryRow(r.Context(), `SELECT seq FROM gongming_messages WHERE id=$1 AND conversation_id=$2 AND retracted_at IS NULL`, input.ReplyToID, c.ID).Scan(&source)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, missing("引用消息不存在或已撤回")
		}
		if err != nil {
			return nil, err
		}
	}
	for _, id := range sortedMessageMedia(input.ImageIDs) {
		var ready bool
		err = tx.QueryRow(r.Context(), `SELECT owner_id=$2 AND scope='conversation' AND conversation_id=$3 AND status='ready' AND deleted_at IS NULL FROM gongming_media_assets WHERE id=$1 FOR SHARE`, id, u.ID, c.ID).Scan(&ready)
		if errors.Is(err, pgx.ErrNoRows) || err == nil && !ready {
			return nil, bad("只能发送本人在本会话上传的可用图片")
		}
		if err != nil {
			return nil, err
		}
	}
	seq := int64(0)
	if err = tx.QueryRow(r.Context(), `SELECT COALESCE(max(seq),0) FROM gongming_messages WHERE conversation_id=$1`, c.ID).Scan(&seq); err != nil {
		return nil, err
	}
	if seq >= maxMessageSequence {
		return nil, conflict("会话消息序列已达到上限")
	}
	m := Message{ID: newID("message_"), ConversationID: c.ID, Sender: u, Body: input.Body, CreatedAt: a.now().UTC().Truncate(time.Microsecond), Seq: seq + 1, ClientID: input.ClientID}
	if _, err = tx.Exec(r.Context(), `INSERT INTO gongming_messages(id,conversation_id,sender_id,body,created_at,seq,client_id,payload_hash,reply_to_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, m.ID, c.ID, u.ID, m.Body, m.CreatedAt, m.Seq, nullString(m.ClientID), hash, nullString(input.ReplyToID)); err != nil {
		return nil, err
	}
	for position, id := range input.ImageIDs {
		if _, err = tx.Exec(r.Context(), `INSERT INTO gongming_message_media(message_id,media_id,position) VALUES($1,$2,$3)`, m.ID, id, position); err != nil {
			return nil, err
		}
	}
	if err = appendMessagingSQLEvent(r.Context(), tx, "message.created", c.ID, m.ID, "", a.now()); err != nil {
		return nil, err
	}
	items, err := projectMessagesSQL(r.Context(), tx, []Message{m}, u.ID, version)
	if err != nil {
		return nil, err
	}
	return items[0], nil
}

func (a *App) messagingSQLRead(r *http.Request, tx pgx.Tx, u PublicUser) (any, error) {
	c, err := messagingSQLConversation(r.Context(), tx, r.PathValue("id"), u.ID, "read")
	if err != nil {
		return nil, err
	}
	var input struct {
		MessageID string `json:"messageId"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	seq := int64(0)
	err = tx.QueryRow(r.Context(), `SELECT seq FROM gongming_messages WHERE id=$1 AND conversation_id=$2`, input.MessageID, c.ID).Scan(&seq)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, missing("已读消息不存在于此会话")
	}
	if err != nil {
		return nil, err
	}
	mark := ReadReceipt{ConversationID: c.ID}
	err = tx.QueryRow(r.Context(), `SELECT COALESCE(message_id,''),seq FROM gongming_conversation_reads WHERE conversation_id=$1 AND user_id=$2 FOR UPDATE`, c.ID, u.ID).Scan(&mark.LastReadMessageID, &mark.ReadSeq)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if seq > mark.ReadSeq {
		now := a.now()
		if _, err = tx.Exec(r.Context(), `INSERT INTO gongming_conversation_reads(conversation_id,user_id,message_id,seq,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(conversation_id,user_id) DO UPDATE SET message_id=EXCLUDED.message_id,seq=EXCLUDED.seq,updated_at=EXCLUDED.updated_at`, c.ID, u.ID, input.MessageID, seq, now); err != nil {
			return nil, err
		}
		mark.ReadSeq, mark.LastReadMessageID = seq, input.MessageID
		if err = appendMessagingSQLEvent(r.Context(), tx, "conversation.read", c.ID, input.MessageID, u.ID, now); err != nil {
			return nil, err
		}
	}
	err = tx.QueryRow(r.Context(), `SELECT count(*) FROM gongming_messages WHERE conversation_id=$1 AND sender_id<>$2 AND retracted_at IS NULL AND seq>$3`, c.ID, u.ID, mark.ReadSeq).Scan(&mark.UnreadCount)
	return mark, err
}

// The global replay cursor is the one intentionally shared row. Acquire it only
// after the domain work, then atomically insert the event and prune the bounded
// outbox. This uses the same counter/table as State transactions: SERIALIZABLE
// conflicts or unique-sequence conflicts replay the entire transaction, so a
// concurrent legacy management update cannot overwrite the cursor or lose events.
// It is a short global serialization point, not a claim of unlimited throughput.
func appendMessagingSQLEvent(ctx context.Context, tx pgx.Tx, kind, conversationID, messageID, recipientID string, now time.Time) error {
	seq := int64(0)
	if err := tx.QueryRow(ctx, `UPDATE gongming_sequences SET value=value+1 WHERE name='message_events' RETURNING value`).Scan(&seq); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO gongming_message_outbox(id,seq,type,conversation_id,message_id,recipient_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, newID("event_"), seq, kind, conversationID, nullString(messageID), nullString(recipientID), now); err != nil {
		return err
	}
	// Equivalent to appendMessageEvent: retain the last 2000, then remove the
	// expired prefix while retaining at least the latest event, even with skewed
	// historical timestamps. No unrelated domain table is read or locked.
	if _, err := tx.Exec(ctx, `DELETE FROM gongming_message_outbox WHERE seq<(SELECT seq FROM gongming_message_outbox ORDER BY seq DESC OFFSET $1 LIMIT 1)`, outboxRetention-1); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `DELETE FROM gongming_message_outbox WHERE seq<(SELECT COALESCE(min(seq) FILTER(WHERE created_at>=$1),max(seq)) FROM gongming_message_outbox)`, now.Add(-7*24*time.Hour))
	return err
}
