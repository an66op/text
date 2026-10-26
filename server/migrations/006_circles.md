# Schema 6: server circles and scoped media

The public DTOs and routes are defined in
[`docs/CIRCLES_SERVICE.md`](../../docs/CIRCLES_SERVICE.md). API version 0.6.0
adds real PostgreSQL circles alongside the independent browser demo. Demo data
are never imported into these tables.

## Migration and authority

The existing migration transaction and schema advisory lock apply schema 6
atomically. The authoritative relations are `gongming_circles`,
`gongming_circle_members`, `gongming_circle_requests`,
`gongming_circle_channels`, `gongming_circle_posts`,
`gongming_circle_comments`, `gongming_circle_likes`,
`gongming_circle_invites`, `gongming_circle_invite_redemptions`, and
`gongming_circle_post_media`. The State adapter reads these relations and
persists changed entities and reference links; no circle JSON blob is used.

Foreign keys bind posts to their own circle/channel, members and authors to
users, invitations to circles, and media references to assets. Unique keys
cover creator/clientId, author/circle/channel/clientId, one pending join request
per user/circle, one active owner per circle, and one invitation redemption per
user. Deferred constraints validate the current owner, member/channel/ownership
limits, invitation use totals, immutable identities, post tombstones, and media
scope/ownership/publication rules. Transaction retries protect concurrent last
slots, idempotent writes, membership changes, and moderation.

`gongming_media_assets` gains immutable `scope` and `circle_id` columns. The
constant default labels existing rows `world` without updating those rows;
their IDs, timestamps, xmin, files, and old links remain intact. The report
target constraint additionally accepts `circle-post`. Migration failure rolls
back the version marker, tables, guards, and column changes together; repeated
successful migration is a no-op. This is an upgrade, not an application
downgrade procedure. Back up database and private media together before a live
upgrade.

Only the initial empty development seed creates two explicitly labelled
example circles, real members/channels/text content, and one pending request.
Existing databases return before this seed, and production does not seed it.
No invitation raw token, artificial online count, or file-backed image is seeded.

## Authorization and durable transitions

An active public circle exposes its introduction to guests. Content always
requires current membership; private introductions require current membership
or the requester's own pending application. Staff-only channels are omitted
from ordinary member results. Platform admin/moderator roles do not grant
membership or circle management rights through normal routes. Separate audited
platform governance routes can inspect and moderate private content.

Circle owner/admin/member permissions are checked on every request. An owner
must transfer before leaving; removed/banned users retain history but lose
access. Archived circles preserve readable member history and reject new
content and membership management. Suspended circles deny normal content
access. Announcement members may comment and like readable published posts;
only circle staff can create announcement main posts. Pending/hidden feed
filters require circle staff. Post deletion retains an immutable idempotency
tombstone and releases media references, so a deleted clientId cannot recreate
the post. Authors may delete their own posts by known ID after leaving to
release uploads, without receiving private content.

Invitations use 256-bit random tokens; only a SHA-256 digest is persisted.
Creation is the only response containing a raw token. Expiry, revocation, and
use limits are enforced atomically with the request/join and unique redemption.
An existing member or pending applicant retries before testing remaining uses,
so a committed retry does not consume a second use. Revocation does not revoke
an already submitted application. Replaying an accepted request cannot restore
a removed member. Historical outgoing requests and creator idempotency receipts
must still pass current introduction access; they cannot reveal later private
circle metadata after membership is lost.

## Media separation

Circle uploads require current active membership and bind immutable scope to
one circle. Circle posts accept only the author's ready assets from that
circle, and image posts initially require review. World posts reject circle
assets. Publication rechecks every asset; blocking an asset atomically hides
published world and circle references, while unblocking restores no post.

Image GET/HEAD uses a narrow repeatable-read PostgreSQL authorization query,
not a full State load. A published circle reference grants access only to
current members who can read its channel and whose circle is not suspended.
It never grants anonymous/world access, including for public circles. Owner
and independent platform media inspection remain separate authorization paths.
Files remain private, with `Cache-Control: no-store`; the upload limits,
orientation handling, filesystem rules, conservative unknown-COMMIT
compensation, backup requirements, and lack of automatic GC in
[`005_media.md`](005_media.md) continue to apply.

Detailed media results keep `posts` world-only and add separate `circlePosts`,
`circleReferenceCount`, and `circlePublishedReferenceCount`.
`referenceCount` includes both domains; `publishedReferenceCount` counts only
world publication, so private references are not labelled public. Deletion
requires zero undeleted references across both domains.

## Verification and current boundary

Nine focused circle test groups cover public/private role checks; announcement
interaction; request/creator receipt privacy; governance and tombstones;
scoped image authorization and blocking; invitation concurrency and terminal
request retries; v5 upgrade/idempotence/failure rollback with old projections,
xmin, cookies, and files unchanged; first-empty seed behavior; and concurrent
approval at the 1000-member limit plus relational foreign-key/owner constraints.
The media and earlier migration compatibility suites also run against this
schema. PostgreSQL tests create and clean isolated schemas and never migrate
the running application's schema.

```sh
TEST_DATABASE_URL='<test-server-DSN>' go test -race ./internal/platform \
  -run '^TestCircle|^TestMedia|^TestFriendship.*Migration|^TestDeviceSession.*Migration' -count=1
go vet ./...
```

Circle reads and writes currently use the normalized State adapter: reads load
a consistent snapshot, and serializable writes load the snapshot then persist
entity deltas with retries. They have whole-State read/allocation cost even
though tables, constraints, and indexes are authoritative and no global row
lock is used. Narrow circle query paths and further pagination SQL remain
future work. Existing messaging and image hot paths retain their domain SQL.
This release does not implement circle real-time streams, voice rooms, events,
or resource libraries, and these tests make no throughput or production
capacity claim.
