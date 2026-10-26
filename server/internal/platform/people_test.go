package platform

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthorFeedDoesNotExposeOtherAuthorsOrPendingPosts(t *testing.T) {
	_, _, handler := fixture(t)
	result := call(t, handler, "GET", "/posts?author=zhouye", nil, nil)
	requireCode(t, result, 200)
	data := payload[struct {
		Items []Post `json:"items"`
	}](t, result)
	if len(data.Items) != 1 || data.Items[0].ID != "post_weekend" {
		t.Fatalf("author filter leaked unexpected posts: %+v", data.Items)
	}
	for _, post := range data.Items {
		if post.Author.Handle != "zhouye" || post.Status != "published" {
			t.Fatal("invalid author feed")
		}
	}
	requireCode(t, call(t, handler, "GET", "/posts?author=not-valid!", nil, nil), 400)
}
func TestStaleAccountCannotLogoutCurrentCookie(t *testing.T) {
	_, _, handler := fixture(t)
	cookie := adminCookie(t, handler)
	request := httptest.NewRequest("POST", "http://localhost:8080/api/v1/auth/logout", bytes.NewReader(nil))
	request.Header.Set("Origin", "http://localhost:5173")
	request.Header.Set("X-Gongming-Account", "user_demo")
	request.AddCookie(cookie)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != 409 {
		t.Fatalf("stale logout status %d", recorder.Code)
	}
	if len(recorder.Result().Cookies()) != 0 {
		t.Fatal("stale logout cleared the current cookie")
	}
	requireCode(t, call(t, handler, http.MethodGet, "/auth/me", nil, cookie), 200)
	requireCode(t, call(t, handler, http.MethodGet, "/stream?account=user_demo", nil, cookie), 409)
}
