package platform

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

const circlesSchema = `
CREATE TABLE gongming_circles (
 id text PRIMARY KEY CHECK(id ~ '^circle_[a-f0-9]{32}$'),creator_id text NOT NULL REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,
 client_id text NOT NULL CHECK(client_id ~ '^[A-Za-z0-9_-]{8,100}$'),fingerprint text NOT NULL,owner_id text NOT NULL REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 40),description text NOT NULL CHECK(char_length(description)<=600),cover text NOT NULL CHECK(char_length(cover)<=2048),icon text NOT NULL CHECK(char_length(icon)<=16),category text NOT NULL CHECK(char_length(category)<=30),
 visibility text NOT NULL CHECK(visibility IN ('public','private')),join_policy text NOT NULL CHECK(join_policy IN ('open','approval')),status text NOT NULL CHECK(status IN ('active','suspended','archived')),note text NOT NULL DEFAULT '' CHECK(char_length(note)<=1000),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL CHECK(updated_at>=created_at),UNIQUE(creator_id,client_id)
);
CREATE INDEX gongming_circles_discover_idx ON gongming_circles(status,visibility,created_at DESC,id);
CREATE INDEX gongming_circles_owner_idx ON gongming_circles(owner_id,status);
CREATE TABLE gongming_circle_members (
 circle_id text NOT NULL REFERENCES gongming_circles(id) DEFERRABLE INITIALLY DEFERRED,user_id text NOT NULL REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,
 role text NOT NULL CHECK(role IN ('owner','admin','member')),status text NOT NULL CHECK(status IN ('active','removed','banned')),note text NOT NULL DEFAULT '' CHECK(char_length(note)<=1000),joined_at timestamptz NOT NULL,updated_at timestamptz NOT NULL CHECK(updated_at>=joined_at),
 owner_circle text GENERATED ALWAYS AS (CASE WHEN role='owner' AND status='active' THEN circle_id END) STORED,
 PRIMARY KEY(circle_id,user_id),UNIQUE(owner_circle) DEFERRABLE INITIALLY DEFERRED,CHECK(role<>'owner' OR status='active')
);
ALTER TABLE gongming_circles ADD CONSTRAINT gongming_circle_owner_member_fk FOREIGN KEY(id,owner_id) REFERENCES gongming_circle_members(circle_id,user_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX gongming_circle_members_user_idx ON gongming_circle_members(user_id,status,circle_id);
CREATE INDEX gongming_circle_members_circle_idx ON gongming_circle_members(circle_id,status,joined_at,user_id);
CREATE TABLE gongming_circle_requests (
 id text PRIMARY KEY CHECK(id ~ '^crequest_[a-f0-9]{32}$'),circle_id text NOT NULL REFERENCES gongming_circles(id) DEFERRABLE INITIALLY DEFERRED,user_id text NOT NULL REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,
 note text NOT NULL CHECK(char_length(note)<=300),status text NOT NULL CHECK(status IN ('pending','accepted','declined','cancelled')),reviewer_id text REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,review_note text NOT NULL DEFAULT '' CHECK(char_length(review_note)<=1000),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL CHECK(updated_at>=created_at)
);
CREATE UNIQUE INDEX gongming_circle_requests_pending_idx ON gongming_circle_requests(circle_id,user_id) WHERE status='pending';
CREATE INDEX gongming_circle_requests_user_idx ON gongming_circle_requests(user_id,status,created_at DESC,id);
CREATE INDEX gongming_circle_requests_circle_idx ON gongming_circle_requests(circle_id,status,created_at DESC,id);
CREATE TABLE gongming_circle_channels (
 id text PRIMARY KEY CHECK(id ~ '^cchannel_[a-f0-9]{32}$'),circle_id text NOT NULL REFERENCES gongming_circles(id) DEFERRABLE INITIALLY DEFERRED,name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 40),description text NOT NULL CHECK(char_length(description)<=300),kind text NOT NULL CHECK(kind IN ('forum','announcement')),access text NOT NULL CHECK(access IN ('members','staff')),archived boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL CHECK(updated_at>=created_at),UNIQUE(circle_id,id)
);
CREATE INDEX gongming_circle_channels_circle_idx ON gongming_circle_channels(circle_id,access,created_at,id);
CREATE TABLE gongming_circle_posts (
 id text PRIMARY KEY CHECK(id ~ '^cpost_[a-f0-9]{32}$'),circle_id text NOT NULL REFERENCES gongming_circles(id) DEFERRABLE INITIALLY DEFERRED,channel_id text NOT NULL,author_id text NOT NULL REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,client_id text NOT NULL CHECK(client_id ~ '^[A-Za-z0-9_-]{8,100}$'),fingerprint text NOT NULL,
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120),body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 5000),images text[] NOT NULL DEFAULT '{}',status text NOT NULL CHECK(status IN ('published','pending','hidden')),pinned boolean NOT NULL DEFAULT false,featured boolean NOT NULL DEFAULT false,note text NOT NULL DEFAULT '' CHECK(char_length(note)<=1000),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL CHECK(updated_at>=created_at),deleted_at timestamptz,
 CHECK(cardinality(images)<=9),CHECK(deleted_at IS NULL OR deleted_at>=created_at),UNIQUE(author_id,circle_id,channel_id,client_id),UNIQUE(circle_id,id),
 FOREIGN KEY(circle_id,channel_id) REFERENCES gongming_circle_channels(circle_id,id) DEFERRABLE INITIALLY DEFERRED,FOREIGN KEY(circle_id,author_id) REFERENCES gongming_circle_members(circle_id,user_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX gongming_circle_posts_feed_idx ON gongming_circle_posts(circle_id,status,pinned DESC,created_at DESC,id) WHERE deleted_at IS NULL;
CREATE INDEX gongming_circle_posts_channel_idx ON gongming_circle_posts(channel_id,status,created_at DESC,id) WHERE deleted_at IS NULL;
CREATE TABLE gongming_circle_comments (
 id text PRIMARY KEY CHECK(id ~ '^ccomment_[a-f0-9]{32}$'),circle_id text NOT NULL,post_id text NOT NULL,author_id text NOT NULL REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 2000),created_at timestamptz NOT NULL,
 FOREIGN KEY(circle_id,post_id) REFERENCES gongming_circle_posts(circle_id,id) DEFERRABLE INITIALLY DEFERRED,FOREIGN KEY(circle_id,author_id) REFERENCES gongming_circle_members(circle_id,user_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX gongming_circle_comments_post_idx ON gongming_circle_comments(post_id,created_at,id);
CREATE TABLE gongming_circle_likes(post_id text NOT NULL REFERENCES gongming_circle_posts(id) DEFERRABLE INITIALLY DEFERRED,user_id text NOT NULL REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,PRIMARY KEY(post_id,user_id));
CREATE INDEX gongming_circle_likes_user_idx ON gongming_circle_likes(user_id,post_id);
CREATE TABLE gongming_circle_invites (
 id text PRIMARY KEY CHECK(id ~ '^cinvite_[a-f0-9]{32}$'),circle_id text NOT NULL REFERENCES gongming_circles(id) DEFERRABLE INITIALLY DEFERRED,creator_id text NOT NULL REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),max_uses integer NOT NULL CHECK(max_uses BETWEEN 1 AND 100),uses integer NOT NULL DEFAULT 0 CHECK(uses>=0 AND uses<=max_uses),expires_at timestamptz NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL,CHECK(expires_at>created_at AND expires_at<=created_at+interval '168 hours'),CHECK(revoked_at IS NULL OR revoked_at>=created_at)
);
CREATE INDEX gongming_circle_invites_circle_idx ON gongming_circle_invites(circle_id,created_at DESC,id);
CREATE TABLE gongming_circle_invite_redemptions(invite_id text NOT NULL REFERENCES gongming_circle_invites(id) DEFERRABLE INITIALLY DEFERRED,user_id text NOT NULL REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,created_at timestamptz NOT NULL,PRIMARY KEY(invite_id,user_id));
ALTER TABLE gongming_media_assets ADD COLUMN scope text NOT NULL DEFAULT 'world' CHECK(scope IN ('world','circle')),ADD COLUMN circle_id text REFERENCES gongming_circles(id) DEFERRABLE INITIALLY DEFERRED,ADD CONSTRAINT gongming_media_scope_circle_check CHECK((scope='world' AND circle_id IS NULL) OR (scope='circle' AND circle_id IS NOT NULL));
CREATE INDEX gongming_media_circle_idx ON gongming_media_assets(circle_id,id) WHERE deleted_at IS NULL;
CREATE TABLE gongming_circle_post_media(post_id text NOT NULL REFERENCES gongming_circle_posts(id) DEFERRABLE INITIALLY DEFERRED,media_id text NOT NULL REFERENCES gongming_media_assets(id) DEFERRABLE INITIALLY DEFERRED,PRIMARY KEY(post_id,media_id));
CREATE INDEX gongming_circle_post_media_asset_idx ON gongming_circle_post_media(media_id,post_id);
ALTER TABLE gongming_reports DROP CONSTRAINT gongming_reports_target_type_check;
ALTER TABLE gongming_reports ADD CONSTRAINT gongming_reports_target_type_check CHECK(target_type IN ('post','user','circle-post'));

CREATE FUNCTION gongming_check_circle_invariants() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text; owner_user text;
BEGIN
 IF TG_TABLE_NAME='gongming_circles' THEN target:=NEW.id;owner_user:=NEW.owner_id;
 ELSE target:=NEW.circle_id;SELECT owner_id INTO owner_user FROM gongming_circles WHERE id=target;END IF;
 IF NOT EXISTS(SELECT 1 FROM gongming_circle_members WHERE circle_id=target AND user_id=owner_user AND role='owner' AND status='active') OR EXISTS(SELECT 1 FROM gongming_circle_members WHERE circle_id=target AND role='owner' AND user_id<>owner_user) THEN RAISE EXCEPTION 'circle must have exactly its active owner' USING ERRCODE='23514';END IF;
 IF (SELECT count(*) FROM gongming_circle_members WHERE circle_id=target AND status='active')>1000 OR (SELECT count(*) FROM gongming_circle_channels WHERE circle_id=target)>50 OR (SELECT count(*) FROM gongming_circles WHERE owner_id=owner_user AND status<>'archived')>20 THEN RAISE EXCEPTION 'circle domain quota exceeded' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER gongming_circle_invariant_guard AFTER INSERT OR UPDATE ON gongming_circles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_circle_invariants();
CREATE CONSTRAINT TRIGGER gongming_circle_member_invariant_guard AFTER INSERT OR UPDATE ON gongming_circle_members DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_circle_invariants();
CREATE CONSTRAINT TRIGGER gongming_circle_channel_invariant_guard AFTER INSERT OR UPDATE ON gongming_circle_channels DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_circle_invariants();
CREATE FUNCTION gongming_guard_circle_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='gongming_circles' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.creator_id IS DISTINCT FROM OLD.creator_id OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint OR NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.status='archived' AND NEW.status<>'archived' THEN RAISE EXCEPTION 'circle identity/archive is immutable' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='gongming_circle_posts' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.circle_id IS DISTINCT FROM OLD.circle_id OR NEW.channel_id IS DISTINCT FROM OLD.channel_id OR NEW.author_id IS DISTINCT FROM OLD.author_id OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint OR NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body OR NEW.images IS DISTINCT FROM OLD.images OR NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.deleted_at IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'circle post identity/tombstone is immutable' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='gongming_circle_requests' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.circle_id IS DISTINCT FROM OLD.circle_id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.note IS DISTINCT FROM OLD.note OR NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.status<>'pending' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'circle request terminal state is immutable' USING ERRCODE='23514';END IF;
 ELSE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.circle_id IS DISTINCT FROM OLD.circle_id OR NEW.creator_id IS DISTINCT FROM OLD.creator_id OR NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.max_uses IS DISTINCT FROM OLD.max_uses OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.uses<OLD.uses OR OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN RAISE EXCEPTION 'circle invite identity/counter is immutable' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gongming_circle_identity_guard BEFORE UPDATE ON gongming_circles FOR EACH ROW EXECUTE FUNCTION gongming_guard_circle_identity();
CREATE TRIGGER gongming_circle_post_identity_guard BEFORE UPDATE ON gongming_circle_posts FOR EACH ROW EXECUTE FUNCTION gongming_guard_circle_identity();
CREATE TRIGGER gongming_circle_request_identity_guard BEFORE UPDATE ON gongming_circle_requests FOR EACH ROW EXECUTE FUNCTION gongming_guard_circle_identity();
CREATE TRIGGER gongming_circle_invite_identity_guard BEFORE UPDATE ON gongming_circle_invites FOR EACH ROW EXECUTE FUNCTION gongming_guard_circle_identity();
CREATE FUNCTION gongming_check_circle_invite_uses() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;
BEGIN
 IF TG_TABLE_NAME='gongming_circle_invites' THEN target:=NEW.id;ELSE target:=NEW.invite_id;END IF;
 IF EXISTS(SELECT 1 FROM gongming_circle_invites i WHERE id=target AND uses<>(SELECT count(*) FROM gongming_circle_invite_redemptions WHERE invite_id=target)) THEN RAISE EXCEPTION 'invite uses must match unique redemptions' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER gongming_circle_invite_uses_guard AFTER INSERT OR UPDATE ON gongming_circle_invites DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_circle_invite_uses();
CREATE CONSTRAINT TRIGGER gongming_circle_redemption_uses_guard AFTER INSERT OR UPDATE ON gongming_circle_invite_redemptions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_circle_invite_uses();
`

func migrateCircles(ctx context.Context, tx pgx.Tx) error {
	var done bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=6)`).Scan(&done); err != nil {
		return err
	}
	if done {
		return nil
	}
	if _, err := tx.Exec(ctx, circlesSchema+circlesMediaGuards); err != nil {
		return fmt.Errorf("create circle schema: %w", err)
	}
	_, err := tx.Exec(ctx, `INSERT INTO gongming_schema_migrations(version) VALUES(6)`)
	return err
}
