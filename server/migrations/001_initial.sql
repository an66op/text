-- Executed idempotently by PostgresStore.Migrate at startup. IDs/permissions live in
-- the Go domain model. The single lock ensures ledger/admin invariants are atomic.
CREATE TABLE IF NOT EXISTS gongming_schema_migrations (
 version integer PRIMARY KEY,
 applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gongming_app_state (
 id smallint PRIMARY KEY CHECK (id = 1),
 value jsonb NOT NULL,
 revision bigint NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO gongming_schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
