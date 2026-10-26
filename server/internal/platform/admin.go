package platform

import (
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

func (a *App) overview(s *State, _ *User, _ *http.Request) (any, error) {
	pending, hidden := 0, 0
	for _, r := range s.Reports {
		if r.Status == "open" {
			pending++
		}
	}
	for _, p := range s.Posts {
		if p.Status == "hidden" {
			hidden++
		}
	}
	active := map[string]bool{}
	for _, session := range s.Sessions {
		if session.ExpiresAt.After(a.now()) {
			if account, ok := s.Accounts[session.UserID]; ok && account.User.Status == "active" {
				active[session.UserID] = true
			}
		}
	}
	type point struct {
		Date     string `json:"date"`
		Users    int    `json:"users"`
		Posts    int    `json:"posts"`
		Messages int    `json:"messages"`
	}
	series := []point{}
	for day := 6; day >= 0; day-- {
		date := a.now().UTC().AddDate(0, 0, -day).Format("2006-01-02")
		p := point{Date: date}
		for _, account := range s.Accounts {
			if account.User.CreatedAt.UTC().Format("2006-01-02") == date {
				p.Users++
			}
		}
		for _, post := range s.Posts {
			if post.CreatedAt.UTC().Format("2006-01-02") == date {
				p.Posts++
			}
		}
		for _, message := range s.Messages {
			if message.CreatedAt.UTC().Format("2006-01-02") == date {
				p.Messages++
			}
		}
		series = append(series, p)
	}
	recent := append([]Audit{}, s.Audits...)
	newest(recent, func(v Audit) time.Time { return v.CreatedAt })
	if len(recent) > 10 {
		recent = recent[:10]
	}
	return map[string]any{"users": len(s.Accounts), "posts": len(s.Posts), "conversations": len(s.Conversations), "reports": len(s.Reports), "pendingReports": pending, "hiddenPosts": hidden, "dailyActive": len(active), "series": series, "recentActivity": recent}, nil
}
func (a *App) adminUsers(s *State, _ *User, r *http.Request) (any, error) {
	status, err := queryEnum(r, "status", "active", "suspended")
	if err != nil {
		return nil, err
	}
	role, err := queryEnum(r, "role", "member", "moderator", "admin")
	if err != nil {
		return nil, err
	}
	items := []User{}
	for _, account := range s.Accounts {
		u := account.User
		if (status == "" || u.Status == status) && (role == "" || u.Role == role) && matches(r, u.ID+" "+u.Name+" "+u.Email+" "+u.Handle) {
			items = append(items, u)
		}
	}
	newest(items, func(u User) time.Time { return u.CreatedAt })
	return list(r, items)
}
func (a *App) adminUpdateUser(s *State, u *User, r *http.Request) (any, error) {
	account, exists := s.Accounts[r.PathValue("id")]
	if !exists {
		return nil, missing("用户不存在")
	}
	var input struct {
		Status *string `json:"status"`
		Role   *string `json:"role"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	if input.Status == nil && input.Role == nil {
		return nil, bad("请选择要更新的用户状态或角色")
	}
	next := account.User
	if input.Status != nil {
		if *input.Status != "active" && *input.Status != "suspended" {
			return nil, bad("用户状态不正确")
		}
		next.Status = *input.Status
	}
	if input.Role != nil {
		if *input.Role != "member" && *input.Role != "moderator" && *input.Role != "admin" {
			return nil, bad("用户角色不正确")
		}
		next.Role = *input.Role
	}
	if next.ID == u.ID && (next.Status != "active" || next.Role != "admin") {
		return nil, forbidden("不能停用或降级自己的管理员账号")
	}
	if account.User.Role == "admin" && account.User.Status == "active" && (next.Role != "admin" || next.Status != "active") {
		count := 0
		for _, candidate := range s.Accounts {
			if candidate.User.Role == "admin" && candidate.User.Status == "active" {
				count++
			}
		}
		if count <= 1 {
			return nil, conflict("必须保留至少一名可用管理员")
		}
	}
	account.User = next
	s.Accounts[next.ID] = account
	if next.Status != "active" {
		for hash, session := range s.Sessions {
			if session.UserID == next.ID {
				delete(s.Sessions, hash)
			}
		}
	}
	s.audit(u, "user.update", next.ID, "status="+next.Status+", role="+next.Role, a.now())
	return next, nil
}
func (a *App) adminPosts(s *State, u *User, r *http.Request) (any, error) {
	status, err := queryEnum(r, "status", "published", "hidden", "pending")
	if err != nil {
		return nil, err
	}
	items := []Post{}
	for _, p := range s.Posts {
		if (status == "" || p.Status == status) && matches(r, p.ID+" "+p.Body+" "+p.Topic+" "+s.Accounts[p.AuthorID].User.Name+" "+s.Accounts[p.AuthorID].User.Handle) {
			items = append(items, s.post(p, u.ID))
		}
	}
	newest(items, func(p Post) time.Time { return p.CreatedAt })
	return list(r, items)
}
func (a *App) adminUpdatePost(s *State, u *User, r *http.Request) (any, error) {
	p, exists := s.Posts[r.PathValue("id")]
	if !exists {
		return nil, missing("动态不存在")
	}
	var input struct {
		Status string `json:"status"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	if input.Status != "published" && input.Status != "hidden" && input.Status != "pending" {
		return nil, bad("内容状态不正确")
	}
	if input.Status == "published" {
		if _, _, err := a.validatePostMedia(s, p.AuthorID, p.Images, r); err != nil {
			return nil, conflict("动态包含不可发布的托管图片，请先处理图片审核")
		}
	}
	if p.Status != input.Status {
		s.notifyChange("world-review", u.ID, p.AuthorID, p.ID, input.Status, a.now())
	}
	p.Status = input.Status
	s.Posts[p.ID] = p
	s.audit(u, "post.moderate", p.ID, "status="+p.Status, a.now())
	return s.post(p, u.ID), nil
}
func (a *App) adminReports(s *State, _ *User, r *http.Request) (any, error) {
	status, err := queryEnum(r, "status", "open", "resolved", "dismissed")
	if err != nil {
		return nil, err
	}
	items := []Report{}
	for _, report := range s.Reports {
		if (status == "" || report.Status == status) && matches(r, report.Reason+" "+report.TargetID) {
			items = append(items, report)
		}
	}
	newest(items, func(report Report) time.Time { return report.CreatedAt })
	return list(r, items)
}
func (a *App) adminUpdateReport(s *State, u *User, r *http.Request) (any, error) {
	report, exists := s.Reports[r.PathValue("id")]
	if !exists {
		return nil, missing("举报不存在")
	}
	var input struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	if input.Status != "resolved" && input.Status != "dismissed" {
		return nil, bad("举报处理状态不正确")
	}
	if strings.TrimSpace(input.Note) == "" || utf8.RuneCountInString(input.Note) > 1000 {
		return nil, bad("处理备注不能为空且最多 1000 字")
	}
	if report.Status != "open" {
		return nil, conflict("举报已结案，请刷新查看处理结果")
	}
	report.Status = input.Status
	report.Note = strings.TrimSpace(input.Note)
	s.Reports[report.ID] = report
	s.queueNotification("report-review", u.ID, report.ReporterID, report.ID, report.Status, "report-review:"+report.ID, a.now())
	s.audit(u, "report.review", report.ID, "status="+report.Status+", note="+report.Note, a.now())
	return report, nil
}
func (a *App) auditLog(s *State, _ *User, r *http.Request) (any, error) {
	items := []Audit{}
	for _, audit := range s.Audits {
		if matches(r, audit.Action+" "+audit.ActorName+" "+audit.Detail+" "+audit.TargetID) {
			items = append(items, audit)
		}
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	return list(r, items)
}
func (a *App) system(_ *State, _ *User, _ *http.Request) (any, error) {
	return map[string]any{"version": Version, "storage": "PostgreSQL · relational schema v7", "environment": a.cfg.Environment, "uptimeSeconds": int64(time.Since(a.started).Seconds()), "features": []string{"account-notifications", "transactional-notification-events", "permission-aware-notifications", "bounded-read-all", "http-only-sessions", "server-circles", "circle-role-permissions", "hashed-circle-invitations", "circle-moderation", "scoped-circle-media", "private-image-storage", "reviewed-image-posts", "media-moderation", "device-session-revocation", "community-posts", "moderation-audit", "member-conversations", "mutual-friendships", "conversation-membership-management", "cursor-message-history", "domain-sql-messaging", "transactional-websocket-outbox", "revisioned-personal-documents", "atomic-test-ledger", "request-idempotency"}}, nil
}
