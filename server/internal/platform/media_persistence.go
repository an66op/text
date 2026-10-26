package platform

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
)

const mediaSchema = `
CREATE TABLE gongming_media_assets (
 id text PRIMARY KEY CHECK(id ~ '^media_[a-f0-9]{32}$'),
 owner_id text NOT NULL REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,
 client_id text NOT NULL CHECK(client_id ~ '^[A-Za-z0-9_-]{8,100}$'),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 content_type text NOT NULL CHECK(content_type IN ('image/jpeg','image/png')),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 8192), height integer NOT NULL CHECK(height BETWEEN 1 AND 8192),
 bytes bigint NOT NULL CHECK(bytes BETWEEN 1 AND 8388608),
 status text NOT NULL CHECK(status IN ('ready','blocked')),
 note text NOT NULL DEFAULT '' CHECK(char_length(note)<=1000),
 created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,deleted_at timestamptz,
 CHECK(width::bigint*height<=16000000),CHECK(updated_at>=created_at),
 CHECK(deleted_at IS NULL OR deleted_at>=created_at),UNIQUE(owner_id,client_id)
);
CREATE INDEX gongming_media_owner_active_idx ON gongming_media_assets(owner_id,created_at DESC,id) WHERE deleted_at IS NULL;
CREATE INDEX gongming_media_moderation_idx ON gongming_media_assets(status,created_at DESC,id) WHERE deleted_at IS NULL;
CREATE TABLE gongming_post_media (
 post_id text NOT NULL REFERENCES gongming_posts(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 media_id text NOT NULL REFERENCES gongming_media_assets(id) DEFERRABLE INITIALLY DEFERRED,
 PRIMARY KEY(post_id,media_id)
);
CREATE INDEX gongming_post_media_asset_idx ON gongming_post_media(media_id,post_id);
CREATE FUNCTION gongming_guard_media_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.source_hash IS DISTINCT FROM OLD.source_hash OR NEW.content_type IS DISTINCT FROM OLD.content_type OR NEW.width IS DISTINCT FROM OLD.width OR NEW.height IS DISTINCT FROM OLD.height OR NEW.bytes IS DISTINCT FROM OLD.bytes OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
  RAISE EXCEPTION 'media identity/content is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.deleted_at IS NOT NULL AND (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.status IS DISTINCT FROM OLD.status OR NEW.note IS DISTINCT FROM OLD.note OR NEW.updated_at IS DISTINCT FROM OLD.updated_at) THEN
  RAISE EXCEPTION 'deleted media cannot be restored or changed' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gongming_media_identity_guard BEFORE UPDATE ON gongming_media_assets FOR EACH ROW EXECUTE FUNCTION gongming_guard_media_identity();
CREATE FUNCTION gongming_check_media_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;
BEGIN
 IF TG_TABLE_NAME='gongming_media_assets' THEN
  target:=NEW.id;
  IF NEW.deleted_at IS NOT NULL AND EXISTS(SELECT 1 FROM gongming_post_media WHERE media_id=target) THEN
   RAISE EXCEPTION 'referenced media cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM gongming_post_media ref JOIN gongming_posts p ON p.id=ref.post_id WHERE ref.media_id=target AND p.status='published' AND (NEW.status<>'ready' OR NEW.deleted_at IS NOT NULL)) THEN
   RAISE EXCEPTION 'published posts require ready media' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='gongming_post_media' THEN
  IF EXISTS(SELECT 1 FROM gongming_posts p JOIN gongming_media_assets a ON a.id=NEW.media_id WHERE p.id=NEW.post_id AND (a.owner_id<>p.author_id OR a.deleted_at IS NOT NULL OR p.status='published' AND a.status<>'ready')) THEN
   RAISE EXCEPTION 'invalid media reference ownership/status' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW.status='published' AND EXISTS(SELECT 1 FROM gongming_post_media ref JOIN gongming_media_assets a ON a.id=ref.media_id WHERE ref.post_id=NEW.id AND (a.owner_id<>NEW.author_id OR a.deleted_at IS NOT NULL OR a.status<>'ready')) THEN
   RAISE EXCEPTION 'published posts require owned ready media' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER gongming_media_reference_guard AFTER INSERT OR UPDATE ON gongming_media_assets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_media_reference();
CREATE CONSTRAINT TRIGGER gongming_post_media_reference_guard AFTER INSERT OR UPDATE ON gongming_post_media DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_media_reference();
CREATE CONSTRAINT TRIGGER gongming_post_publication_media_guard AFTER INSERT OR UPDATE ON gongming_posts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_media_reference();
CREATE FUNCTION gongming_check_media_quota() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total_count bigint;total_bytes bigint;
BEGIN
 SELECT count(*),COALESCE(sum(bytes),0) INTO total_count,total_bytes FROM gongming_media_assets WHERE owner_id=NEW.owner_id AND deleted_at IS NULL;
 IF total_count>100 OR total_bytes>104857600 THEN RAISE EXCEPTION 'media quota exceeded' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER gongming_media_quota_guard AFTER INSERT OR UPDATE ON gongming_media_assets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_media_quota();
`

func migrateMedia(ctx context.Context, tx pgx.Tx) error {
	var done bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=5)`).Scan(&done); err != nil {
		return err
	}
	if done {
		return nil
	}
	if _, err := tx.Exec(ctx, mediaSchema); err != nil {
		return fmt.Errorf("create media schema: %w", err)
	}
	_, err := tx.Exec(ctx, `INSERT INTO gongming_schema_migrations(version) VALUES(5)`)
	return err
}

const mediaSQLFields = `id,owner_id,client_id,source_hash,content_type,width,height,bytes,status,note,created_at,updated_at,deleted_at,scope,COALESCE(circle_id,'')`

func scanStoredMedia(row messagingSQLScanner) (StoredMediaAsset, error) {
	v := StoredMediaAsset{}
	err := row.Scan(&v.ID, &v.OwnerID, &v.ClientID, &v.SourceHash, &v.ContentType, &v.Width, &v.Height, &v.Bytes, &v.Status, &v.Note, &v.CreatedAt, &v.UpdatedAt, &v.DeletedAt, &v.Scope, &v.CircleID)
	v.URL = mediaURLPrefix + v.ID
	v.CreatedAt = v.CreatedAt.UTC()
	v.UpdatedAt = v.UpdatedAt.UTC()
	return v, err
}
func loadMedia(ctx context.Context, tx pgx.Tx, s *State) error {
	if s.Media == nil {
		s.Media = map[string]StoredMediaAsset{}
	}
	return collectRows(ctx, tx, `SELECT `+mediaSQLFields+` FROM gongming_media_assets`, func(rows pgx.Rows) error {
		v, err := scanStoredMedia(rows)
		if err == nil {
			s.Media[v.ID] = v
		}
		return err
	})
}
func persistMedia(ctx context.Context, tx pgx.Tx, before, after *State) error {
	return syncEntities(before.Media, after.Media, func(id string, v StoredMediaAsset) error {
		if id != v.ID || v.URL != mediaURLPrefix+id {
			return fmt.Errorf("invalid media identity/url")
		}
		return execRow(ctx, tx, `INSERT INTO gongming_media_assets(id,owner_id,client_id,source_hash,content_type,width,height,bytes,status,note,created_at,updated_at,deleted_at,scope,circle_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(id) DO UPDATE SET owner_id=EXCLUDED.owner_id,client_id=EXCLUDED.client_id,source_hash=EXCLUDED.source_hash,content_type=EXCLUDED.content_type,width=EXCLUDED.width,height=EXCLUDED.height,bytes=EXCLUDED.bytes,status=EXCLUDED.status,note=EXCLUDED.note,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at,deleted_at=EXCLUDED.deleted_at,scope=EXCLUDED.scope,circle_id=EXCLUDED.circle_id`, v.ID, v.OwnerID, v.ClientID, v.SourceHash, v.ContentType, v.Width, v.Height, v.Bytes, v.Status, v.Note, v.CreatedAt, v.UpdatedAt, v.DeletedAt, effectiveMediaScope(v), nullString(v.CircleID))
	}, func(string) error { return errors.New("media rows require soft deletion") })
}
func postMediaIDs(p StoredPost) map[string]bool {
	result := map[string]bool{}
	for _, image := range p.Images {
		if id, ok := mediaIDFromURL(image); ok {
			result[id] = true
		}
	}
	return result
}
func persistPostMedia(ctx context.Context, tx pgx.Tx, before, after *State) error {
	for _, id := range mapKeys(after.Posts) {
		old, now := postMediaIDs(before.Posts[id]), postMediaIDs(after.Posts[id])
		for _, mediaID := range mapKeys(now) {
			if !old[mediaID] {
				if err := execRow(ctx, tx, `INSERT INTO gongming_post_media(post_id,media_id) VALUES($1,$2)`, id, mediaID); err != nil {
					return err
				}
			}
		}
		for _, mediaID := range mapKeys(old) {
			if !now[mediaID] {
				if err := execRow(ctx, tx, `DELETE FROM gongming_post_media WHERE post_id=$1 AND media_id=$2`, id, mediaID); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// Image reads authorize only the session, requested asset and indexed post refs.
func (a *App) authorizeMediaSQL(r *http.Request, s *PostgresStore) (StoredMediaAsset, error) {
	v := StoredMediaAsset{}
	tx, err := s.pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return v, err
	}
	defer tx.Rollback(r.Context())
	userID := ""
	isStaff := false
	if cookie, err := r.Cookie(cookieName); err == nil {
		err = tx.QueryRow(r.Context(), `SELECT u.id,u.role IN ('admin','moderator') FROM gongming_sessions s JOIN gongming_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.status='active' AND `+browserSessionPredicate("s", "$3"), tokenHash(cookie.Value), a.now(), browserCredentialHash(r)).Scan(&userID, &isStaff)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return v, err
		}
	}
	if expected := r.Header.Get("X-Gongming-Account"); expected != "" && expected != userID {
		return v, &APIError{409, "account_changed", "账号已切换，请重新确认后再操作"}
	}
	v, err = scanStoredMedia(tx.QueryRow(r.Context(), `SELECT `+mediaSQLFields+` FROM gongming_media_assets WHERE id=$1`, r.PathValue("id")))
	if errors.Is(err, pgx.ErrNoRows) {
		return v, missing("图片不存在或不可见")
	}
	if err != nil {
		return v, err
	}
	if v.DeletedAt != nil || v.Status == "blocked" && !isStaff {
		return v, missing("图片不存在或不可见")
	}
	allowed := isStaff || userID == v.OwnerID
	if !allowed {
		query := `SELECT EXISTS(SELECT 1 FROM gongming_post_media ref JOIN gongming_posts p ON p.id=ref.post_id WHERE ref.media_id=$1 AND p.status='published')`
		args := []any{v.ID}
		if v.Scope == "circle" {
			query = `SELECT EXISTS(SELECT 1 FROM gongming_circle_post_media ref JOIN gongming_circle_posts p ON p.id=ref.post_id JOIN gongming_circles c ON c.id=p.circle_id JOIN gongming_circle_channels ch ON ch.id=p.channel_id AND ch.circle_id=c.id JOIN gongming_circle_members m ON m.circle_id=c.id AND m.user_id=$2 AND m.status='active' WHERE ref.media_id=$1 AND p.circle_id=$3 AND p.deleted_at IS NULL AND p.status='published' AND c.status IN ('active','archived') AND (ch.access='members' OR m.role IN ('owner','admin')))`
			args = append(args, userID, v.CircleID)
		}
		if err = tx.QueryRow(r.Context(), query, args...).Scan(&allowed); err != nil {
			return v, err
		}
	}
	if !allowed {
		return v, missing("图片不存在或不可见")
	}
	return v, tx.Commit(r.Context())
}
