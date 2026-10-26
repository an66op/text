package platform

import (
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Event history never enters State. Only this page's event references are
// enriched, using current membership/circle/moderation in the inbox snapshot.
func projectEventNotifications(r *http.Request, tx pgx.Tx, user string, stored []storedNotification, items []Notification) error {
	ids := map[string]bool{}
	for _, v := range stored {
		if strings.HasPrefix(v.Kind, "circle-event-") {
			ids[v.ReferenceID] = true
		}
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := tx.Query(r.Context(), `SELECT e.id,e.circle_id,e.title,e.location,e.starts_at FROM gongming_circle_events e JOIN gongming_circles c ON c.id=e.circle_id JOIN gongming_circle_members m ON m.circle_id=c.id AND m.user_id=$2 AND m.status='active' WHERE e.id=ANY($1::text[]) AND c.status<>'suspended' AND (e.moderation='visible' OR m.role IN ('owner','admin'))`, mapKeys(ids), user)
	if err != nil {
		return err
	}
	defer rows.Close()
	values := map[string]struct{ circle, title, excerpt string }{}
	for rows.Next() {
		var id, circle, title, location string
		var start time.Time
		if err = rows.Scan(&id, &circle, &title, &location, &start); err != nil {
			return err
		}
		values[id] = struct{ circle, title, excerpt string }{circle, notificationSnippet(title, 120), notificationSnippet(location+" · "+start.UTC().Format(time.RFC3339), 160)}
	}
	if err = rows.Err(); err != nil {
		return err
	}
	for i, v := range stored {
		if !strings.HasPrefix(v.Kind, "circle-event-") {
			continue
		}
		if context, ok := values[v.ReferenceID]; ok {
			items[i].Available = true
			items[i].Actor = nil
			items[i].Context = &NotificationContext{context.title, context.excerpt}
			items[i].Target = &NotificationTarget{Type: "circle-event", CircleID: context.circle, EventID: v.ReferenceID}
		}
	}
	return nil
}
