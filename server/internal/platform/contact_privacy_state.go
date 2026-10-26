package platform

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
)

// Only request-local checks/results live on State. Private policy/block tables
// are never loaded into, cloned with, or written back by the State adapter.
func prepareStateContacts(ctx context.Context, tx pgx.Tx, before, after *State) ([]string, error) {
	checks := append([]contactCheck{}, after.ContactChecks...)
	changed := map[string]bool{}
	for _, key := range mapKeys(after.FriendRequests) {
		v := after.FriendRequests[key]
		old, exists := before.FriendRequests[key]
		if before.Accounts[v.FromID].User.ID == "" || before.Accounts[v.ToID].User.ID == "" {
			continue
		}
		if !exists && v.Status == "pending" {
			checks = append(checks, contactCheck{v.FromID, v.ToID, "friend-request"})
		}
		if exists && old.Status == "pending" && v.Status == "accepted" {
			checks = append(checks, contactCheck{v.ToID, v.FromID, "friend-accept"})
		}
	}
	pairs := map[string]StoredFriendship{}
	for k, v := range before.Friendships {
		pairs[k] = v
	}
	for k, v := range after.Friendships {
		pairs[k] = v
	}
	for k, v := range pairs {
		if entityEqual(before.Friendships[k], after.Friendships[k]) {
			continue
		}
		if before.Accounts[v.UserA].User.ID == "" || before.Accounts[v.UserB].User.ID == "" {
			continue
		}
		changed[v.UserA] = true
		changed[v.UserB] = true
		if _, ok := after.Friendships[k]; ok {
			checks = append(checks, contactCheck{v.UserA, v.UserB, "friend-accept"})
		}
	}
	for id, v := range after.Accounts {
		if old, ok := before.Accounts[id]; ok && old.User.Status != v.User.Status {
			changed[id] = true
		}
	}
	for id, c := range after.Conversations {
		old, exists := before.Conversations[id]
		if c.Kind == "direct" && exists {
			continue
		}
		inviter := c.OwnerID
		if exists {
			inviter = old.OwnerID
		}
		for _, target := range c.Members {
			if target == inviter || exists && member(old, target) {
				continue
			}
			if before.Accounts[inviter].User.ID == "" || before.Accounts[target].User.ID == "" {
				continue
			}
			kind := "invite"
			if c.Kind == "direct" {
				kind = "message"
			}
			checks = append(checks, contactCheck{inviter, target, kind})
		}
	}
	ids := map[string]bool{}
	for id := range changed {
		ids[id] = true
	}
	for _, check := range checks {
		ids[check.Actor] = true
		ids[check.Target] = true
	}
	if len(ids) == 0 {
		return nil, nil
	}
	// Authenticate the actor/session before acquiring any contact guard. A trusted
	// internal Store.Update without HTTP credentials still supports migrations/tests.
	if credential, ok := ctx.Value(browserGateKey{}).(browserCredential); ok && credential.SessionHash != "" && !credential.Bypass {
		var user string
		e := tx.QueryRow(ctx, `SELECT u.id FROM gongming_sessions s JOIN gongming_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status='active' AND `+browserSessionPredicate("s", "$2")+` FOR SHARE OF u,s`, credential.SessionHash, credential.BrowserHash).Scan(&user)
		if errors.Is(e, pgx.ErrNoRows) {
			return nil, unauthorized()
		}
		if e != nil {
			return nil, e
		}
	}
	if e := lockContactGuards(ctx, tx, mapKeys(ids), len(changed) > 0); e != nil {
		return nil, e
	}
	for _, check := range checks {
		if e := checkContactSQL(ctx, tx, check); e != nil {
			return nil, e
		}
	}
	if len(changed) > 0 {
		if e := bumpContactGuards(ctx, tx, mapKeys(changed)); e != nil {
			return nil, e
		}
	}
	return mapKeys(changed), nil
}
func projectStateContactResults(ctx context.Context, tx pgx.Tx, state *State) error {
	for _, result := range state.ContactResults {
		items, e := projectContactConversations(ctx, tx, result.Viewer, []Conversation{*result.Conversation})
		if e != nil {
			return e
		}
		*result.Conversation = items[0]
	}
	return nil
}
func projectContactConversations(ctx context.Context, tx pgx.Tx, viewer string, items []Conversation) ([]Conversation, error) {
	targets := map[string]bool{}
	for _, c := range items {
		if c.Kind == "direct" {
			for _, id := range c.Members {
				if id != viewer {
					targets[id] = true
				}
			}
		}
	}
	states, e := readContactTargets(ctx, tx, viewer, mapKeys(targets))
	if e != nil {
		return nil, e
	}
	for i := range items {
		c := &items[i]
		c.CanSend = member(c.StoredConversation, viewer) && (c.Kind != "channel" || c.OwnerID == viewer)
		if c.Kind == "direct" {
			c.CanSend = false
			if len(c.Members) == 2 {
				for _, id := range c.Members {
					if id != viewer {
						v, ok := states[id]
						c.CanSend = member(c.StoredConversation, viewer) && ok && v.Active && !v.Blocked && contactAllows(v.DirectMessagePolicy, v.Friended)
					}
				}
			}
		}
	}
	return items, nil
}
func prepareDirectContact(rctx context.Context, tx pgx.Tx, conversation, viewer string) error {
	if !validContactID(conversation) {
		return bad("会话编号不正确")
	}
	var kind string
	e := tx.QueryRow(rctx, `SELECT kind FROM gongming_conversations WHERE id=$1`, conversation).Scan(&kind)
	if errors.Is(e, pgx.ErrNoRows) {
		return missing("会话不存在或你尚未加入")
	}
	if e != nil {
		return e
	}
	if kind != "direct" {
		return nil
	}
	ids := []string{}
	e = collectMediaRows(rctx, tx, `SELECT user_id FROM gongming_conversation_members WHERE conversation_id=$1 ORDER BY user_id`, func(rows pgx.Rows) error {
		var id string
		if e := rows.Scan(&id); e != nil {
			return e
		}
		ids = append(ids, id)
		return nil
	}, conversation)
	if e != nil {
		return e
	}
	if len(ids) != 2 {
		return missing("会话不存在或你尚未加入")
	}
	found := false
	for _, id := range ids {
		found = found || id == viewer
	}
	if !found {
		return missing("会话不存在或你尚未加入")
	}
	return lockContactGuards(rctx, tx, ids, false)
}
func checkDirectContact(ctx context.Context, tx pgx.Tx, c StoredConversation, viewer string) error {
	if c.Kind != "direct" {
		return nil
	}
	var target string
	var active bool
	if e := tx.QueryRow(ctx, `SELECT m.user_id,u.status='active' FROM gongming_conversation_members m JOIN gongming_users u ON u.id=m.user_id WHERE m.conversation_id=$1 AND m.user_id<>$2`, c.ID, viewer).Scan(&target, &active); e != nil {
		return e
	}
	if !active {
		return contactRestricted()
	}
	return checkContactSQL(ctx, tx, contactCheck{viewer, target, "message"})
}
