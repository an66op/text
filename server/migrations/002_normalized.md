# Migration 2: authoritative relational entities

The executable, transactionally applied SQL is `internal/platform/normalized_schema.go`.
`PostgresStore.Migrate` performs this sequence under a schema-scoped transaction advisory lock:

1. Create normalized users/sessions/posts/likes/comments/conversations/members/messages/documents/reports/audits/wallets/ledger/wallet_requests/reads/outbox/sequences tables, constraints and indexes.
2. If `gongming_app_state` exists, read its original payload once and import every entity with its original ID, session digest, document revision, wallet balance, ledger history, idempotent response and audit. Legacy message sequences are backfilled chronologically per conversation.
3. Rename that source to `gongming_legacy_state_v1` and preserve its exact payload. The runtime never reads or writes it. Old binaries fail rather than silently writing abandoned data.
4. Record version 2 and commit. Any failure, including deferred foreign keys, rolls back schema/data/version/rename atomically. Re-running a committed migration is a no-op.

Back up the database and stop old API processes before migrating the live database.
Do not copy only the legacy table back onto an active normalized database: restore a tested full backup in an isolated database and coordinate the binary version. Post-migration writes only exist in normalized tables.

The State callback remains a compatibility layer. Reads use a REPEATABLE READ transaction; writes load a SERIALIZABLE snapshot and persist only changed rows, with whole-callback retries on serialization/deadlock/unique-conflict races. There is no global application-state row lock. Large snapshot reads and SSI predicate conflicts still limit throughput; production scale requires domain-specific SQL repositories/cursor queries, not merely more API replicas.
