package platform

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

const notificationsSchema = `
CREATE TABLE gongming_notification_counters (
 user_id text PRIMARY KEY REFERENCES gongming_users(id) ON DELETE CASCADE,
 last_sequence bigint NOT NULL DEFAULT 0 CHECK(last_sequence>=0)
);
CREATE TABLE gongming_notifications (
 id text PRIMARY KEY CHECK(id ~ '^notice_[a-f0-9]{32}$'),
 recipient_id text NOT NULL REFERENCES gongming_users(id) ON DELETE CASCADE,
 actor_id text REFERENCES gongming_users(id),
 sequence bigint NOT NULL CHECK(sequence>0),
 kind text NOT NULL, outcome text NOT NULL, reference_id text NOT NULL CHECK(char_length(reference_id) BETWEEN 1 AND 128),
 event_key text NOT NULL CHECK(char_length(event_key) BETWEEN 1 AND 300),
 created_at timestamptz NOT NULL, read_at timestamptz CHECK(read_at IS NULL OR read_at>=created_at),
 UNIQUE(recipient_id,sequence),UNIQUE(recipient_id,event_key),
 CHECK(actor_id IS NULL OR actor_id<>recipient_id),
 CHECK((kind IN ('friend-request','circle-request','world-comment','world-like','circle-comment','circle-like') AND outcome='')
 OR (kind IN ('friend-decision','circle-decision') AND outcome IN ('accepted','declined'))
 OR (kind='circle-membership' AND outcome IN ('admin','member','owner','removed','banned','unbanned'))
 OR (kind='circle-status' AND outcome IN ('active','suspended','archived'))
 OR (kind IN ('world-review','circle-review') AND outcome IN ('published','pending','hidden'))
 OR (kind='media-review' AND outcome IN ('ready','blocked'))
 OR (kind='report-review' AND outcome IN ('resolved','dismissed')))
);
CREATE INDEX gongming_notifications_recipient_idx ON gongming_notifications(recipient_id,sequence DESC);
CREATE INDEX gongming_notifications_unread_idx ON gongming_notifications(recipient_id,sequence DESC) WHERE read_at IS NULL;
CREATE FUNCTION gongming_guard_notification_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id OR NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.sequence IS DISTINCT FROM OLD.sequence OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.outcome IS DISTINCT FROM OLD.outcome OR NEW.reference_id IS DISTINCT FROM OLD.reference_id OR NEW.event_key IS DISTINCT FROM OLD.event_key OR NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN
 RAISE EXCEPTION 'notification identity and completed read are immutable' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gongming_notification_identity_guard BEFORE UPDATE ON gongming_notifications FOR EACH ROW EXECUTE FUNCTION gongming_guard_notification_identity();
`

func migrateNotifications(ctx context.Context, tx pgx.Tx) error {
	var done bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=7)`).Scan(&done); err != nil {
		return err
	}
	if done {
		return nil
	}
	if _, err := tx.Exec(ctx, notificationsSchema); err != nil {
		return fmt.Errorf("create notification schema: %w", err)
	}
	_, err := tx.Exec(ctx, `INSERT INTO gongming_schema_migrations(version) VALUES(7)`)
	return err
}

func validNotificationDraft(d NotificationDraft) bool {
	rule, ok := notificationRules[d.Kind]
	if !ok {
		return false
	}
	valid := d.Outcome == "" && rule.outcomes == ""
	for _, outcome := range strings.Split(rule.outcomes, "|") {
		if outcome == d.Outcome {
			valid = true
		}
	}
	return valid && d.RecipientID != "" && d.RecipientID != d.ActorID && len(d.ReferenceID) > 0 && len(d.ReferenceID) <= 128 && len(d.EventKey) > 0 && len(d.EventKey) <= 300 && !d.CreatedAt.IsZero()
}

// Business rows are persisted first. Only recipient-local counter rows are
// locked here, in stable user ID order; no global notification sequence exists.
// A commit publishes business data, audit and inbox together, or none of them.
func persistNotificationDrafts(ctx context.Context, tx pgx.Tx, drafts []NotificationDraft) error {
	groups := map[string][]NotificationDraft{}
	for _, d := range drafts {
		if !validNotificationDraft(d) {
			return fmt.Errorf("invalid notification draft kind %q", d.Kind)
		}
		groups[d.RecipientID] = append(groups[d.RecipientID], d)
	}
	users := make([]string, 0, len(groups))
	for user := range groups {
		users = append(users, user)
	}
	sort.Strings(users)
	for _, user := range users {
		if _, err := tx.Exec(ctx, `INSERT INTO gongming_notification_counters(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING`, user); err != nil {
			return err
		}
		var sequence int64
		if err := tx.QueryRow(ctx, `SELECT last_sequence FROM gongming_notification_counters WHERE user_id=$1 FOR UPDATE`, user).Scan(&sequence); err != nil {
			return err
		}
		for _, d := range groups[user] {
			var exists bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gongming_notifications WHERE recipient_id=$1 AND event_key=$2)`, user, d.EventKey).Scan(&exists); err != nil {
				return err
			}
			if exists {
				continue
			}
			sequence++
			if _, err := tx.Exec(ctx, `INSERT INTO gongming_notifications(id,recipient_id,actor_id,sequence,kind,outcome,reference_id,event_key,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, newID("notice_"), user, nullString(d.ActorID), sequence, d.Kind, d.Outcome, d.ReferenceID, d.EventKey, d.CreatedAt); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE gongming_notification_counters SET last_sequence=$2 WHERE user_id=$1`, user, sequence); err != nil {
			return err
		}
	}
	return nil
}
