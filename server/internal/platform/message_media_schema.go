package platform

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
)

const messageMediaSchema = `
ALTER TABLE gongming_conversations ADD COLUMN mutation_version bigint NOT NULL DEFAULT 0 CHECK(mutation_version BETWEEN 0 AND 9007199254740990);
ALTER TABLE gongming_messages DROP CONSTRAINT gongming_messages_body_check,
 ADD COLUMN payload_hash text CHECK(payload_hash IS NULL OR payload_hash ~ '^[a-f0-9]{64}$'),
 ADD COLUMN reply_to_id text,
 ADD COLUMN retracted_at timestamptz,
 ADD CONSTRAINT gongming_messages_body_length CHECK(char_length(body)<=5000),
 ADD CONSTRAINT gongming_messages_tombstone CHECK(retracted_at IS NULL OR (body='' AND reply_to_id IS NULL AND payload_hash IS NOT NULL AND retracted_at>=created_at)),
 ADD CONSTRAINT gongming_messages_conversation_identity UNIQUE(conversation_id,id),
 ADD CONSTRAINT gongming_messages_reply_scope FOREIGN KEY(conversation_id,reply_to_id) REFERENCES gongming_messages(conversation_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE gongming_media_assets DROP CONSTRAINT gongming_media_assets_scope_check,DROP CONSTRAINT gongming_media_scope_circle_check,
 ADD COLUMN conversation_id text REFERENCES gongming_conversations(id) DEFERRABLE INITIALLY DEFERRED,
 ADD CONSTRAINT gongming_media_scope_check CHECK((scope='world' AND circle_id IS NULL AND conversation_id IS NULL) OR (scope='circle' AND circle_id IS NOT NULL AND conversation_id IS NULL) OR (scope='conversation' AND circle_id IS NULL AND conversation_id IS NOT NULL));
CREATE INDEX gongming_media_conversation_idx ON gongming_media_assets(conversation_id,id) WHERE scope='conversation' AND deleted_at IS NULL;
CREATE TABLE gongming_message_media (
 message_id text NOT NULL REFERENCES gongming_messages(id) DEFERRABLE INITIALLY DEFERRED,
 media_id text NOT NULL REFERENCES gongming_media_assets(id) DEFERRABLE INITIALLY DEFERRED,
 position integer NOT NULL CHECK(position BETWEEN 0 AND 8),PRIMARY KEY(message_id,media_id),UNIQUE(message_id,position)
);
CREATE INDEX gongming_message_media_asset_idx ON gongming_message_media(media_id,message_id);
CREATE INDEX gongming_messages_reply_idx ON gongming_messages(reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE FUNCTION gongming_guard_message_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'messages require permanent tombstones' USING ERRCODE='23514'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id OR NEW.sender_id IS DISTINCT FROM OLD.sender_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.seq IS DISTINCT FROM OLD.seq OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN RAISE EXCEPTION 'message identity is immutable' USING ERRCODE='23514';END IF;
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL;END IF;
 IF OLD.retracted_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'retracted message is terminal' USING ERRCODE='23514';END IF;
 IF OLD.payload_hash IS NOT NULL AND NEW.payload_hash IS DISTINCT FROM OLD.payload_hash THEN RAISE EXCEPTION 'message fingerprint is immutable' USING ERRCODE='23514';END IF;
 IF NEW.retracted_at IS NULL AND (NEW.body IS DISTINCT FROM OLD.body OR NEW.reply_to_id IS DISTINCT FROM OLD.reply_to_id OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash) THEN RAISE EXCEPTION 'message payload can only be erased' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gongming_message_identity_guard BEFORE UPDATE OR DELETE ON gongming_messages FOR EACH ROW EXECUTE FUNCTION gongming_guard_message_identity();
CREATE FUNCTION gongming_check_message_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text; m gongming_messages; source_seq bigint;
BEGIN
 IF TG_TABLE_NAME='gongming_message_media' THEN target:=COALESCE(NEW.message_id,OLD.message_id);ELSE target:=NEW.id;END IF;
 SELECT * INTO m FROM gongming_messages WHERE id=target;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF m.retracted_at IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM gongming_message_media WHERE message_id=m.id) THEN RAISE EXCEPTION 'tombstone must release images' USING ERRCODE='23514';END IF;
 ELSE
  IF m.body='' AND NOT EXISTS(SELECT 1 FROM gongming_message_media WHERE message_id=m.id) THEN RAISE EXCEPTION 'message requires text or images' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM gongming_message_media r JOIN gongming_media_assets a ON a.id=r.media_id WHERE r.message_id=m.id AND (a.scope<>'conversation' OR a.conversation_id<>m.conversation_id OR a.owner_id<>m.sender_id OR a.deleted_at IS NOT NULL)) THEN RAISE EXCEPTION 'message media ownership/scope mismatch' USING ERRCODE='23514';END IF;
  IF m.reply_to_id IS NOT NULL THEN
   SELECT seq INTO source_seq FROM gongming_messages WHERE id=m.reply_to_id AND conversation_id=m.conversation_id;
   IF source_seq IS NULL OR source_seq>=m.seq THEN RAISE EXCEPTION 'reply must reference an earlier message' USING ERRCODE='23514';END IF;
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER gongming_message_content_guard AFTER INSERT OR UPDATE ON gongming_messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_message_content();
CREATE CONSTRAINT TRIGGER gongming_message_media_content_guard AFTER INSERT OR UPDATE OR DELETE ON gongming_message_media DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_message_content();
CREATE FUNCTION gongming_guard_message_media() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  PERFORM 1 FROM gongming_messages WHERE id=OLD.message_id AND retracted_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'live message images cannot be removed' USING ERRCODE='23514';END IF;RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'message images are immutable' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM gongming_messages WHERE id=NEW.message_id AND xmin::text=(pg_current_xact_id()::text::numeric % 4294967296)::text) THEN RAISE EXCEPTION 'cannot append to a committed message' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM gongming_messages m JOIN gongming_media_assets a ON a.id=NEW.media_id WHERE m.id=NEW.message_id AND (m.retracted_at IS NOT NULL OR a.status<>'ready' OR a.deleted_at IS NOT NULL OR a.scope<>'conversation' OR a.conversation_id<>m.conversation_id OR a.owner_id<>m.sender_id)) THEN RAISE EXCEPTION 'new message requires owned ready scoped image' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gongming_message_media_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON gongming_message_media FOR EACH ROW EXECUTE FUNCTION gongming_guard_message_media();
CREATE FUNCTION gongming_guard_conversation_media_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id THEN RAISE EXCEPTION 'media conversation is immutable' USING ERRCODE='23514';END IF;
 IF NEW.deleted_at IS NOT NULL AND EXISTS(SELECT 1 FROM gongming_message_media WHERE media_id=NEW.id) THEN RAISE EXCEPTION 'message referenced image cannot be deleted' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gongming_media_conversation_identity_guard BEFORE UPDATE ON gongming_media_assets FOR EACH ROW EXECUTE FUNCTION gongming_guard_conversation_media_identity();
`

func migrateMessageMedia(ctx context.Context, tx pgx.Tx) error {
	var done bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=10)`).Scan(&done); err != nil {
		return err
	}
	if done {
		return nil
	}
	if _, err := tx.Exec(ctx, messageMediaSchema); err != nil {
		return fmt.Errorf("create message media schema: %w", err)
	}
	_, err := tx.Exec(ctx, `INSERT INTO gongming_schema_migrations(version) VALUES(10)`)
	return err
}
