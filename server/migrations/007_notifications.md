# Schema 7: transactional account notifications

API version 0.7.0 follows the fourteen event kinds, controlled outcomes, target
union, and privacy rules in
[`docs/NOTIFICATIONS_SERVICE.md`](../../docs/NOTIFICATIONS_SERVICE.md).
Notifications cover explicit social actions and moderation outcomes. Chat
unread remains in the messaging domain; no email, push service, or notification
creation API is added.

## Storage and atomic event creation

The migration adds `gongming_notifications` and
`gongming_notification_counters` in the existing migration transaction and
advisory lock. A failed DDL statement rolls back both objects and the version
marker; running the successful migration again changes nothing. No existing
business row, session, media file, or identifier is rewritten. Existing
databases receive no historical inbox backfill. Only the first empty
development seed queues notifications for its newly created, labelled real
circle comments, likes, and pending application.

Inbox rows contain a random `notice_<32 lowercase hex>` ID, recipient, optional
actor, recipient-local sequence, kind/outcome, immutable reference ID, stable
event key, creation time, and nullable read time. Recipient and actor have user
foreign keys. Business references intentionally remain soft IDs: world posts
can be physically deleted while their notification survives as an unavailable
history item. A target ID never grants access on its own.

There are no stored content snapshots, circle names, titles, excerpts, covers,
moderation notes, raw invitation tokens, or arbitrary jump URLs. Check
constraints restrict kind/outcome pairs and timestamps. Unique constraints
protect `(recipient_id,event_key)` and `(recipient_id,sequence)`. An immutable
identity guard permits the first read timestamp to be set but prevents its
replacement or reversal. Recipient/sequence and partial unread indexes support
inbox operations.

Business handlers queue explicit `State.NotificationDrafts` only after an
authorized real transition. This slice uses `json:"-"`; normal State reads,
cloning, and normalized persistence never load notification history. The live
callback's drafts remain in memory until `PostgresStore.updateOnce` persists
business entity deltas and flushes drafts in the **same transaction**, before
COMMIT. Any business, audit, inbox, constraint, or commit error fails the whole
transaction. Complete callback retries rebuild drafts from the fresh snapshot.
There are no external side effects or post-commit best-effort inbox writes.

Flush groups recipients and locks their counter rows in sorted user-ID order.
The lock scope is one recipient, not a global event sequence. After checking
existing event keys, it assigns a sequence and inserts each new row. Comment
and request IDs provide stable keys; likes use domain/post/actor for lifetime
deduplication across unlike/re-like cycles. New real status/role transitions
receive distinct change keys, so a later genuine reversal remains an event.
Idempotent terminal requests, same-status notes, repeated roles, self actions,
and transfer's old owner do not create extra notifications. Media blocking
queues both the asset result and each affected post's hidden result in the
same transaction. This release has no inbox deletion or GC; future retention
must preserve lifetime like-deduplication evidence separately before removing
rows.

## Domain SQL and the read-all boundary

All four notification endpoints use dedicated SQL, never `loadNormalized`.
Authentication checks the current token hash, expiry, active account, and
expected account header. Writes also share-lock the actor/session and retain
the shared Origin, body-size, deadline, and rate-limit middleware.

List and badge use repeatable-read snapshots. List first reads the recipient's
bounded page, then batches only the referenced domains for permission
projection. No page causes whole-table business hydration. Badge, single read,
and read-all query only users/sessions and notification tables. Unrelated
business-table exclusive locks therefore do not block those operations; a list
with only request rows also avoids unrelated world/media/circle-post tables.

`throughId` is the recipient's highest committed sequence ID in that snapshot,
independent of category, unread filtering, and pagination. Empty inboxes return
null. Read-all requires the field explicitly; null marks nothing. A non-null ID
must belong to the current recipient, and only unread rows at or below that
row's sequence are updated. Per-recipient counter serialization ensures a
later committed notification is beyond an earlier visible bound. Cross-account
or unknown bounds return 404. Repeated single reads preserve their original
timestamp. Complete serializable retries handle concurrent readers/writers;
unknown commit results are errors, not success claims.

## Current permission projection

Only reference IDs and controlled historical outcomes are durable. Every list
recomputes actor profiles, context, target availability, and snippets from
current entities and permissions in the same snapshot. Missing/deactivated
friend targets, deleted posts/media, private-circle departure, role downgrade,
staff-channel access changes, and circle suspension cannot restore an old
content snapshot. Unavailable items have **actor/context/target all null**.

Circle request notifications require current circle management access.
Circle decision/membership/status introductions require a current active member
or the recipient's pending request, even for a public circle. Circle post
notifications use current circle/channel/post read checks with no automatic
platform-staff membership privilege. World authors can still inspect their
pending/hidden posts. Media results link only to the owner's undeleted uploads
metadata, without loading a blocked image. System notifications expose no
moderator identity. Report closure is a fixed informational outcome, with no
content, internal note, actor, or link. Snippets are generated at read time and
bounded to 120/160 Unicode codepoints.

## Focused verification and remaining limits

Ten notification groups use a dedicated atomic memory test adapter and real
PostgreSQL isolated schemas. They cover event/business/audit failure rollback;
two-instance request and counter concurrency; permanent like deduplication;
account/Origin/session/header isolation; exact read timestamp idempotence;
snapshot bounds protecting new arrivals; null/cross-account/unknown bounds;
unrelated-table lock independence; current private-circle membership, manager,
channel, suspension and deletion redaction; lifecycle/transfer/archive/self
noise; world and circle media-moderation cascades; report information privacy;
foreign keys and immutable event identity; initial-only seed behavior; and
v6→v7 DDL failure rollback/idempotence with old row xmin, cookie, and file bytes
preserved.

```sh
TEST_DATABASE_URL='<test-server-DSN>' go test -race ./internal/platform \
  -run '^TestNotification' -count=1
go vet ./...
```

The dedicated memory adapter is test-only. Production still requires
PostgreSQL. Notifications have no real-time subscription, external delivery,
delete/GC, retention limit, or measured capacity guarantee. Inbox counters and
event writes serialize per recipient; high-fanout circle status changes write
one event per active member (current circle limit 1000). Exact unread counts
scan that recipient's indexed unread rows. Other social business handlers still
have the existing whole-State snapshot cost even though notification history is
excluded and inbox reads/writes use account-domain SQL. Future capacity work
must measure those costs rather than infer production throughput from these
tests.
