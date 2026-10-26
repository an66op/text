package platform

import (
	"bytes"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestMessageMediaPostgresNonmemberStaffAndLargeLegacyUploadPath(t *testing.T) {
	_, _, _, _, h := postgresMediaFixture(t)
	cookie := memberCookie(t, h)
	admin := adminCookie(t, h)
	c := payload[Conversation](t, call(t, h, "POST", "/conversations", map[string]any{"title": "private room", "kind": "group", "memberIds": []string{"user_friend"}}, cookie))
	body, ct := multipartMedia(t, append(testMediaPNG(t), make([]byte, 2*1024*1024)...), "legacy-large-chat-upload", false)
	r := httptest.NewRequest("POST", "http://localhost:8080/api/v1/conversations/"+c.ID+"/media/images", bytes.NewReader(body))
	r.Header.Set("Content-Type", ct)
	r.Header.Set("Origin", "http://localhost:5173")
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	var result struct{ Data MediaAsset }
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	asset := result.Data
	message := call(t, h, "POST", "/conversations/"+c.ID+"/messages", map[string]any{"clientId": "private-room-message", "imageIds": []string{asset.ID}}, cookie)
	requireCode(t, message, 200)
	for _, method := range []string{"GET", "HEAD"} {
		if readMedia(t, h, method, asset.URL, admin).Code != 404 {
			t.Fatal("global staff accessed private conversation image")
		}
	}
	// The actual legacy seed route must also bypass the 1MiB JSON body limit.
	r = httptest.NewRequest("POST", "http://localhost:8080/api/v1/conversations/conversation_group/media/images", bytes.NewReader(body))
	r.Header.Set("Content-Type", ct)
	r.Header.Set("Origin", "http://localhost:5173")
	r.AddCookie(cookie)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 409 {
		t.Fatal("legacy path body limit or global clientId collision", w.Code, w.Body.String())
	}
}
func TestMessageMediaPostgresStateGovernanceAndSendInteroperate(t *testing.T) {
	ctx, s, _, _, h := postgresMediaFixture(t)
	cookie := memberCookie(t, h)
	asset := chatImage(t, h, cookie, "stale-governance-upload")
	entered, release := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	var callbacks atomic.Int32
	go func() {
		done <- s.Update(ctx, func(state *State) error {
			if callbacks.Add(1) == 1 {
				close(entered)
				<-release
			}
			v := state.Media[asset.ID]
			v.Status = "blocked"
			state.Media[v.ID] = v
			return nil
		})
	}()
	<-entered
	m := richMessage(t, h, cookie, map[string]any{"clientId": "stale-governance-send", "imageIds": []string{asset.ID}})
	close(release)
	if e := <-done; e != nil {
		t.Fatal(e)
	}
	if callbacks.Load() < 2 {
		t.Fatal("old snapshot did not retry against newly linked message")
	}
	next := getRichMessage(t, h, cookie, m.ID)
	if next.Revision != 2 || next.Images[0].Available {
		t.Fatal("committed message missed availability mutation", next)
	}
}
func TestMessageMediaPostgresNoopUpdateCannotPermitAttachmentAppend(t *testing.T) {
	ctx, s, _, _, h := postgresMediaFixture(t)
	cookie := memberCookie(t, h)
	asset := chatImage(t, h, cookie, "identity-append-upload")
	m := richMessage(t, h, cookie, map[string]any{"body": "accepted text", "clientId": "identity-append-message"})
	tx, e := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(ctx)
	var before, after string
	if e = tx.QueryRow(ctx, `SELECT xmin::text FROM gongming_messages WHERE id=$1`, m.ID).Scan(&before); e != nil {
		t.Fatal(e)
	}
	if _, e = tx.Exec(ctx, `UPDATE gongming_messages SET body=body WHERE id=$1`, m.ID); e != nil {
		t.Fatal(e)
	}
	if e = tx.QueryRow(ctx, `SELECT xmin::text FROM gongming_messages WHERE id=$1`, m.ID).Scan(&after); e != nil || before != after {
		t.Fatal("noop rewrote identity", before, after, e)
	}
	_, e = tx.Exec(ctx, `INSERT INTO gongming_message_media(message_id,media_id,position) VALUES($1,$2,0)`, m.ID, asset.ID)
	expectDatabaseCode(t, e, "23514")
}
func TestMessageMediaPostgresRetractionKeepsUnreadAndLastSequenceConsistent(t *testing.T) {
	_, _, _, _, h := postgresMediaFixture(t)
	cookie := memberCookie(t, h)
	admin := adminCookie(t, h)
	first := richMessage(t, h, cookie, map[string]any{"body": "first", "clientId": "unread-first-message"})
	last := richMessage(t, h, cookie, map[string]any{"body": "last", "clientId": "unread-last-message"})
	requireCode(t, call(t, h, "DELETE", "/me/messages/"+last.ID, nil, cookie), 200)
	detail := payload[struct{ Conversation Conversation }](t, call(t, h, "GET", "/conversations/conversation_group", nil, admin))
	if detail.Conversation.UnreadCount != 1 || detail.Conversation.LastMessage == nil || detail.Conversation.LastMessage.ID != last.ID || detail.Conversation.LastMessage.Status != "retracted" {
		t.Fatal(detail)
	}
	mark := payload[ReadReceipt](t, call(t, h, "POST", "/conversations/conversation_group/read", map[string]string{"messageId": last.ID}, admin))
	if mark.ReadSeq != last.Seq || mark.UnreadCount != 0 {
		t.Fatal(mark)
	}
	page := payload[struct {
		Items           []Message
		MutationVersion int64
	}](t, call(t, h, "GET", "/conversations/conversation_group/messages?afterSeq=1", nil, cookie))
	if page.MutationVersion != 1 || len(page.Items) != 2 || page.Items[0].ID != first.ID || page.Items[1].ID != last.ID {
		t.Fatal(page)
	}
}
func TestMessageMediaPostgresMyUploadsRetainsBlindCircleAuthorCleanup(t *testing.T) {
	ctx, s, _, _, h := postgresMediaFixture(t)
	owner := memberCookie(t, h)
	person, author := circleUser(t, h, "v10circleauthor")
	for _, mode := range []string{"left", "removed", "staff"} {
		t.Run(mode, func(t *testing.T) {
			c := createdCircle(t, h, owner, "public", "open")
			base := "/circles/" + c.ID
			requireCode(t, call(t, h, "POST", base+"/join", map[string]any{}, author), 200)
			ch := circleFirstChannel(t, h, author, c.ID)
			upload := uploadCircleImage(t, h, c.ID, testMediaPNG(t), "v10-cleanup-"+mode, author)
			requireCode(t, upload, 200)
			asset := payload[MediaAsset](t, upload)
			p := circleCreatedPost(t, h, author, c.ID, ch.ID, []string{asset.URL})
			switch mode {
			case "left":
				requireCode(t, call(t, h, "POST", base+"/leave", map[string]any{}, author), 200)
			case "removed":
				requireCode(t, call(t, h, "POST", base+"/members/"+person.ID+"/remove", map[string]bool{"ban": false}, owner), 200)
			case "staff":
				requireCode(t, call(t, h, "PATCH", base+"/channels/"+ch.ID, map[string]string{"access": "staff"}, owner), 200)
			}
			page := payload[struct {
				Items []struct {
					CircleReferenceCount int
					CirclePosts          []AdminMediaCirclePost
				}
			}](t, call(t, h, "GET", "/me/media?q="+asset.ID, nil, author))
			if len(page.Items) != 1 || page.Items[0].CircleReferenceCount != 1 || len(page.Items[0].CirclePosts) != 1 {
				t.Fatal("lost blind cleanup reference", page)
			}
			ref := page.Items[0].CirclePosts[0]
			if ref.ID != p.ID || ref.CircleID != c.ID || ref.ChannelID != ch.ID || ref.Body != "" {
				t.Fatal("cleanup reference or redaction", ref)
			}
			requireCode(t, call(t, h, "DELETE", base+"/posts/"+p.ID, nil, author), 200)
			requireCode(t, call(t, h, "DELETE", "/media/images/"+asset.ID, nil, author), 200)
			requireCode(t, call(t, h, "DELETE", "/media/images/"+asset.ID, nil, author), 200)
			var count int
			if e := s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_audits WHERE action='media.delete' AND target_id=$1`, asset.ID).Scan(&count); e != nil || count != 1 {
				t.Fatal("missing or duplicated delete audit", count, e)
			}
		})
	}
}
