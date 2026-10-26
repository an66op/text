package platform

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"unicode/utf8"
)

func (a *App) circleChannels(s *State, u *User, r *http.Request) (any, error) {
	c, m, err := circleAccess(s, u, r.PathValue("id"), false, false)
	if err != nil {
		return nil, err
	}
	items := []CircleChannel{}
	for _, ch := range s.CircleChannels {
		if ch.CircleID == c.ID && (ch.Access == "members" || circleStaff(m.Role)) {
			items = append(items, circleChannel(ch))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt.Before(items[j].CreatedAt)
	})
	return list(r, items)
}
func cleanCircleChannel(ch StoredCircleChannel) (StoredCircleChannel, error) {
	var err error
	ch.Name, err = trimText(ch.Name, 40)
	if err != nil {
		return ch, err
	}
	ch.Description = strings.TrimSpace(ch.Description)
	if utf8.RuneCountInString(ch.Description) > 300 {
		return ch, bad("频道说明最多300字")
	}
	if ch.Kind != "forum" && ch.Kind != "announcement" || ch.Access != "members" && ch.Access != "staff" {
		return ch, bad("频道类型或访问范围不正确")
	}
	return ch, nil
}
func (a *App) createCircleChannel(s *State, u *User, r *http.Request) (any, error) {
	c, _, err := circleAccess(s, u, r.PathValue("id"), true, true)
	if err != nil {
		return nil, err
	}
	var input struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Kind        string `json:"kind"`
		Access      string `json:"access"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	count := 0
	for _, ch := range s.CircleChannels {
		if ch.CircleID == c.ID {
			count++
		}
	}
	if count >= 50 {
		return nil, conflict("每圈最多50个频道")
	}
	ch, err := cleanCircleChannel(StoredCircleChannel{ID: newID("cchannel_"), CircleID: c.ID, Name: input.Name, Description: input.Description, Kind: input.Kind, Access: input.Access, CreatedAt: a.circleNow(), UpdatedAt: a.circleNow()})
	if err != nil {
		return nil, err
	}
	s.CircleChannels[ch.ID] = ch
	s.audit(u, "circle.channel.create", ch.ID, "circle="+c.ID, a.circleNow())
	return circleChannel(ch), nil
}
func (a *App) updateCircleChannel(s *State, u *User, r *http.Request) (any, error) {
	c, _, err := circleAccess(s, u, r.PathValue("id"), true, true)
	if err != nil {
		return nil, err
	}
	ch, ok := s.CircleChannels[r.PathValue("channelId")]
	if !ok || ch.CircleID != c.ID {
		return nil, missing("频道不存在")
	}
	var input struct {
		Name, Description, Kind, Access *string
		Archived                        *bool
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	changed := false
	for _, field := range []struct {
		from *string
		to   *string
	}{{input.Name, &ch.Name}, {input.Description, &ch.Description}, {input.Kind, &ch.Kind}, {input.Access, &ch.Access}} {
		if field.from != nil {
			*field.to = *field.from
			changed = true
		}
	}
	if input.Archived != nil {
		ch.Archived = *input.Archived
		changed = true
	}
	if !changed {
		return nil, bad("请选择需要修改的频道字段")
	}
	ch, err = cleanCircleChannel(ch)
	if err != nil {
		return nil, err
	}
	ch.UpdatedAt = a.circleNow()
	s.CircleChannels[ch.ID] = ch
	s.audit(u, "circle.channel.update", ch.ID, "circle="+c.ID, a.circleNow())
	return circleChannel(ch), nil
}
func (a *App) circlePosts(s *State, u *User, r *http.Request) (any, error) {
	c, m, err := circleAccess(s, u, r.PathValue("id"), false, false)
	if err != nil {
		return nil, err
	}
	status, err := queryEnum(r, "status", "published", "pending", "hidden")
	if err != nil {
		return nil, err
	}
	if status == "" {
		status = "published"
	}
	if status != "published" && !circleStaff(m.Role) {
		return nil, forbidden("只有圈管理可查看审核队列")
	}
	view, err := queryEnum(r, "view", "all", "featured", "owner", "photos")
	if err != nil {
		return nil, err
	}
	channelID := r.URL.Query().Get("channelId")
	if channelID != "" {
		if _, _, _, err = circleChannelAccess(s, u, c.ID, channelID, false, false); err != nil {
			return nil, err
		}
	}
	items := []CirclePost{}
	for _, p := range s.CirclePosts {
		ch := s.CircleChannels[p.ChannelID]
		if p.CircleID != c.ID || p.DeletedAt != nil || p.Status != status || channelID != "" && p.ChannelID != channelID || ch.Access == "staff" && !circleStaff(m.Role) || view == "featured" && !p.Featured || view == "owner" && p.AuthorID != c.OwnerID || view == "photos" && len(p.Images) == 0 || !matches(r, p.ID+" "+p.Title+" "+p.Body+" "+s.Accounts[p.AuthorID].User.Name) {
			continue
		}
		items = append(items, s.circlePost(p, u.ID))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Pinned != items[j].Pinned {
			return items[i].Pinned
		}
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})
	return list(r, items)
}
func (a *App) createCirclePost(s *State, u *User, r *http.Request) (any, error) {
	var input struct {
		ChannelID string   `json:"channelId"`
		Title     string   `json:"title"`
		Body      string   `json:"body"`
		Images    []string `json:"images"`
		ClientID  string   `json:"clientId"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	c, _, _, err := circleChannelAccess(s, u, r.PathValue("id"), input.ChannelID, true, true)
	if err != nil {
		return nil, err
	}
	if !requestPattern.MatchString(input.ClientID) {
		return nil, bad("clientId格式不正确")
	}
	input.Title, err = trimText(input.Title, 120)
	if err != nil {
		return nil, err
	}
	input.Body, err = trimText(input.Body, 5000)
	if err != nil {
		return nil, err
	}
	input.Images, err = canonicalCircleImages(input.Images)
	if err != nil {
		return nil, err
	}
	clientID := input.ClientID
	input.ClientID = ""
	raw, _ := json.Marshal(input)
	fingerprint := string(raw)
	for _, p := range s.CirclePosts {
		if p.CircleID == c.ID && p.ChannelID == input.ChannelID && p.AuthorID == u.ID && p.ClientID == clientID {
			if p.DeletedAt != nil {
				return nil, conflict("圈帖已删除，请使用新的clientId")
			}
			if p.Fingerprint != fingerprint {
				return nil, conflict("clientId已用于不同的圈帖内容")
			}
			return s.circlePost(p, u.ID), nil
		}
	}
	now := a.circleNow()
	if _, err = validateCirclePostMedia(s, c.ID, u.ID, input.Images); err != nil {
		return nil, err
	}
	status := "published"
	if len(input.Images) > 0 {
		status = "pending"
	}
	p := StoredCirclePost{ID: newID("cpost_"), CircleID: c.ID, ChannelID: input.ChannelID, AuthorID: u.ID, ClientID: clientID, Fingerprint: fingerprint, Title: input.Title, Body: input.Body, Images: input.Images, Status: status, CreatedAt: now, UpdatedAt: now, Likes: map[string]bool{}}
	s.CirclePosts[p.ID] = p
	return s.circlePost(p, u.ID), nil
}
func (a *App) circlePostDetail(s *State, u *User, r *http.Request) (any, error) {
	p, _, err := visibleCirclePost(s, u, r.PathValue("id"), r.PathValue("postId"))
	if err != nil {
		return nil, err
	}
	return s.circlePost(p, u.ID), nil
}
func (a *App) updateCirclePost(s *State, u *User, r *http.Request) (any, error) {
	p, m, err := visibleCirclePost(s, u, r.PathValue("id"), r.PathValue("postId"))
	if err != nil {
		return nil, err
	}
	if !circleStaff(m.Role) {
		return nil, forbidden("只有圈管理可审核圈帖")
	}
	if _, _, _, err = circleChannelAccess(s, u, p.CircleID, p.ChannelID, true, false); err != nil {
		return nil, err
	}
	var input struct {
		Status   *string `json:"status"`
		Featured *bool   `json:"featured"`
		Pinned   *bool   `json:"pinned"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	if input.Status == nil && input.Featured == nil && input.Pinned == nil {
		return nil, bad("请选择审核或置顶精华操作")
	}
	if input.Status != nil {
		if *input.Status != "published" && *input.Status != "hidden" && *input.Status != "pending" {
			return nil, bad("圈帖状态不正确")
		}
		if *input.Status == "published" {
			if _, err = validateCirclePostMedia(s, p.CircleID, p.AuthorID, p.Images); err != nil {
				return nil, conflict("圈帖图片不可发布")
			}
		}
		if p.Status != *input.Status {
			s.notifyChange("circle-review", u.ID, p.AuthorID, p.ID, *input.Status, a.circleNow())
		}
		p.Status = *input.Status
	}
	if input.Featured != nil {
		p.Featured = *input.Featured
	}
	if input.Pinned != nil {
		p.Pinned = *input.Pinned
	}
	p.UpdatedAt = a.circleNow()
	s.CirclePosts[p.ID] = p
	s.audit(u, "circle.post.moderate", p.ID, "status="+p.Status, a.circleNow())
	return s.circlePost(p, u.ID), nil
}
func (a *App) deleteCirclePost(s *State, u *User, r *http.Request) (any, error) {
	p, ok := s.CirclePosts[r.PathValue("postId")]
	if !ok || p.CircleID != r.PathValue("id") {
		return nil, missing("圈帖不存在")
	}
	if p.AuthorID != u.ID {
		_, m, _, err := circleChannelAccess(s, u, p.CircleID, p.ChannelID, false, false)
		if err != nil {
			return nil, err
		}
		if !circleStaff(m.Role) {
			return nil, forbidden("只能删除自己的圈帖或由圈管理处理")
		}
	}
	if p.DeletedAt != nil {
		return map[string]bool{"ok": true}, nil
	}
	now := a.circleNow()
	p.DeletedAt = &now
	p.UpdatedAt = now
	p.Likes = map[string]bool{}
	s.CirclePosts[p.ID] = p
	for id, v := range s.CircleComments {
		if v.PostID == p.ID {
			delete(s.CircleComments, id)
		}
	}
	s.audit(u, "circle.post.delete", p.ID, "circle="+p.CircleID, now)
	return map[string]bool{"ok": true}, nil
}
func writableCircleInteraction(s *State, u *User, r *http.Request) (StoredCirclePost, error) {
	p, _, err := visibleCirclePost(s, u, r.PathValue("id"), r.PathValue("postId"))
	if err != nil {
		return p, err
	}
	if p.Status != "published" {
		return p, forbidden("未发布圈帖暂不可互动")
	}
	_, _, _, err = circleChannelAccess(s, u, p.CircleID, p.ChannelID, true, false)
	return p, err
}
func (a *App) likeCirclePost(s *State, u *User, r *http.Request) (any, error) {
	p, err := writableCircleInteraction(s, u, r)
	if err != nil {
		return nil, err
	}
	var input struct {
		Liked *bool `json:"liked"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	if input.Liked == nil {
		return nil, bad("请提供liked布尔值")
	}
	if p.Likes == nil {
		p.Likes = map[string]bool{}
	}
	if *input.Liked {
		if !p.Likes[u.ID] {
			s.queueNotification("circle-like", u.ID, p.AuthorID, p.ID, "", "circle-like:"+p.ID+":"+u.ID, a.circleNow())
		}
		p.Likes[u.ID] = true
	} else {
		delete(p.Likes, u.ID)
	}
	s.CirclePosts[p.ID] = p
	return s.circlePost(p, u.ID), nil
}
func (a *App) circleComments(s *State, u *User, r *http.Request) (any, error) {
	p, _, err := visibleCirclePost(s, u, r.PathValue("id"), r.PathValue("postId"))
	if err != nil {
		return nil, err
	}
	items := []CircleComment{}
	for _, v := range s.CircleComments {
		if v.PostID == p.ID && matches(r, v.Body) {
			items = append(items, CircleComment{v.ID, v.PostID, publicUser(s.Accounts[v.AuthorID].User), v.Body, v.CreatedAt.UTC()})
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt.Before(items[j].CreatedAt)
	})
	return list(r, items)
}
func (a *App) createCircleComment(s *State, u *User, r *http.Request) (any, error) {
	p, err := writableCircleInteraction(s, u, r)
	if err != nil {
		return nil, err
	}
	var input struct {
		Body string `json:"body"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	body, err := trimText(input.Body, 2000)
	if err != nil {
		return nil, err
	}
	v := StoredCircleComment{ID: newID("ccomment_"), CircleID: p.CircleID, PostID: p.ID, AuthorID: u.ID, Body: body, CreatedAt: a.circleNow()}
	s.CircleComments[v.ID] = v
	s.queueNotification("circle-comment", u.ID, p.AuthorID, p.ID, "", "circle-comment:"+v.ID, v.CreatedAt)
	return CircleComment{v.ID, v.PostID, publicUser(*u), v.Body, v.CreatedAt}, nil
}
