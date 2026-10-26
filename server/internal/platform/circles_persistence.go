package platform

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

func loadCircles(ctx context.Context, tx pgx.Tx, s *State) error {
	initializeCircles(s)
	if err := collectRows(ctx, tx, `SELECT id,creator_id,client_id,fingerprint,owner_id,name,description,icon,cover,category,visibility,join_policy,status,note,created_at,updated_at FROM gongming_circles`, func(r pgx.Rows) error {
		v := StoredCircle{}
		err := r.Scan(&v.ID, &v.CreatorID, &v.ClientID, &v.Fingerprint, &v.OwnerID, &v.Name, &v.Description, &v.Icon, &v.Cover, &v.Category, &v.Visibility, &v.JoinPolicy, &v.Status, &v.Note, &v.CreatedAt, &v.UpdatedAt)
		s.Circles[v.ID] = v
		return err
	}); err != nil {
		return err
	}
	if err := collectRows(ctx, tx, `SELECT circle_id,user_id,role,status,note,joined_at,updated_at FROM gongming_circle_members`, func(r pgx.Rows) error {
		v := StoredCircleMember{}
		err := r.Scan(&v.CircleID, &v.UserID, &v.Role, &v.Status, &v.Note, &v.JoinedAt, &v.UpdatedAt)
		s.CircleMembers[circleMemberKey(v.CircleID, v.UserID)] = v
		return err
	}); err != nil {
		return err
	}
	if err := collectRows(ctx, tx, `SELECT id,circle_id,user_id,note,status,COALESCE(reviewer_id,''),review_note,created_at,updated_at FROM gongming_circle_requests`, func(r pgx.Rows) error {
		v := StoredCircleJoinRequest{}
		err := r.Scan(&v.ID, &v.CircleID, &v.UserID, &v.Note, &v.Status, &v.ReviewerID, &v.ReviewNote, &v.CreatedAt, &v.UpdatedAt)
		s.CircleJoinRequests[v.ID] = v
		return err
	}); err != nil {
		return err
	}
	if err := collectRows(ctx, tx, `SELECT id,circle_id,name,description,kind,access,archived,created_at,updated_at FROM gongming_circle_channels`, func(r pgx.Rows) error {
		v := StoredCircleChannel{}
		err := r.Scan(&v.ID, &v.CircleID, &v.Name, &v.Description, &v.Kind, &v.Access, &v.Archived, &v.CreatedAt, &v.UpdatedAt)
		s.CircleChannels[v.ID] = v
		return err
	}); err != nil {
		return err
	}
	if err := collectRows(ctx, tx, `SELECT id,circle_id,channel_id,author_id,client_id,fingerprint,title,body,images,status,pinned,featured,note,created_at,updated_at,deleted_at FROM gongming_circle_posts`, func(r pgx.Rows) error {
		v := StoredCirclePost{Likes: map[string]bool{}}
		err := r.Scan(&v.ID, &v.CircleID, &v.ChannelID, &v.AuthorID, &v.ClientID, &v.Fingerprint, &v.Title, &v.Body, &v.Images, &v.Status, &v.Pinned, &v.Featured, &v.Note, &v.CreatedAt, &v.UpdatedAt, &v.DeletedAt)
		s.CirclePosts[v.ID] = v
		return err
	}); err != nil {
		return err
	}
	if err := collectRows(ctx, tx, `SELECT post_id,user_id FROM gongming_circle_likes`, func(r pgx.Rows) error {
		var post, user string
		if err := r.Scan(&post, &user); err != nil {
			return err
		}
		p, ok := s.CirclePosts[post]
		if !ok {
			return errors.New("orphaned circle like")
		}
		p.Likes[user] = true
		s.CirclePosts[post] = p
		return nil
	}); err != nil {
		return err
	}
	if err := collectRows(ctx, tx, `SELECT id,circle_id,post_id,author_id,body,created_at FROM gongming_circle_comments`, func(r pgx.Rows) error {
		v := StoredCircleComment{}
		err := r.Scan(&v.ID, &v.CircleID, &v.PostID, &v.AuthorID, &v.Body, &v.CreatedAt)
		s.CircleComments[v.ID] = v
		return err
	}); err != nil {
		return err
	}
	if err := collectRows(ctx, tx, `SELECT id,circle_id,creator_id,token_hash,max_uses,uses,expires_at,revoked_at,created_at FROM gongming_circle_invites`, func(r pgx.Rows) error {
		v := StoredCircleInvite{}
		err := r.Scan(&v.ID, &v.CircleID, &v.CreatorID, &v.TokenHash, &v.MaxUses, &v.Uses, &v.ExpiresAt, &v.RevokedAt, &v.CreatedAt)
		s.CircleInvites[v.ID] = v
		return err
	}); err != nil {
		return err
	}
	return collectRows(ctx, tx, `SELECT invite_id,user_id,created_at FROM gongming_circle_invite_redemptions`, func(r pgx.Rows) error {
		v := StoredCircleInviteRedemption{}
		err := r.Scan(&v.InviteID, &v.UserID, &v.CreatedAt)
		s.CircleInviteRedemptions[circleRedemptionKey(v.InviteID, v.UserID)] = v
		return err
	})
}
func preserveCircleRow(string) error {
	return errors.New("circle entities require logical archive/removal/tombstone/revocation")
}
func persistCircles(ctx context.Context, tx pgx.Tx, before, after *State) error {
	if err := syncEntities(before.Circles, after.Circles, func(_ string, v StoredCircle) error {
		return execRow(ctx, tx, `INSERT INTO gongming_circles(id,creator_id,client_id,fingerprint,owner_id,name,description,icon,cover,category,visibility,join_policy,status,note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(id) DO UPDATE SET creator_id=EXCLUDED.creator_id,client_id=EXCLUDED.client_id,fingerprint=EXCLUDED.fingerprint,owner_id=EXCLUDED.owner_id,name=EXCLUDED.name,description=EXCLUDED.description,icon=EXCLUDED.icon,cover=EXCLUDED.cover,category=EXCLUDED.category,visibility=EXCLUDED.visibility,join_policy=EXCLUDED.join_policy,status=EXCLUDED.status,note=EXCLUDED.note,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at`, v.ID, v.CreatorID, v.ClientID, v.Fingerprint, v.OwnerID, v.Name, v.Description, v.Icon, v.Cover, v.Category, v.Visibility, v.JoinPolicy, v.Status, v.Note, v.CreatedAt, v.UpdatedAt)
	}, preserveCircleRow); err != nil {
		return err
	}
	if err := syncEntities(before.CircleMembers, after.CircleMembers, func(_ string, v StoredCircleMember) error {
		return execRow(ctx, tx, `INSERT INTO gongming_circle_members(circle_id,user_id,role,status,note,joined_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(circle_id,user_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status,note=EXCLUDED.note,joined_at=EXCLUDED.joined_at,updated_at=EXCLUDED.updated_at`, v.CircleID, v.UserID, v.Role, v.Status, v.Note, v.JoinedAt, v.UpdatedAt)
	}, preserveCircleRow); err != nil {
		return err
	}
	if err := syncEntities(before.CircleJoinRequests, after.CircleJoinRequests, func(_ string, v StoredCircleJoinRequest) error {
		return execRow(ctx, tx, `INSERT INTO gongming_circle_requests(id,circle_id,user_id,note,status,reviewer_id,review_note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET circle_id=EXCLUDED.circle_id,user_id=EXCLUDED.user_id,note=EXCLUDED.note,status=EXCLUDED.status,reviewer_id=EXCLUDED.reviewer_id,review_note=EXCLUDED.review_note,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at`, v.ID, v.CircleID, v.UserID, v.Note, v.Status, nullString(v.ReviewerID), v.ReviewNote, v.CreatedAt, v.UpdatedAt)
	}, preserveCircleRow); err != nil {
		return err
	}
	if err := syncEntities(before.CircleChannels, after.CircleChannels, func(_ string, v StoredCircleChannel) error {
		return execRow(ctx, tx, `INSERT INTO gongming_circle_channels(id,circle_id,name,description,kind,access,archived,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET circle_id=EXCLUDED.circle_id,name=EXCLUDED.name,description=EXCLUDED.description,kind=EXCLUDED.kind,access=EXCLUDED.access,archived=EXCLUDED.archived,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at`, v.ID, v.CircleID, v.Name, v.Description, v.Kind, v.Access, v.Archived, v.CreatedAt, v.UpdatedAt)
	}, preserveCircleRow); err != nil {
		return err
	}
	if err := syncEntities(before.CirclePosts, after.CirclePosts, func(id string, v StoredCirclePost) error {
		old := before.CirclePosts[id]
		plain, previous := v, old
		plain.Likes = nil
		previous.Likes = nil
		if !entityEqual(plain, previous) {
			images := v.Images
			if images == nil {
				images = []string{}
			}
			if err := execRow(ctx, tx, `INSERT INTO gongming_circle_posts(id,circle_id,channel_id,author_id,client_id,fingerprint,title,body,images,status,pinned,featured,note,created_at,updated_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(id) DO UPDATE SET circle_id=EXCLUDED.circle_id,channel_id=EXCLUDED.channel_id,author_id=EXCLUDED.author_id,client_id=EXCLUDED.client_id,fingerprint=EXCLUDED.fingerprint,title=EXCLUDED.title,body=EXCLUDED.body,images=EXCLUDED.images,status=EXCLUDED.status,pinned=EXCLUDED.pinned,featured=EXCLUDED.featured,note=EXCLUDED.note,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at,deleted_at=EXCLUDED.deleted_at`, v.ID, v.CircleID, v.ChannelID, v.AuthorID, v.ClientID, v.Fingerprint, v.Title, v.Body, images, v.Status, v.Pinned, v.Featured, v.Note, v.CreatedAt, v.UpdatedAt, v.DeletedAt); err != nil {
				return err
			}
		}
		for _, user := range mapKeys(v.Likes) {
			if v.Likes[user] && !old.Likes[user] {
				if err := execRow(ctx, tx, `INSERT INTO gongming_circle_likes(post_id,user_id) VALUES($1,$2)`, id, user); err != nil {
					return err
				}
			}
		}
		for _, user := range mapKeys(old.Likes) {
			if old.Likes[user] && !v.Likes[user] {
				if err := execRow(ctx, tx, `DELETE FROM gongming_circle_likes WHERE post_id=$1 AND user_id=$2`, id, user); err != nil {
					return err
				}
			}
		}
		return nil
	}, preserveCircleRow); err != nil {
		return err
	}
	if err := syncEntities(before.CircleComments, after.CircleComments, func(_ string, v StoredCircleComment) error {
		return execRow(ctx, tx, `INSERT INTO gongming_circle_comments(id,circle_id,post_id,author_id,body,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET circle_id=EXCLUDED.circle_id,post_id=EXCLUDED.post_id,author_id=EXCLUDED.author_id,body=EXCLUDED.body,created_at=EXCLUDED.created_at`, v.ID, v.CircleID, v.PostID, v.AuthorID, v.Body, v.CreatedAt)
	}, func(id string) error { return removeID(ctx, tx, "gongming_circle_comments", id) }); err != nil {
		return err
	}
	if err := syncEntities(before.CircleInvites, after.CircleInvites, func(_ string, v StoredCircleInvite) error {
		return execRow(ctx, tx, `INSERT INTO gongming_circle_invites(id,circle_id,creator_id,token_hash,max_uses,uses,expires_at,revoked_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET circle_id=EXCLUDED.circle_id,creator_id=EXCLUDED.creator_id,token_hash=EXCLUDED.token_hash,max_uses=EXCLUDED.max_uses,uses=EXCLUDED.uses,expires_at=EXCLUDED.expires_at,revoked_at=EXCLUDED.revoked_at,created_at=EXCLUDED.created_at`, v.ID, v.CircleID, v.CreatorID, v.TokenHash, v.MaxUses, v.Uses, v.ExpiresAt, v.RevokedAt, v.CreatedAt)
	}, preserveCircleRow); err != nil {
		return err
	}
	if err := syncEntities(before.CircleInviteRedemptions, after.CircleInviteRedemptions, func(key string, v StoredCircleInviteRedemption) error {
		if _, ok := before.CircleInviteRedemptions[key]; ok {
			return errors.New("invite redemptions are immutable")
		}
		return execRow(ctx, tx, `INSERT INTO gongming_circle_invite_redemptions(invite_id,user_id,created_at) VALUES($1,$2,$3)`, v.InviteID, v.UserID, v.CreatedAt)
	}, preserveCircleRow); err != nil {
		return err
	}
	for _, id := range mapKeys(after.CirclePosts) {
		old, now := circlePostMediaIDs(before.CirclePosts[id]), circlePostMediaIDs(after.CirclePosts[id])
		for _, media := range mapKeys(now) {
			if !old[media] {
				if err := execRow(ctx, tx, `INSERT INTO gongming_circle_post_media(post_id,media_id) VALUES($1,$2)`, id, media); err != nil {
					return err
				}
			}
		}
		for _, media := range mapKeys(old) {
			if !now[media] {
				if err := execRow(ctx, tx, `DELETE FROM gongming_circle_post_media WHERE post_id=$1 AND media_id=$2`, id, media); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
func circlePostMediaIDs(p StoredCirclePost) map[string]bool {
	if p.DeletedAt != nil {
		return map[string]bool{}
	}
	return postMediaIDs(StoredPost{Images: p.Images})
}
