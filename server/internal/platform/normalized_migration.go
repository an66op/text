package platform

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func migrateNormalized(ctx context.Context, pool *pgxpool.Pool) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Serialize schema changes only. Ordinary reads/writes never take this lock.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended(current_database()||':'||current_schema()||':gongming:migrations',0))`); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS gongming_schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	var done bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=2)`).Scan(&done); err != nil {
		return err
	}
	if done {
		if err = migrateFriendships(ctx, tx); err != nil {
			return err
		}
		if err = migrateDeviceSessions(ctx, tx); err != nil {
			return err
		}
		if err = migrateMedia(ctx, tx); err != nil {
			return err
		}
		if err = migrateCircles(ctx, tx); err != nil {
			return err
		}
		if err = migrateNotifications(ctx, tx); err != nil {
			return err
		}
		if err = migrateCircleEvents(ctx, tx); err != nil {
			return err
		}
		if err = migrateWalletIdentity(ctx, tx); err != nil {
			return err
		}
		if err = migrateMessageMedia(ctx, tx); err != nil {
			return err
		}
		if err = migrateContactPrivacy(ctx, tx); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if _, err = tx.Exec(ctx, normalizedSchema); err != nil {
		return fmt.Errorf("create normalized schema: %w", err)
	}
	if _, err = tx.Exec(ctx, normalizedGuards); err != nil {
		return fmt.Errorf("create normalized guards: %w", err)
	}
	if err = migrateFriendships(ctx, tx); err != nil {
		return err
	}
	if err = migrateDeviceSessions(ctx, tx); err != nil {
		return err
	}
	if err = migrateMedia(ctx, tx); err != nil {
		return err
	}
	if err = migrateCircles(ctx, tx); err != nil {
		return err
	}
	if err = migrateNotifications(ctx, tx); err != nil {
		return err
	}
	if err = migrateCircleEvents(ctx, tx); err != nil {
		return err
	}
	if err = migrateWalletIdentity(ctx, tx); err != nil {
		return err
	}
	if err = migrateMessageMedia(ctx, tx); err != nil {
		return err
	}
	if err = migrateContactPrivacy(ctx, tx); err != nil {
		return err
	}
	var legacy bool
	if err = tx.QueryRow(ctx, `SELECT to_regclass('gongming_app_state') IS NOT NULL`).Scan(&legacy); err != nil {
		return err
	}
	if legacy {
		var raw []byte
		err = tx.QueryRow(ctx, `SELECT value FROM gongming_app_state WHERE id=1 FOR UPDATE`).Scan(&raw)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if err == nil {
			state, decodeErr := cloneLegacy(raw)
			if decodeErr != nil {
				return decodeErr
			}
			normalizeMessageSequences(state)
			normalizeLegacySessionMetadata(state)
			for _, event := range state.Outbox {
				if event.Seq > state.EventSequence {
					state.EventSequence = event.Seq
				}
			}
			if err = persistNormalized(ctx, tx, NewState(), state); err != nil {
				return fmt.Errorf("legacy migration rejected; source preserved: %w", err)
			}
		}
		// Preserve the original payload for audited rollback/export. Removing its old
		// name prevents an old application process silently writing abandoned state.
		if _, err = tx.Exec(ctx, `ALTER TABLE gongming_app_state RENAME TO gongming_legacy_state_v1`); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO gongming_schema_migrations(version) VALUES(2)`); err != nil {
		return err
	}
	// Deferred FKs are checked by commit, so partial imports and schema objects
	// disappear together if any entity violates relational invariants.
	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit normalized migration: %w", err)
	}
	return nil
}
