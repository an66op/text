package platform

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
)

const contactPrivacySchema = `
CREATE TABLE gongming_contact_preferences (
 user_id text PRIMARY KEY REFERENCES gongming_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 direct_message_policy text NOT NULL DEFAULT 'everyone' CHECK(direct_message_policy IN ('everyone','friends','nobody')),
 group_invite_policy text NOT NULL DEFAULT 'everyone' CHECK(group_invite_policy IN ('everyone','friends','nobody')),
 allow_friend_requests boolean NOT NULL DEFAULT true,
 discoverable_by_handle boolean NOT NULL DEFAULT true,
 revision bigint NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991),
 updated_at timestamptz,
 guard_version bigint NOT NULL DEFAULT 0 CHECK(guard_version BETWEEN 0 AND 9007199254740991),
 CHECK((revision=0 AND updated_at IS NULL) OR (revision>0 AND updated_at IS NOT NULL))
);
CREATE TABLE gongming_user_blocks (
 owner_id text NOT NULL REFERENCES gongming_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 target_id text NOT NULL REFERENCES gongming_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 created_at timestamptz NOT NULL,PRIMARY KEY(owner_id,target_id),CHECK(owner_id<>target_id)
);
CREATE INDEX gongming_user_blocks_owner_page_idx ON gongming_user_blocks(owner_id,created_at DESC,target_id);
CREATE INDEX gongming_user_blocks_target_idx ON gongming_user_blocks(target_id,owner_id);
CREATE FUNCTION gongming_guard_block_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'block identity is immutable' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE TRIGGER gongming_block_identity_guard BEFORE UPDATE ON gongming_user_blocks FOR EACH ROW EXECUTE FUNCTION gongming_guard_block_identity();
CREATE FUNCTION gongming_check_block_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE first_id text;second_id text;
BEGIN
 IF TG_TABLE_NAME='gongming_user_blocks' THEN
  first_id:=NEW.owner_id;second_id:=NEW.target_id;
  IF (SELECT count(*) FROM gongming_user_blocks WHERE owner_id=first_id)>500 THEN RAISE EXCEPTION 'block quota exceeded' USING ERRCODE='23514';END IF;
 ELSE first_id:=NEW.from_id;second_id:=NEW.to_id;END IF;
 IF EXISTS(SELECT 1 FROM gongming_user_blocks WHERE (owner_id=first_id AND target_id=second_id) OR (owner_id=second_id AND target_id=first_id)) AND EXISTS(SELECT 1 FROM gongming_friend_requests WHERE pair_low=LEAST(first_id COLLATE "C",second_id COLLATE "C") AND pair_high=GREATEST(first_id COLLATE "C",second_id COLLATE "C") AND status='pending') THEN RAISE EXCEPTION 'blocked pair cannot have pending requests' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER gongming_block_pair_guard AFTER INSERT ON gongming_user_blocks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_block_pair();
CREATE CONSTRAINT TRIGGER gongming_block_request_guard AFTER INSERT OR UPDATE ON gongming_friend_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_block_pair();
ALTER TABLE gongming_message_outbox ALTER COLUMN conversation_id DROP NOT NULL,
 ADD CONSTRAINT gongming_outbox_contact_resync CHECK((type='contact.resync' AND conversation_id IS NULL AND message_id IS NULL AND recipient_id IS NOT NULL) OR (type<>'contact.resync' AND conversation_id IS NOT NULL));
`

func migrateContactPrivacy(ctx context.Context, tx pgx.Tx) error {
	var done bool
	if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=11)`).Scan(&done); e != nil {
		return e
	}
	if done {
		return nil
	}
	if _, e := tx.Exec(ctx, contactPrivacySchema); e != nil {
		return fmt.Errorf("create contact privacy schema: %w", e)
	}
	_, e := tx.Exec(ctx, `INSERT INTO gongming_schema_migrations(version) VALUES(11)`)
	return e
}
