package platform

import (
	"net/http"
	"sort"
)

func (s *State) adminCircle(c StoredCircle, viewer string) AdminCircle {
	v := AdminCircle{Circle: s.circle(c, viewer), ModerationNote: c.Note}
	for _, ch := range s.CircleChannels {
		if ch.CircleID == c.ID {
			v.ChannelCount++
		}
	}
	for _, p := range s.CirclePosts {
		if p.CircleID == c.ID && p.DeletedAt == nil {
			v.PostCount++
		}
	}
	return v
}
func (s *State) adminCirclePost(p StoredCirclePost, viewer string) AdminCirclePost {
	return AdminCirclePost{CirclePost: s.circlePost(p, viewer), CircleName: s.Circles[p.CircleID].Name, ChannelName: s.CircleChannels[p.ChannelID].Name, ModerationNote: p.Note}
}
func (a *App) adminCircles(s *State, u *User, r *http.Request) (any, error) {
	status, err := queryEnum(r, "status", "active", "suspended", "archived")
	if err != nil {
		return nil, err
	}
	items := []AdminCircle{}
	for _, c := range s.Circles {
		owner := s.Accounts[c.OwnerID].User
		if (status == "" || c.Status == status) && matches(r, c.ID+" "+c.Name+" "+c.Description+" "+owner.ID+" "+owner.Handle) {
			items = append(items, s.adminCircle(c, u.ID))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})
	return list(r, items)
}
func (a *App) adminUpdateCircle(s *State, u *User, r *http.Request) (any, error) {
	c, ok := s.Circles[r.PathValue("id")]
	if !ok {
		return nil, missing("圈子不存在")
	}
	var input struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	if input.Status != "active" && input.Status != "suspended" {
		return nil, bad("圈子平台治理状态不正确")
	}
	note, err := trimText(input.Note, 1000)
	if err != nil {
		return nil, err
	}
	if c.Status == "archived" {
		return nil, conflict("圈主已归档，平台不能代替圈主解除归档")
	}
	c.Status = input.Status
	c.Note = note
	c.UpdatedAt = a.circleNow()
	s.Circles[c.ID] = c
	s.audit(u, "circle.govern", c.ID, "status="+c.Status+", note="+note, a.circleNow())
	return s.adminCircle(c, u.ID), nil
}
func (a *App) adminCirclePosts(s *State, u *User, r *http.Request) (any, error) {
	status, err := queryEnum(r, "status", "published", "pending", "hidden")
	if err != nil {
		return nil, err
	}
	circleID := r.URL.Query().Get("circleId")
	items := []AdminCirclePost{}
	for _, p := range s.CirclePosts {
		author := s.Accounts[p.AuthorID].User
		if p.DeletedAt == nil && (status == "" || p.Status == status) && (circleID == "" || p.CircleID == circleID) && matches(r, p.ID+" "+p.CircleID+" "+p.Title+" "+p.Body+" "+author.Handle+" "+author.Name+" "+s.Circles[p.CircleID].Name) {
			items = append(items, s.adminCirclePost(p, u.ID))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})
	return list(r, items)
}
func (a *App) adminUpdateCirclePost(s *State, u *User, r *http.Request) (any, error) {
	p, ok := s.CirclePosts[r.PathValue("id")]
	if !ok || p.DeletedAt != nil {
		return nil, missing("圈帖不存在")
	}
	var input struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	if input.Status != "published" && input.Status != "pending" && input.Status != "hidden" {
		return nil, bad("圈帖平台治理状态不正确")
	}
	note, err := trimText(input.Note, 1000)
	if err != nil {
		return nil, err
	}
	if input.Status == "published" {
		c := s.Circles[p.CircleID]
		ch := s.CircleChannels[p.ChannelID]
		if c.Status != "active" || ch.Archived {
			return nil, conflict("暂停/归档圈子或归档频道不能发布圈帖")
		}
		if _, err = validateCirclePostMedia(s, p.CircleID, p.AuthorID, p.Images); err != nil {
			return nil, conflict("圈帖包含不可用或跨圈图片")
		}
	}
	p.Status = input.Status
	p.Note = note
	p.UpdatedAt = a.circleNow()
	s.CirclePosts[p.ID] = p
	s.audit(u, "circle.post.govern", p.ID, "status="+p.Status+", note="+note, a.circleNow())
	return s.adminCirclePost(p, u.ID), nil
}
