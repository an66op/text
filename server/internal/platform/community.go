package platform

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

func (a *App) posts(s *State, u *User, r *http.Request) (any, error) {
	items := []Post{}
	viewer := ""
	if u != nil {
		viewer = u.ID
	}
	topic := strings.TrimSpace(r.URL.Query().Get("topic"))
	if utf8.RuneCountInString(topic) > 40 {
		return nil, bad("话题筛选最多 40 字")
	}
	for _, p := range s.Posts {
		if p.Status == "published" && (topic == "" || p.Topic == topic) && matches(r, p.Body+" "+p.Topic+" "+s.Accounts[p.AuthorID].User.Name) {
			items = append(items, s.post(p, viewer))
		}
	}
	newest(items, func(p Post) time.Time { return p.CreatedAt })
	return list(r, items)
}
func visiblePost(s *State, id string, u *User) (StoredPost, error) {
	p, exists := s.Posts[id]
	if !exists {
		return p, missing("动态不存在")
	}
	if p.Status != "published" && !staff(u) && (u == nil || p.AuthorID != u.ID) {
		return p, missing("动态不存在或暂不可见")
	}
	return p, nil
}
func (a *App) postDetail(s *State, u *User, r *http.Request) (any, error) {
	p, err := visiblePost(s, r.PathValue("id"), u)
	if err != nil {
		return nil, err
	}
	viewer := ""
	if u != nil {
		viewer = u.ID
	}
	return s.post(p, viewer), nil
}
func (a *App) createPost(s *State, u *User, r *http.Request) (any, error) {
	var input struct {
		Body   string   `json:"body"`
		Images []string `json:"images"`
		Topic  string   `json:"topic"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	body, err := trimText(input.Body, 5000)
	if err != nil {
		return nil, err
	}
	if len(input.Images) > 9 || utf8.RuneCountInString(input.Topic) > 40 {
		return nil, bad("最多 9 张图片，话题最多 40 字")
	}
	for _, image := range input.Images {
		if image == "" || !validImage(image) {
			return nil, bad("图片必须为有效的 http(s) 地址")
		}
	}
	if input.Images == nil {
		input.Images = []string{}
	}
	p := StoredPost{newID("post_"), u.ID, body, input.Images, strings.TrimSpace(input.Topic), "published", a.now(), map[string]bool{}}
	s.Posts[p.ID] = p
	return s.post(p, u.ID), nil
}
func (a *App) deletePost(s *State, u *User, r *http.Request) (any, error) {
	p, exists := s.Posts[r.PathValue("id")]
	if !exists {
		return nil, missing("动态不存在")
	}
	if p.AuthorID != u.ID && u.Role != "admin" {
		return nil, forbidden("只能删除自己的动态")
	}
	delete(s.Posts, p.ID)
	for id, c := range s.Comments {
		if c.PostID == p.ID {
			delete(s.Comments, id)
		}
	}
	if p.AuthorID != u.ID {
		s.audit(u, "post.delete", p.ID, "管理员删除动态", a.now())
	}
	return map[string]bool{"ok": true}, nil
}
func (a *App) likePost(s *State, u *User, r *http.Request) (any, error) {
	p, err := visiblePost(s, r.PathValue("id"), u)
	if err != nil {
		return nil, err
	}
	if p.Status != "published" {
		return nil, forbidden("此动态暂不可互动")
	}
	var input struct {
		Liked *bool `json:"liked"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	if input.Liked == nil {
		return nil, bad("请提供 liked 布尔值")
	}
	if p.Likes == nil {
		p.Likes = map[string]bool{}
	}
	if *input.Liked {
		p.Likes[u.ID] = true
	} else {
		delete(p.Likes, u.ID)
	}
	s.Posts[p.ID] = p
	return s.post(p, u.ID), nil
}
func (a *App) comments(s *State, u *User, r *http.Request) (any, error) {
	p, err := visiblePost(s, r.PathValue("id"), u)
	if err != nil {
		return nil, err
	}
	items := []Comment{}
	for _, c := range s.Comments {
		if c.PostID == p.ID {
			items = append(items, Comment{c.ID, c.PostID, publicUser(s.Accounts[c.AuthorID].User), c.Body, c.CreatedAt})
		}
	}
	newest(items, func(c Comment) time.Time { return c.CreatedAt })
	return list(r, items)
}
func (a *App) createComment(s *State, u *User, r *http.Request) (any, error) {
	p, err := visiblePost(s, r.PathValue("id"), u)
	if err != nil {
		return nil, err
	}
	if p.Status != "published" {
		return nil, forbidden("此动态暂不可评论")
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
	c := StoredComment{newID("comment_"), p.ID, u.ID, body, a.now()}
	s.Comments[c.ID] = c
	return Comment{c.ID, c.PostID, publicUser(*u), c.Body, c.CreatedAt}, nil
}
func (a *App) report(s *State, u *User, r *http.Request) (any, error) {
	var input struct {
		TargetType string `json:"targetType"`
		TargetID   string `json:"targetId"`
		Reason     string `json:"reason"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	reason, err := trimText(input.Reason, 1000)
	if err != nil {
		return nil, err
	}
	switch input.TargetType {
	case "post":
		if _, err = visiblePost(s, input.TargetID, u); err != nil {
			return nil, err
		}
	case "user":
		if _, exists := s.Accounts[input.TargetID]; !exists {
			return nil, missing("被举报用户不存在")
		}
	default:
		return nil, bad("不支持的举报类型")
	}
	for _, report := range s.Reports {
		if report.ReporterID == u.ID && report.TargetID == input.TargetID && report.TargetType == input.TargetType && report.Status == "open" {
			return nil, conflict("你已提交此内容的举报，请等待处理")
		}
	}
	report := Report{newID("report_"), u.ID, input.TargetType, input.TargetID, reason, "open", "", a.now()}
	s.Reports[report.ID] = report
	return report, nil
}
