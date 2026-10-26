# Messaging query paths

The production PostgreSQL store uses dedicated domain SQL for message reads and writes. The original five routes are listed below; schema 10 adds the four rich-message routes described afterward.
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

Schema 10 adds membership-authorized single-message lookup, sender-only clientId
lookup, bounded `POST .../messages/resolve` (at most 200 IDs), and author-only
`DELETE /me/messages/{messageId}`. These also use narrow SQL. The blind deletion
returns only `{ok:true,messageId}` even when the author has left the conversation;
no current conversation version, timestamp or content is disclosed. The route
creates a permanent tombstone and releases attachment relations atomically.

History, detail, list summaries, clientId lookup and resolve project attachments
and one-level replies from the same read snapshot. Conversation mutationVersion
advances only on retraction or actual attachment availability changes; every
message and reply projection uses revision=mutationVersion+1. Old messages and
attachments are batch-projected only for the bounded response, not loaded into
ordinary State. A source retraction clears its quote previews dynamically. Normal
new sends keep the existing sequence and do not advance mutationVersion.

Clients retain the greatest seen conversation version, quarantine older responses
even for previously unknown IDs, and resolve loaded IDs after invalidation,
reconnect or visibility changes. Missing IDs clear caches. Attachment viewer and
input quote state obey the same permission/authentication generation. Full DTO,
locking, privacy and recovery rules: [message media contract](../docs/MESSAGE_MEDIA_SERVICE.md).

These paths never call `loadNormalized`, `Store.Read`, or `Store.Update`, and do
not read posts, wallets, documents, friendships, reports, or audits. Public users
are explicit `id/handle/name/avatar/bio` projections; email and operational roles
are not selected into message responses. Cookie SHA-256 lookup, expiry, active
account checks, and `X-Gongming-Account` mismatch protection run in the same SQL
transaction as each operation. The common HTTP middleware still enforces Origin,
body limits, request deadlines, and request rate limits. Since schema 9 it also
checks browser/session context matching on all authenticated HTTP surfaces.
The narrow actor query repeats the context predicate inside its own snapshot;
media and WebSocket authorization use the same credential boundary. This adds
authentication SQL and is outside the historical benchmark below.

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
4. Resolve/deduplicate messages or lock/update that viewer's read watermark; rich sends/retractions lock messages and then attached media in ID order.
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

State media governance locks affected conversations in sorted order before persisting media, then increments each affected conversation version once and inserts its invalidation event. This avoids reversing the send conversation→media lock order. State writes preserve SQL-only reply/hash/attachment metadata and terminal retractions; management responses may omit optional lastMessage and are followed by a fresh detail read.

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
Password authentication/profile, posts/comments/reports, directory, friendships,
documents, test-ledger wallet, and admin endpoints also retain it unless separately migrated
by their owning domain. Device-session routes have their own implementation;
messaging SQL also checks the session's browser context and current pointer.

Other migrated domains now have their own narrow paths: private-image GET/HEAD,
notification list/badge/read operations, and all ten circle-event endpoints
(including the independent platform governance routes). Event and registration
history never enter ordinary State snapshots. State membership/account changes
run bounded event reconciliation in the same transaction; old snapshots retry
even when the activity itself was created after the snapshot. See
[circle events](../docs/CIRCLE_EVENTS_SERVICE.md) and
[notifications](../docs/NOTIFICATIONS_SERVICE.md) for those contracts. The
frontend still reads ordinary circle metadata and authentication through the
existing adapter, so these migrations do not remove every page's broad-read
cost. Event-row locks, circle management/quota locks, and per-recipient notice
counters also retain serialization points. The messaging benchmark below does
not measure these newer domains.

Wallet identity uses four SQL-only tables: browser contexts, SIWE challenges,
wallet bindings, and wallet session proofs. Ordinary State never hydrates those
histories. Browser password authentication adds a transaction hook before loading
State to lock/CAS the browser generation, and a hook after persisting sessions to
revoke the prior pointer and publish the next one atomically. Wallet operations
use the same browser → user/session → challenge → binding → related sessions
order and retry complete serializable transactions. No wallet signing prompt,
external RPC or Cookie emission runs inside the retry callback. An active address is globally
unique; account version changes invalidate stale credential challenges. Details
and capability limits are in [wallet identity](../docs/WALLET_IDENTITY_SERVICE.md).
The broad password-auth snapshot remains a cost; contexts/challenges currently
have issuance limits and expiry checks, without automatic retention cleanup or
production capacity claims.

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

Historical pre-rich-message measurement on **2026-10-27**, using Go 1.27.3 on darwin/arm64, an Apple M3 Pro,
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

The historical byte-parity benchmark above predates wallet context and rich-message projection. It is not a measured schema10 latency figure. The current schema10 correctness and runtime verification results are recorded in [STACK_STATUS](../docs/STACK_STATUS.md).

## Contact privacy and directory (schema11)

`GET/PUT /me/contact-privacy`, own block list/mutations and contact capabilities
use private SQL tables in their own authenticated transactions. Read-only GETs
return virtual defaults without inserting guard rows. Lists, totals and own CAS
revision share a REPEATABLE READ snapshot. Directory and handle profile reads
also use SQL, applying active status plus discoverable/self/real-friend rules
before filtering and pagination. They do not load ordinary State.

Conversation list/detail batches direct-chat targets into one bounded permission
projection. `canSend` combines current membership, channel ownership and the
recipient's inbound policy. Blocks work in either direction; accepted friendship
remains independent. No policy or reverse block relation enters User/PublicUser,
admin users, audit search or personal backup documents.

Ordinary contact writes establish and share-lock sorted private guard rows;
policy/block/friendship/account-status changes update guards so an old
SERIALIZABLE snapshot retries after waiting. Narrow SQL send/upload and the
State management adapter follow actor/session, sorted contact guards,
conversation, message, media and outbox order. Same client/hash confirmations
return the existing current object before applying the gate to new effects.
The State adapter records transient checks and projects return values in the
same transaction; it does not hydrate or persist the two private tables.

Private refresh events use nullable conversation IDs exclusively for internal
`contact.resync`, constrained to a recipient and no message ID. Wire projection
is only `resync/eventId`, including accounts with no conversations. Existing
outbox rows are not rewritten. Friend notifications retain immutable event keys
and dynamically remove actor/context/target when either direction is blocked.

These paths add correctness boundaries; no new capacity benchmark has been
performed. Group metadata and friendship writes still use the ordinary State
adapter, and sorted guard contention, default-row establishment and large
invitation batches need production load measurements. Runtime migration,
regression and recovery evidence is recorded in [STACK_STATUS](../docs/STACK_STATUS.md).
