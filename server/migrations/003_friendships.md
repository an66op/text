# Migration 3: explicit friend requests and mutual friendships

Executable schema, guards, loading and incremental persistence are in
`internal/platform/friendship_persistence.go`.

`PostgresStore.Migrate` applies migration 3 under the existing schema-scoped
transaction advisory lock. A database already at v2 receives two empty tables:

- `gongming_friend_requests`: caller/recipient foreign keys, bounded note and
  status/timestamp checks, immutable request identity/content, immutable terminal
  decisions, incoming/outgoing indexes, and a generated unordered pair with a
  partial unique index allowing at most one pending request in either direction.
- `gongming_friendships`: one canonical ordered user pair, both user foreign keys,
  acceptance timestamp and indexes for each participant.

Deferred database guards reject a friendship without an accepted request or a
friendship coexisting with a pending request for the same pair. Request acceptance
and the mutual friendship insert commit together. Removal deletes only that
canonical friendship, keeps historical requests, and never removes conversations
or messages. A replay of an old accepted response does not recreate a removed
friendship; a new request must be sent and accepted again.

There is no automatic relationship import from the member directory, existing
private conversations, group memberships or channels. Every existing account
starts with zero explicit friends unless real friend-request records already
exist in a source State import. Original v2 users, conversations, messages,
ledger and session data are not rewritten by this migration.

Fresh and v1 databases apply v2 and v3 in the same transaction. Old entity IDs,
session hashes, ledger history and the v1 backup payload retain their existing
migration guarantees. Any schema/import/foreign-key failure rolls back all new
tables and markers together. A committed v3 marker makes re-running migration a
no-op. Do not execute the migration on a running old API binary; back up and stop
old processes first, then restart the new API. This implementation does not
perform any live-database migration during isolated-schema tests.

The API caller must be active. Request creation and acceptance require both
accounts active. Cancellation, refusal and friendship removal may clean up an
existing relationship involving a suspended account. Friend lists hide suspended
accounts; request history remains visible only to its two participants with
PublicUser projections. Maximum note length is 300 Unicode characters.

Transactions retain the current SERIALIZABLE snapshot adapter and replayable
callbacks. Concurrent same-direction requests converge to the original pending
record, reciprocal pending attempts return conflict, and repeated acceptance
converges to one friendship. Domain-specific SQL queries remain a future
performance improvement; this migration does not promise large-scale throughput.
