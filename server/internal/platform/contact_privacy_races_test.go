package platform

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
	"net/http"
	"net/url"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestContactPrivacyPostgresConcurrentCASAndOppositeBlocks(t *testing.T) {
	ctx, s, dsn, a, h := postgresMediaFixture(t)
	ac := memberCookie(t, h)
	b, bc := circleUser(t, h, "contactraceb")
	other, e := OpenPostgres(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer other.Close()
	second := NewApp(other, a.cfg).Handler()
	results := make(chan response, 2)
	var wg sync.WaitGroup
	for _, handler := range []http.Handler{h, second} {
		wg.Add(1)
		go func(handler http.Handler) {
			defer wg.Done()
			results <- call(t, handler, "PUT", "/me/blocks/"+b.ID, map[string]int64{"revision": 0}, ac)
		}(handler)
	}
	wg.Wait()
	close(results)
	ok, conflict := 0, 0
	for r := range results {
		switch r.Code {
		case 200:
			ok++
		case 409:
			conflict++
		default:
			t.Fatal(r.Code, r.Error)
		}
	}
	if ok != 1 || conflict != 1 || privacy(t, h, ac).Revision != 1 {
		t.Fatal("CAS allowed both", ok, conflict)
	}
	// Reverse ownership has its own revision; lock order must allow both records.
	blockContact(t, second, bc, "user_demo", 0, true)
	var count int
	if e = s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_user_blocks`).Scan(&count); e != nil || count != 2 {
		t.Fatal(count, e)
	}
	blockContact(t, h, ac, b.ID, 1, false)
	if contactCaps(t, h, ac, b.ID).CanMessage {
		t.Fatal("one-sided unblock bypassed reverse block")
	}
}
func TestContactPrivacyPostgresOldStateAcceptAndInvitationRetry(t *testing.T) {
	for _, op := range []string{"accept", "invite"} {
		t.Run(op, func(t *testing.T) {
			ctx, s, _, _, h := postgresMediaFixture(t)
			ac := memberCookie(t, h)
			b, bc := circleUser(t, h, "contactstate"+op)
			var request FriendRequest
			if op == "accept" {
				request = payload[FriendRequest](t, call(t, h, "POST", "/friend-requests", map[string]string{"userId": b.ID}, ac))
			}
			loaded, release := make(chan struct{}), make(chan struct{})
			done := make(chan error, 1)
			var attempts atomic.Int32
			go func() {
				done <- s.Update(ctx, func(state *State) error {
					if attempts.Add(1) == 1 {
						close(loaded)
						<-release
					}
					if op == "accept" {
						v := state.FriendRequests[request.ID]
						if v.Status != "pending" {
							return conflict("already processed")
						}
						v.Status = "accepted"
						v.UpdatedAt = time.Now()
						state.FriendRequests[v.ID] = v
						lo, hi := canonicalFriendPair(v.FromID, v.ToID)
						state.Friendships[friendshipKey(lo, hi)] = StoredFriendship{lo, hi, time.Now()}
					} else {
						c := StoredConversation{ID: "stale-private-group", Title: "旧快照邀请", Kind: "group", OwnerID: "user_demo", Members: []string{"user_demo", b.ID}, CreatedAt: time.Now()}
						state.Conversations[c.ID] = c
					}
					return nil
				})
			}()
			<-loaded
			blockContact(t, h, bc, "user_demo", 0, true)
			close(release)
			e := <-done
			if e == nil || attempts.Load() < 2 {
				t.Fatal("stale callback committed", e, attempts.Load())
			}
			var count int
			if op == "accept" {
				e = s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_friendships`).Scan(&count)
			} else {
				e = s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_conversations WHERE id='stale-private-group'`).Scan(&count)
			}
			if e != nil || count != 0 {
				t.Fatal("partial stale contact", count, e)
			}
		})
	}
}
func TestContactPrivacyPostgresOldSQLSnapshotFriendsRemovalAndStatus(t *testing.T) {
	for _, change := range []string{"unfriend", "suspend"} {
		t.Run(change, func(t *testing.T) {
			ctx, s, _, a, h := postgresMediaFixture(t)
			ac := memberCookie(t, h)
			b, bc := circleUser(t, h, "contactsql"+change)
			acceptContactFriend(t, h, ac, bc, b.ID)
			c := directContact(t, h, ac, b.ID)
			p := privacy(t, h, bc)
			p.DirectMessagePolicy = "friends"
			savePrivacy(t, h, bc, p)
			// Establish the old snapshot before the competing authoritative mutation.
			tx, e := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
			if e != nil {
				t.Fatal(e)
			}
			defer tx.Rollback(ctx)
			var value int
			if e = tx.QueryRow(ctx, `SELECT 1 FROM gongming_users WHERE id='user_demo'`).Scan(&value); e != nil {
				t.Fatal(e)
			}
			if change == "unfriend" {
				requireCode(t, call(t, h, "DELETE", "/friends/"+b.ID, nil, ac), 200)
			} else {
				if e = s.Update(ctx, func(state *State) error {
					person := state.Accounts[b.ID]
					person.User.Status = "suspended"
					state.Accounts[b.ID] = person
					return nil
				}); e != nil {
					t.Fatal(e)
				}
			}
			e = prepareDirectContact(ctx, tx, c.ID, "user_demo")
			expectDatabaseCode(t, e, "40001")
			_ = tx.Rollback(ctx)
			r := call(t, h, "POST", "/conversations/"+c.ID+"/messages", map[string]string{"body": "fresh retry cannot use old privilege"}, ac)
			requireContactDenied(t, r)
			_ = a
		})
	}
}
func waitContactLock(t *testing.T, ctx context.Context, s *PostgresStore, name string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var waiting bool
		if e := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock')`, name).Scan(&waiting); e != nil {
			t.Fatal(e)
		}
		if waiting {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("contact writer never reached final guard lock")
}
func TestContactPrivacyPostgresUploadFinalCommitRevalidation(t *testing.T) {
	for _, change := range []string{"reverse-block", "suspend"} {
		t.Run(change, func(t *testing.T) {
			ctx, s, dsn, a, h := postgresMediaFixture(t)
			ac := memberCookie(t, h)
			b, _ := circleUser(t, h, "contactupload"+fmt.Sprint(len(change)))
			c := directContact(t, h, ac, b.ID)
			// Ensure stable fence rows, then hold the recipient's row while a complete
			// upload passes its read-only preflight, decoding and private file creation.
			setup, e := s.pool.Begin(ctx)
			if e != nil {
				t.Fatal(e)
			}
			if e = lockContactGuards(ctx, setup, []string{"user_demo", b.ID}, false); e != nil {
				t.Fatal(e)
			}
			if e = setup.Commit(ctx); e != nil {
				t.Fatal(e)
			}
			hold, e := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
			if e != nil {
				t.Fatal(e)
			}
			defer hold.Rollback(ctx)
			if _, e = hold.Exec(ctx, `SELECT 1 FROM gongming_contact_preferences WHERE user_id=$1 FOR UPDATE`, b.ID); e != nil {
				t.Fatal(e)
			}
			parsed, e := url.Parse(dsn)
			if e != nil {
				t.Fatal(e)
			}
			q := parsed.Query()
			name := newID("contact-upload-")
			q.Set("application_name", name)
			parsed.RawQuery = q.Encode()
			other, e := OpenPostgres(ctx, parsed.String())
			if e != nil {
				t.Fatal(e)
			}
			defer other.Close()
			handler := NewApp(other, a.cfg).Handler()
			done := make(chan response, 1)
			go func() { done <- uploadChatImage(t, handler, c.ID, "contact-final-upload", ac) }()
			waitContactLock(t, ctx, s, name)
			files, e := os.ReadDir(a.cfg.MediaDirectory)
			if e != nil || len(files) != 1 {
				t.Fatal("test did not reach file-before-commit boundary", len(files), e)
			}
			if change == "reverse-block" {
				if e = execRow(ctx, hold, `INSERT INTO gongming_user_blocks(owner_id,target_id,created_at) VALUES($1,'user_demo',now())`, b.ID); e != nil {
					t.Fatal(e)
				}
			} else {
				if e = execRow(ctx, hold, `UPDATE gongming_users SET status='suspended' WHERE id=$1`, b.ID); e != nil {
					t.Fatal(e)
				}
			}
			if e = bumpContactGuards(ctx, hold, []string{b.ID}); e != nil {
				t.Fatal(e)
			}
			if e = hold.Commit(ctx); e != nil {
				t.Fatal(e)
			}
			res := <-done
			requireContactDenied(t, res)
			files, e = os.ReadDir(a.cfg.MediaDirectory)
			if e != nil || len(files) != 0 {
				t.Fatal("known final rejection left a candidate", len(files), e)
			}
			var count int
			if e = s.pool.QueryRow(ctx, `SELECT count(*) FROM gongming_media_assets WHERE client_id='contact-final-upload'`).Scan(&count); e != nil || count != 0 {
				t.Fatal("failed upload committed", count, e)
			}
		})
	}
}
func TestContactPrivacyPostgresRollbackInactiveBlocksAndNoop(t *testing.T) {
	ctx, s, _, _, h := postgresMediaFixture(t)
	ac := memberCookie(t, h)
	b, bc := circleUser(t, h, "contactrollbackb")
	pending := payload[FriendRequest](t, call(t, h, "POST", "/friend-requests", map[string]string{"userId": b.ID}, ac))
	if _, e := s.pool.Exec(ctx, `CREATE FUNCTION fail_contact_resync() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='contact.resync' THEN RAISE EXCEPTION 'injected private refresh failure' USING ERRCODE='23514';END IF;RETURN NEW;END $$;CREATE TRIGGER fail_contact_resync BEFORE INSERT ON gongming_message_outbox FOR EACH ROW EXECUTE FUNCTION fail_contact_resync()`); e != nil {
		t.Fatal(e)
	}
	requireCode(t, call(t, h, "PUT", "/me/blocks/"+b.ID, map[string]int64{"revision": 0}, ac), 500)
	if privacy(t, h, ac).Revision != 0 {
		t.Fatal("failed block advanced revision")
	}
	var status string
	if e := s.pool.QueryRow(ctx, `SELECT status FROM gongming_friend_requests WHERE id=$1`, pending.ID).Scan(&status); e != nil || status != "pending" {
		t.Fatal("failed block cancelled request", status, e)
	}
	if _, e := s.pool.Exec(ctx, `DROP TRIGGER fail_contact_resync ON gongming_message_outbox`); e != nil {
		t.Fatal(e)
	}
	blockContact(t, h, ac, b.ID, 0, true)
	if e := s.Update(ctx, func(state *State) error {
		u := state.Accounts[b.ID]
		u.User.Status = "suspended"
		state.Accounts[b.ID] = u
		return nil
	}); e != nil {
		t.Fatal(e)
	}
	page := payload[struct {
		Items    []BlockEntry
		Revision int64
	}](t, call(t, h, "GET", "/me/blocks?userId="+b.ID, nil, ac))
	if len(page.Items) != 1 || page.Items[0].Available || page.Items[0].User != nil || page.Revision != 1 {
		t.Fatal("inactive block disclosure", page)
	}
	blockContact(t, h, ac, b.ID, 1, true)
	blockContact(t, h, ac, b.ID, 1, false)
	no := blockContact(t, h, ac, "unknown-user", 2, false)
	if no.Revision != 2 {
		t.Fatal(no)
	}
	requireCode(t, call(t, h, "GET", "/me/blocks", nil, bc), 401)
}
func TestContactPrivacyPostgresOppositeLazyBlocksAcrossInstances(t *testing.T) {
	ctx, _, dsn, a, h := postgresMediaFixture(t)
	ac := memberCookie(t, h)
	b, bc := circleUser(t, h, "contactopposite")
	other, e := OpenPostgres(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer other.Close()
	second := NewApp(other, a.cfg).Handler()
	start := make(chan struct{})
	results := make(chan response, 2)
	for _, job := range []struct {
		h      http.Handler
		cookie *http.Cookie
		target string
	}{{h, ac, b.ID}, {second, bc, "user_demo"}} {
		go func(job struct {
			h      http.Handler
			cookie *http.Cookie
			target string
		}) {
			<-start
			results <- call(t, job.h, "PUT", "/me/blocks/"+job.target, map[string]int64{"revision": 0}, job.cookie)
		}(job)
	}
	close(start)
	for i := 0; i < 2; i++ {
		requireCode(t, <-results, 200)
	}
	if privacy(t, h, ac).Revision != 1 || privacy(t, h, bc).Revision != 1 {
		t.Fatal("opposite owners lost independent CAS")
	}
}
func TestContactPrivacyPostgresBlockQuotaPaginationAndDatabaseInvariant(t *testing.T) {
	ctx, s, _, _, h := postgresMediaFixture(t)
	ac := memberCookie(t, h)
	if _, e := s.pool.Exec(ctx, `INSERT INTO gongming_users(id,handle,name,email,role,status,password_hash,created_at) SELECT 'quota_contact_'||i,'quota_contact_'||i,'Quota contact '||i,'quota-contact-'||i||'@example.test','member','active','not-a-login-hash',now() FROM generate_series(1,501) i`); e != nil {
		t.Fatal(e)
	}
	blockContact(t, h, ac, "quota_contact_1", 0, true)
	if _, e := s.pool.Exec(ctx, `INSERT INTO gongming_user_blocks(owner_id,target_id,created_at) SELECT 'user_demo','quota_contact_'||i,now() FROM generate_series(2,500) i`); e != nil {
		t.Fatal(e)
	}
	page := payload[struct {
		Items    []BlockEntry
		Total    int
		Revision int64
	}](t, call(t, h, "GET", "/me/blocks?limit=100&offset=400", nil, ac))
	if len(page.Items) != 100 || page.Total != 500 || page.Revision != 1 {
		t.Fatal(page.Total, len(page.Items), page.Revision)
	}
	requireCode(t, call(t, h, "PUT", "/me/blocks/quota_contact_501", map[string]int64{"revision": 1}, ac), 409)
	_, e := s.pool.Exec(ctx, `INSERT INTO gongming_user_blocks(owner_id,target_id,created_at) VALUES('user_demo','quota_contact_501',now())`)
	expectDatabaseCode(t, e, "23514")
	_, e = s.pool.Exec(ctx, `UPDATE gongming_user_blocks SET created_at=created_at+interval '1 second' WHERE owner_id='user_demo' AND target_id='quota_contact_1'`)
	expectDatabaseCode(t, e, "23514")
	requireCode(t, call(t, h, "GET", "/me/blocks?limit=101", nil, ac), 400)
	if privacy(t, h, ac).Revision != 1 {
		t.Fatal("failed quota write changed CAS")
	}
}
