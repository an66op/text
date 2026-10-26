# Schema 8: circle events and transactional waitlists

API 0.8.0 implements the frozen contract in
[`docs/CIRCLE_EVENTS_SERVICE.md`](../../docs/CIRCLE_EVENTS_SERVICE.md). Events
are circle-level entities, independent of forum/announcement channels. There
are no fees, payment tickets, check-in/location collection, external meeting
navigation, media references, or scheduled background jobs in this release.

## Migration and durable authority

Schema 8 adds exactly three authoritative tables:

- `gongming_circle_events`: immutable identity, creator/clientId/fingerprint,
  content, UTC times, capacity/counters, per-event registration sequence,
  lifecycle, moderation, note, revision, and timestamps.
- `gongming_circle_event_registrations`: one row per event/user, registered /
  waitlisted / cancelled state, controlled reason, queue ordinal and timestamps.
- `gongming_circle_event_requests`: immutable successful event/user/clientId
  receipts bound to one intent. Failed operations save no receipt.

Foreign keys bind events to circles/users and registrations to their event,
circle and member identity. Unique keys protect creation idempotency, one
registration per person and stable ordinals. SQL guards protect immutable
identities, revision advancement, cancellation terminal state, queue ordering,
capacity and count equality. Deferred checks compare stored counters to actual
registration rows and reject invalid active memberships. All three tables
reject physical DELETE; receipts also reject UPDATE. Explicit re-registration
uses a fresh ordinal at the queue tail, while preserving the row's original
createdAt; current queue position comes from ordinal, not that timestamp.

Duration is bounded by absolute `interval '168 hours'`, matching Go's 7×24h
validation even in a session time zone crossing daylight saving time. Each
circle has at most 20 unfinished, uncancelled events, including hidden events.
The application checks this under the circle lock; a deferred SQL guard also
checks it at commit.

The same migration transaction extends report targetType with `circle-event`
and the existing notification CHECK with three controlled event kinds. It
does not rewrite any existing business row, Cookie or media file. DDL, guards
and the version marker commit together; failure rolls everything back, and
re-running a completed migration is a no-op. Existing databases receive no
activity or registration backfill. Only a first empty development seed inserts
two labelled public-circle examples, one with demo confirmed and one with demo
waitlisted; their confirmations, queues and receipts are real relational rows.
Seed drafts are transient and commit atomically with the original development
accounts/circles, rather than in a later best-effort transaction.

## Dedicated SQL and permissions

All ten event routes use explicit domain SQL, including create/edit/cancel,
registration, attendees, report, and independent staff governance. No route
calls `loadNormalized` or stores activity history in State. Ordinary reads use
REPEATABLE READ so authorization, totals, page and myRegistration share one
snapshot. A list batches the current user's registrations for its bounded page;
admin lists project aggregate counters without querying a participant list or
the operator's personal registration.

Every request checks the current session, active account and expected-account
header. Writes retain Origin, body-size, deadline and rate-limit protection.
Ordinary access requires current active circle membership, including in public
circles. Suspended circles deny ordinary reads; archived circles retain readable
history. Hidden events are visible only to current circle owner/admin. A former
creator has no special management/read privilege, including creation receipt
replays. Platform roles only grant independent governance routes and never
membership. Attendee lists are circle-management-only; ordinary members see
only their own registration and aggregate counts.

Leave has a narrow cleanup exception: a normal account with its own prior
registration/receipt may cancel by known event ID while the circle is suspended,
archived or membership has been lost. It returns only the current personal
registration, never event content, location or other participants. Unknown
history without circle access is 404. No cleanup restores content permissions.

## Queue transactions, receipts and reconciliation

Write lock order is authenticated user/session → circle → actor membership →
event → registrations/receipt → audits → recipient-local notification counters.
Create/edit/cancel serialize the circle where quota or management changes need
it; registration and governance share-lock the circle. Membership uses
`FOR SHARE`, because key-share would not block status/role updates. The target
event is always locked `FOR UPDATE` before queue work. Deadlocks, serialization
and unique conflicts retry the complete authorization and operation with the
original bounded body. There are no external side effects before commit.

Existing eligible waiters are coordinated before a new signup can take a seat.
Join only accepts a confirmed seat; waitlist accepts a seat or appends at the
tail. An already registered/waitlisted person keeps their place. When a join
still finds the event full, its 409 rolls back **all** provisional promotions,
counter changes, notifications and audits; partial coordination is not committed
under an error response. A successful request receipt is permanently bound to
its intent. Replaying an old join/leave reads the person's current registration
without reapplying the old action, so an old leave cannot cancel a later signup.

Cancellation releases all active registrations with reason=event. Capacity
growth, eligible leave, and recovery from circle suspension or hidden moderation
coordinate valid waiters in the same successful transaction. Promotion requires
published/visible activity, active circle/account/membership and an unexpired
registration window. After cutoff, releases do not promote; the waiter remains
visibly waitlisted with registrationOpen=false. Suspension/archive/hidden retain
registrations rather than cancelling them, and recovery never resurrects a
cancelled registration or reopens a time window.

State still handles the existing member/account/circle operations. Its transaction
persists those entity deltas, then calls a narrow reconciliation hook before
notification flush. Loss of membership or account access cancels that person's
unfinished registrations with reason=membership/account, updates counts and
promotes other eligible waiters atomically. Unbanning/rejoining does not restore
the cancelled row. Circle suspended→active also invokes reconciliation.

The hook locks **every unfinished event in each affected circle**, rather than
only signup rows visible in its old snapshot. This detects event counter writes
made by overlapping SQL signup transactions and forces complete retries. Real
PostgreSQL tests also prove the predicate case where a different transaction
creates an entirely new event and signup after the old State snapshot: member
removal and account suspension both retry and release it. No State writer
rewrites the activity tables from an obsolete in-memory collection.

## Notifications and moderation

The existing fourteen kinds retain their meanings; the three additions are
`circle-event-update` (updated/cancelled), `circle-event-registration` (promoted)
and `circle-event-review` (hidden/visible). Business, registration, receipt,
audit and notification writes share one transaction. Revision/ordinal keys
deduplicate real transitions; repeated requests and same-content edits create
no extra event. Platform same-status note edits still advance revision and audit
for concurrency protection, while producing no review notification.

Review recipients include the original creator independently of current
membership, plus current active registered/waitlisted members, deduplicated and
excluding the actor. Leaving creators receive an unavailable historical result,
not a new access privilege. Event notification context is batch-projected from
this page's IDs using current member/circle/moderation permissions. It contains
only the current title and bounded location/time excerpt. System actor is null;
unavailable context/actor/target are all null. No internal moderation note or
historical private content is copied into notifications.

## Verification and remaining boundary

Eleven focused groups (ten real PostgreSQL isolated-schema groups and one input
unit group) cover:

1. Current permissions, creation replays after edits/demotion, time/CAS checks,
   no-op edit revisions, hidden counts and cross-circle isolation.
2. Cross-instance final-seat concurrency, queue order, receipts, old leave/join
   replay protection, manager-only pagination, and terminal cancellation.
3. Reads, list, registration, leave, attendees and edit while unrelated posts,
   media, wallet, documents, messages and friendships hold exclusive locks.
4. Input length/mode validation.
5. Hidden/circle recovery promotion, pause/archive preservation and blind leave,
   cutoff behavior, cutoff extension and self-notification exclusion.
6. Full-join rollback of provisional promotions/receipts/notifications, and
   inbox failure rolling back an edit/capacity increase.
7. Two old-snapshot/existing-event interleavings, member/account release,
   rejoin non-restoration and promoted notification persistence.
8. Departed creator review redaction, independent governance/report closure,
   foreign keys, immutable identities/counters and three-table DELETE rejection.
9. v7 upgrade/idempotence/DDL rollback with all old rows/xmin, prior notification,
   Cookie and image bytes preserved, with no existing-database seeding.
10. First-empty confirmed/waitlisted examples, 20-event quota, and an exact
    168-hour activity across America/Denver DST (longer rejected by SQL).
11. Entirely new events/signups committed after State snapshots, for both
    membership removal and account suspension.

```sh
TEST_DATABASE_URL='<test-server-DSN>' go test -race ./internal/platform \
  -run '^TestCircleEvent' -count=1
go vet ./...
```

The related circle, notification and earlier migration suites are also checked.
Tests use disposable schemas and never migrate the shared running database.
The account/membership side still pays the existing full-State snapshot cost;
the reconciliation hook is bounded to 20 unfinished events **per affected
circle**, not a global bound on an account's total memberships. Large fanout,
notification/audit retention, counts over historical lists, and lock contention
need workload measurements. There is no event GC, distributed admission
control, real-time event stream, reminder scheduler, production capacity claim,
or new media/object-storage capability in this release.
