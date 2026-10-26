package platform

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const eventSQLFields = `e.id,e.circle_id,e.creator_id,e.client_id,e.fingerprint,e.title,e.description,e.mode,e.location,e.starts_at,e.ends_at,e.registration_closes_at,e.capacity,e.registered_count,e.waitlisted_count,e.registration_sequence,e.lifecycle,e.moderation,e.note,e.revision,e.created_at,e.updated_at,c.name,c.status,u.id,u.handle,u.name,u.avatar,u.bio`
const eventSQLFrom = ` FROM gongming_circle_events e JOIN gongming_circles c ON c.id=e.circle_id JOIN gongming_users u ON u.id=e.creator_id `

func scanCircleEvent(row messagingSQLScanner) (storedCircleEvent, error) {
	e := storedCircleEvent{}
	err := row.Scan(&e.ID, &e.CircleID, &e.CreatorID, &e.ClientID, &e.Fingerprint, &e.Title, &e.Description, &e.Mode, &e.Location, &e.StartsAt, &e.EndsAt, &e.RegistrationClosesAt, &e.Capacity, &e.RegisteredCount, &e.WaitlistedCount, &e.RegistrationSequence, &e.Lifecycle, &e.Moderation, &e.Note, &e.Revision, &e.CreatedAt, &e.UpdatedAt, &e.CircleName, &e.CircleStatus, &e.Creator.ID, &e.Creator.Handle, &e.Creator.Name, &e.Creator.Avatar, &e.Creator.Bio)
	return e, err
}
func eventSQLCircle(ctx context.Context, tx pgx.Tx, user, circle, lock string) (eventCircleAccess, error) {
	c := eventCircleAccess{}
	sql := `SELECT id,name,status FROM gongming_circles WHERE id=$1`
	if lock != "" {
		sql += ` FOR ` + lock
	}
	err := tx.QueryRow(ctx, sql, circle).Scan(&c.ID, &c.Name, &c.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, missing("圈子不存在或无访问权限")
	}
	if err != nil {
		return c, err
	}
	var status string
	sql = `SELECT role,status FROM gongming_circle_members WHERE circle_id=$1 AND user_id=$2`
	if lock != "" {
		sql += ` FOR SHARE`
	}
	err = tx.QueryRow(ctx, sql, circle, user).Scan(&c.Role, &status)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return c, err
	}
	c.Member = err == nil && status == "active"
	return c, nil
}
func requireEventCircle(c eventCircleAccess, manage, write bool) error {
	if !c.Member || c.Status == "suspended" {
		return missing("圈子不存在或你已无访问权限")
	}
	if manage && !circleStaff(c.Role) {
		return forbidden("只有圈主或圈管理员可管理活动")
	}
	if write && c.Status != "active" {
		return conflict("圈子已归档，活动只读")
	}
	return nil
}
func eventSQLGet(ctx context.Context, tx pgx.Tx, circle, id string, lock bool) (storedCircleEvent, error) {
	sql := `SELECT ` + eventSQLFields + eventSQLFrom + `WHERE e.id=$1 AND e.circle_id=$2`
	if lock {
		sql += ` FOR UPDATE OF e`
	}
	e, err := scanCircleEvent(tx.QueryRow(ctx, sql, id, circle))
	if errors.Is(err, pgx.ErrNoRows) {
		err = missing("活动不存在或不可见")
	}
	return e, err
}
func eventReadable(e storedCircleEvent, c eventCircleAccess) error {
	if e.Moderation == "hidden" && !circleStaff(c.Role) {
		return missing("活动不存在或不可见")
	}
	return nil
}
func scanEventRegistration(row messagingSQLScanner) (storedEventRegistration, error) {
	v := storedEventRegistration{}
	err := row.Scan(&v.UserID, &v.Status, &v.Reason, &v.Ordinal, &v.CreatedAt, &v.UpdatedAt)
	return v, err
}
func eventSQLRegistration(ctx context.Context, tx pgx.Tx, event, user string) (*storedEventRegistration, error) {
	v, err := scanEventRegistration(tx.QueryRow(ctx, `SELECT user_id,status,reason,ordinal,created_at,updated_at FROM gongming_circle_event_registrations WHERE event_id=$1 AND user_id=$2`, event, user))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if v.Status == "waitlisted" {
		var pos int
		if err = tx.QueryRow(ctx, `SELECT count(*) FROM gongming_circle_event_registrations WHERE event_id=$1 AND status='waitlisted' AND ordinal<=$2`, event, v.Ordinal).Scan(&pos); err != nil {
			return nil, err
		}
		v.QueuePosition = &pos
	}
	v.CreatedAt = v.CreatedAt.UTC()
	v.UpdatedAt = v.UpdatedAt.UTC()
	return &v, nil
}
func eventBaseProjection(e storedCircleEvent, now time.Time) CircleEvent {
	v := e.CircleEvent
	v.Phase = eventPhase(e, now)
	v.RegistrationOpen = eventOpen(e, now)
	v.MyRegistration = nil
	v.CreatedAt = v.CreatedAt.UTC()
	v.UpdatedAt = v.UpdatedAt.UTC()
	v.StartsAt = v.StartsAt.UTC()
	v.EndsAt = v.EndsAt.UTC()
	v.RegistrationClosesAt = v.RegistrationClosesAt.UTC()
	return v
}
func eventSQLProjection(ctx context.Context, tx pgx.Tx, e storedCircleEvent, user string, now time.Time) (CircleEvent, error) {
	v := eventBaseProjection(e, now)
	reg, err := eventSQLRegistration(ctx, tx, e.ID, user)
	if err != nil {
		return v, err
	}
	if reg != nil {
		v.MyRegistration = &reg.EventRegistration
	}
	v.CreatedAt = v.CreatedAt.UTC()
	v.UpdatedAt = v.UpdatedAt.UTC()
	v.StartsAt = v.StartsAt.UTC()
	v.EndsAt = v.EndsAt.UTC()
	v.RegistrationClosesAt = v.RegistrationClosesAt.UTC()
	return v, nil
}
func eventSQLDetail(r *http.Request, tx pgx.Tx, user string, now time.Time, manage bool) (any, error) {
	c, err := eventSQLCircle(r.Context(), tx, user, r.PathValue("id"), "")
	if err != nil {
		return nil, err
	}
	if err = requireEventCircle(c, manage, false); err != nil {
		return nil, err
	}
	e, err := eventSQLGet(r.Context(), tx, c.ID, r.PathValue("eventId"), false)
	if err != nil {
		return nil, err
	}
	if err = eventReadable(e, c); err != nil {
		return nil, err
	}
	return eventSQLProjection(r.Context(), tx, e, user, now)
}
func eventSQLList(r *http.Request, tx pgx.Tx, user string, now time.Time) (any, error) {
	c, err := eventSQLCircle(r.Context(), tx, user, r.PathValue("id"), "")
	if err != nil {
		return nil, err
	}
	if err = requireEventCircle(c, false, false); err != nil {
		return nil, err
	}
	limit, offset, err := eventPagination(r)
	if err != nil {
		return nil, err
	}
	view, err := queryEnum(r, "view", "upcoming", "mine", "all")
	if err != nil {
		return nil, err
	}
	if view == "" {
		view = "upcoming"
	}
	where := ` WHERE e.circle_id=$1 AND (e.moderation='visible' OR $2::boolean)`
	args := []any{c.ID, circleStaff(c.Role)}
	if view == "upcoming" {
		where += ` AND e.lifecycle='published' AND e.ends_at>$3`
		args = append(args, now)
	} else if view == "mine" {
		where += ` AND EXISTS(SELECT 1 FROM gongming_circle_event_registrations r WHERE r.event_id=e.id AND r.user_id=$3 AND r.status IN ('registered','waitlisted'))`
		args = append(args, user)
	}
	var total int
	if err = tx.QueryRow(r.Context(), `SELECT count(*) FROM gongming_circle_events e`+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	order := ` ORDER BY e.starts_at,e.id`
	if view == "all" {
		order = ` ORDER BY e.starts_at DESC,e.id`
	}
	args = append(args, limit, offset)
	sql := `SELECT ` + eventSQLFields + eventSQLFrom + where + order + ` LIMIT $` + intString(len(args)-1) + ` OFFSET $` + intString(len(args))
	rows, err := tx.Query(r.Context(), sql, args...)
	if err != nil {
		return nil, err
	}
	stored := []storedCircleEvent{}
	for rows.Next() {
		e, x := scanCircleEvent(rows)
		if x != nil {
			rows.Close()
			return nil, x
		}
		stored = append(stored, e)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	items := []CircleEvent{}
	indexes := map[string]int{}
	ids := []string{}
	for _, e := range stored {
		indexes[e.ID] = len(items)
		ids = append(ids, e.ID)
		items = append(items, eventBaseProjection(e, now))
	}
	if len(ids) > 0 {
		err = notificationProjectionRows(r, tx, `SELECT r.event_id,r.status,r.reason,r.created_at,r.updated_at,CASE WHEN r.status='waitlisted' THEN (SELECT count(*) FROM gongming_circle_event_registrations q WHERE q.event_id=r.event_id AND q.status='waitlisted' AND q.ordinal<=r.ordinal) ELSE NULL END FROM gongming_circle_event_registrations r WHERE r.event_id=ANY($1::text[]) AND r.user_id=$2`, []any{ids, user}, func(row pgx.Rows) error {
			var id string
			reg := EventRegistration{}
			err := row.Scan(&id, &reg.Status, &reg.Reason, &reg.CreatedAt, &reg.UpdatedAt, &reg.QueuePosition)
			reg.CreatedAt = reg.CreatedAt.UTC()
			reg.UpdatedAt = reg.UpdatedAt.UTC()
			items[indexes[id]].MyRegistration = &reg
			return err
		})
		if err != nil {
			return nil, err
		}
	}
	return map[string]any{"items": items, "total": total}, nil
}
func eventSQLAttendees(r *http.Request, tx pgx.Tx, user string, now time.Time) (any, error) {
	c, err := eventSQLCircle(r.Context(), tx, user, r.PathValue("id"), "")
	if err != nil {
		return nil, err
	}
	if err = requireEventCircle(c, true, false); err != nil {
		return nil, err
	}
	e, err := eventSQLGet(r.Context(), tx, c.ID, r.PathValue("eventId"), false)
	if err != nil {
		return nil, err
	}
	limit, offset, err := eventPagination(r)
	if err != nil {
		return nil, err
	}
	status, err := queryEnum(r, "status", "all", "registered", "waitlisted", "cancelled")
	if err != nil {
		return nil, err
	}
	if status == "all" {
		status = ""
	}
	var total int
	if err = tx.QueryRow(r.Context(), `SELECT count(*) FROM gongming_circle_event_registrations WHERE event_id=$1 AND ($2='' OR status=$2)`, e.ID, status).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := tx.Query(r.Context(), `SELECT u.id,u.handle,u.name,u.avatar,u.bio,r.status,r.reason,r.created_at,r.updated_at,CASE WHEN r.status='waitlisted' THEN (SELECT count(*) FROM gongming_circle_event_registrations q WHERE q.event_id=r.event_id AND q.status='waitlisted' AND q.ordinal<=r.ordinal) ELSE NULL END FROM gongming_circle_event_registrations r JOIN gongming_users u ON u.id=r.user_id WHERE r.event_id=$1 AND ($2='' OR r.status=$2) ORDER BY r.ordinal,r.user_id LIMIT $3 OFFSET $4`, e.ID, status, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []EventAttendee{}
	for rows.Next() {
		v := EventAttendee{}
		if err = rows.Scan(&v.User.ID, &v.User.Handle, &v.User.Name, &v.User.Avatar, &v.User.Bio, &v.Registration.Status, &v.Registration.Reason, &v.Registration.CreatedAt, &v.Registration.UpdatedAt, &v.Registration.QueuePosition); err != nil {
			return nil, err
		}
		v.Registration.CreatedAt = v.Registration.CreatedAt.UTC()
		v.Registration.UpdatedAt = v.Registration.UpdatedAt.UTC()
		items = append(items, v)
	}
	return map[string]any{"items": items, "total": total}, rows.Err()
}
func eventSQLAdminList(r *http.Request, tx pgx.Tx, user string, now time.Time) (any, error) {
	limit, offset, err := eventPagination(r)
	if err != nil {
		return nil, err
	}
	lifecycle, err := queryEnum(r, "lifecycle", "published", "cancelled")
	if err != nil {
		return nil, err
	}
	moderation, err := queryEnum(r, "moderation", "visible", "hidden")
	if err != nil {
		return nil, err
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(q) > 200 || strings.ContainsRune(q, 0) {
		return nil, bad("搜索内容无效或超过200字")
	}
	circle := r.URL.Query().Get("circleId")
	where := `WHERE ($1='' OR e.circle_id=$1) AND ($2='' OR e.lifecycle=$2) AND ($3='' OR e.moderation=$3)`
	args := []any{circle, lifecycle, moderation}
	if q != "" {
		where += ` AND strpos(translate(e.id||' '||c.name||' '||e.title||' '||u.handle,$5,$6),$4)>0`
		args = append(args, strings.ToLower(q), messagingSQLLowerFrom, messagingSQLLowerTo)
	}
	var total int
	if err = tx.QueryRow(r.Context(), `SELECT count(*)`+eventSQLFrom+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	args = append(args, limit, offset)
	rows, err := tx.Query(r.Context(), `SELECT `+eventSQLFields+eventSQLFrom+where+` ORDER BY e.created_at DESC,e.id LIMIT $`+intString(len(args)-1)+` OFFSET $`+intString(len(args)), args...)
	if err != nil {
		return nil, err
	}
	stored := []storedCircleEvent{}
	for rows.Next() {
		e, x := scanCircleEvent(rows)
		if x != nil {
			rows.Close()
			return nil, x
		}
		stored = append(stored, e)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	items := []AdminCircleEvent{}
	for _, e := range stored {
		v := eventBaseProjection(e, now)
		items = append(items, AdminCircleEvent{v, e.CircleName, e.CircleStatus, e.Note})
	}
	return map[string]any{"items": items, "total": total}, nil
}
