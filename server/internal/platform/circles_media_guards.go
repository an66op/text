package platform

const circlesMediaGuards = `
CREATE OR REPLACE FUNCTION gongming_guard_media_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.source_hash IS DISTINCT FROM OLD.source_hash OR NEW.content_type IS DISTINCT FROM OLD.content_type OR NEW.width IS DISTINCT FROM OLD.width OR NEW.height IS DISTINCT FROM OLD.height OR NEW.bytes IS DISTINCT FROM OLD.bytes OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.scope IS DISTINCT FROM OLD.scope OR NEW.circle_id IS DISTINCT FROM OLD.circle_id THEN RAISE EXCEPTION 'media identity/content/scope is immutable' USING ERRCODE='23514';END IF;
 IF OLD.deleted_at IS NOT NULL AND (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.status IS DISTINCT FROM OLD.status OR NEW.note IS DISTINCT FROM OLD.note OR NEW.updated_at IS DISTINCT FROM OLD.updated_at) THEN RAISE EXCEPTION 'deleted media cannot be restored or changed' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION gongming_check_media_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='gongming_media_assets' THEN
  IF NEW.deleted_at IS NOT NULL AND EXISTS(SELECT 1 FROM gongming_post_media WHERE media_id=NEW.id) THEN RAISE EXCEPTION 'referenced media cannot be deleted' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM gongming_post_media ref JOIN gongming_posts p ON p.id=ref.post_id WHERE ref.media_id=NEW.id AND (NEW.scope<>'world' OR p.status='published' AND (NEW.status<>'ready' OR NEW.deleted_at IS NOT NULL))) THEN RAISE EXCEPTION 'world posts require world ready media' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='gongming_post_media' THEN
  IF EXISTS(SELECT 1 FROM gongming_posts p JOIN gongming_media_assets a ON a.id=NEW.media_id WHERE p.id=NEW.post_id AND (a.scope<>'world' OR a.owner_id<>p.author_id OR a.deleted_at IS NOT NULL OR p.status='published' AND a.status<>'ready')) THEN RAISE EXCEPTION 'invalid world media reference ownership/status/scope' USING ERRCODE='23514';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM gongming_post_media ref JOIN gongming_media_assets a ON a.id=ref.media_id WHERE ref.post_id=NEW.id AND (a.scope<>'world' OR a.owner_id<>NEW.author_id OR a.deleted_at IS NOT NULL OR NEW.status='published' AND a.status<>'ready')) THEN RAISE EXCEPTION 'world posts require owned world ready media' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION gongming_check_circle_media_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='gongming_media_assets' THEN
  IF NEW.deleted_at IS NOT NULL AND EXISTS(SELECT 1 FROM gongming_circle_post_media WHERE media_id=NEW.id) THEN RAISE EXCEPTION 'circle referenced media cannot be deleted' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM gongming_circle_post_media ref JOIN gongming_circle_posts p ON p.id=ref.post_id WHERE ref.media_id=NEW.id AND (NEW.scope<>'circle' OR NEW.circle_id<>p.circle_id OR NEW.owner_id<>p.author_id OR p.deleted_at IS NULL AND p.status='published' AND NEW.status<>'ready')) THEN RAISE EXCEPTION 'circle media scope/owner/readiness mismatch' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='gongming_circle_post_media' THEN
  IF EXISTS(SELECT 1 FROM gongming_circle_posts p JOIN gongming_media_assets a ON a.id=NEW.media_id WHERE p.id=NEW.post_id AND (p.deleted_at IS NOT NULL OR a.scope<>'circle' OR a.circle_id<>p.circle_id OR a.owner_id<>p.author_id OR a.deleted_at IS NOT NULL OR p.status='published' AND a.status<>'ready')) THEN RAISE EXCEPTION 'invalid circle media reference' USING ERRCODE='23514';END IF;
 ELSE
  IF NEW.deleted_at IS NOT NULL AND EXISTS(SELECT 1 FROM gongming_circle_post_media WHERE post_id=NEW.id) THEN RAISE EXCEPTION 'deleted circle post must release media' USING ERRCODE='23514';END IF;
  IF NEW.deleted_at IS NULL AND EXISTS(SELECT 1 FROM gongming_circle_post_media ref JOIN gongming_media_assets a ON a.id=ref.media_id WHERE ref.post_id=NEW.id AND (a.scope<>'circle' OR a.circle_id<>NEW.circle_id OR a.owner_id<>NEW.author_id OR a.deleted_at IS NOT NULL OR NEW.status='published' AND a.status<>'ready')) THEN RAISE EXCEPTION 'circle publication requires owned scoped ready media' USING ERRCODE='23514';END IF;
  IF NEW.deleted_at IS NULL AND NEW.status='published' AND (TG_OP='INSERT' OR OLD.status<>'published') AND EXISTS(SELECT 1 FROM gongming_circles c JOIN gongming_circle_channels ch ON ch.circle_id=c.id WHERE c.id=NEW.circle_id AND ch.id=NEW.channel_id AND (c.status<>'active' OR ch.archived)) THEN RAISE EXCEPTION 'inactive circle/channel cannot publish' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER gongming_media_circle_reference_guard AFTER INSERT OR UPDATE ON gongming_media_assets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_circle_media_reference();
CREATE CONSTRAINT TRIGGER gongming_circle_post_media_reference_guard AFTER INSERT OR UPDATE ON gongming_circle_post_media DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_circle_media_reference();
CREATE CONSTRAINT TRIGGER gongming_circle_post_publication_guard AFTER INSERT OR UPDATE ON gongming_circle_posts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_circle_media_reference();
`
