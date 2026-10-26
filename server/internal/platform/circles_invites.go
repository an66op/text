package platform

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"sort"
	"time"
)

func (a *App) validCircleInvite(s *State, token string) (StoredCircleInvite, error) {
	if len(token) != 64 {
		return StoredCircleInvite{}, missing("邀请无效或已失效")
	}
	if _, err := hex.DecodeString(token); err != nil {
		return StoredCircleInvite{}, missing("邀请无效或已失效")
	}
	hash := tokenHash(token)
	for _, v := range s.CircleInvites {
		if v.TokenHash == hash {
			c, ok := s.Circles[v.CircleID]
			if ok && c.Status == "active" && v.RevokedAt == nil && v.ExpiresAt.After(a.now()) && v.Uses < v.MaxUses {
				return v, nil
			}
			break
		}
	}
	return StoredCircleInvite{}, missing("邀请无效或已失效")
}
func (a *App) createCircleInvite(s *State, u *User, r *http.Request) (any, error) {
	c, _, err := circleAccess(s, u, r.PathValue("id"), true, true)
	if err != nil {
		return nil, err
	}
	var input struct {
		ExpiresInHours *int `json:"expiresInHours"`
		MaxUses        *int `json:"maxUses"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	hours, uses := 72, 20
	if input.ExpiresInHours != nil {
		hours = *input.ExpiresInHours
	}
	if input.MaxUses != nil {
		uses = *input.MaxUses
	}
	if hours < 1 || hours > 168 || uses < 1 || uses > 100 {
		return nil, bad("邀请有效期1–168小时、次数1–100")
	}
	raw := make([]byte, 32)
	if _, err = rand.Read(raw); err != nil {
		return nil, err
	}
	token := hex.EncodeToString(raw)
	now := a.circleNow()
	v := StoredCircleInvite{ID: newID("cinvite_"), CircleID: c.ID, CreatorID: u.ID, TokenHash: tokenHash(token), MaxUses: uses, ExpiresAt: now.Add(time.Duration(hours) * time.Hour), CreatedAt: now}
	s.CircleInvites[v.ID] = v
	s.audit(u, "circle.invite.create", v.ID, "circle="+c.ID, a.circleNow())
	return struct {
		CircleInvite
		Token string `json:"token"`
	}{circleInvite(v), token}, nil
}
func (a *App) circleInvites(s *State, u *User, r *http.Request) (any, error) {
	c, _, err := circleAccess(s, u, r.PathValue("id"), false, true)
	if err != nil {
		return nil, err
	}
	items := []CircleInvite{}
	for _, v := range s.CircleInvites {
		if v.CircleID == c.ID {
			items = append(items, circleInvite(v))
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
func (a *App) revokeCircleInvite(s *State, u *User, r *http.Request) (any, error) {
	c, _, err := circleAccess(s, u, r.PathValue("id"), true, true)
	if err != nil {
		return nil, err
	}
	v, ok := s.CircleInvites[r.PathValue("inviteId")]
	if !ok || v.CircleID != c.ID {
		return nil, missing("邀请不存在")
	}
	if v.RevokedAt != nil {
		return map[string]bool{"ok": true}, nil
	}
	now := a.circleNow()
	v.RevokedAt = &now
	s.CircleInvites[v.ID] = v
	s.audit(u, "circle.invite.revoke", v.ID, "circle="+c.ID, now)
	return map[string]bool{"ok": true}, nil
}
func (a *App) previewCircleInvite(s *State, u *User, r *http.Request) (any, error) {
	var input struct {
		Token string `json:"token"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	v, err := a.validCircleInvite(s, input.Token)
	if err != nil {
		return nil, err
	}
	return s.circle(s.Circles[v.CircleID], u.ID), nil
}
