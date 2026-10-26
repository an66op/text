package platform

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

func eventDraft(drafts *[]NotificationDraft, kind, actor, user, event, outcome, key string, now time.Time) {
	if actor == user || user == "" {
		return
	}
	*drafts = append(*drafts, NotificationDraft{RecipientID: user, ActorID: actor, Kind: kind, Outcome: outcome, ReferenceID: event, EventKey: key, CreatedAt: now})
}
func eventNotifyAudience(ctx context.Context, tx pgx.Tx, e storedCircleEvent, kind, outcome, actor string, includeCreator bool, now time.Time, drafts *[]NotificationDraft) error {
	rows, err := tx.Query(ctx, `SELECT m.user_id FROM gongming_circle_members m JOIN gongming_users u ON u.id=m.user_id WHERE m.circle_id=$1 AND m.status='active' AND u.status='active' AND EXISTS(SELECT 1 FROM gongming_circle_event_registrations r WHERE r.event_id=$2 AND r.user_id=m.user_id AND r.status IN ('registered','waitlisted')) UNION SELECT $4::text WHERE $3::boolean ORDER BY 1`, e.CircleID, e.ID, includeCreator, e.CreatorID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var user string
		if err = rows.Scan(&user); err != nil {
			return err
		}
		eventDraft(drafts, kind, actor, user, e.ID, outcome, kind+":"+e.ID+":"+strconv.FormatInt(e.Revision, 10), now)
	}
	return rows.Err()
}
func cancelEventRegistration(ctx context.Context, tx pgx.Tx, e *storedCircleEvent, user, status, reason string, now time.Time) error {
	if status != "registered" && status != "waitlisted" {
		return nil
	}
	if err := execRow(ctx, tx, `UPDATE gongming_circle_event_registrations SET status='cancelled',reason=$3,updated_at=GREATEST(created_at,$4) WHERE event_id=$1 AND user_id=$2`, e.ID, user, reason, now); err != nil {
		return err
	}
	if status == "registered" {
		e.RegisteredCount--
	} else {
		e.WaitlistedCount--
	}
	return nil
}

// Caller holds the event FOR UPDATE lock. Coordination never commits on its
// own: a full-capacity join error rolls back promotions, audits and receipts.
func coordinateEventQueue(ctx context.Context, tx pgx.Tx, e *storedCircleEvent, actor string, now time.Time, drafts *[]NotificationDraft) error {
	if e.Lifecycle != "published" || !now.Before(e.EndsAt) {
		return nil
	}
	rows, err := tx.Query(ctx, `SELECT r.user_id,r.status,CASE WHEN u.status<>'active' THEN 'account' ELSE 'membership' END FROM gongming_circle_event_registrations r JOIN gongming_users u ON u.id=r.user_id JOIN gongming_circle_members m ON m.circle_id=r.circle_id AND m.user_id=r.user_id WHERE r.event_id=$1 AND r.status IN ('registered','waitlisted') AND (u.status<>'active' OR m.status<>'active') ORDER BY r.ordinal,r.user_id`, e.ID)
	if err != nil {
		return err
	}
	invalid := [][3]string{}
	for rows.Next() {
		v := [3]string{}
		if err = rows.Scan(&v[0], &v[1], &v[2]); err != nil {
			rows.Close()
			return err
		}
		invalid = append(invalid, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, v := range invalid {
		if err = cancelEventRegistration(ctx, tx, e, v[0], v[1], v[2], now); err != nil {
			return err
		}
		if err = eventSQLAudit(ctx, tx, PublicUser{ID: actor, Name: "活动登记协调"}, "circle.event.registration", e.ID, "user="+v[0]+", reason="+v[2], now); err != nil {
			return err
		}
	}
	if eventOpen(*e, now) && e.RegisteredCount < e.Capacity {
		rows, err = tx.Query(ctx, `SELECT r.user_id,r.ordinal FROM gongming_circle_event_registrations r JOIN gongming_users u ON u.id=r.user_id JOIN gongming_circle_members m ON m.circle_id=r.circle_id AND m.user_id=r.user_id WHERE r.event_id=$1 AND r.status='waitlisted' AND u.status='active' AND m.status='active' ORDER BY r.ordinal,r.user_id LIMIT $2 FOR UPDATE OF r`, e.ID, e.Capacity-e.RegisteredCount)
		if err != nil {
			return err
		}
		waiting := []struct {
			user    string
			ordinal int64
		}{}
		for rows.Next() {
			v := struct {
				user    string
				ordinal int64
			}{}
			if err = rows.Scan(&v.user, &v.ordinal); err != nil {
				rows.Close()
				return err
			}
			waiting = append(waiting, v)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		for _, v := range waiting {
			if err = execRow(ctx, tx, `UPDATE gongming_circle_event_registrations SET status='registered',reason='',updated_at=GREATEST(created_at,$3) WHERE event_id=$1 AND user_id=$2`, e.ID, v.user, now); err != nil {
				return err
			}
			e.RegisteredCount++
			e.WaitlistedCount--
			eventDraft(drafts, "circle-event-registration", actor, v.user, e.ID, "promoted", "circle-event-registration:"+e.ID+":"+v.user+":"+strconv.FormatInt(v.ordinal, 10), now)
			if err = eventSQLAudit(ctx, tx, PublicUser{ID: actor, Name: "活动候补递补"}, "circle.event.registration", e.ID, "user="+v.user+", status=promoted", now); err != nil {
				return err
			}
		}
	}
	return updateEventCounts(ctx, tx, *e)
}
func eventSQLRegister(r *http.Request, tx pgx.Tx, u PublicUser, now time.Time, drafts *[]NotificationDraft) (any, error) {
	var input struct {
		Intent   string `json:"intent"`
		ClientID string `json:"clientId"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	if input.Intent != "join" && input.Intent != "waitlist" && input.Intent != "leave" {
		return nil, bad("报名意图无效")
	}
	if !requestPattern.MatchString(input.ClientID) {
		return nil, bad("clientId格式无效")
	}
	c, err := eventSQLCircle(r.Context(), tx, u.ID, r.PathValue("id"), "SHARE")
	if err != nil {
		return nil, err
	}
	e, err := eventSQLGet(r.Context(), tx, c.ID, r.PathValue("eventId"), true)
	if err != nil {
		return nil, err
	}
	reg, err := eventSQLRegistration(r.Context(), tx, e.ID, u.ID)
	if err != nil {
		return nil, err
	}
	var oldIntent string
	err = tx.QueryRow(r.Context(), `SELECT intent FROM gongming_circle_event_requests WHERE event_id=$1 AND user_id=$2 AND client_id=$3`, e.ID, u.ID, input.ClientID).Scan(&oldIntent)
	hasReceipt := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	access := requireEventCircle(c, false, false)
	if access == nil {
		access = eventReadable(e, c)
	}
	if input.Intent != "leave" {
		if access != nil {
			return nil, access
		}
	} else if access != nil && reg == nil && !hasReceipt {
		return nil, missing("登记不存在或无访问权限")
	}
	if hasReceipt {
		if oldIntent != input.Intent {
			return nil, conflict("相同clientId不能更改报名意图")
		}
		return eventRegistrationResult(reg), nil
	}
	if input.Intent == "leave" {
		if reg != nil && (reg.Status == "registered" || reg.Status == "waitlisted") {
			if !now.Before(e.EndsAt) {
				return nil, conflict("活动已结束，不能取消报名")
			}
			if err = cancelEventRegistration(r.Context(), tx, &e, u.ID, reg.Status, "user", now); err != nil {
				return nil, err
			}
			if err = eventSQLAudit(r.Context(), tx, u, "circle.event.registration", e.ID, "intent=leave", now); err != nil {
				return nil, err
			}
		}
		if err = coordinateEventQueue(r.Context(), tx, &e, u.ID, now, drafts); err != nil {
			return nil, err
		}
	} else {
		if err = requireEventCircle(c, false, true); err != nil {
			return nil, err
		}
		if !eventOpen(e, now) {
			return nil, conflict("活动当前不开放报名")
		}
		if err = coordinateEventQueue(r.Context(), tx, &e, u.ID, now, drafts); err != nil {
			return nil, err
		}
		reg, err = eventSQLRegistration(r.Context(), tx, e.ID, u.ID)
		if err != nil {
			return nil, err
		}
		if reg == nil || reg.Status == "cancelled" {
			status := "registered"
			if e.RegisteredCount >= e.Capacity {
				if input.Intent == "join" {
					return nil, conflict("确认名额已满，可选择候补")
				}
				status = "waitlisted"
			}
			e.RegistrationSequence++
			created := now
			if reg != nil {
				created = reg.CreatedAt
			}
			if err = execRow(r.Context(), tx, `INSERT INTO gongming_circle_event_registrations(event_id,user_id,circle_id,status,reason,ordinal,created_at,updated_at) VALUES($1,$2,$3,$4,'',$5,$6,$7) ON CONFLICT(event_id,user_id) DO UPDATE SET status=EXCLUDED.status,reason='',ordinal=EXCLUDED.ordinal,updated_at=EXCLUDED.updated_at`, e.ID, u.ID, e.CircleID, status, e.RegistrationSequence, created, now); err != nil {
				return nil, err
			}
			if status == "registered" {
				e.RegisteredCount++
			} else {
				e.WaitlistedCount++
			}
			if err = updateEventCounts(r.Context(), tx, e); err != nil {
				return nil, err
			}
			if err = eventSQLAudit(r.Context(), tx, u, "circle.event.registration", e.ID, "intent="+input.Intent+", status="+status, now); err != nil {
				return nil, err
			}
		}
	}
	if err = execRow(r.Context(), tx, `INSERT INTO gongming_circle_event_requests(event_id,user_id,client_id,intent,created_at) VALUES($1,$2,$3,$4,$5)`, e.ID, u.ID, input.ClientID, input.Intent, now); err != nil {
		return nil, err
	}
	reg, err = eventSQLRegistration(r.Context(), tx, e.ID, u.ID)
	return eventRegistrationResult(reg), err
}
func eventRegistrationResult(v *storedEventRegistration) any {
	var reg *EventRegistration
	if v != nil {
		reg = &v.EventRegistration
	}
	return map[string]any{"ok": true, "registration": reg}
}
