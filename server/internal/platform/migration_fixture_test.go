package platform

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// A historical database must be populated with its historical session columns,
// not with today's authentication writer. This adapter exists only in tests;
// the production writer always requires the fully migrated current schema.
func persistHistoricalFixture(ctx context.Context, tx pgx.Tx, version int, state *State) error {
	if version < 2 || version >= 10 {
		return fmt.Errorf("unsupported historical fixture version %d", version)
	}
	snapshot := *state
	snapshot.Sessions = map[string]Session{}
	snapshot.Messages = map[string]StoredMessage{}
	snapshot.Media = map[string]StoredMediaAsset{}
	if err := persistNormalized(ctx, tx, NewState(), &snapshot); err != nil {
		return err
	}
	for _, id := range mapKeys(state.Messages) {
		m := state.Messages[id]
		if _, err := tx.Exec(ctx, `INSERT INTO gongming_messages(id,conversation_id,sender_id,body,created_at,seq,client_id) VALUES($1,$2,$3,$4,$5,$6,$7)`, m.ID, m.ConversationID, m.SenderID, m.Body, m.CreatedAt, m.Seq, nullString(m.ClientID)); err != nil {
			return err
		}
	}
	for _, id := range mapKeys(state.Media) {
		v := state.Media[id]
		var err error
		if version < 6 {
			_, err = tx.Exec(ctx, `INSERT INTO gongming_media_assets(id,owner_id,client_id,source_hash,content_type,width,height,bytes,status,note,created_at,updated_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, v.ID, v.OwnerID, v.ClientID, v.SourceHash, v.ContentType, v.Width, v.Height, v.Bytes, v.Status, v.Note, v.CreatedAt, v.UpdatedAt, v.DeletedAt)
		} else {
			_, err = tx.Exec(ctx, `INSERT INTO gongming_media_assets(id,owner_id,client_id,source_hash,content_type,width,height,bytes,status,note,created_at,updated_at,deleted_at,scope,circle_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, v.ID, v.OwnerID, v.ClientID, v.SourceHash, v.ContentType, v.Width, v.Height, v.Bytes, v.Status, v.Note, v.CreatedAt, v.UpdatedAt, v.DeletedAt, effectiveMediaScope(v), nullString(v.CircleID))
		}
		if err != nil {
			return err
		}
	}
	for _, hash := range mapKeys(state.Sessions) {
		session := state.Sessions[hash]
		if version < 4 {
			if _, err := tx.Exec(ctx, `INSERT INTO gongming_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)`, hash, session.UserID, session.ExpiresAt); err != nil {
				return err
			}
		} else {
			if _, err := tx.Exec(ctx, `INSERT INTO gongming_sessions(token_hash,user_id,expires_at,public_id,device,created_at,last_seen_at,legacy) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, hash, session.UserID, session.ExpiresAt, session.ID, session.Device, session.CreatedAt, session.LastSeenAt, session.Legacy); err != nil {
				return err
			}
		}
	}
	return nil
}

// Freeze every source column before upgrading, including its row xmin. Adding a
// new column with a legitimate default must not make old-column preservation
// assertions fail; changing any source value or rewriting an old row still does.
func freezeMigrationProjection(ctx context.Context, store *PostgresStore, table string) (string, error) {
	rows, err := store.pool.Query(ctx, `SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position`, table)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	columns := []string{}
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			return "", err
		}
		columns = append(columns, pgx.Identifier{name}.Sanitize())
	}
	if err = rows.Err(); err != nil {
		return "", err
	}
	if len(columns) == 0 {
		return "", fmt.Errorf("missing historical table %s", table)
	}
	return `SELECT COALESCE(jsonb_agg(obj ORDER BY obj::text),'[]'::jsonb)::text FROM (SELECT to_jsonb(t) AS obj FROM (SELECT ` + strings.Join(columns, ",") + `,xmin::text AS "__xmin" FROM ` + pgx.Identifier{table}.Sanitize() + `) t) source`, nil
}
