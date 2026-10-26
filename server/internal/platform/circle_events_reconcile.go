package platform

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// State owns only membership/account transitions, never event history. Lock
// every unfinished event in an affected circle, not merely visible signup rows:
// an older SERIALIZABLE snapshot must collide with a just-committed SQL signup's
// event counter/ordinal write and retry instead of overlooking that new row.
func reconcileCircleEvents(ctx context.Context, tx pgx.Tx, before, after *State) error {
	circles := map[string]bool{}
	lostAccounts := map[string]bool{}
	for id, old := range before.Accounts {
		if old.User.Status == "active" && after.Accounts[id].User.Status != "active" {
			lostAccounts[id] = true
		}
	}
	for key, old := range before.CircleMembers {
		next, exists := after.CircleMembers[key]
		if old.Status == "active" && (!exists || next.Status != "active") {
			circles[old.CircleID] = true
		}
		if lostAccounts[old.UserID] {
			circles[old.CircleID] = true
		}
	}
	for _, member := range after.CircleMembers {
		if lostAccounts[member.UserID] {
			circles[member.CircleID] = true
		}
	}
	for id, old := range before.Circles {
		if old.Status == "suspended" && after.Circles[id].Status == "active" {
			circles[id] = true
		}
	}
	if len(circles) == 0 {
		return nil
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	actor := ""
	if len(after.Audits) > len(before.Audits) {
		audit := after.Audits[len(after.Audits)-1]
		now = audit.CreatedAt.UTC().Truncate(time.Microsecond)
		actor = audit.ActorID
	}
	rows, err := tx.Query(ctx, `SELECT `+eventSQLFields+eventSQLFrom+`WHERE e.circle_id=ANY($1::text[]) AND e.lifecycle='published' AND e.ends_at>$2 ORDER BY e.id FOR UPDATE OF e`, mapKeys(circles), now)
	if err != nil {
		return err
	}
	events := []storedCircleEvent{}
	for rows.Next() {
		e, x := scanCircleEvent(rows)
		if x != nil {
			rows.Close()
			return x
		}
		events = append(events, e)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, e := range events {
		if err = coordinateEventQueue(ctx, tx, &e, actor, now, &after.NotificationDrafts); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) seedDevelopmentCircleEvents(s *State) {
	for _, c := range s.Circles {
		if c.Visibility != "public" || c.CreatorID != "user_demo" {
			continue
		}
		now := a.circleNow()
		for index := 0; index < 2; index++ {
			confirmed, waiting := "user_demo", "user_friend"
			title := "开发示例 · 周末城市漫步"
			if index == 1 {
				confirmed, waiting = "user_friend", "user_demo"
				title = "开发示例 · 满额与候补体验"
			}
			v := EventInput{Title: title, Description: "真实PostgreSQL开发示例：报名、候补与自动递补均由服务端事务决定，无收费或签到定位。", Mode: "offline", Location: "开发示例 · 城市公园入口（纯文本）", StartsAt: now.Add(time.Duration(48+index*24) * time.Hour), EndsAt: now.Add(time.Duration(50+index*24) * time.Hour), RegistrationClosesAt: now.Add(time.Duration(36+index*24) * time.Hour), Capacity: 1}
			e := storedCircleEvent{CircleEvent: CircleEvent{ID: newID("cevent_"), CircleID: c.ID, Creator: publicUser(s.Accounts["user_demo"].User), EventInput: v, RegisteredCount: 1, WaitlistedCount: 1, Lifecycle: "published", Moderation: "visible", Revision: 1, CreatedAt: now, UpdatedAt: now}, CreatorID: "user_demo", ClientID: "development-event-" + intString(index), Fingerprint: eventFingerprint(v), RegistrationSequence: 2, CircleName: c.Name, CircleStatus: c.Status}
			s.EventSeedDrafts = append(s.EventSeedDrafts, eventSeedDraft{e, confirmed, waiting})
		}
		return
	}
}
func persistCircleEventSeeds(ctx context.Context, tx pgx.Tx, drafts []eventSeedDraft) error {
	for _, d := range drafts {
		if err := insertCircleEvent(ctx, tx, d.Event); err != nil {
			return err
		}
		for i, user := range []string{d.Confirmed, d.Waiting} {
			status, intent := "registered", "join"
			if i == 1 {
				status, intent = "waitlisted", "waitlist"
			}
			if err := execRow(ctx, tx, `INSERT INTO gongming_circle_event_registrations(event_id,user_id,circle_id,status,reason,ordinal,created_at,updated_at) VALUES($1,$2,$3,$4,'',$5,$6,$6)`, d.Event.ID, user, d.Event.CircleID, status, i+1, d.Event.CreatedAt); err != nil {
				return err
			}
			if err := execRow(ctx, tx, `INSERT INTO gongming_circle_event_requests(event_id,user_id,client_id,intent,created_at) VALUES($1,$2,$3,$4,$5)`, d.Event.ID, user, "development-registration-"+intString(i), intent, d.Event.CreatedAt); err != nil {
				return err
			}
		}
	}
	return nil
}
