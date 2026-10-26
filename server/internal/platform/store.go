package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store interface {
	Read(context.Context, func(*State) error) error
	Update(context.Context, func(*State) error) error
	Ping(context.Context) error
}
type PostgresStore struct{ pool *pgxpool.Pool }

func OpenPostgres(ctx context.Context, dsn string) (*PostgresStore, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 10
	cfg.MinConns = 1
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	s := &PostgresStore{p}
	if err = s.Ping(ctx); err != nil {
		p.Close()
		return nil, err
	}
	return s, nil
}
func (s *PostgresStore) Close()                            { s.pool.Close() }
func (s *PostgresStore) Ping(ctx context.Context) error    { return s.pool.Ping(ctx) }
func (s *PostgresStore) Migrate(ctx context.Context) error { return migrateNormalized(ctx, s.pool) }
func (s *PostgresStore) Read(ctx context.Context, fn func(*State) error) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = verifyBrowserSnapshot(ctx, tx); err != nil {
		return err
	}
	state, err := loadNormalized(ctx, tx)
	if err != nil {
		return err
	}
	if err = fn(state); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *PostgresStore) Update(ctx context.Context, fn func(*State) error) error {
	// SERIALIZABLE detects lost updates, write skew and predicate conflicts. Retry
	// the entire callback against a fresh snapshot, never an old computed patch.
	// Callbacks must be replayable and must not perform external side effects.
	for attempt := 0; attempt < 20; attempt++ {
		err := s.updateOnce(ctx, fn)
		if err == nil {
			return nil
		}
		if !retryableTransaction(err) {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		delay := time.Duration(min(150, 5*(attempt+1))+rand.IntN(15)) * time.Millisecond
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
	return &APIError{503, "transaction_conflict", "操作繁忙，请稍后重试"}
}
func (s *PostgresStore) updateOnce(ctx context.Context, fn func(*State) error) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	m, _ := ctx.Value(browserMutationKey{}).(*browserMutation)
	if err = lockBrowserMutation(ctx, tx, m); err != nil {
		return err
	}
	if err = verifyBrowserSnapshot(ctx, tx); err != nil {
		return err
	}
	state, err := loadNormalized(ctx, tx)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	before := NewState()
	if err = json.Unmarshal(raw, before); err != nil {
		return err
	}
	if err = fn(state); err != nil {
		return err
	}
	mediaConversations, err := lockChangedConversationMedia(ctx, tx, before, state)
	if err != nil {
		return err
	}
	if err = persistNormalized(ctx, tx, before, state); err != nil {
		return err
	}
	if err = persistConversationMediaMutations(ctx, tx, mediaConversations); err != nil {
		return err
	}
	if err = finishBrowserMutation(ctx, tx, m); err != nil {
		return err
	}
	if err = persistCircleEventSeeds(ctx, tx, state.EventSeedDrafts); err != nil {
		return err
	}
	if err = reconcileCircleEvents(ctx, tx, before, state); err != nil {
		return err
	}
	if err = persistNotificationDrafts(ctx, tx, state.NotificationDrafts); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func retryableTransaction(err error) bool {
	var database *pgconn.PgError
	if !errors.As(err, &database) {
		return false
	}
	return database.Code == "40001" || database.Code == "40P01" || database.Code == "23505"
}
func Env(name, otherwise string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return otherwise
}
func cloneLegacy(raw []byte) (*State, error) {
	s := NewState()
	if err := json.Unmarshal(raw, s); err != nil {
		return nil, fmt.Errorf("decode legacy state: %w", err)
	}
	return s, nil
}
