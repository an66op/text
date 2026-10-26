package platform

import (
	"net/http"
)

func (a *App) routes(mux *http.ServeMux) {
	a.registerConversationManagementRoutes(mux)
	a.registerFriendshipRoutes(mux)
	mux.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		if err := a.store.Ping(r.Context()); err != nil {
			writeError(w, &APIError{503, "unavailable", "服务暂时不可用"})
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /api/v1/auth/register", a.register)
	mux.HandleFunc("POST /api/v1/auth/login", a.login)
	mux.HandleFunc("POST /api/v1/auth/logout", a.logout)
	mux.HandleFunc("GET /api/v1/auth/me", a.endpoint(false, "member", a.me))
	mux.HandleFunc("PATCH /api/v1/me", a.endpoint(true, "member", a.updateMe))
	mux.HandleFunc("GET /api/v1/posts", a.endpoint(false, "", a.posts))
	mux.HandleFunc("POST /api/v1/posts", a.endpoint(true, "member", a.createPost))
	mux.HandleFunc("GET /api/v1/posts/{id}", a.endpoint(false, "", a.postDetail))
	mux.HandleFunc("DELETE /api/v1/posts/{id}", a.endpoint(true, "member", a.deletePost))
	mux.HandleFunc("POST /api/v1/posts/{id}/like", a.endpoint(true, "member", a.likePost))
	mux.HandleFunc("GET /api/v1/posts/{id}/comments", a.endpoint(false, "", a.comments))
	mux.HandleFunc("POST /api/v1/posts/{id}/comments", a.endpoint(true, "member", a.createComment))
	mux.HandleFunc("POST /api/v1/reports", a.endpoint(true, "member", a.report))
	mux.HandleFunc("GET /api/v1/conversations", a.endpoint(false, "member", a.conversations))
	mux.HandleFunc("POST /api/v1/conversations", a.endpoint(true, "member", a.createConversation))
	mux.HandleFunc("GET /api/v1/conversations/{id}/messages", a.endpoint(false, "member", a.messages))
	mux.HandleFunc("POST /api/v1/conversations/{id}/messages", a.endpoint(true, "member", a.sendMessage))
	mux.HandleFunc("POST /api/v1/conversations/{id}/read", a.endpoint(true, "member", a.readConversation))
	mux.HandleFunc("GET /api/v1/stream", a.stream)
	mux.HandleFunc("GET /api/v1/directory", a.endpoint(false, "member", a.directory))
	mux.HandleFunc("GET /api/v1/users/{handle}", a.endpoint(false, "member", a.userProfile))
	mux.HandleFunc("GET /api/v1/documents", a.endpoint(false, "member", a.documents))
	mux.HandleFunc("PUT /api/v1/documents/{key}", a.endpoint(true, "member", a.putDocument))
	mux.HandleFunc("GET /api/v1/admin/overview", a.endpoint(false, "staff", a.overview))
	mux.HandleFunc("GET /api/v1/admin/users", a.endpoint(false, "staff", a.adminUsers))
	mux.HandleFunc("PATCH /api/v1/admin/users/{id}", a.endpoint(true, "admin", a.adminUpdateUser))
	mux.HandleFunc("GET /api/v1/admin/posts", a.endpoint(false, "staff", a.adminPosts))
	mux.HandleFunc("PATCH /api/v1/admin/posts/{id}", a.endpoint(true, "staff", a.adminUpdatePost))
	mux.HandleFunc("GET /api/v1/admin/reports", a.endpoint(false, "staff", a.adminReports))
	mux.HandleFunc("PATCH /api/v1/admin/reports/{id}", a.endpoint(true, "staff", a.adminUpdateReport))
	mux.HandleFunc("GET /api/v1/admin/audit", a.endpoint(false, "staff", a.auditLog))
	mux.HandleFunc("GET /api/v1/admin/system", a.endpoint(false, "staff", a.system))
	mux.HandleFunc("GET /api/v1/wallet", a.endpoint(false, "member", a.wallet))
	mux.HandleFunc("POST /api/v1/wallet/faucet", a.endpoint(true, "member", a.faucet))
	mux.HandleFunc("POST /api/v1/wallet/transfer", a.endpoint(true, "member", a.transfer))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, missing("接口不存在或不支持此方法"))
	})
}
