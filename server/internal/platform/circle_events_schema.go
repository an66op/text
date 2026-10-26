package platform

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

const circleEventsSchema = `
CREATE TABLE gongming_circle_events (
 id text PRIMARY KEY CHECK(id ~ '^cevent_[a-f0-9]{32}$'),circle_id text NOT NULL REFERENCES gongming_circles(id),creator_id text NOT NULL REFERENCES gongming_users(id),
 client_id text NOT NULL CHECK(client_id ~ '^[A-Za-z0-9_-]{8,100}$'),fingerprint text NOT NULL,
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 80),description text NOT NULL CHECK(char_length(description) BETWEEN 1 AND 4000),mode text NOT NULL CHECK(mode IN ('online','offline')),location text NOT NULL CHECK(char_length(location) BETWEEN 1 AND 200),
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,registration_closes_at timestamptz NOT NULL,
 capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 1000),registered_count integer NOT NULL DEFAULT 0 CHECK(registered_count>=0 AND registered_count<=capacity),waitlisted_count integer NOT NULL DEFAULT 0 CHECK(waitlisted_count>=0),registration_sequence bigint NOT NULL DEFAULT 0 CHECK(registration_sequence>=0),
 lifecycle text NOT NULL CHECK(lifecycle IN ('published','cancelled')),moderation text NOT NULL CHECK(moderation IN ('visible','hidden')),note text NOT NULL DEFAULT '' CHECK(char_length(note)<=1000),revision bigint NOT NULL CHECK(revision>0),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL CHECK(updated_at>=created_at),
 CHECK(ends_at>starts_at AND ends_at<=starts_at+interval '168 hours' AND registration_closes_at<=starts_at),UNIQUE(creator_id,circle_id,client_id),UNIQUE(circle_id,id)
);
CREATE INDEX gongming_circle_events_feed_idx ON gongming_circle_events(circle_id,starts_at,id);
CREATE INDEX gongming_circle_events_quota_idx ON gongming_circle_events(circle_id,ends_at) WHERE lifecycle='published';
CREATE TABLE gongming_circle_event_registrations (
 event_id text NOT NULL,user_id text NOT NULL REFERENCES gongming_users(id),circle_id text NOT NULL,
 status text NOT NULL CHECK(status IN ('registered','waitlisted','cancelled')),reason text NOT NULL CHECK(reason IN ('','user','membership','account','event')),
 ordinal bigint NOT NULL CHECK(ordinal>0),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL CHECK(updated_at>=created_at),
 PRIMARY KEY(event_id,user_id),UNIQUE(event_id,ordinal) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(circle_id,event_id) REFERENCES gongming_circle_events(circle_id,id),FOREIGN KEY(circle_id,user_id) REFERENCES gongming_circle_members(circle_id,user_id),
 CHECK((status='cancelled' AND reason<>'') OR (status<>'cancelled' AND reason=''))
);
CREATE INDEX gongming_circle_event_registrations_queue_idx ON gongming_circle_event_registrations(event_id,status,ordinal,user_id);
CREATE INDEX gongming_circle_event_registrations_user_idx ON gongming_circle_event_registrations(user_id,status,event_id);
CREATE TABLE gongming_circle_event_requests (
 event_id text NOT NULL REFERENCES gongming_circle_events(id),user_id text NOT NULL REFERENCES gongming_users(id),client_id text NOT NULL CHECK(client_id ~ '^[A-Za-z0-9_-]{8,100}$'),intent text NOT NULL CHECK(intent IN ('join','waitlist','leave')),created_at timestamptz NOT NULL,
 PRIMARY KEY(event_id,user_id,client_id)
);
CREATE FUNCTION gongming_guard_circle_event_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.circle_id IS DISTINCT FROM OLD.circle_id OR NEW.creator_id IS DISTINCT FROM OLD.creator_id OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.revision<OLD.revision OR NEW.revision>OLD.revision+1 OR NEW.registration_sequence<OLD.registration_sequence OR OLD.lifecycle='cancelled' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'immutable circle event identity or terminal state' USING ERRCODE='23514';END IF;
 IF ROW(NEW.title,NEW.description,NEW.mode,NEW.location,NEW.starts_at,NEW.ends_at,NEW.registration_closes_at,NEW.capacity,NEW.lifecycle,NEW.moderation,NEW.note) IS DISTINCT FROM ROW(OLD.title,OLD.description,OLD.mode,OLD.location,OLD.starts_at,OLD.ends_at,OLD.registration_closes_at,OLD.capacity,OLD.lifecycle,OLD.moderation,OLD.note) AND NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'event revision must advance' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gongming_circle_event_identity_guard BEFORE UPDATE ON gongming_circle_events FOR EACH ROW EXECUTE FUNCTION gongming_guard_circle_event_identity();
CREATE FUNCTION gongming_guard_event_registration_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.circle_id IS DISTINCT FROM OLD.circle_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.ordinal<OLD.ordinal OR NEW.ordinal<>OLD.ordinal AND NOT(OLD.status='cancelled' AND NEW.status IN ('registered','waitlisted')) OR OLD.status='cancelled' AND NEW.status IN ('registered','waitlisted') AND NEW.ordinal<=OLD.ordinal OR OLD.status='registered' AND NEW.status='waitlisted' THEN RAISE EXCEPTION 'immutable registration identity/order' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gongming_event_registration_identity_guard BEFORE UPDATE ON gongming_circle_event_registrations FOR EACH ROW EXECUTE FUNCTION gongming_guard_event_registration_identity();
CREATE FUNCTION gongming_guard_event_request() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'successful event requests are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER gongming_event_request_identity_guard BEFORE UPDATE OR DELETE ON gongming_circle_event_requests FOR EACH ROW EXECUTE FUNCTION gongming_guard_event_request();
CREATE FUNCTION gongming_forbid_circle_event_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'event and registration history cannot be deleted' USING ERRCODE='23514'; END $$;
CREATE TRIGGER gongming_circle_event_delete_guard BEFORE DELETE ON gongming_circle_events FOR EACH ROW EXECUTE FUNCTION gongming_forbid_circle_event_delete();
CREATE TRIGGER gongming_event_registration_delete_guard BEFORE DELETE ON gongming_circle_event_registrations FOR EACH ROW EXECUTE FUNCTION gongming_forbid_circle_event_delete();
CREATE FUNCTION gongming_check_circle_event_invariants() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text; e gongming_circle_events%ROWTYPE; confirmed bigint; waiting bigint; max_order bigint;
BEGIN
 IF TG_TABLE_NAME='gongming_circle_events' THEN target:=NEW.id;ELSE target:=NEW.event_id;END IF;
 SELECT * INTO e FROM gongming_circle_events WHERE id=target;
 SELECT count(*) FILTER(WHERE status='registered'),count(*) FILTER(WHERE status='waitlisted'),COALESCE(max(ordinal),0) INTO confirmed,waiting,max_order FROM gongming_circle_event_registrations WHERE event_id=target;
 IF e.registered_count<>confirmed OR e.waitlisted_count<>waiting OR e.registration_sequence<max_order OR e.lifecycle='cancelled' AND confirmed+waiting<>0 THEN RAISE EXCEPTION 'event registration count mismatch' USING ERRCODE='23514';END IF;
 IF e.ends_at>transaction_timestamp() AND EXISTS(SELECT 1 FROM gongming_circle_event_registrations r JOIN gongming_users u ON u.id=r.user_id JOIN gongming_circle_members m ON m.circle_id=r.circle_id AND m.user_id=r.user_id WHERE r.event_id=target AND r.status IN ('registered','waitlisted') AND (u.status<>'active' OR m.status<>'active')) THEN RAISE EXCEPTION 'inactive event registration' USING ERRCODE='23514';END IF;
 IF (SELECT count(*) FROM gongming_circle_events WHERE circle_id=e.circle_id AND lifecycle='published' AND ends_at>transaction_timestamp())>20 THEN RAISE EXCEPTION 'circle event quota exceeded' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER gongming_circle_event_invariant_guard AFTER INSERT OR UPDATE ON gongming_circle_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_circle_event_invariants();
CREATE CONSTRAINT TRIGGER gongming_event_registration_invariant_guard AFTER INSERT OR UPDATE ON gongming_circle_event_registrations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_circle_event_invariants();
ALTER TABLE gongming_reports DROP CONSTRAINT gongming_reports_target_type_check;
ALTER TABLE gongming_reports ADD CONSTRAINT gongming_reports_target_type_check CHECK(target_type IN ('post','user','circle-post','circle-event'));
DO $$ DECLARE c record; BEGIN FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='gongming_notifications'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%friend-request%' LOOP EXECUTE format('ALTER TABLE gongming_notifications DROP CONSTRAINT %I',c.conname);END LOOP;END $$;
ALTER TABLE gongming_notifications ADD CONSTRAINT gongming_notification_event_kinds_check CHECK(
 (kind IN ('friend-request','circle-request','world-comment','world-like','circle-comment','circle-like') AND outcome='')
 OR (kind IN ('friend-decision','circle-decision') AND outcome IN ('accepted','declined'))
 OR (kind='circle-membership' AND outcome IN ('admin','member','owner','removed','banned','unbanned'))
 OR (kind='circle-status' AND outcome IN ('active','suspended','archived'))
 OR (kind IN ('world-review','circle-review') AND outcome IN ('published','pending','hidden'))
 OR (kind='media-review' AND outcome IN ('ready','blocked')) OR (kind='report-review' AND outcome IN ('resolved','dismissed'))
 OR (kind='circle-event-update' AND outcome IN ('updated','cancelled')) OR (kind='circle-event-registration' AND outcome='promoted') OR (kind='circle-event-review' AND outcome IN ('hidden','visible')));
`

func migrateCircleEvents(ctx context.Context, tx pgx.Tx) error {
	var done bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gongming_schema_migrations WHERE version=8)`).Scan(&done); err != nil {
		return err
	}
	if done {
		return nil
	}
	if _, err := tx.Exec(ctx, circleEventsSchema); err != nil {
		return fmt.Errorf("create circle event schema: %w", err)
	}
	_, err := tx.Exec(ctx, `INSERT INTO gongming_schema_migrations(version) VALUES(8)`)
	return err
}
