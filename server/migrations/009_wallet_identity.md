# Schema 9: wallet credentials and browser authentication

API 0.9.0 adds four authoritative SQL tables: `gongming_wallet_bindings`,
`gongming_siwe_challenges`, `gongming_wallet_session_proofs` and
`gongming_auth_browser_contexts`. Migration runs under the existing migration
advisory lock and one transaction. Failure rolls back DDL and version 9 marker;
reopening an already migrated database is idempotent. No wallet is imported from
browser connection demos, test ledger data or development seeds.

Existing users receive private `wallet_auth_version=0`. An account status change
increments it through a database trigger; bind/unbind increments it explicitly.
Existing session authentication source defaults to `unknown`. New password and
wallet sessions record their real source. Session metadata updates use UPDATE
first and preserve SQL-owned authentication/context columns; historical State
callbacks cannot clear wallet provenance. Wallet-session proof rows reference
sessions with ON DELETE CASCADE. Revoked bindings remain as immutable identities,
with a partial global unique index over active 20-byte addresses.

Browser contexts have random 256-bit HttpOnly secrets (only SHA-256 stored), an
independent globally unique random public generation, a current session hash and
a fixed 30-day expiry. Initial context creation never adopts an existing session.
Enabling browser mode therefore requires explicit authentication once; genuine
legacy CLI sessions without browser mode remain valid. With a context Cookie,
all State, narrow SQL, media and WebSocket authorization requires the source
context and its current pointer to match. Missing/malformed contexts cannot
silently downgrade a browser or wallet session to legacy authentication.

Password State authentication locks/CAS-checks the browser before loading its
snapshot and updates its pointer after session persistence in the same commit.
Dedicated wallet transactions use browser -> account/session -> challenge ->
binding -> related session locking. SERIALIZABLE/deadlock/unique conflicts retry
the complete operation. Login, registration and logout revoke the context's
previous session and explicitly replaced legacy request session; a mixed Cookie
cannot revoke a session belonging to another context. Only a known successful
COMMIT can emit authentication Cookies. Cookie response ordering can still cause
loss of local login state; it cannot reinstate a superseded managed session.

SIWE messages are server-generated canonical ASCII using an explicitly allowed
Origin/chain, 256-bit nonce and five-minute bound. Exact bytes are verified with
ERC-191 Legacy Keccak-256 and Decred secp256k1 recovery (65-byte, low-s EOA proofs).
No RPC, contract-wallet verification, transaction signing or transfers occur.
Bind requires a current session and fresh current password at challenge issuance;
unbind requires fresh password and revokes that binding's wallet sessions without
sending a potentially late session-clearing Cookie. A valid old challenge never
starts matching a later/new binding. Five failed proofs and SQL issuance windows
(30/hour across browser/address/account scopes) bound verification/issuance;
per-IP process limits are additional, not distributed limits.

New history domains are never hydrated by ordinary State. They are indexed SQL
reads/writes; this is not a claim of production load capacity. Expired contexts,
revoked binding identities and challenge history are retained in this version;
retention/GC requires a separate audited implementation. Authentication Cookies,
passwords, signatures, nonce messages and private keys are never added to audit
records or personal documents. Audit actions are `wallet.bind`, `wallet.unbind`
and `wallet.login`; target IDs are opaque binding IDs.

Development defaults allow wallet authentication only from the configured
localhost/127.0.0.1 frontend port 5173 and chains `1,11155111`. Production requires
explicit `WALLET_ORIGINS` and `WALLET_CHAINS` to enable it; malformed settings fail
startup. Wallet origins must be canonical ASCII origins, a subset of
`ALLOWED_ORIGINS`, and HTTPS in production. The admin origin is not in the
wallet-development defaults. Session DTOs add only
`authMethod: unknown|password|wallet`, never a secret or another user's wallet.

Rolling back to a pre-v9 binary is not a safe mixed-version deployment: old
binaries do not enforce managed-context authorization. Stop all old binaries
before enabling v9. Rollback requires a stopped, consistent pre-upgrade database
and media backup, or explicit revocation of all v9 managed/wallet sessions under
an audited migration plan. Do not drop the four tables against live traffic.
