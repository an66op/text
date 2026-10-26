# Schema 5: private reviewed image media

This migration adds `gongming_media_assets` and `gongming_post_media` in the
existing migration transaction, under the existing schema advisory lock. It
does not rewrite existing users, sessions, posts, IDs, or timestamps. Re-running
the migration is a no-op. A DDL/constraint failure rolls back the new objects and
version marker together; the old schema/data remain available for a corrected
upgrade. No application downgrade or production rollback is performed here.

## Authority and references

`gongming_media_assets` stores immutable media identity, owner/clientId, original
SHA-256, detected/re-encoded MIME type, dimensions, encoded byte count, creation
time, moderation status/note, updated time, and optional soft-deletion time.
Owner/clientId is unique, including soft-deleted records; a deleted request key
cannot silently resurrect an asset. Deleted rows are retained as tombstones.
The State adapter loads/persists this metadata from its authoritative table.

`gongming_post_media` has a `(post_id,media_id)` primary key and foreign keys to
posts/assets, with an index starting at media_id for authorization and reference
lookup. The same transaction synchronizes it from canonical hosted URLs in the
post's image array. Deleting a post cascades these references. Deferred guards
reject foreign-owner/deleted references, publication with blocked assets,
deletion of referenced assets, invalid dimensions/bytes, and over-quota states.
Application writes use the serializable State adapter and complete-callback
retries, including concurrent upload/quota and publication/moderation races.
Direct database maintenance must preserve these links and transaction rules.

Existing absolute HTTP(S) image URLs remain compatible. New hosted references
must exactly match `/api/v1/media/images/media_<32 lowercase hex>` and belong to
the author, remain undeleted, and be ready. Input duplicates are removed.
Same-origin absolute aliases (configured allowed origins/current API Host),
query/hash suffixes, and arbitrary relative API paths are rejected. Any post
containing a hosted image starts pending; existing text/external-image posts
retain their previous initial status. Publication rechecks every hosted image.

## API contract

- `POST /api/v1/media/images`: multipart with exactly `file` and `clientId`.
  clientId is 8–100 ASCII letters/digits/underscore/hyphen. Returns
  `{id,url,contentType,width,height,bytes,createdAt}` in the standard data envelope.
  `bytes` is the re-encoded size; dimensions reflect applied JPEG orientation.
  The original SHA-256 binds a clientId to its owner's original input bytes;
  identical retries return the same full asset, different bytes return 409.
  Deleted keys return 409 and require a new clientId.
- `GET /HEAD /api/v1/media/images/{id}`: actual re-encoded JPEG/PNG bytes/headers,
  with `Cache-Control: no-store` and nosniff. Private ready assets are visible to
  the owner/staff; an active published post reference also allows public reads.
  Pending, hidden, and deleted posts never independently grant public reads.
  Blocked media are invisible to all ordinary readers, including the owner;
  staff can inspect them. Deleted assets are invisible to everyone.
- `DELETE /api/v1/media/images/{id}`: owner only, zero post references of any
  status, standard `{ok:true}`. Repeating a completed soft deletion is idempotent.
  A failed metadata transaction never deletes the original file.
- `GET /api/v1/me/media?status=&q=&limit=&offset=`: member-only, undeleted assets
  belonging to the authenticated account; no caller-supplied owner selector.
  Returns `{items,total}` using the detailed asset below for owner management.
- `GET /api/v1/admin/media`: staff-only, same query/pagination model across all
  owners. Status is empty, ready, or blocked. q matches asset ID, owner
  ID/handle/name, and referencing post IDs. Both lists sort createdAt descending,
  then ID, and use the existing limit 1–100 / offset 0–100000 validation.
- Detailed owner/admin items contain the public asset fields plus
  `owner:PublicUser`, `status`, `note`, `referenceCount`,
  `publishedReferenceCount`, `updatedAt`, and `posts:[{id,body,status}]`.
  Posts are newest first, at most 10; bodies are at most 200 Unicode codepoints.
  No email, role, source hash, original filename, or filesystem path is exposed.
- `PATCH /api/v1/admin/media/{id}`: staff-only `{status:'ready'|'blocked',note}`,
  with a required 1–1000-codepoint trimmed note, returns the detailed asset.
  Same-status note changes are allowed and audited. Blocking hides every
  currently published referencing post in the same transaction, with per-post
  and media audit records. Pending posts stay pending. Unblocking never restores
  posts automatically.

For PostgreSQL image GET/HEAD, authorization queries only the current session,
active user, requested asset, and indexed post references in a repeatable-read
snapshot. It never hydrates the full State. The test memory store uses the same
policy through its State callback. Session/expected-account/Origin protection
remains in place; image reads do not rely on static hosting or URL secrecy.

## Filesystem and resource limits

Set `Config.MediaDirectory` to a dedicated absolute directory and call exported
`PrepareMediaDirectory` before starting the HTTP server. Production validation
requires an explicit directory; an empty directory in tests disables media with
controlled 503 responses. Preparation rejects filesystem root, symbolic roots,
and existing directories with any group/other permission. It **never chmods an
existing directory**. Missing directories are created with 0700; a private
create/remove probe checks write access. Files are random-ID `.jpg`/`.png` names,
created with O_EXCL and 0600 through `os.Root`. Reads use O_NOFOLLOW and verify a
regular file with the expected size. File writes and directory entry changes
are fsynced. No user filename/path is used and no static route exposes the dir.

Both input and encoded output are limited to 8 MiB; multipart total overhead is
bounded to 64 KiB beyond that, with exactly two parts. Actual image decoding,
not extension or client MIME, determines JPEG/PNG. SVG, GIF, corrupt images,
dimensions over 8192 on either side, and more than **16,000,000 pixels** are
rejected. Images are decoded and freshly encoded, removing EXIF/other metadata.
The bounded JPEG APP1/TIFF IFD0 parser applies orientation 1–8 before re-encoding;
invalid offsets/types are safely ignored without recursion.

Per app instance there are four upload admission slots acquired before reading
multipart bodies, two decoder slots, and one active upload per account. Full
admission returns controlled 429 with Retry-After. A per-account limit allows 30
new upload attempts/hour per instance; committed clientId retries bypass it.
Durable logical quotas count ready and blocked undeleted assets: at most 100
assets and 100 MiB per account, protected by serializable writes and constraints.
Decoder allocations can still be substantial at the pixel limit; these bounds
are resource controls, not measured throughput/RSS guarantees.

## Commit compensation, cleanup, and deployment boundary

The random candidate file is exclusively written and synced **outside** database
transaction callbacks. Its row becomes visible only when metadata commits.
Callbacks have no filesystem side effects and can be retried. A losing
idempotent candidate or a known business rejection removes only its own file.
Unknown DB/context/COMMIT errors retain the private candidate: a later negative
SELECT cannot prove an in-flight COMMIT will not finish. This deliberately
prefers an inaccessible orphan over deleting a potentially committed asset.

Deletion commits the tombstone first, then removes bytes. Cleanup failures and
crashes can also leave inaccessible orphans. There is **no automatic GC** in
this migration. Reconciliation must run offline with application writers stopped,
compare the private directory to committed undeleted metadata, and preserve
ambiguous candidates until the transaction outcome is settled. Logical quotas
do not cap orphan bytes, total accounts, tombstones, or total disk usage. Monitor
and provision disk separately, and back up database plus private files together.

This is local filesystem storage, not object storage. A single API instance with
its private mounted volume is the supported straightforward deployment. Multiple
instances need a correctly shared filesystem (and consistent directory settings)
to serve the same committed IDs; the database alone does not replicate files.
No high-concurrency, horizontal-availability, or production capacity claim is made.

## Targeted verification

The media suites use memory fixtures and real PostgreSQL random schemas, never
the running application's schema. They cover v4→v5 upgrade/idempotence/failure
rollback with old rows/xmin/cookies intact; persistence/reopen; owner list IDOR
and pagination; narrow GET/HEAD under unrelated exclusive table locks; valid
formats and bounded/invalid multipart; dimension/byte limits; metadata stripping
and all JPEG orientations; owner/public/staff/blocked/deleted access; strict
reference ownership/deduplication and multi-post moderation; delete constraints;
unknown/later-committing transaction outcomes; file creation failure and symbolic
links; concurrent clientId, final quota slot, and block/publication races.

```sh
TEST_DATABASE_URL='<test-server-DSN>' go test -race ./internal/platform -run '^TestMedia' -count=1
go vet ./...
```

These checks establish the bounded behaviors above, not a load-test acceptance.
