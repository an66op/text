package platform

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
)

const walletIdentitySchema = `
ALTER TABLE gongming_users ADD COLUMN wallet_auth_version bigint NOT NULL DEFAULT 0 CHECK(wallet_auth_version>=0);
CREATE TABLE gongming_auth_browser_contexts (
 hash text PRIMARY KEY CHECK(hash ~ '^[a-f0-9]{64}$'),
 generation text NOT NULL UNIQUE CHECK(generation ~ '^[a-f0-9]{64}$'),
 current_session_hash text CHECK(current_session_hash IS NULL OR current_session_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL
);
ALTER TABLE gongming_sessions
 ADD COLUMN auth_method text NOT NULL DEFAULT 'unknown' CHECK(auth_method IN ('unknown','password','wallet')),
 ADD COLUMN browser_context_hash text REFERENCES gongming_auth_browser_contexts(hash),
 ADD CONSTRAINT gongming_wallet_session_context CHECK(auth_method<>'wallet' OR browser_context_hash IS NOT NULL);
CREATE INDEX gongming_sessions_browser_idx ON gongming_sessions(browser_context_hash);
CREATE TABLE gongming_wallet_bindings (
 id text PRIMARY KEY CHECK(id ~ '^binding_[a-f0-9]{32}$'),
 user_id text NOT NULL REFERENCES gongming_users(id),
 address bytea NOT NULL CHECK(octet_length(address)=20),
 bound_at timestamptz NOT NULL,
 revoked_at timestamptz CHECK(revoked_at IS NULL OR revoked_at>=bound_at)
);
CREATE UNIQUE INDEX gongming_wallet_active_address_idx ON gongming_wallet_bindings(address) WHERE revoked_at IS NULL;
CREATE INDEX gongming_wallet_owner_idx ON gongming_wallet_bindings(user_id,bound_at DESC,id) WHERE revoked_at IS NULL;
CREATE TABLE gongming_siwe_challenges (
 id text PRIMARY KEY CHECK(id ~ '^challenge_[a-f0-9]{32}$'),
 purpose text NOT NULL CHECK(purpose IN ('login','bind')),
 address bytea NOT NULL CHECK(octet_length(address)=20),
 chain_id text NOT NULL CHECK(chain_id ~ '^[1-9][0-9]{0,77}$'),
 origin text NOT NULL CHECK(octet_length(origin)<=512),
 uri text NOT NULL CHECK(octet_length(uri)<=600),
 message text NOT NULL CHECK(octet_length(message)<=2048),
 nonce text NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{64}$'),
 issued_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '300 seconds'),
 browser_hash text NOT NULL REFERENCES gongming_auth_browser_contexts(hash),
 generation text NOT NULL CHECK(generation ~ '^[a-f0-9]{64}$'),
 user_id text REFERENCES gongming_users(id),
 session_hash text,
 account_version bigint NOT NULL CHECK(account_version>=0),
 binding_id text REFERENCES gongming_wallet_bindings(id),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 consumed_at timestamptz,
 CHECK(purpose<>'bind' OR (user_id IS NOT NULL AND session_hash IS NOT NULL))
);
CREATE INDEX gongming_siwe_browser_idx ON gongming_siwe_challenges(browser_hash,issued_at);
CREATE INDEX gongming_siwe_address_idx ON gongming_siwe_challenges(address,issued_at);
CREATE INDEX gongming_siwe_user_idx ON gongming_siwe_challenges(user_id,issued_at);
CREATE TABLE gongming_wallet_session_proofs (
 token_hash text PRIMARY KEY REFERENCES gongming_sessions(token_hash) ON DELETE CASCADE,
 binding_id text NOT NULL REFERENCES gongming_wallet_bindings(id),
 chain_id text NOT NULL CHECK(chain_id ~ '^[1-9][0-9]{0,77}$')
);
CREATE INDEX gongming_wallet_proof_binding_idx ON gongming_wallet_session_proofs(binding_id);
CREATE FUNCTION gongming_wallet_status_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status THEN NEW.wallet_auth_version:=OLD.wallet_auth_version+1; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gongming_wallet_status_version_guard BEFORE UPDATE OF status ON gongming_users FOR EACH ROW EXECUTE FUNCTION gongming_wallet_status_version();
`

func migrateWalletIdentity(ctx context.Context, tx pgx.Tx) error {
	var done bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=9)`).Scan(&done); err != nil {
		return err
	}
	if done {
		return nil
	}
	if _, err := tx.Exec(ctx, walletIdentitySchema); err != nil {
		return fmt.Errorf("create wallet identity schema: %w", err)
	}
	_, err := tx.Exec(ctx, `INSERT INTO gongming_schema_migrations(version) VALUES(9)`)
	return err
}

// Existing SQL-owned authentication/context provenance is never reconstructed
// from State. UPDATE first also avoids a pre-ON-CONFLICT wallet-context CHECK on
// an otherwise valid existing wallet session.
func persistSessionMetadata(ctx context.Context, tx pgx.Tx, key string, v Session) error {
	tag, err := tx.Exec(ctx, `UPDATE gongming_sessions SET user_id=$2,expires_at=$3,public_id=$4,device=$5,created_at=$6,last_seen_at=$7,legacy=$8 WHERE token_hash=$1`, key, v.UserID, v.ExpiresAt, v.ID, v.Device, v.CreatedAt, v.LastSeenAt, v.Legacy)
	if err != nil || tag.RowsAffected() != 0 {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO gongming_sessions(token_hash,user_id,expires_at,public_id,device,created_at,last_seen_at,legacy,auth_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, key, v.UserID, v.ExpiresAt, v.ID, v.Device, v.CreatedAt, v.LastSeenAt, v.Legacy, sessionAuthMethod(v))
	return err
}
