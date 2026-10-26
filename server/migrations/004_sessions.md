# Schema v4: account device sessions

This is an additive migration on `gongming_sessions`, inside the existing schema-migration transaction and advisory lock. It preserves the original `token_hash`, `user_id`, and `expires_at` exactly: existing cookies keep working. No account is logged out during migration.

The added `public_id` is an independent random, non-secret locator, not a token or token digest. Existing rows receive random identifiers through PostgreSQL 16's core [`gen_random_uuid()`](https://www.postgresql.org/docs/16/functions-uuid.html), without installing an extension. UUID defaults are volatile and may rewrite/lock the sessions table; do not claim a lock-free or zero-downtime migration. Stop application writers and take a verified backup before deployment.

Existing sessions become `legacy=true`, device `未知设备`, and NULL `created_at` / `last_seen_at`. No migration timestamp is presented as historical login activity. The v1 JSONB import follows the same rule when metadata was absent. Existing metadata is retained when already present. Re-running a committed migration leaves all public IDs unchanged.

New registration/login records use a random public ID, UTC timestamps at PostgreSQL microsecond precision, and a fixed coarse OS/browser label derived from the user-agent. The original user-agent, IP, token, and digest are never returned by the management API; raw user-agent/IP are not stored in these columns. A user-agent label is an untrusted convenience hint, not verified hardware or an authentication factor.

`last_seen_at` currently records session establishment/credential validation only. Ordinary GET requests do not update it. The UI must call it “最近验证”, explain this meaning, and must not label it live activity, last visit, or online presence.

Authenticated users can list only their own valid sessions, revoke one by public ID, or revoke all others while retaining the current cookie. Unknown, expired, already-revoked, and another account's IDs all return 404. Revoking the current session clears its cookie only after the transaction commits. Account-identity/Origin/active-account checks remain authoritative. WebSocket authentication still uses the old token hash and expiry columns and closes revoked sessions through its existing session validation.

## Rollback and recovery

DDL, default backfill, indexes, and the version 4 marker commit atomically. If any migration statement fails, all of them roll back; the original authentication rows remain unchanged and usable. Repair the cause and retry migration from the intact source.

The additional columns have defaults, so a coordinated v3 binary can still use its original three-column session INSERT; those new rows honestly remain legacy/unknown. Existing cookies continue to work. Do not drop these columns while a v4 binary is running. For a full database rollback, restore a tested full backup into an isolated database and coordinate the matching binary version. A rollback cannot resurrect sessions revoked after the backup without also restoring older authentication state; treat that as an explicit security decision.

Verification uses isolated PostgreSQL schemas: preservation of original credential columns, stable public IDs, NULL historical metadata, migration failure rollback/retry, old-writer compatibility, per-account IDOR boundaries, revocation persistence, and closing only the revoked device's WebSocket. No test migrates or rewrites the running application database.
