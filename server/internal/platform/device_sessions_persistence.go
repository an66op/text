package platform

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// The old authentication columns are intentionally unchanged. Volatile random
// defaults assign independent public identifiers to existing rows, never hashes
// of their secret credentials. They also allow a coordinated older binary to
// insert a legacy session using the original three-column INSERT.
const deviceSessionSchema = `
ALTER TABLE gongming_sessions
 ADD COLUMN public_id text NOT NULL DEFAULT ('session_'||replace(gen_random_uuid()::text,'-','')),
 ADD COLUMN device text NOT NULL DEFAULT '未知设备',
 ADD COLUMN created_at timestamptz,
 ADD COLUMN last_seen_at timestamptz,
 ADD COLUMN legacy boolean NOT NULL DEFAULT true,
 ADD CONSTRAINT gongming_sessions_public_id_format CHECK(public_id ~ '^session_[a-f0-9]{32}$'),
 ADD CONSTRAINT gongming_sessions_device_length CHECK(char_length(device) BETWEEN 1 AND 80),
 ADD CONSTRAINT gongming_sessions_known_metadata CHECK(legacy OR (created_at IS NOT NULL AND last_seen_at IS NOT NULL)),
 ADD CONSTRAINT gongming_sessions_validation_order CHECK(created_at IS NULL OR last_seen_at IS NULL OR last_seen_at>=created_at);
CREATE UNIQUE INDEX gongming_sessions_public_id_idx ON gongming_sessions(public_id);
CREATE INDEX gongming_sessions_user_created_idx ON gongming_sessions(user_id,created_at DESC,public_id);
`

func migrateDeviceSessions(ctx context.Context, tx pgx.Tx) error {
	var done bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=4)`).Scan(&done); err != nil {
		return err
	}
	if done {
		return nil
	}
	if _, err := tx.Exec(ctx, deviceSessionSchema); err != nil {
		return fmt.Errorf("create device-session metadata: %w", err)
	}
	_, err := tx.Exec(ctx, `INSERT INTO gongming_schema_migrations(version) VALUES(4)`)
	return err
}
