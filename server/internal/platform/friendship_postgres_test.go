package platform

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func postgresFriendshipFixture(t *testing.T) (context.Context, *PostgresStore, string, *App, http.Handler, *http.Cookie, *http.Cookie) {
	t.Helper()
	ctx, s, dsn := isolatedPostgres(t)
	a := seedPostgres(t, ctx, s)
	if err := s.Update(ctx, func(state *State) error {
		account := state.Accounts["user_friend"]
		account.PasswordHash = hashPassword("Friend2026!", bcrypt.MinCost)
		state.Accounts["user_friend"] = account
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	h := friendshipTestHandler(a)
	return ctx, s, dsn, a, h, memberCookie(t, h), loginAs(t, h, "zhouye@gongming.local", "Friend2026!")
}
func TestFriendshipPostgresConcurrentRequestsAcceptanceAndRestart(t *testing.T) {
	ctx, s, dsn, _, h, from, to := postgresFriendshipFixture(t)
	var wg sync.WaitGroup
	responses := make(chan response, 8)
	for index := 0; index < 8; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res := call(t, h, "POST", "/friend-requests", map[string]string{"userId": "user_friend", "note": "并发申请"}, from)
			if res.Code != 200 {
				t.Errorf("concurrent request status=%d err=%v", res.Code, res.Error)
				return
			}
			responses <- res
		}()
	}
	wg.Wait()
	close(responses)
	id := ""
	var original []byte
	for res := range responses {
		next := payload[FriendRequest](t, res).ID
		if original == nil {
			original = res.Data
		} else if string(original) != string(res.Data) {
			t.Fatal("pending retries did not return original object")
		}
		if id != "" && id != next {
			t.Fatal("same-direction race created duplicate request")
		}
		id = next
	}
	if id == "" {
		t.Fatal("no request returned")
	}
	repeated := call(t, h, "POST", "/friend-requests", map[string]string{"userId": "user_friend", "note": "重发不替换备注"}, from)
	requireCode(t, repeated, 200)
	if string(original) != string(repeated.Data) {
		t.Fatal("repeated pending request changed original object")
	}
	requireCode(t, call(t, h, "POST", "/friend-requests", map[string]string{"userId": "user_demo"}, to), 409)
	for index := 0; index < 8; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res := respondFriendCall(t, h, id, "accept", to)
			if res.Code != 200 {
				t.Errorf("idempotent accept status=%d err=%v", res.Code, res.Error)
			}
		}()
	}
	wg.Wait()
	var count int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_friendships`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("mutual pair count=%d err=%v", count, err)
	}
	reopened, err := OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	next := NewApp(reopened, Config{Environment: "test", Origins: []string{"http://localhost:5173"}, BcryptCost: bcrypt.MinCost})
	nextHandler := friendshipTestHandler(next)
	items, total := friendPage(t, call(t, nextHandler, "GET", "/friends", nil, from))
	if total != 1 || items[0].User.ID != "user_friend" {
		t.Fatal("friendship or session did not persist across repository restart")
	}
	relation := payload[Relationship](t, call(t, nextHandler, "GET", "/relationships/user_demo", nil, to))
	if relation.Status != "friends" || relation.Since == nil {
		t.Fatal("mutual reverse relationship missing after restart")
	}
	var messagesBefore, messagesAfter int
	_ = s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_messages`).Scan(&messagesBefore)
	requireCode(t, call(t, nextHandler, "DELETE", "/friends/user_friend", nil, from), 200)
	requireCode(t, call(t, nextHandler, "DELETE", "/friends/user_friend", nil, from), 200)
	requireCode(t, respondFriendCall(t, nextHandler, id, "accept", to), 200)
	_ = s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_messages`).Scan(&messagesAfter)
	_, total = friendPage(t, call(t, nextHandler, "GET", "/friends", nil, to))
	if total != 0 || messagesBefore != messagesAfter {
		t.Fatal("removal resurrected friends or deleted history")
	}
}
func TestFriendshipPostgresReciprocalAndDecisionRaces(t *testing.T) {
	ctx, s, _, _, h, from, to := postgresFriendshipFixture(t)
	var wg sync.WaitGroup
	results := make(chan response, 2)
	for _, entry := range []struct {
		cookie *http.Cookie
		target string
	}{{from, "user_friend"}, {to, "user_demo"}} {
		wg.Add(1)
		go func(cookie *http.Cookie, target string) {
			defer wg.Done()
			results <- call(t, h, "POST", "/friend-requests", map[string]string{"userId": target}, cookie)
		}(entry.cookie, entry.target)
	}
	wg.Wait()
	close(results)
	var request FriendRequest
	success, conflicts := 0, 0
	for res := range results {
		if res.Code == 200 {
			success++
			request = payload[FriendRequest](t, res)
		} else if res.Code == 409 {
			conflicts++
		} else {
			t.Fatalf("reciprocal status=%d err=%v", res.Code, res.Error)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatal("reciprocal pending requests both committed")
	}
	sender, recipient := from, to
	if request.From.ID == "user_friend" {
		sender, recipient = to, from
	}
	codes := make(chan int, 2)
	for _, entry := range []struct {
		cookie *http.Cookie
		action string
	}{{recipient, "accept"}, {sender, "cancel"}} {
		wg.Add(1)
		go func(cookie *http.Cookie, action string) {
			defer wg.Done()
			codes <- respondFriendCall(t, h, request.ID, action, cookie).Code
		}(entry.cookie, entry.action)
	}
	wg.Wait()
	close(codes)
	success, conflicts = 0, 0
	for code := range codes {
		if code == 200 {
			success++
		} else if code == 409 {
			conflicts++
		} else {
			t.Fatalf("decision race status=%d", code)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatal("conflicting decisions both committed")
	}
	if err := s.Read(ctx, func(state *State) error {
		request := state.FriendRequests[request.ID]
		_, friends := state.Friendships[friendshipKey(request.FromID, request.ToID)]
		if friends != (request.Status == "accepted") {
			return fmt.Errorf("terminal decision and mutual pair diverged")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
func TestFriendshipPostgresConstraintsAndAtomicFailure(t *testing.T) {
	ctx, s, _, _, h, from, to := postgresFriendshipFixture(t)
	request := friendRequestCall(t, h, "user_friend", from)
	for _, test := range []struct{ query, code string }{
		{`INSERT INTO gongming_friend_requests(id,from_id,to_id,status,created_at,updated_at) VALUES('reverse','user_friend','user_demo','pending',now(),now())`, "23505"},
		{`INSERT INTO gongming_friend_requests(id,from_id,to_id,status,created_at,updated_at) VALUES('self','user_demo','user_demo','pending',now(),now())`, "23514"},
		{`INSERT INTO gongming_friend_requests(id,from_id,to_id,status,created_at,updated_at) VALUES('orphan','missing','user_admin','pending',now(),now())`, "23503"},
		{`INSERT INTO gongming_friendships(user_a,user_b,since) VALUES('user_friend','user_demo',now())`, "23514"},
		{`INSERT INTO gongming_friendships(user_a,user_b,since) VALUES('user_admin','user_demo',now())`, "23514"},
		{`UPDATE gongming_friend_requests SET note='改写原申请'`, "23514"},
	} {
		_, err := s.pool.Exec(ctx, test.query)
		expectDatabaseCode(t, err, test.code)
	}
	// A failure after both domain mutations must leave neither decision committed.
	err := s.Update(ctx, func(state *State) error {
		request := state.FriendRequests[request.ID]
		request.Status = "accepted"
		state.FriendRequests[request.ID] = request
		low, high := canonicalFriendPair(request.FromID, request.ToID)
		state.Friendships[friendshipKey(low, high)] = StoredFriendship{low, high, request.CreatedAt}
		return fmt.Errorf("force callback rollback")
	})
	if err == nil {
		t.Fatal("expected forced rollback")
	}
	if err = s.Read(ctx, func(state *State) error {
		if state.FriendRequests[request.ID].Status != "pending" || len(state.Friendships) != 0 {
			t.Fatal("failed accept callback leaked partial state")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	requireCode(t, respondFriendCall(t, h, request.ID, "accept", to), 200)
	_, err = s.pool.Exec(ctx, `UPDATE gongming_friend_requests SET status='pending' WHERE id=$1`, request.ID)
	expectDatabaseCode(t, err, "23514")
	_, err = s.pool.Exec(ctx, `DELETE FROM gongming_friend_requests WHERE id=$1`, request.ID)
	expectDatabaseCode(t, err, "23514")
}

func installVersionTwo(t *testing.T, ctx context.Context, s *PostgresStore, withData bool) {
	t.Helper()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `CREATE TABLE gongming_schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());INSERT INTO gongming_schema_migrations(version) VALUES(2)`); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, normalizedSchema); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, normalizedGuards); err != nil {
		t.Fatal(err)
	}
	if withData {
		_, memory, _ := fixture(t)
		// This source schema predates the independent circles service.
		memory.state.Circles = nil
		memory.state.CircleMembers = nil
		memory.state.CircleJoinRequests = nil
		memory.state.CircleChannels = nil
		memory.state.CirclePosts = nil
		memory.state.CircleComments = nil
		memory.state.CircleInvites = nil
		memory.state.CircleInviteRedemptions = nil
		if err = persistNormalized(ctx, tx, NewState(), memory.state); err != nil {
			t.Fatal(err)
		}
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}
func TestFriendshipVersionThreeMigrationIsAtomicIdempotentAndDoesNotInferFriends(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	installVersionTwo(t, ctx, s, true)
	var beforeUser, beforeMessage string
	if err := s.pool.QueryRow(ctx, `SELECT xmin::text FROM gongming_users WHERE id='user_demo'`).Scan(&beforeUser); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT xmin::text FROM gongming_messages LIMIT 1`).Scan(&beforeMessage); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for index := 0; index < 2; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := s.Migrate(ctx); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	var afterUser, afterMessage string
	_ = s.pool.QueryRow(ctx, `SELECT xmin::text FROM gongming_users WHERE id='user_demo'`).Scan(&afterUser)
	_ = s.pool.QueryRow(ctx, `SELECT xmin::text FROM gongming_messages LIMIT 1`).Scan(&afterMessage)
	if beforeUser != afterUser || beforeMessage != afterMessage {
		t.Fatal("v3 migration rewrote unrelated v2 rows")
	}
	var requests, friends, markers int
	if err := s.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM gongming_friend_requests),(SELECT count(*) FROM gongming_friendships),(SELECT count(*) FROM gongming_schema_migrations WHERE version=3)`).Scan(&requests, &friends, &markers); err != nil {
		t.Fatal(err)
	}
	if requests != 0 || friends != 0 || markers != 1 {
		t.Fatal("migration inferred friends or duplicated marker")
	}
}
func TestFriendshipVersionThreeFailedDDLLeavesVersionTwoUntouched(t *testing.T) {
	ctx, s, _ := isolatedPostgres(t)
	installVersionTwo(t, ctx, s, false)
	if _, err := s.pool.Exec(ctx, `CREATE TABLE gongming_friendships(user_a text)`); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx); err == nil {
		t.Fatal("malformed conflicting schema accepted")
	}
	var requestsExist, marker bool
	if err := s.pool.QueryRow(ctx, `SELECT to_regclass('gongming_friend_requests') IS NOT NULL,EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=3)`).Scan(&requestsExist, &marker); err != nil {
		t.Fatal(err)
	}
	if requestsExist || marker {
		t.Fatal("failed v3 migration left partial table/marker")
	}
	if _, err := s.pool.Exec(ctx, `DROP TABLE gongming_friendships`); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx); err != nil {
		t.Fatal("corrected migration could not retry", err)
	}
}
