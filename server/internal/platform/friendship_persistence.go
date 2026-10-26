package platform

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

const friendshipSchema = `
CREATE TABLE IF NOT EXISTS gongming_friend_requests (
 id text PRIMARY KEY,
 from_id text NOT NULL REFERENCES gongming_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 to_id text NOT NULL REFERENCES gongming_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 pair_low text GENERATED ALWAYS AS (LEAST(from_id COLLATE "C",to_id COLLATE "C")) STORED,
 pair_high text GENERATED ALWAYS AS (GREATEST(from_id COLLATE "C",to_id COLLATE "C")) STORED,
 note text NOT NULL DEFAULT '' CHECK(char_length(note)<=300),
 status text NOT NULL CHECK(status IN ('pending','accepted','declined','cancelled')),
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 CHECK(from_id<>to_id), CHECK(updated_at>=created_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS gongming_friend_requests_pending_pair_idx ON gongming_friend_requests(pair_low,pair_high) WHERE status='pending';
CREATE INDEX IF NOT EXISTS gongming_friend_requests_incoming_idx ON gongming_friend_requests(to_id,status,created_at DESC,id);
CREATE INDEX IF NOT EXISTS gongming_friend_requests_outgoing_idx ON gongming_friend_requests(from_id,status,created_at DESC,id);
CREATE TABLE IF NOT EXISTS gongming_friendships (
 user_a text NOT NULL REFERENCES gongming_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 user_b text NOT NULL REFERENCES gongming_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 since timestamptz NOT NULL, PRIMARY KEY(user_a,user_b), CHECK(user_a COLLATE "C"<user_b COLLATE "C")
);
CREATE INDEX IF NOT EXISTS gongming_friendships_a_idx ON gongming_friendships(user_a,since DESC,user_b);
CREATE INDEX IF NOT EXISTS gongming_friendships_b_idx ON gongming_friendships(user_b,since DESC,user_a);

CREATE OR REPLACE FUNCTION gongming_guard_friend_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.from_id IS DISTINCT FROM OLD.from_id OR NEW.to_id IS DISTINCT FROM OLD.to_id OR NEW.note IS DISTINCT FROM OLD.note OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
  RAISE EXCEPTION 'friend request identity/content is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.status<>'pending' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.updated_at IS DISTINCT FROM OLD.updated_at) THEN
  RAISE EXCEPTION 'friend request terminal state is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER gongming_friend_request_transition_guard BEFORE UPDATE ON gongming_friend_requests FOR EACH ROW EXECUTE FUNCTION gongming_guard_friend_request();

CREATE OR REPLACE FUNCTION gongming_check_friend_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE low_id text; high_id text;
BEGIN
 IF TG_TABLE_NAME='gongming_friendships' THEN low_id:=NEW.user_a;high_id:=NEW.user_b;
 ELSIF TG_OP='DELETE' THEN low_id:=OLD.pair_low;high_id:=OLD.pair_high;
 ELSE low_id:=NEW.pair_low;high_id:=NEW.pair_high; END IF;
 IF EXISTS(SELECT 1 FROM gongming_friendships WHERE user_a=low_id AND user_b=high_id) THEN
  IF EXISTS(SELECT 1 FROM gongming_friend_requests WHERE pair_low=low_id AND pair_high=high_id AND status='pending') THEN
   RAISE EXCEPTION 'friends cannot have a pending request' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM gongming_friend_requests WHERE pair_low=low_id AND pair_high=high_id AND status='accepted') THEN
   RAISE EXCEPTION 'friendship requires an accepted request' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS gongming_friendship_pair_guard ON gongming_friendships;
CREATE CONSTRAINT TRIGGER gongming_friendship_pair_guard AFTER INSERT OR UPDATE ON gongming_friendships DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_friend_pair();
DROP TRIGGER IF EXISTS gongming_friend_request_pair_guard ON gongming_friend_requests;
CREATE CONSTRAINT TRIGGER gongming_friend_request_pair_guard AFTER INSERT OR UPDATE OR DELETE ON gongming_friend_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_friend_pair();
`

func migrateFriendships(ctx context.Context, tx pgx.Tx) error {
	var done bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=3)`).Scan(&done); err != nil {
		return err
	}
	if done {
		return nil
	}
	if _, err := tx.Exec(ctx, friendshipSchema); err != nil {
		return fmt.Errorf("create friendship schema: %w", err)
	}
	_, err := tx.Exec(ctx, `INSERT INTO gongming_schema_migrations(version) VALUES(3)`)
	return err
}
func loadFriendships(ctx context.Context, tx pgx.Tx, s *State) error {
	if s.FriendRequests == nil {
		s.FriendRequests = map[string]StoredFriendRequest{}
	}
	if s.Friendships == nil {
		s.Friendships = map[string]StoredFriendship{}
	}
	if err := collectRows(ctx, tx, `SELECT id,from_id,to_id,note,status,created_at,updated_at FROM gongming_friend_requests`, func(r pgx.Rows) error {
		var v StoredFriendRequest
		if err := r.Scan(&v.ID, &v.FromID, &v.ToID, &v.Note, &v.Status, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return err
		}
		s.FriendRequests[v.ID] = v
		return nil
	}); err != nil {
		return err
	}
	return collectRows(ctx, tx, `SELECT user_a,user_b,since FROM gongming_friendships`, func(r pgx.Rows) error {
		var v StoredFriendship
		if err := r.Scan(&v.UserA, &v.UserB, &v.Since); err != nil {
			return err
		}
		s.Friendships[friendshipKey(v.UserA, v.UserB)] = v
		return nil
	})
}
func persistFriendships(ctx context.Context, tx pgx.Tx, before, after *State) error {
	if err := syncEntities(before.FriendRequests, after.FriendRequests, func(key string, v StoredFriendRequest) error {
		if key != v.ID {
			return fmt.Errorf("friend request key does not match id")
		}
		return execRow(ctx, tx, `INSERT INTO gongming_friend_requests(id,from_id,to_id,note,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET from_id=EXCLUDED.from_id,to_id=EXCLUDED.to_id,note=EXCLUDED.note,status=EXCLUDED.status,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at`, v.ID, v.FromID, v.ToID, v.Note, v.Status, v.CreatedAt, v.UpdatedAt)
	}, func(id string) error { return removeID(ctx, tx, "gongming_friend_requests", id) }); err != nil {
		return err
	}
	return syncEntities(before.Friendships, after.Friendships, func(key string, v StoredFriendship) error {
		if key != friendshipKey(v.UserA, v.UserB) || v.UserA >= v.UserB {
			return fmt.Errorf("friendship pair is not canonical")
		}
		return execRow(ctx, tx, `INSERT INTO gongming_friendships(user_a,user_b,since) VALUES($1,$2,$3) ON CONFLICT(user_a,user_b) DO UPDATE SET since=EXCLUDED.since`, v.UserA, v.UserB, v.Since)
	}, func(key string) error {
		v := before.Friendships[key]
		return execRow(ctx, tx, `DELETE FROM gongming_friendships WHERE user_a=$1 AND user_b=$2`, v.UserA, v.UserB)
	})
}
