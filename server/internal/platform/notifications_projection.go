package platform

import (
	"net/http"

	"github.com/jackc/pgx/v5"
)

func notificationProjectionRows(r *http.Request, tx pgx.Tx, sql string, args []any, scan func(pgx.Rows) error) error {
	rows, err := tx.Query(r.Context(), sql, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err = scan(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}

// Load only IDs referenced by this recipient's bounded page, grouped by domain.
// This is a transient permission projection, not loadNormalized and not a
// durable content snapshot. No query is made to a domain absent from this page.
func loadNotificationProjection(r *http.Request, tx pgx.Tx, user string, items []storedNotification) (*State, error) {
	s := NewState()
	if len(items) == 0 {
		return s, nil
	}
	refs := map[string][]string{}
	actors := map[string]bool{user: true}
	circles := map[string]bool{}
	channels := map[string]bool{}
	for _, v := range items {
		if v.ActorID != "" && notificationRules[v.Kind].category != "system" {
			actors[v.ActorID] = true
		}
		switch v.Kind {
		case "friend-request", "friend-decision":
			refs["friend"] = append(refs["friend"], v.ReferenceID)
		case "circle-request", "circle-decision":
			refs["request"] = append(refs["request"], v.ReferenceID)
		case "circle-membership", "circle-status":
			circles[v.ReferenceID] = true
		case "world-comment", "world-like", "world-review":
			refs["world"] = append(refs["world"], v.ReferenceID)
		case "circle-comment", "circle-like", "circle-review":
			refs["post"] = append(refs["post"], v.ReferenceID)
		case "media-review":
			refs["media"] = append(refs["media"], v.ReferenceID)
		case "report-review":
			refs["report"] = append(refs["report"], v.ReferenceID)
		}
	}
	query := func(key, sql string, scan func(pgx.Rows) error) error {
		if len(refs[key]) == 0 {
			return nil
		}
		return notificationProjectionRows(r, tx, sql, []any{refs[key]}, scan)
	}
	if err := query("friend", `SELECT id,from_id,to_id,note,status FROM gongming_friend_requests WHERE id=ANY($1::text[])`, func(row pgx.Rows) error {
		v := StoredFriendRequest{}
		err := row.Scan(&v.ID, &v.FromID, &v.ToID, &v.Note, &v.Status)
		s.FriendRequests[v.ID] = v
		actors[v.FromID] = true
		actors[v.ToID] = true
		return err
	}); err != nil {
		return nil, err
	}
	requestScan := func(row pgx.Rows) error {
		v := StoredCircleJoinRequest{}
		err := row.Scan(&v.ID, &v.CircleID, &v.UserID, &v.Note, &v.Status)
		s.CircleJoinRequests[v.ID] = v
		circles[v.CircleID] = true
		return err
	}
	if err := query("request", `SELECT id,circle_id,user_id,note,status FROM gongming_circle_requests WHERE id=ANY($1::text[])`, requestScan); err != nil {
		return nil, err
	}
	if err := query("world", `SELECT id,author_id,body,status FROM gongming_posts WHERE id=ANY($1::text[])`, func(row pgx.Rows) error {
		v := StoredPost{}
		err := row.Scan(&v.ID, &v.AuthorID, &v.Body, &v.Status)
		s.Posts[v.ID] = v
		return err
	}); err != nil {
		return nil, err
	}
	if err := query("post", `SELECT id,circle_id,channel_id,author_id,title,body,status,deleted_at FROM gongming_circle_posts WHERE id=ANY($1::text[])`, func(row pgx.Rows) error {
		v := StoredCirclePost{}
		err := row.Scan(&v.ID, &v.CircleID, &v.ChannelID, &v.AuthorID, &v.Title, &v.Body, &v.Status, &v.DeletedAt)
		s.CirclePosts[v.ID] = v
		circles[v.CircleID] = true
		channels[v.ChannelID] = true
		return err
	}); err != nil {
		return nil, err
	}
	if err := query("media", `SELECT id,owner_id,status,deleted_at FROM gongming_media_assets WHERE id=ANY($1::text[])`, func(row pgx.Rows) error {
		v := StoredMediaAsset{}
		err := row.Scan(&v.ID, &v.OwnerID, &v.Status, &v.DeletedAt)
		s.Media[v.ID] = v
		return err
	}); err != nil {
		return nil, err
	}
	if err := query("report", `SELECT id,reporter_id FROM gongming_reports WHERE id=ANY($1::text[])`, func(row pgx.Rows) error {
		v := Report{}
		err := row.Scan(&v.ID, &v.ReporterID)
		s.Reports[v.ID] = v
		return err
	}); err != nil {
		return nil, err
	}
	if len(circles) > 0 {
		ids := mapKeys(circles)
		if err := notificationProjectionRows(r, tx, `SELECT id,name,status,visibility FROM gongming_circles WHERE id=ANY($1::text[])`, []any{ids}, func(row pgx.Rows) error {
			v := StoredCircle{}
			err := row.Scan(&v.ID, &v.Name, &v.Status, &v.Visibility)
			s.Circles[v.ID] = v
			return err
		}); err != nil {
			return nil, err
		}
		if err := notificationProjectionRows(r, tx, `SELECT circle_id,user_id,role,status FROM gongming_circle_members WHERE circle_id=ANY($1::text[]) AND user_id=$2`, []any{ids, user}, func(row pgx.Rows) error {
			v := StoredCircleMember{}
			err := row.Scan(&v.CircleID, &v.UserID, &v.Role, &v.Status)
			s.CircleMembers[circleMemberKey(v.CircleID, v.UserID)] = v
			return err
		}); err != nil {
			return nil, err
		}
		if err := notificationProjectionRows(r, tx, `SELECT id,circle_id,user_id,note,status FROM gongming_circle_requests WHERE circle_id=ANY($1::text[]) AND user_id=$2 AND status='pending'`, []any{ids, user}, requestScan); err != nil {
			return nil, err
		}
	}
	if len(channels) > 0 {
		if err := notificationProjectionRows(r, tx, `SELECT id,circle_id,access,archived FROM gongming_circle_channels WHERE id=ANY($1::text[])`, []any{mapKeys(channels)}, func(row pgx.Rows) error {
			v := StoredCircleChannel{}
			err := row.Scan(&v.ID, &v.CircleID, &v.Access, &v.Archived)
			s.CircleChannels[v.ID] = v
			return err
		}); err != nil {
			return nil, err
		}
	}
	if err := notificationProjectionRows(r, tx, `SELECT id,handle,name,avatar,bio,status,role FROM gongming_users WHERE id=ANY($1::text[])`, []any{mapKeys(actors)}, func(row pgx.Rows) error {
		u := User{}
		err := row.Scan(&u.ID, &u.Handle, &u.Name, &u.Avatar, &u.Bio, &u.Status, &u.Role)
		s.Accounts[u.ID] = Account{User: u}
		return err
	}); err != nil {
		return nil, err
	}
	return s, nil
}

func projectNotification(s *State, user string, v storedNotification) Notification {
	n := notificationBase(v)
	u := s.Accounts[user].User
	var context *NotificationContext
	var target *NotificationTarget
	switch v.Kind {
	case "friend-request", "friend-decision":
		request, ok := s.FriendRequests[v.ReferenceID]
		if !ok || request.FromID != user && request.ToID != user {
			return n
		}
		other := request.FromID
		if other == user {
			other = request.ToID
		}
		account, ok := s.Accounts[other]
		if !ok || account.User.Status != "active" {
			return n
		}
		context = &NotificationContext{"好友申请", notificationSnippet(request.Note, 160)}
		if request.Status == "pending" {
			target = &NotificationTarget{Type: "friend-requests"}
		} else {
			target = &NotificationTarget{Type: "user", Handle: account.User.Handle}
		}
	case "circle-request":
		request, ok := s.CircleJoinRequests[v.ReferenceID]
		if !ok {
			return n
		}
		c, _, err := circleAccess(s, &u, request.CircleID, false, true)
		if err != nil {
			return n
		}
		context = &NotificationContext{notificationSnippet(c.Name, 120), notificationSnippet(request.Note, 160)}
		target = &NotificationTarget{Type: "circle-members", CircleID: c.ID}
	case "circle-decision", "circle-membership", "circle-status":
		id := v.ReferenceID
		if v.Kind == "circle-decision" {
			request, ok := s.CircleJoinRequests[v.ReferenceID]
			if !ok || request.UserID != user {
				return n
			}
			id = request.CircleID
		}
		_, member := activeCircleMember(s, id, user)
		_, pending := circlePending(s, id, user)
		if !member && !pending {
			return n
		}
		c, err := circleIntroduction(s, &u, id)
		if err != nil {
			return n
		}
		context = &NotificationContext{notificationSnippet(c.Name, 120), ""}
		target = &NotificationTarget{Type: "circle", CircleID: c.ID}
	case "world-comment", "world-like", "world-review":
		p, err := visiblePost(s, v.ReferenceID, &u)
		if err != nil {
			return n
		}
		context = &NotificationContext{"世界动态", notificationSnippet(p.Body, 160)}
		target = &NotificationTarget{Type: "world-post", PostID: p.ID}
	case "circle-comment", "circle-like", "circle-review":
		p, ok := s.CirclePosts[v.ReferenceID]
		if !ok {
			return n
		}
		if _, _, err := visibleCirclePost(s, &u, p.CircleID, p.ID); err != nil {
			return n
		}
		context = &NotificationContext{notificationSnippet(p.Title, 120), notificationSnippet(p.Body, 160)}
		target = &NotificationTarget{Type: "circle-post", CircleID: p.CircleID, PostID: p.ID}
	case "media-review":
		asset, ok := s.Media[v.ReferenceID]
		if !ok || asset.OwnerID != user || asset.DeletedAt != nil {
			return n
		}
		status := "图片当前可用"
		if asset.Status == "blocked" {
			status = "图片当前已屏蔽"
		}
		context = &NotificationContext{"我的上传", status}
		target = &NotificationTarget{Type: "uploads", MediaID: asset.ID}
	case "report-review":
		if report, ok := s.Reports[v.ReferenceID]; ok && report.ReporterID == user {
			n.Available = true
		}
		return n
	default:
		return n
	}
	if n.Category != "system" {
		actor, ok := s.Accounts[v.ActorID]
		if !ok || actor.User.Status != "active" {
			return n
		}
		public := publicUser(actor.User)
		n.Actor = &public
	}
	n.Available = true
	n.Context = context
	n.Target = target
	return n
}
