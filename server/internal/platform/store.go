package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5"
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
func (s *PostgresStore) Close()                         { s.pool.Close() }
func (s *PostgresStore) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }
func (s *PostgresStore) Migrate(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS gongming_schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()); CREATE TABLE IF NOT EXISTS gongming_app_state (id smallint PRIMARY KEY CHECK (id=1), value jsonb NOT NULL, revision bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()); INSERT INTO gongming_schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;`)
	if err != nil {
		return err
	}
	b, err := json.Marshal(NewState())
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO gongming_app_state(id,value) VALUES (1,$1::jsonb) ON CONFLICT DO NOTHING`, string(b))
	return err
}
func (s *PostgresStore) Read(ctx context.Context, fn func(*State) error) error {
	var raw []byte
	if err := s.pool.QueryRow(ctx, `SELECT value FROM gongming_app_state WHERE id=1`).Scan(&raw); err != nil {
		return err
	}
	state := NewState()
	if err := json.Unmarshal(raw, state); err != nil {
		return fmt.Errorf("decode stored state: %w", err)
	}
	return fn(state)
}
func (s *PostgresStore) Update(ctx context.Context, fn func(*State) error) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var raw []byte
	if err = tx.QueryRow(ctx, `SELECT value FROM gongming_app_state WHERE id=1 FOR UPDATE`).Scan(&raw); err != nil {
		return err
	}
	state := NewState()
	if err = json.Unmarshal(raw, state); err != nil {
		return err
	}
	if err = fn(state); err != nil {
		return err
	}
	raw, err = json.Marshal(state)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE gongming_app_state SET value=$1::jsonb,revision=revision+1,updated_at=now() WHERE id=1`, string(raw)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func Env(name, otherwise string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return otherwise
}
