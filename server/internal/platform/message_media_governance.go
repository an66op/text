package platform

import (
	"context"
	"github.com/jackc/pgx/v5"
	"net/http"
	"time"
)

// State callbacks never hydrate chat attachment relations. Lock affected
// conversations before persisting media rows; all chat writers use this order.
func lockChangedConversationMedia(ctx context.Context, tx pgx.Tx, before, after *State) ([]string, error) {
	ids := []string{}
	for _, id := range mapKeys(after.Media) {
		v := after.Media[id]
		old, ok := before.Media[id]
		if ok && v.Scope == "conversation" && v.Status != old.Status {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil, nil
	}
	rows, e := tx.Query(ctx, `SELECT DISTINCT m.conversation_id FROM gongming_message_media ref JOIN gongming_messages m ON m.id=ref.message_id WHERE ref.media_id=ANY($1::text[]) AND m.retracted_at IS NULL ORDER BY m.conversation_id`, ids)
	if e != nil {
		return nil, e
	}
	convs := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return nil, e
		}
		convs = append(convs, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	for _, id := range convs {
		if _, e = tx.Exec(ctx, `SELECT 1 FROM gongming_conversations WHERE id=$1 FOR UPDATE`, id); e != nil {
			return nil, e
		}
	}
	return convs, nil
}
func persistConversationMediaMutations(ctx context.Context, tx pgx.Tx, ids []string) error {
	for _, id := range ids {
		if _, e := advanceMessageMutation(ctx, tx, id); e != nil {
			return e
		}
		if e := appendMessagingSQLEvent(ctx, tx, "conversation.messages.invalidated", id, "", "", time.Now().UTC()); e != nil {
			return e
		}
	}
	return nil
}
func (a *App) mediaModerationEndpoint() http.HandlerFunc {
	base := a.endpoint(true, "staff", a.adminUpdateMedia)
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := a.store.(*PostgresStore); !ok {
			base(w, r)
			return
		}
		result, err := a.execute(r, true, "staff", func(s *State, u *User) (any, error) { return a.adminUpdateMedia(s, u, r) })
		_ = result
		if err != nil {
			writeError(w, err)
			return
		}
		data, err := a.readMediaListSQL(r, a.store.(*PostgresStore), false, r.PathValue("id"))
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, 200, data)
	}
}
