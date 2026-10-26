package platform

import (
	"context"
	"net/http"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

func hashPassword(password string, cost int) string {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), cost)
	if err != nil {
		panic(err)
	}
	return string(hash)
}
func validPassword(password string) bool {
	return len(password) <= 72 && utf8.RuneCountInString(password) >= 10
}
func validEmail(value string) bool {
	email, err := mail.ParseAddress(value)
	return err == nil && email.Address == value && len(value) <= 254
}
func (a *App) newSession(s *State, user User, userAgent string) (string, time.Time) {
	now := a.now().UTC().Truncate(time.Microsecond)
	for hash, session := range s.Sessions {
		if !session.ExpiresAt.After(now) {
			delete(s.Sessions, hash)
		}
	}
	token := newID("") + newID("")
	expires := now.Add(a.cfg.SessionTTL)
	created, seen := now, now
	s.Sessions[tokenHash(token)] = Session{UserID: user.ID, ExpiresAt: expires, ID: newID("session_"), Device: sessionDevice(userAgent), CreatedAt: &created, LastSeenAt: &seen, Legacy: false}
	return token, expires
}
func (a *App) register(w http.ResponseWriter, r *http.Request) {
	if !a.limiter.allow("register:"+clientIP(r), 6, time.Hour, a.now()) {
		writeError(w, &APIError{429, "rate_limited", "注册过于频繁，请稍后再试"})
		return
	}
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
		Handle   string `json:"handle"`
	}
	if err := decode(r, &input); err != nil {
		writeError(w, err)
		return
	}
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	input.Handle = strings.ToLower(strings.TrimSpace(input.Handle))
	name, err := trimText(input.Name, 40)
	if err != nil || !validEmail(input.Email) || !handlePattern.MatchString(input.Handle) || !validPassword(input.Password) {
		writeError(w, bad("请填写有效邮箱、3–30 位英文用户名，以及 10–72 字节密码"))
		return
	}
	passwordHash := hashPassword(input.Password, a.cfg.BcryptCost)
	var token string
	var expires time.Time
	result, err := a.execute(r, true, "", func(s *State, _ *User) (any, error) {
		for _, account := range s.Accounts {
			if account.User.Email == input.Email || account.User.Handle == input.Handle {
				return nil, conflict("邮箱或用户名已被使用")
			}
		}
		u := User{ID: newID("user_"), Handle: input.Handle, Name: name, Email: input.Email, Avatar: "", Bio: "", Role: "member", Status: "active", CreatedAt: a.now()}
		s.Accounts[u.ID] = Account{u, passwordHash}
		token, expires = a.newSession(s, u, r.UserAgent())
		return map[string]any{"user": u, "expiresAt": expires}, nil
	})
	if err != nil {
		writeError(w, err)
		return
	}
	a.setSessionCookie(w, token, expires)
	writeJSON(w, 201, result)
}
func (a *App) login(w http.ResponseWriter, r *http.Request) {
	if !a.limiter.allow("login:"+clientIP(r), 15, 15*time.Minute, a.now()) {
		w.Header().Set("Retry-After", "900")
		writeError(w, &APIError{429, "rate_limited", "登录尝试过多，请 15 分钟后再试"})
		return
	}
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decode(r, &input); err != nil {
		writeError(w, err)
		return
	}
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	if !validEmail(input.Email) || len(input.Password) > 72 {
		writeError(w, bad("邮箱或密码格式不正确"))
		return
	}
	var token string
	var expires time.Time
	result, err := a.execute(r, true, "", func(s *State, _ *User) (any, error) {
		var account Account
		for _, candidate := range s.Accounts {
			if candidate.User.Email == input.Email {
				account = candidate
				break
			}
		}
		hash := account.PasswordHash
		if hash == "" {
			hash = a.dummyHash
		}
		compare := bcrypt.CompareHashAndPassword([]byte(hash), []byte(input.Password))
		if compare != nil || account.User.ID == "" {
			return nil, &APIError{401, "invalid_credentials", "邮箱或密码不正确"}
		}
		if account.User.Status != "active" {
			return nil, forbidden("此账号已停用，请联系平台运营")
		}
		token, expires = a.newSession(s, account.User, r.UserAgent())
		return map[string]any{"user": account.User, "expiresAt": expires}, nil
	})
	if err != nil {
		writeError(w, err)
		return
	}
	a.setSessionCookie(w, token, expires)
	writeJSON(w, 200, result)
}
func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	_, err := a.execute(r, true, "", func(s *State, _ *User) (any, error) {
		if cookie, e := r.Cookie(cookieName); e == nil {
			delete(s.Sessions, tokenHash(cookie.Value))
		}
		return nil, nil
	})
	if err != nil {
		writeError(w, err)
		return
	}
	a.clearSessionCookie(w)
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *App) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Path: "/api/v1", MaxAge: -1, HttpOnly: true, Secure: a.cfg.CookieSecure, SameSite: http.SameSiteLaxMode})
}
func (a *App) me(s *State, u *User, r *http.Request) (any, error) {
	cookie, _ := r.Cookie(cookieName)
	return map[string]any{"user": u, "expiresAt": s.Sessions[tokenHash(cookie.Value)].ExpiresAt}, nil
}
func (a *App) updateMe(s *State, u *User, r *http.Request) (any, error) {
	var input struct {
		Name   *string `json:"name"`
		Bio    *string `json:"bio"`
		Avatar *string `json:"avatar"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	if input.Name == nil && input.Bio == nil && input.Avatar == nil {
		return nil, bad("请选择要更新的资料")
	}
	account := s.Accounts[u.ID]
	if input.Name != nil {
		value, err := trimText(*input.Name, 40)
		if err != nil {
			return nil, err
		}
		account.User.Name = value
	}
	if input.Bio != nil {
		if utf8.RuneCountInString(*input.Bio) > 200 {
			return nil, bad("简介最多 200 字")
		}
		account.User.Bio = strings.TrimSpace(*input.Bio)
	}
	if input.Avatar != nil {
		if !validImage(*input.Avatar) {
			return nil, bad("头像必须为 http(s) 地址")
		}
		account.User.Avatar = *input.Avatar
	}
	s.Accounts[u.ID] = account
	return account.User, nil
}
func (a *App) SeedDevelopment(ctx context.Context) error {
	if a.cfg.Environment != "development" {
		return forbidden("仅开发环境允许种子数据")
	}
	demoHash := hashPassword("Demo2026!", a.cfg.BcryptCost)
	adminHash := hashPassword("Admin2026!", a.cfg.BcryptCost)
	return a.store.Update(ctx, func(s *State) error {
		if len(s.Accounts) > 0 {
			return nil
		}
		now := a.now()
		demo := User{"user_demo", "demo", "林见夏", "demo@gongming.local", "https://i.pravatar.cc/160?img=47", "把有趣的人和生活，聚在一起。", "member", "active", now.Add(-72 * time.Hour)}
		admin := User{"user_admin", "gongming", "共鸣团队", "admin@gongming.local", "https://i.pravatar.cc/160?img=12", "和你一起建设共鸣。", "admin", "active", now.Add(-96 * time.Hour)}
		friend := User{"user_friend", "zhouye", "周野", "zhouye@gongming.local", "https://i.pravatar.cc/160?img=13", "周末去山野，平日写代码。", "member", "active", now.Add(-48 * time.Hour)}
		s.Accounts[demo.ID] = Account{demo, demoHash}
		s.Accounts[admin.ID] = Account{admin, adminHash}
		s.Accounts[friend.ID] = Account{friend, hashPassword(newID(""), a.cfg.BcryptCost)}
		for _, p := range []StoredPost{{"post_welcome", admin.ID, "欢迎来到共鸣。这里的动态、消息、举报和测试资产已经连接同一套服务，试着发出你的第一条动态。", []string{}, "共鸣公告", "published", now.Add(-24 * time.Hour), map[string]bool{demo.ID: true}}, {"post_weekend", friend.ID, "本周末约一个城市漫游：从独立书店到河边咖啡馆，想认识同频的新朋友。", []string{"https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1000&auto=format&fit=crop"}, "城市生活", "published", now.Add(-3 * time.Hour), map[string]bool{demo.ID: true, admin.ID: true}}, {"post_design", demo.ID, "做一个打开就想停留的社交空间。今天的灵感来自光、留白，还有与你的每一次对话。", []string{}, "设计灵感", "published", now.Add(-time.Hour), map[string]bool{}}, {"post_review", friend.ID, "这是一条待审核的演示内容，用于后台体验审核操作。", []string{}, "产品体验", "pending", now.Add(-30 * time.Minute), map[string]bool{}}} {
			s.Posts[p.ID] = p
		}
		s.Comments["comment_welcome"] = StoredComment{"comment_welcome", "post_welcome", demo.ID, "新的故事，从这里开始。", now.Add(-20 * time.Hour)}
		for _, c := range []StoredConversation{{"conversation_direct", "与周野的私聊", "direct", []string{demo.ID, friend.ID}, demo.ID, now.Add(-48 * time.Hour)}, {"conversation_group", "共鸣 · 周末出走", "group", []string{demo.ID, admin.ID, friend.ID}, admin.ID, now.Add(-24 * time.Hour)}, {"conversation_channel", "共鸣动态", "channel", []string{demo.ID, admin.ID, friend.ID}, admin.ID, now.Add(-24 * time.Hour)}} {
			s.Conversations[c.ID] = c
		}
		for _, m := range []StoredMessage{
			{ID: "message_direct", ConversationID: "conversation_direct", SenderID: friend.ID, Body: "周末要不要一起逛书店？", CreatedAt: now.Add(-12 * time.Minute), Seq: 1},
			{ID: "message_group", ConversationID: "conversation_group", SenderID: admin.ID, Body: "欢迎来到周末出走群，分享一下你的城市计划吧。", CreatedAt: now.Add(-30 * time.Minute), Seq: 1},
			{ID: "message_channel", ConversationID: "conversation_channel", SenderID: admin.ID, Body: "共鸣频道已上线。公告由频道主发布，订阅者可以在社区继续讨论。", CreatedAt: now.Add(-time.Hour), Seq: 1},
		} {
			s.Messages[m.ID] = m
		}
		s.Reports["report_demo"] = Report{"report_demo", demo.ID, "post", "post_review", "演示审核流程，请检查内容是否符合社区规则。", "open", "", now.Add(-10 * time.Minute)}
		a.seedDevelopmentCircles(s)
		a.seedDevelopmentCircleEvents(s)
		s.audit(&admin, "system.seed", "development", "开发环境示例数据初始化", now)
		return nil
	})
}
func (a *App) CheckProductionData(ctx context.Context) error {
	if a.cfg.Environment != "production" {
		return nil
	}
	return a.store.Read(ctx, func(s *State) error {
		for _, account := range s.Accounts {
			if account.User.ID == "user_demo" || account.User.ID == "user_admin" {
				return forbidden("生产环境拒绝开发种子数据库，请使用独立数据库")
			}
		}
		return nil
	})
}
func (a *App) BootstrapAdmin(ctx context.Context, email, password, handle string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" && password == "" && handle == "" {
		return nil
	}
	if !validEmail(email) || !handlePattern.MatchString(handle) || len(password) < 16 || len(password) > 72 || strings.HasSuffix(email, "@gongming.local") || password == "Admin2026!" {
		return bad("bootstrap 管理员需真实邮箱、合法handle和16–72字节独立密码")
	}
	hash := hashPassword(password, a.cfg.BcryptCost)
	return a.store.Update(ctx, func(s *State) error {
		for _, account := range s.Accounts {
			if account.User.Email == email {
				if account.User.Role == "admin" && account.User.Status == "active" {
					return nil
				}
				return conflict("bootstrap 邮箱已由非管理员使用")
			}
			if account.User.Handle == handle {
				return conflict("bootstrap handle 已被使用")
			}
		}
		if len(s.Accounts) > 0 {
			return conflict("仅空数据库允许 bootstrap 管理员")
		}
		u := User{ID: newID("user_"), Handle: handle, Name: "平台管理员", Email: email, Role: "admin", Status: "active", CreatedAt: a.now()}
		s.Accounts[u.ID] = Account{u, hash}
		s.audit(&u, "system.bootstrap", u.ID, "初始化平台管理员", a.now())
		return nil
	})
}
