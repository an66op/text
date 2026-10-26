package platform

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

func intString(v int) string { return strconv.Itoa(v) }
func eventSQLAudit(ctx context.Context, tx pgx.Tx, u PublicUser, action, target, detail string, now time.Time) error {
	return execRow(ctx, tx, `INSERT INTO gongming_audits(id,actor_id,actor_name,action,target_id,detail,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, newID("audit_"), nullString(u.ID), u.Name, action, target, detail, now)
}
func eventSQLQuota(ctx context.Context, tx pgx.Tx, circle, excluding string, now time.Time) error {
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM gongming_circle_events WHERE circle_id=$1 AND lifecycle='published' AND ends_at>$2 AND id<>$3`, circle, now, excluding).Scan(&count); err != nil {
		return err
	}
	if count >= 20 {
		return conflict("每圈最多20个尚未结束的活动")
	}
	return nil
}
func insertCircleEvent(ctx context.Context, tx pgx.Tx, e storedCircleEvent) error {
	return execRow(ctx, tx, `INSERT INTO gongming_circle_events(id,circle_id,creator_id,client_id,fingerprint,title,description,mode,location,starts_at,ends_at,registration_closes_at,capacity,registered_count,waitlisted_count,registration_sequence,lifecycle,moderation,note,revision,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`, e.ID, e.CircleID, e.CreatorID, e.ClientID, e.Fingerprint, e.Title, e.Description, e.Mode, e.Location, e.StartsAt, e.EndsAt, e.RegistrationClosesAt, e.Capacity, e.RegisteredCount, e.WaitlistedCount, e.RegistrationSequence, e.Lifecycle, e.Moderation, e.Note, e.Revision, e.CreatedAt, e.UpdatedAt)
}
func updateCircleEvent(ctx context.Context, tx pgx.Tx, e storedCircleEvent) error {
	return execRow(ctx, tx, `UPDATE gongming_circle_events SET title=$2,description=$3,mode=$4,location=$5,starts_at=$6,ends_at=$7,registration_closes_at=$8,capacity=$9,registered_count=$10,waitlisted_count=$11,registration_sequence=$12,lifecycle=$13,moderation=$14,note=$15,revision=$16,updated_at=$17 WHERE id=$1`, e.ID, e.Title, e.Description, e.Mode, e.Location, e.StartsAt, e.EndsAt, e.RegistrationClosesAt, e.Capacity, e.RegisteredCount, e.WaitlistedCount, e.RegistrationSequence, e.Lifecycle, e.Moderation, e.Note, e.Revision, e.UpdatedAt)
}
func updateEventCounts(ctx context.Context, tx pgx.Tx, e storedCircleEvent) error {
	return execRow(ctx, tx, `UPDATE gongming_circle_events SET registered_count=$2,waitlisted_count=$3,registration_sequence=$4 WHERE id=$1`, e.ID, e.RegisteredCount, e.WaitlistedCount, e.RegistrationSequence)
}
func eventSQLCreate(r *http.Request, tx pgx.Tx, u PublicUser, now time.Time) (any, error) {
	c, err := eventSQLCircle(r.Context(), tx, u.ID, r.PathValue("id"), "UPDATE")
	if err != nil {
		return nil, err
	}
	if err = requireEventCircle(c, true, true); err != nil {
		return nil, err
	}
	var input struct {
		EventInput
		ClientID string `json:"clientId"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	if !requestPattern.MatchString(input.ClientID) {
		return nil, bad("clientId格式无效")
	}
	v, err := cleanEventInput(input.EventInput)
	if err != nil {
		return nil, err
	}
	fingerprint := eventFingerprint(v)
	existing, err := scanCircleEvent(tx.QueryRow(r.Context(), `SELECT `+eventSQLFields+eventSQLFrom+`WHERE e.creator_id=$1 AND e.circle_id=$2 AND e.client_id=$3`, u.ID, c.ID, input.ClientID))
	if err == nil {
		if err = eventReadable(existing, c); err != nil {
			return nil, err
		}
		if existing.Fingerprint != fingerprint {
			return nil, conflict("相同clientId不能提交不同活动")
		}
		return eventSQLProjection(r.Context(), tx, existing, u.ID, now)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if err = validEventTimes(v, now, nil); err != nil {
		return nil, err
	}
	if err = eventSQLQuota(r.Context(), tx, c.ID, "", now); err != nil {
		return nil, err
	}
	e := storedCircleEvent{CircleEvent: CircleEvent{ID: newID("cevent_"), CircleID: c.ID, Creator: u, EventInput: v, Lifecycle: "published", Moderation: "visible", Revision: 1, CreatedAt: now, UpdatedAt: now}, CreatorID: u.ID, ClientID: input.ClientID, Fingerprint: fingerprint, CircleName: c.Name, CircleStatus: c.Status}
	if err = insertCircleEvent(r.Context(), tx, e); err != nil {
		return nil, err
	}
	if err = eventSQLAudit(r.Context(), tx, u, "circle.event.create", e.ID, "circle="+c.ID, now); err != nil {
		return nil, err
	}
	return eventSQLProjection(r.Context(), tx, e, u.ID, now)
}
func eventSQLManaged(r *http.Request, tx pgx.Tx, u PublicUser) (eventCircleAccess, storedCircleEvent, error) {
	c, err := eventSQLCircle(r.Context(), tx, u.ID, r.PathValue("id"), "UPDATE")
	if err != nil {
		return c, storedCircleEvent{}, err
	}
	if err = requireEventCircle(c, true, false); err != nil {
		return c, storedCircleEvent{}, err
	}
	e, err := eventSQLGet(r.Context(), tx, c.ID, r.PathValue("eventId"), true)
	return c, e, err
}
func eventSQLEdit(r *http.Request, tx pgx.Tx, u PublicUser, now time.Time, drafts *[]NotificationDraft) (any, error) {
	c, e, err := eventSQLManaged(r, tx, u)
	if err != nil {
		return nil, err
	}
	if err = requireEventCircle(c, true, true); err != nil {
		return nil, err
	}
	var input struct {
		EventInput
		Revision int64 `json:"revision"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	if input.Revision < 1 {
		return nil, bad("请提供revision")
	}
	if e.Revision != input.Revision {
		return nil, conflict("活动已更新，请刷新确认")
	}
	if e.Lifecycle == "cancelled" || !now.Before(e.StartsAt) {
		return nil, conflict("已取消或已开始的活动不能编辑")
	}
	v, err := cleanEventInput(input.EventInput)
	if err != nil {
		return nil, err
	}
	if err = validEventTimes(v, now, &e); err != nil {
		return nil, err
	}
	if v.Capacity < e.RegisteredCount {
		return nil, conflict("容量不能低于已确认人数")
	}
	if err = eventSQLQuota(r.Context(), tx, e.CircleID, e.ID, now); err != nil {
		return nil, err
	}
	// PostgreSQL may scan UTC timestamps with a different Location pointer;
	// compare semantic instants rather than serialized/reflect time metadata.
	changed := v.Title != e.Title || v.Description != e.Description || v.Mode != e.Mode || v.Location != e.Location || v.Capacity != e.Capacity || !v.StartsAt.Equal(e.StartsAt) || !v.EndsAt.Equal(e.EndsAt) || !v.RegistrationClosesAt.Equal(e.RegistrationClosesAt)
	if !changed {
		return eventSQLProjection(r.Context(), tx, e, u.ID, now)
	}
	if changed {
		e.EventInput = v
		e.Revision++
		e.UpdatedAt = now
		if err = updateCircleEvent(r.Context(), tx, e); err != nil {
			return nil, err
		}
		if err = eventNotifyAudience(r.Context(), tx, e, "circle-event-update", "updated", u.ID, false, now, drafts); err != nil {
			return nil, err
		}
		if err = eventSQLAudit(r.Context(), tx, u, "circle.event.update", e.ID, "revision="+strconv.FormatInt(e.Revision, 10), now); err != nil {
			return nil, err
		}
	}
	if err = coordinateEventQueue(r.Context(), tx, &e, u.ID, now, drafts); err != nil {
		return nil, err
	}
	return eventSQLProjection(r.Context(), tx, e, u.ID, now)
}
func eventSQLCancel(r *http.Request, tx pgx.Tx, u PublicUser, now time.Time, drafts *[]NotificationDraft) (any, error) {
	c, e, err := eventSQLManaged(r, tx, u)
	if err != nil {
		return nil, err
	}
	var input struct {
		Revision int64 `json:"revision"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	if input.Revision < 1 {
		return nil, bad("请提供revision")
	}
	if e.Lifecycle == "cancelled" {
		return eventSQLProjection(r.Context(), tx, e, u.ID, now)
	}
	if err = requireEventCircle(c, true, true); err != nil {
		return nil, err
	}
	if e.Revision != input.Revision {
		return nil, conflict("活动已更新，请刷新确认")
	}
	if !now.Before(e.EndsAt) {
		return nil, conflict("已结束活动不能取消")
	}
	e.Revision++
	if err = eventNotifyAudience(r.Context(), tx, e, "circle-event-update", "cancelled", u.ID, false, now, drafts); err != nil {
		return nil, err
	}
	if err = execRow(r.Context(), tx, `UPDATE gongming_circle_event_registrations SET status='cancelled',reason='event',updated_at=GREATEST(created_at,$2) WHERE event_id=$1 AND status IN ('registered','waitlisted')`, e.ID, now); err != nil {
		return nil, err
	}
	e.Lifecycle = "cancelled"
	e.RegisteredCount = 0
	e.WaitlistedCount = 0
	e.UpdatedAt = now
	if err = updateCircleEvent(r.Context(), tx, e); err != nil {
		return nil, err
	}
	if err = eventSQLAudit(r.Context(), tx, u, "circle.event.cancel", e.ID, "circle="+e.CircleID, now); err != nil {
		return nil, err
	}
	return eventSQLProjection(r.Context(), tx, e, u.ID, now)
}
func eventSQLReport(r *http.Request, tx pgx.Tx, u PublicUser, now time.Time) (any, error) {
	c, err := eventSQLCircle(r.Context(), tx, u.ID, r.PathValue("id"), "SHARE")
	if err != nil {
		return nil, err
	}
	if err = requireEventCircle(c, false, false); err != nil {
		return nil, err
	}
	e, err := eventSQLGet(r.Context(), tx, c.ID, r.PathValue("eventId"), true)
	if err != nil {
		return nil, err
	}
	if err = eventReadable(e, c); err != nil {
		return nil, err
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	reason, err := trimText(input.Reason, 1000)
	if err != nil {
		return nil, err
	}
	var exists bool
	if err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM gongming_reports WHERE reporter_id=$1 AND target_type='circle-event' AND target_id=$2 AND status='open')`, u.ID, e.ID).Scan(&exists); err != nil {
		return nil, err
	}
	if exists {
		return nil, conflict("你已提交此活动的举报")
	}
	v := Report{ID: newID("report_"), ReporterID: u.ID, TargetType: "circle-event", TargetID: e.ID, Reason: reason, Status: "open", CreatedAt: now}
	if err = execRow(r.Context(), tx, `INSERT INTO gongming_reports(id,reporter_id,target_type,target_id,reason,status,note,created_at) VALUES($1,$2,$3,$4,$5,$6,'',$7)`, v.ID, v.ReporterID, v.TargetType, v.TargetID, v.Reason, v.Status, v.CreatedAt); err != nil {
		return nil, err
	}
	return v, nil
}
func eventSQLGovern(r *http.Request, tx pgx.Tx, u PublicUser, now time.Time, drafts *[]NotificationDraft) (any, error) {
	var circle string
	if err := tx.QueryRow(r.Context(), `SELECT circle_id FROM gongming_circle_events WHERE id=$1`, r.PathValue("eventId")).Scan(&circle); errors.Is(err, pgx.ErrNoRows) {
		return nil, missing("活动不存在")
	} else if err != nil {
		return nil, err
	}
	c, err := eventSQLCircle(r.Context(), tx, u.ID, circle, "SHARE")
	if err != nil {
		return nil, err
	}
	e, err := eventSQLGet(r.Context(), tx, c.ID, r.PathValue("eventId"), true)
	if err != nil {
		return nil, err
	}
	var input struct {
		Moderation string `json:"moderation"`
		Note       string `json:"note"`
		Revision   int64  `json:"revision"`
	}
	if err = decode(r, &input); err != nil {
		return nil, err
	}
	if input.Revision < 1 {
		return nil, bad("请提供revision")
	}
	if input.Moderation != "visible" && input.Moderation != "hidden" {
		return nil, bad("活动可见性无效")
	}
	note, err := trimText(input.Note, 1000)
	if err != nil {
		return nil, err
	}
	if e.Lifecycle == "cancelled" {
		return nil, conflict("已取消活动只读")
	}
	if e.Revision != input.Revision {
		return nil, conflict("活动已更新，请刷新确认")
	}
	if input.Moderation == "visible" && c.Status != "active" {
		return nil, conflict("圈子须正常开放才能恢复活动可见性")
	}
	changed := e.Moderation != input.Moderation
	e.Moderation = input.Moderation
	e.Note = note
	e.Revision++
	e.UpdatedAt = now
	if err = updateCircleEvent(r.Context(), tx, e); err != nil {
		return nil, err
	}
	if changed {
		if err = eventNotifyAudience(r.Context(), tx, e, "circle-event-review", input.Moderation, u.ID, true, now, drafts); err != nil {
			return nil, err
		}
		if input.Moderation == "visible" {
			if err = coordinateEventQueue(r.Context(), tx, &e, u.ID, now, drafts); err != nil {
				return nil, err
			}
		}
	}
	if err = eventSQLAudit(r.Context(), tx, u, "circle.event.govern", e.ID, "moderation="+e.Moderation+", note="+note, now); err != nil {
		return nil, err
	}
	v := eventBaseProjection(e, now)
	return AdminCircleEvent{v, e.CircleName, e.CircleStatus, e.Note}, nil
}
