# Messaging query paths

The production PostgreSQL store uses dedicated domain SQL for these five routes.
`messagingEndpoint(operation, write, fallback)` selects an explicit operation at
route registration; it does not infer behavior from a URL. A test memory store
continues to run the original State handler. Response envelopes and permissions
are unchanged.

| Route                                      | PostgreSQL path             | Behavior preserved                                                                                                                                                                           |
| ------------------------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/conversations`                | `messagingSQLConversations` | Joined conversations, latest message, member order, title substring search, limit/offset, per-conversation unread count and `unreadTotal` before filtering/pagination                        |
| `GET /api/v1/conversations/{id}`           | `messagingSQLDetail`        | Membership-only access, conversation summary, ordered public `memberProfiles`                                                                                                                |
| `GET /api/v1/conversations/{id}/messages`  | `messagingSQLHistory`       | Latest page in ascending sequence order, older `beforeId`/`beforeSeq`, forward `afterSeq`, substring search, offset compatibility, total before cursor filtering, next-history cursor        |
| `POST /api/v1/conversations/{id}/messages` | `messagingSQLSend`          | Active member, current channel owner only, body validation, sender/conversation/clientId deduplication, conflicting payload rejection, monotonic conversation sequence, transactional outbox |
| `POST /api/v1/conversations/{id}/read`     | `messagingSQLRead`          | Member-only monotonic read watermark, duplicate/older reads are no-ops, personal outbox event, unread count excluding the viewer's own messages                                              |

These paths never call `loadNormalized`, `Store.Read`, or `Store.Update`, and do
not read posts, wallets, documents, friendships, reports, or audits. Public users
are explicit `id/handle/name/avatar/bio` projections; email and operational roles
are not selected into message responses. Cookie SHA-256 lookup, expiry, active
account checks, and `X-Gongming-Account` mismatch protection run in the same SQL
transaction as each operation. The common HTTP middleware still enforces Origin,
body limits, request deadlines, and request rate limits.

Substring searches use the complete Go Unicode simple-lower mapping through
PostgreSQL `translate`, rather than locale-dependent SQL `lower`. This preserves
the State handler's behavior under a C database locale, including dotted I,
Kelvin sign, Greek, and non-BMP letters. Empty searches skip that transformation.
Send responses normalize the stored timestamp to UTC microseconds on both the
first result and clientId replay, so a PostgreSQL round-trip cannot change the
JSON timestamp's precision or offset.

## Transactions and locking

Read endpoints use a read-only `REPEATABLE READ` transaction, so authorization,
membership, totals, summaries, and message pages share one consistent snapshot.
They do not hold row locks across network writes.

Write endpoints use `SERIALIZABLE`, with this logical lock order:

1. Share-lock the authenticated user and current session.
2. Lock the target conversation: `FOR UPDATE` for send, `FOR SHARE` for read.
3. Key-share-lock the viewer's membership, preventing removal before commit.
4. Resolve/deduplicate messages or lock/update that viewer's read watermark.
5. Increment the outbox counter, insert the event, and prune retained events.

Each send serializes its target conversation, rather than all conversations.
Concurrent sends can still need serialization/unique-constraint retries because
their transaction snapshots can precede another send's commit. The entire
authorization and domain operation is retried up to 20 times on SQLSTATE
`40001`, `40P01`, or `23505`, within the HTTP deadline. The request body is cached
under the existing body limit and replayed on each attempt. Exhausted retries
return a controlled 503. Nothing is pushed to a socket before commit.

The `gongming_sequences` row named `message_events` is intentionally a **global
serialization point** for the global replay cursor. It is acquired after domain
work and held only for the event insertion/retention part of the transaction.
The retained outbox is bounded to the last 2000 events and then has its expired
prefix removed after seven days, keeping at least the latest event. This does
not establish a production throughput guarantee.

## Interoperation with the State adapter

Management still uses the existing serializable State adapter and the same
normalized tables, message sequence uniqueness constraints, outbox, and counter.
A stale management snapshot that overlaps a SQL message/read commit must retry
against the committed data. Likewise, a SQL operation overlapping membership or
owner changes rechecks authorization after a serialization retry. Unique event
sequences and atomic counter updates prevent a stale management update from
silently reusing a cursor or dropping another transaction's event. Occasional
deadlocks between the two persistence paths are also retried as complete
transactions; neither path publishes an external side effect during a retry.

Member removal deletes the viewer's readmark through the existing management
semantics and database membership foreign key. It retains historical messages.
Completed removal yields 404 for that former member's detail/history/send/read
requests. Completed channel-owner transfer yields 403 for the former owner,
including retries of an earlier clientId; only the current owner can publish.

The WebSocket dispatcher already has its own narrow SQL `ReadStream` and
`AuthorizeStream` paths, and consumes the same committed outbox across instances.
Its initial handshake still uses State authentication once.

## Remaining State paths and limits

`POST /conversations` (including direct-conversation deduplication), rename,
add/remove member, transfer owner, and leave retain the full State adapter.
Authentication/profile, posts/comments/reports, directory, friendships,
documents, wallet, and admin endpoints also retain it unless separately migrated
by their owning domain. Device-session routes have their own implementation;
messaging SQL needs only the retained `token_hash/user_id/expires_at` columns.

Thus broad snapshot costs and serializable predicate conflicts still exist for
those operations. The five messaging routes avoid cross-domain hydration, but
conversation-list unread totals count matching messages across the viewer's
joined conversations; history substring searches/counts and large offsets can
still inspect many domain rows. Per-user counters, narrower management SQL,
search indexes, and partitioning remain potential follow-up work requiring real
workload measurements.

## Verification performed

`messaging_sql_test.go` contains eight real PostgreSQL groups. Tests use
`isolatedPostgres`, create random test schemas, and never migrate the running
application schema:

1. **Domain isolation:** posts, comments, wallets, ledger, documents, friend
   requests, friendships, reports, and audits stay under `ACCESS EXCLUSIVE`
   locks while HTTP conversation list/detail/history, send, and read complete
   under individual 1.5-second deadlines. The narrow outbox snapshot also works.
2. **Contract parity:** 33 successful/error list/detail/history cases match the
   State handlers; additional checks cover pre-filter/pagination unread totals,
   public projections, non-member admin isolation, expiry, channel permissions,
   stale-account headers, Unicode lowercase, and NUL queries.
3. **Concurrent retries and removal:** eight sends across two PostgreSQL
   instances with one clientId persist one message. A deliberately stale State
   management snapshot retries after SQL send/read commits, removes the member
   without restoring readmarks, and retains all messages/events/cursor values.
4. **Atomic rollback and read races:** a forced outbox-insert failure rolls back
   the message or readmark and cursor. Concurrent older/newer reads never move
   the watermark backward. Completed owner transfer changes send permission.
5. **Concurrent owner transfer:** a State transfer loaded before a SQL send is
   forced to retry; the earlier authorized message is retained and later sends
   enforce the newly committed owner.
6. **Cross-instance WebSocket replay:** one API instance sends through SQL while
   another instance delivers the committed event and replays an offline event
   after reconnection from its decimal cursor.
7. **Retention parity:** skewed historical event timestamps exercise the same
   count/expiry prefix retention as `appendMessageEvent`.
8. **Complete idempotent responses:** the first send and its clientId replay
   return byte-identical JSON, with a non-UTC clock and nanosecond input time.

Run the focused integration suite with:

```sh
TEST_DATABASE_URL='<isolated-test-server-DSN>' go test -race ./internal/platform -run '^TestMessagingSQL' -count=1
go vet ./...
```

The local tests establish correctness for those bounded scenarios. They are not
a high-concurrency capacity acceptance test or a distributed load benchmark.

`BenchmarkMessagingHistoryReadPaths` additionally creates an isolated dataset
with 3000 unrelated posts and 1000 extra messages, verifies byte-identical HTTP
responses, and compares the original State endpoint with the new SQL endpoint:

```sh
TEST_DATABASE_URL='<isolated-test-server-DSN>' go test ./internal/platform -run '^$' -bench '^BenchmarkMessagingHistoryReadPaths$' -benchmem -benchtime=1s
```

Measured on **2026-10-27**, using Go 1.27.3 on darwin/arm64, an Apple M3 Pro,
and PostgreSQL 16.15. The command above used a 1-second benchmark duration per
path, 3000 unrelated posts and 1000 additional conversation messages in a fresh
isolated schema, and the latest 30 messages. The two HTTP response bodies were
verified byte-identical before measurement.

| Read path     | Iterations |     ns/op |      B/op | allocs/op |
| ------------- | ---------: | --------: | --------: | --------: |
| StateSnapshot |        289 | 4,993,409 | 7,364,977 |    36,493 |
| DomainSQL     |        996 | 1,181,818 |   129,105 |       442 |

These are single-machine, sequential local read measurements with one PostgreSQL
instance and this bounded dataset. They show the cost of these two query paths
under those conditions. They do not measure concurrent writes, lock contention,
distributed deployment, sustained throughput, or production capacity, and do
not establish a throughput or capacity commitment.
