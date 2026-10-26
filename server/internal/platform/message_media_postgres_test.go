package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func uploadChatImage(t *testing.T, h http.Handler, conv, client string, cookie *http.Cookie) response {
	t.Helper()
	body, ct := multipartMedia(t, testMediaPNG(t), client, false)
	r := httptest.NewRequest("POST", "http://localhost:8080/api/v1/conversations/"+conv+"/media/images", bytes.NewReader(body))
	r.Header.Set("Content-Type", ct)
	r.Header.Set("Origin", "http://localhost:5173")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var res struct {
		Data  json.RawMessage
		Error *APIError
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatal(w.Body.String())
	}
	return response{Code: w.Code, Data: res.Data, Error: res.Error}
}
func chatImage(t *testing.T, h http.Handler, cookie *http.Cookie, client string) MediaAsset {
	t.Helper()
	r := uploadChatImage(t, h, "conversation_group", client, cookie)
	requireCode(t, r, 201)
	return payload[MediaAsset](t, r)
}
func richMessage(t *testing.T, h http.Handler, cookie *http.Cookie, body map[string]any) Message {
	t.Helper()
	r := call(t, h, "POST", "/conversations/conversation_group/messages", body, cookie)
	requireCode(t, r, 200)
	return payload[Message](t, r)
}
func getRichMessage(t *testing.T, h http.Handler, cookie *http.Cookie, id string) Message {
	t.Helper()
	r := call(t, h, "GET", "/conversations/conversation_group/messages/"+id, nil, cookie)
	requireCode(t, r, 200)
	return payload[Message](t, r)
}
func TestMessageMediaPostgresImageReplyRetractionAndReplay(t *testing.T) {
	ctx, s, _, _, h := postgresMediaFixture(t)
	cookie := memberCookie(t, h)
	admin := adminCookie(t, h)
	asset := chatImage(t, h, cookie, "chat-first-upload")
	requireCode(t, uploadChatImage(t, h, "conversation_group", "chat-first-upload", cookie), 200)
	request := map[string]any{"body": "", "clientId": "chat-image-only-1", "imageIds": []string{asset.ID}}
	source := richMessage(t, h, cookie, request)
	if source.Status != "sent" || source.Body != "" || source.Revision != 1 || !source.CanRetract || len(source.Images) != 1 || !source.Images[0].Available {
		t.Fatalf("bad source %+v", source)
	}
	reply := richMessage(t, h, cookie, map[string]any{"body": "回复图片", "clientId": "chat-image-reply-1", "replyToId": source.ID})
	if reply.ReplyTo == nil || !reply.ReplyTo.Available || reply.ReplyTo.ImageCount != 1 || reply.ReplyTo.Body == nil || *reply.ReplyTo.Body != "" {
		t.Fatal("reply projection", reply)
	}
	requireCode(t, call(t, h, "POST", "/conversations/conversation_group/messages", map[string]any{"body": "changed", "clientId": "chat-image-only-1", "imageIds": []string{asset.ID}}, cookie), 409)
	by := payload[Message](t, call(t, h, "GET", "/conversations/conversation_group/messages/by-client/chat-image-only-1", nil, cookie))
	if by.ID != source.ID {
		t.Fatal("by-client")
	}
	requireCode(t, call(t, h, "DELETE", "/me/messages/"+source.ID, nil, admin), 404)
	for i := 0; i < 2; i++ {
		r := call(t, h, "DELETE", "/me/messages/"+source.ID, nil, cookie)
		requireCode(t, r, 200)
		var receipt map[string]any
		_ = json.Unmarshal(r.Data, &receipt)
		if len(receipt) != 2 || receipt["messageId"] != source.ID || receipt["ok"] != true {
			t.Fatal("blind receipt leaked", receipt)
		}
	}
	tomb := getRichMessage(t, h, cookie, source.ID)
	if tomb.Status != "retracted" || tomb.Body != "" || len(tomb.Images) != 0 || tomb.ReplyTo != nil || tomb.CanRetract || tomb.Revision != 2 {
		t.Fatal("bad tombstone", tomb)
	}
	quote := getRichMessage(t, h, cookie, reply.ID)
	if quote.ReplyTo == nil || quote.ReplyTo.Available || quote.ReplyTo.Body != nil || quote.ReplyTo.Sender != nil || quote.ReplyTo.ImageCount != 0 || quote.ReplyTo.Revision != 2 {
		t.Fatal("source erased preview", quote)
	}
	requireCode(t, call(t, h, "DELETE", "/media/images/"+asset.ID, nil, cookie), 200)
	replay := call(t, h, "POST", "/conversations/conversation_group/messages", request, cookie)
	requireCode(t, replay, 200)
	if payload[Message](t, replay).Status != "retracted" {
		t.Fatal("replay revived")
	}
	var hash string
	var refs int
	if e := s.pool.QueryRow(ctx, `SELECT payload_hash,(SELECT count(*) FROM gongming_message_media WHERE message_id=$1) FROM gongming_messages WHERE id=$1`, source.ID).Scan(&hash, &refs); e != nil || hash == "" || refs != 0 {
		t.Fatal(hash, refs, e)
	}
	resolve := payload[struct {
		Items           []Message
		MissingIDs      []string
		MutationVersion int64
	}](t, call(t, h, "POST", "/conversations/conversation_group/messages/resolve", map[string]any{"ids": []string{source.ID, reply.ID, "missing", source.ID}}, cookie))
	if resolve.MutationVersion != 1 || len(resolve.Items) != 2 || !reflect.DeepEqual(resolve.MissingIDs, []string{"missing"}) {
		t.Fatal("resolve", resolve)
	}
	requireCode(t, call(t, h, "POST", "/conversations/conversation_group/messages/resolve", map[string]any{"ids": []string{"bad\x00id"}}, cookie), 400)
	requireCode(t, call(t, h, "GET", "/conversations/conversation_group/messages/bad%00id", nil, cookie), 400)
}
func TestMessageMediaPostgresPrivateAuthorizationAndBlindCleanup(t *testing.T) {
	_, _, _, _, h := postgresMediaFixture(t)
	cookie := memberCookie(t, h)
	admin := adminCookie(t, h)
	asset := chatImage(t, h, cookie, "private-chat-upload")
	// An unreferenced image is private to its uploader, even for other members.
	for _, method := range []string{"GET", "HEAD"} {
		if r := readMedia(t, h, method, asset.URL, cookie); r.Code != 200 {
			t.Fatal(r.Code)
		}
		if r := readMedia(t, h, method, asset.URL, admin); r.Code != 404 {
			t.Fatal("staff override", r.Code)
		}
	}
	m := richMessage(t, h, cookie, map[string]any{"body": "private", "clientId": "private-chat-message", "imageIds": []string{asset.ID}})
	raw := call(t, h, "GET", "/admin/media?q="+asset.ID, nil, admin)
	requireCode(t, raw, 200)
	var page struct{ Items []map[string]any }
	_ = json.Unmarshal(raw.Data, &page)
	v := page.Items[0]
	if v["url"] != nil || v["conversationId"] != nil || v["messageReferences"] != nil || v["messageReferenceCount"] != float64(1) {
		t.Fatal("private admin projection", v)
	}
	search := payload[struct{ Total int }](t, call(t, h, "GET", "/admin/media?q="+m.ID, nil, admin))
	if search.Total != 0 {
		t.Fatal("private message ID search")
	}
	requireCode(t, call(t, h, "POST", "/conversations/conversation_group/leave", map[string]any{}, cookie), 200)
	if readMedia(t, h, "GET", asset.URL, cookie).Code != 404 {
		t.Fatal("former owner preview")
	}
	mine := payload[struct{ Items []map[string]any }](t, call(t, h, "GET", "/me/media?scope=conversation&conversationId=conversation_group&clientId=private-chat-upload", nil, cookie))
	if len(mine.Items) != 1 || mine.Items[0]["url"] != nil || mine.Items[0]["previewAvailable"] != false {
		t.Fatal("former owner upload projection", mine)
	}
	requireCode(t, call(t, h, "DELETE", "/media/images/"+asset.ID, nil, cookie), 409)
	requireCode(t, call(t, h, "DELETE", "/me/messages/"+m.ID, nil, cookie), 200)
	requireCode(t, call(t, h, "DELETE", "/media/images/"+asset.ID, nil, cookie), 200)
	requireCode(t, call(t, h, "GET", "/conversations/conversation_group/messages/"+m.ID, nil, cookie), 404)
}
func TestMessageMediaPostgresBlockUnblockVersionAndOutbox(t *testing.T) {
	ctx, s, _, _, h := postgresMediaFixture(t)
	cookie := memberCookie(t, h)
	admin := adminCookie(t, h)
	asset := chatImage(t, h, cookie, "moderation-chat-upload")
	m := richMessage(t, h, cookie, map[string]any{"body": "keep body", "clientId": "moderation-chat-message", "imageIds": []string{asset.ID}})
	for index, status := range []string{"blocked", "blocked", "ready"} {
		requireCode(t, call(t, h, "PATCH", "/admin/media/"+asset.ID, map[string]string{"status": status, "note": "人工审核"}, admin), 200)
		next := getRichMessage(t, h, cookie, m.ID)
		want := int64(2)
		if index == 2 {
			want = 3
		}
		if next.Revision != want || next.Body != "keep body" || next.Images[0].Available != (status == "ready") || ((next.Images[0].URL != nil) != (status == "ready")) {
			t.Fatalf("projection %+v", next)
		}
		wantRead := 404
		if status == "ready" {
			wantRead = 200
		} // admin is an actual seed-group member.
		if readMedia(t, h, "GET", asset.URL, admin).Code != wantRead {
			t.Fatal("staff/member preview")
		}
	}
	var count int
	if e := s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_message_outbox WHERE type='conversation.messages.invalidated' AND conversation_id='conversation_group'`).Scan(&count); e != nil || count != 2 {
		t.Fatal(count, e)
	}
	if e := s.Update(ctx, func(state *State) error {
		u := state.Accounts["user_demo"]
		u.User.Bio = "State must preserve SQL rich metadata"
		state.Accounts[u.User.ID] = u
		return nil
	}); e != nil {
		t.Fatal(e)
	}
	next := getRichMessage(t, h, cookie, m.ID)
	if len(next.Images) != 1 || next.Revision != 3 {
		t.Fatal("State overwrote rich data")
	}
	requireCode(t, call(t, h, "DELETE", "/me/messages/"+m.ID, nil, cookie), 200)
	requireCode(t, call(t, h, "PATCH", "/admin/media/"+asset.ID, map[string]string{"status": "blocked", "note": "无有效引用"}, admin), 200)
	if getRichMessage(t, h, cookie, m.ID).Revision != 4 {
		t.Fatal("unreferenced asset changed V")
	}
}
func TestMessageMediaPostgresScopeFingerprintAndChannel(t *testing.T) {
	_, _, _, _, h := postgresMediaFixture(t)
	cookie := memberCookie(t, h)
	admin := adminCookie(t, h)
	world := payload[MediaAsset](t, uploadMedia(t, h, testMediaPNG(t), "scope-world-upload", cookie))
	one := chatImage(t, h, cookie, "scope-chat-first")
	two := chatImage(t, h, cookie, "scope-chat-second")
	for _, body := range []map[string]any{{"body": "x", "clientId": "scope-invalid-world", "imageIds": []string{world.ID}}, {"body": "x", "clientId": "scope-invalid-duplicate", "imageIds": []string{one.ID, one.ID}}, {"body": "", "replyToId": "message_group", "clientId": "reply-empty-invalid"}, {"body": "x", "imageIds": []string{one.ID}}} {
		requireCode(t, call(t, h, "POST", "/conversations/conversation_group/messages", body, cookie), 400)
	}
	request := map[string]any{"body": "ordered", "clientId": "ordered-chat-message", "imageIds": []string{one.ID, two.ID}}
	m := richMessage(t, h, cookie, request)
	request["imageIds"] = []string{two.ID, one.ID}
	requireCode(t, call(t, h, "POST", "/conversations/conversation_group/messages", request, cookie), 409)
	if m.Images[0].ID != one.ID || m.Images[1].ID != two.ID {
		t.Fatal("order")
	}
	requireCode(t, call(t, h, "POST", "/posts", map[string]any{"body": "cross-scope", "images": []string{one.URL}}, cookie), 400)
	requireCode(t, uploadChatImage(t, h, "conversation_channel", "channel-forbidden-upload", cookie), 403)
	channel := uploadChatImage(t, h, "conversation_channel", "channel-owner-upload", admin)
	requireCode(t, channel, 201)
	asset := payload[MediaAsset](t, channel)
	result := call(t, h, "POST", "/conversations/conversation_channel/messages", map[string]any{"clientId": "channel-owner-message", "imageIds": []string{asset.ID}}, admin)
	requireCode(t, result, 200)
	published := payload[Message](t, result)
	requireCode(t, call(t, h, "POST", "/conversations/conversation_channel/owner", map[string]string{"userId": "user_demo"}, admin), 200)
	requireCode(t, call(t, h, "POST", "/conversations/conversation_channel/messages", map[string]any{"clientId": "channel-owner-message", "imageIds": []string{asset.ID}}, admin), 403)
	requireCode(t, call(t, h, "DELETE", "/me/messages/"+published.ID, nil, admin), 200)
}
func TestMessageMediaPostgresMoreThanTenReferencesAndConstraints(t *testing.T) {
	ctx, s, _, _, h := postgresMediaFixture(t)
	cookie := memberCookie(t, h)
	asset := chatImage(t, h, cookie, "many-chat-upload")
	messages := []Message{}
	for i := 0; i < 12; i++ {
		messages = append(messages, richMessage(t, h, cookie, map[string]any{"clientId": fmt.Sprintf("many-chat-message-%02d", i), "imageIds": []string{asset.ID}, "body": "live body"}))
	}
	page := payload[struct {
		Items []struct {
			ReferenceCount        int
			MessageReferenceCount int
			MessageReferences     []OwnedMessageReference
		}
	}](t, call(t, h, "GET", "/me/media?clientId=many-chat-upload", nil, cookie))
	if len(page.Items) != 1 || page.Items[0].ReferenceCount != 12 || page.Items[0].MessageReferenceCount != 12 || len(page.Items[0].MessageReferences) != 10 {
		t.Fatal(page)
	}
	for _, query := range []string{`DELETE FROM gongming_message_media WHERE message_id=$1`, `UPDATE gongming_messages SET body='mutated' WHERE id=$1`, `DELETE FROM gongming_messages WHERE id=$1`} {
		_, e := s.pool.Exec(ctx, query, messages[0].ID)
		expectDatabaseCode(t, e, "23514")
	}
	_, e := s.pool.Exec(ctx, `INSERT INTO gongming_message_media(message_id,media_id,position) VALUES($1,$2,1)`, messages[0].ID, asset.ID)
	expectDatabaseCode(t, e, "23514")
	for _, m := range messages {
		requireCode(t, call(t, h, "DELETE", "/me/messages/"+m.ID, nil, cookie), 200)
	}
	requireCode(t, call(t, h, "DELETE", "/media/images/"+asset.ID, nil, cookie), 200)
}
func TestMessageMediaPostgresConcurrentReplayRetractionAndRollback(t *testing.T) {
	ctx, s, dsn, a, h := postgresMediaFixture(t)
	cookie := memberCookie(t, h)
	asset := chatImage(t, h, cookie, "concurrent-chat-upload")
	other, e := OpenPostgres(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer other.Close()
	second := NewApp(other, a.cfg).Handler()
	body := map[string]any{"clientId": "concurrent-chat-message", "imageIds": []string{asset.ID}}
	var wg sync.WaitGroup
	results := make(chan response, 2)
	for _, handler := range []http.Handler{h, second} {
		wg.Add(1)
		go func(handler http.Handler) {
			defer wg.Done()
			results <- call(t, handler, "POST", "/conversations/conversation_group/messages", body, cookie)
		}(handler)
	}
	wg.Wait()
	close(results)
	id := ""
	for r := range results {
		requireCode(t, r, 200)
		m := payload[Message](t, r)
		if id != "" && id != m.ID {
			t.Fatal("duplicate")
		}
		id = m.ID
	}
	if _, e = s.pool.Exec(ctx, `CREATE FUNCTION fail_chat_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='message.retracted' THEN RAISE EXCEPTION 'forced rollback' USING ERRCODE='23514';END IF;RETURN NEW;END $$;CREATE TRIGGER fail_chat_event BEFORE INSERT ON gongming_message_outbox FOR EACH ROW EXECUTE FUNCTION fail_chat_event()`); e != nil {
		t.Fatal(e)
	}
	requireCode(t, call(t, h, "DELETE", "/me/messages/"+id, nil, cookie), 500)
	if m := getRichMessage(t, h, cookie, id); m.Status != "sent" || len(m.Images) != 1 || m.Revision != 1 {
		t.Fatal("partial rollback", m)
	}
	if _, e = s.pool.Exec(ctx, `DROP TRIGGER fail_chat_event ON gongming_message_outbox`); e != nil {
		t.Fatal(e)
	}
	requireCode(t, call(t, h, "DELETE", "/me/messages/"+id, nil, cookie), 200)
	replay := payload[Message](t, call(t, second, "POST", "/conversations/conversation_group/messages", body, cookie))
	if replay.Status != "retracted" || replay.Revision != 2 {
		t.Fatal(replay)
	}
}
func TestMessageMediaPostgresNarrowResolveAndMediaAuthorization(t *testing.T) {
	ctx, s, _, _, h := postgresMediaFixture(t)
	cookie := memberCookie(t, h)
	asset := chatImage(t, h, cookie, "narrow-chat-upload")
	m := richMessage(t, h, cookie, map[string]any{"clientId": "narrow-chat-message", "imageIds": []string{asset.ID}})
	lock, e := s.pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer lock.Rollback(ctx)
	if _, e = lock.Exec(ctx, `LOCK TABLE gongming_posts,gongming_comments,gongming_wallets,gongming_ledger,gongming_documents,gongming_friend_requests,gongming_reports,gongming_audits IN ACCESS EXCLUSIVE MODE`); e != nil {
		t.Fatal(e)
	}
	bounded := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		h.ServeHTTP(w, r.WithContext(c))
	})
	requireCode(t, call(t, bounded, "POST", "/conversations/conversation_group/messages/resolve", map[string]any{"ids": []string{m.ID}}, cookie), 200)
	requireCode(t, call(t, bounded, "GET", "/conversations/conversation_group/messages/by-client/narrow-chat-message", nil, cookie), 200)
	requireCode(t, call(t, bounded, "GET", "/conversations/conversation_group/messages/"+m.ID, nil, cookie), 200)
	if readMedia(t, bounded, "GET", asset.URL, cookie).Code != 200 {
		t.Fatal("media loaded unrelated tables")
	}
	requireCode(t, call(t, bounded, "DELETE", "/me/messages/"+m.ID, nil, cookie), 200)
}
func TestMessageMediaV9MigrationPreservesColumnsXminCookiesAndRollback(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	_, memory, mh := fixture(t)
	cookie := memberCookie(t, mh)
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `CREATE TABLE gongming_schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());`+normalizedSchema+normalizedGuards+`INSERT INTO gongming_schema_migrations(version) VALUES(2)`); e != nil {
		t.Fatal(e)
	}
	for _, fn := range []func(context.Context, pgx.Tx) error{migrateFriendships, migrateDeviceSessions, migrateMedia, migrateCircles, migrateNotifications, migrateCircleEvents, migrateWalletIdentity} {
		if e = fn(ctx, tx); e != nil {
			t.Fatal(e)
		}
	}
	if e = persistHistoricalFixture(ctx, tx, 9, memory.state); e != nil {
		t.Fatal(e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	rows, e := s.pool.Query(ctx, `SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' AND table_name<>'gongming_schema_migrations' ORDER BY table_name`)
	if e != nil {
		t.Fatal(e)
	}
	tables := []string{}
	for rows.Next() {
		var table string
		if e = rows.Scan(&table); e != nil {
			t.Fatal(e)
		}
		tables = append(tables, table)
	}
	rows.Close()
	queries := map[string]string{}
	values := map[string]string{}
	for _, table := range tables {
		q, e := freezeMigrationProjection(ctx, s, table)
		if e != nil {
			t.Fatal(e)
		}
		queries[table] = q
		var raw string
		if e = s.pool.QueryRow(ctx, q).Scan(&raw); e != nil {
			t.Fatal(e)
		}
		values[table] = raw
	}
	if _, e = s.pool.Exec(ctx, `CREATE TABLE gongming_message_media(collision text)`); e != nil {
		t.Fatal(e)
	}
	if e = s.Migrate(ctx); e == nil {
		t.Fatal("migration collision accepted")
	}
	var exists bool
	if e = s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=10)`).Scan(&exists); e != nil || exists {
		t.Fatal("partial migration marker", e)
	}
	if _, e = s.pool.Exec(ctx, `DROP TABLE gongming_message_media`); e != nil {
		t.Fatal(e)
	}
	if e = s.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	if e = s.Migrate(ctx); e != nil {
		t.Fatal("not idempotent", e)
	}
	for table, q := range queries {
		var raw string
		if e = s.pool.QueryRow(ctx, q).Scan(&raw); e != nil || raw != values[table] {
			t.Fatal("rewrote old table", table, e)
		}
	}
	a := NewApp(s, Config{Environment: "development", Origins: []string{"http://localhost:5173"}})
	requireCode(t, call(t, a.Handler(), "GET", "/auth/me", nil, cookie), 200)
	var count int
	if e = s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_message_media`).Scan(&count); e != nil || count != 0 {
		t.Fatal("migration backfilled refs", e)
	}
}
func TestMessageMediaPostgresFileFailureAndUnknownCommitCandidate(t *testing.T) {
	ctx, s, _, a, h := postgresMediaFixture(t)
	cookie := memberCookie(t, h)
	if _, e := s.pool.Exec(ctx, `CREATE FUNCTION fail_chat_asset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'unknown failure' USING ERRCODE='23514';END $$;CREATE TRIGGER fail_chat_asset BEFORE INSERT ON gongming_media_assets FOR EACH ROW EXECUTE FUNCTION fail_chat_asset()`); e != nil {
		t.Fatal(e)
	}
	requireCode(t, uploadChatImage(t, h, "conversation_group", "chat-failed-candidate", cookie), 500)
	files, e := os.ReadDir(a.cfg.MediaDirectory)
	if e != nil || len(files) != 1 {
		t.Fatal(files, e)
	}
	id := strings.TrimSuffix(files[0].Name(), ".png")
	if readMedia(t, h, "GET", mediaURLPrefix+id, cookie).Code != 404 {
		t.Fatal("orphan visible")
	}
	if _, e = s.pool.Exec(ctx, `DROP TRIGGER fail_chat_asset ON gongming_media_assets`); e != nil {
		t.Fatal(e)
	}
	a.cfg.MediaDirectory = filepath.Join(t.TempDir(), "missing", "private")
	requireCode(t, uploadChatImage(t, h, "conversation_group", "chat-file-unavailable", cookie), 503)
}
