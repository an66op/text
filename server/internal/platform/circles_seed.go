package platform

import "time"

// Called only by the existing first-empty-development-database branch. It does
// not import browser demo state or mutate an already populated database.
func (a *App) seedDevelopmentCircles(s *State) {
	initializeCircles(s)
	now := a.circleNow().Add(-24 * time.Hour)
	for index, visibility := range []string{"public", "private"} {
		id := newID("circle_")
		name := "开发示例 · 城市灵感"
		policy := "open"
		if visibility == "private" {
			name = "开发示例 · 共建小组"
			policy = "approval"
		}
		c := StoredCircle{ID: id, CreatorID: "user_demo", ClientID: "development-circle-" + visibility, Fingerprint: "development-example-" + visibility, OwnerID: "user_demo", Name: name, Description: "开发环境真实持久化示例。成员、频道、帖子与审批均由服务端校验；不会导入浏览器本机圈子。", Icon: "🌿", Category: "开发示例", Visibility: visibility, JoinPolicy: policy, Status: "active", CreatedAt: now, UpdatedAt: now}
		s.Circles[id] = c
		for _, user := range []string{"user_demo", "user_friend"} {
			role := "member"
			if user == "user_demo" {
				role = "owner"
			}
			s.CircleMembers[circleMemberKey(id, user)] = StoredCircleMember{CircleID: id, UserID: user, Role: role, Status: "active", JoinedAt: now, UpdatedAt: now}
		}
		forum := newID("cchannel_")
		announcement := newID("cchannel_")
		staff := newID("cchannel_")
		for _, ch := range []StoredCircleChannel{{ID: forum, CircleID: id, Name: "开发示例讨论", Description: "成员分享与讨论", Kind: "forum", Access: "members", CreatedAt: now, UpdatedAt: now}, {ID: announcement, CircleID: id, Name: "开发示例公告", Description: "圈主发布，成员可评论点赞", Kind: "announcement", Access: "members", CreatedAt: now.Add(time.Second), UpdatedAt: now.Add(time.Second)}, {ID: staff, CircleID: id, Name: "开发示例管理", Description: "仅圈主和圈管理员可见", Kind: "forum", Access: "staff", CreatedAt: now.Add(2 * time.Second), UpdatedAt: now.Add(2 * time.Second)}} {
			s.CircleChannels[ch.ID] = ch
		}
		post := StoredCirclePost{ID: newID("cpost_"), CircleID: id, ChannelID: forum, AuthorID: "user_demo", ClientID: "development-welcome", Fingerprint: "development-welcome", Title: "开发示例：欢迎来到真实圈子", Body: "这是保存在PostgreSQL的开发示例。可测试加入、频道权限、评论点赞、图片待审和圈内管理；私圈内容不会公开给访客。", Images: []string{}, Status: "published", Pinned: true, CreatedAt: now.Add(time.Minute), UpdatedAt: now.Add(time.Minute), Likes: map[string]bool{"user_friend": true}}
		s.CirclePosts[post.ID] = post
		comment := StoredCircleComment{ID: newID("ccomment_"), CircleID: id, PostID: post.ID, AuthorID: "user_friend", Body: "开发示例评论：一起完善这个空间。", CreatedAt: now.Add(2 * time.Minute)}
		s.CircleComments[comment.ID] = comment
		s.queueNotification("circle-comment", comment.AuthorID, post.AuthorID, post.ID, "", "circle-comment:"+comment.ID, comment.CreatedAt)
		s.queueNotification("circle-like", "user_friend", post.AuthorID, post.ID, "", "circle-like:"+post.ID+":user_friend", comment.CreatedAt)
		announcementPost := StoredCirclePost{ID: newID("cpost_"), CircleID: id, ChannelID: announcement, AuthorID: "user_demo", ClientID: "development-announcement", Fingerprint: "development-announcement", Title: "开发示例：圈子使用说明", Body: "公告主帖由圈主和圈管理员发布，正常成员可点赞评论。示例不会创建或存储任何明文邀请token。", Images: []string{}, Status: "published", CreatedAt: now.Add(3 * time.Minute), UpdatedAt: now.Add(3 * time.Minute), Likes: map[string]bool{}}
		s.CirclePosts[announcementPost.ID] = announcementPost
		if index == 1 {
			request := StoredCircleJoinRequest{ID: newID("crequest_"), CircleID: id, UserID: "user_admin", Note: "开发示例待审申请：平台管理员也需要圈方批准，不自动获得成员权限。", Status: "pending", CreatedAt: now.Add(4 * time.Minute), UpdatedAt: now.Add(4 * time.Minute)}
			s.CircleJoinRequests[request.ID] = request
			s.notifyCircleManagers(request, request.CreatedAt)
		}
	}
}
