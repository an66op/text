package platform

// normalizedSchema is migration 2. JSON is limited to naturally unstructured
// document values and cached idempotent responses; core entities are relational.
const normalizedSchema = `
CREATE TABLE IF NOT EXISTS gongming_users (
 id text PRIMARY KEY,
 handle text NOT NULL UNIQUE CHECK (handle ~ '^[a-z][a-z0-9_]{2,29}$'),
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
 email text NOT NULL UNIQUE CHECK (email=lower(email) AND char_length(email)<=254),
 avatar text NOT NULL DEFAULT '' CHECK(char_length(avatar)<=2048), bio text NOT NULL DEFAULT '' CHECK(char_length(bio)<=200),
 role text NOT NULL CHECK (role IN ('member','moderator','admin')),
 status text NOT NULL CHECK (status IN ('active','suspended')),
 password_hash text NOT NULL, created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS gongming_users_status_created_idx ON gongming_users(status,created_at DESC,id);
CREATE INDEX IF NOT EXISTS gongming_users_role_idx ON gongming_users(role,status);
CREATE TABLE IF NOT EXISTS gongming_sessions (
 token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 user_id text NOT NULL REFERENCES gongming_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS gongming_sessions_user_idx ON gongming_sessions(user_id);
CREATE INDEX IF NOT EXISTS gongming_sessions_expiry_idx ON gongming_sessions(expires_at);
CREATE TABLE IF NOT EXISTS gongming_posts (
 id text PRIMARY KEY,
 author_id text NOT NULL REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,
 body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
 images text[] NOT NULL DEFAULT '{}', topic text NOT NULL DEFAULT '',
 status text NOT NULL CHECK (status IN ('published','hidden','pending')),
 created_at timestamptz NOT NULL,
 CHECK (cardinality(images)<=9), CHECK (char_length(topic)<=40)
);
CREATE INDEX IF NOT EXISTS gongming_posts_feed_idx ON gongming_posts(status,created_at DESC,id);
CREATE INDEX IF NOT EXISTS gongming_posts_topic_idx ON gongming_posts(topic,status,created_at DESC);
CREATE INDEX IF NOT EXISTS gongming_posts_author_idx ON gongming_posts(author_id,created_at DESC);
CREATE TABLE IF NOT EXISTS gongming_post_likes (
 post_id text NOT NULL REFERENCES gongming_posts(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 user_id text NOT NULL REFERENCES gongming_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 PRIMARY KEY(post_id,user_id)
);
CREATE INDEX IF NOT EXISTS gongming_likes_user_idx ON gongming_post_likes(user_id,post_id);
CREATE TABLE IF NOT EXISTS gongming_comments (
 id text PRIMARY KEY,
 post_id text NOT NULL REFERENCES gongming_posts(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 author_id text NOT NULL REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,
 body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000), created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS gongming_comments_post_idx ON gongming_comments(post_id,created_at DESC,id);
CREATE TABLE IF NOT EXISTS gongming_conversations (
 id text PRIMARY KEY, title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
 kind text NOT NULL CHECK (kind IN ('direct','group','channel')),
 owner_id text NOT NULL REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,
 created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS gongming_conversation_members (
 conversation_id text NOT NULL REFERENCES gongming_conversations(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 user_id text NOT NULL REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,
 position integer NOT NULL CHECK(position BETWEEN 0 AND 199), PRIMARY KEY(conversation_id,user_id),
 UNIQUE(conversation_id,position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS gongming_members_user_idx ON gongming_conversation_members(user_id,conversation_id);
CREATE TABLE IF NOT EXISTS gongming_messages (
 id text PRIMARY KEY,
 conversation_id text NOT NULL REFERENCES gongming_conversations(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 sender_id text NOT NULL REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,
 body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
 created_at timestamptz NOT NULL, seq bigint NOT NULL DEFAULT 0 CHECK(seq>=0), client_id text
);
CREATE UNIQUE INDEX IF NOT EXISTS gongming_messages_client_idx ON gongming_messages(sender_id,conversation_id,client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS gongming_messages_seq_idx ON gongming_messages(conversation_id,seq) WHERE seq>0;
CREATE INDEX IF NOT EXISTS gongming_messages_history_idx ON gongming_messages(conversation_id,seq DESC,created_at DESC,id);
CREATE TABLE IF NOT EXISTS gongming_documents (
 user_id text NOT NULL REFERENCES gongming_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 key text NOT NULL, value jsonb NOT NULL CHECK(pg_column_size(value)<=131072),
 revision bigint NOT NULL CHECK(revision>0), updated_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,key)
);
CREATE TABLE IF NOT EXISTS gongming_reports (
 id text PRIMARY KEY,
 reporter_id text NOT NULL REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,
 target_type text NOT NULL CHECK(target_type IN ('post','user')), target_id text NOT NULL,
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 1000),
 status text NOT NULL CHECK(status IN ('open','resolved','dismissed')),
 note text NOT NULL DEFAULT '' CHECK(char_length(note)<=1000), created_at timestamptz NOT NULL,
 CHECK(status='open' OR char_length(btrim(note))>0)
);
CREATE UNIQUE INDEX IF NOT EXISTS gongming_reports_open_unique_idx ON gongming_reports(reporter_id,target_type,target_id) WHERE status='open';
CREATE INDEX IF NOT EXISTS gongming_reports_review_idx ON gongming_reports(status,created_at DESC,id);
CREATE TABLE IF NOT EXISTS gongming_audits (
 id text PRIMARY KEY,
 actor_id text REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,
 actor_name text NOT NULL, action text NOT NULL, target_id text NOT NULL,
 detail text NOT NULL, created_at timestamptz NOT NULL,
 position bigint GENERATED ALWAYS AS IDENTITY UNIQUE
);
CREATE INDEX IF NOT EXISTS gongming_audits_created_idx ON gongming_audits(created_at DESC,id);
CREATE INDEX IF NOT EXISTS gongming_audits_target_idx ON gongming_audits(target_id,created_at DESC);
CREATE TABLE IF NOT EXISTS gongming_wallets (
 user_id text PRIMARY KEY REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,
 balance bigint NOT NULL DEFAULT 0 CHECK(balance>=0), address text NOT NULL UNIQUE,
 last_faucet timestamptz
);
CREATE TABLE IF NOT EXISTS gongming_ledger (
 wallet_user_id text NOT NULL REFERENCES gongming_wallets(user_id) DEFERRABLE INITIALLY DEFERRED,
 entry_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('faucet','transfer_out','transfer_in')),
 amount bigint NOT NULL CHECK(amount<>0), symbol text NOT NULL CHECK(symbol='GEM'),
 counterparty text NOT NULL, request_id text NOT NULL, created_at timestamptz NOT NULL,
 position bigint NOT NULL CHECK(position>=0), PRIMARY KEY(wallet_user_id,entry_id),
 UNIQUE(wallet_user_id,position),
 CHECK ((kind='transfer_out' AND amount<0) OR (kind IN ('faucet','transfer_in') AND amount>0))
);
CREATE INDEX IF NOT EXISTS gongming_ledger_created_idx ON gongming_ledger(wallet_user_id,created_at DESC,entry_id);
CREATE INDEX IF NOT EXISTS gongming_ledger_transfer_idx ON gongming_ledger(entry_id);
CREATE TABLE IF NOT EXISTS gongming_wallet_requests (
 user_id text NOT NULL REFERENCES gongming_users(id) DEFERRABLE INITIALLY DEFERRED,
 request_id text NOT NULL, fingerprint text NOT NULL, result jsonb NOT NULL,
 PRIMARY KEY(user_id,request_id)
);
CREATE TABLE IF NOT EXISTS gongming_conversation_reads (
 conversation_id text NOT NULL, user_id text NOT NULL, message_id text REFERENCES gongming_messages(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
 seq bigint NOT NULL CHECK(seq>=0), updated_at timestamptz NOT NULL,
 PRIMARY KEY(conversation_id,user_id),
 FOREIGN KEY(conversation_id,user_id) REFERENCES gongming_conversation_members(conversation_id,user_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE IF NOT EXISTS gongming_message_outbox (
 id text PRIMARY KEY, seq bigint NOT NULL UNIQUE CHECK(seq>0), type text NOT NULL,
 conversation_id text NOT NULL REFERENCES gongming_conversations(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 message_id text REFERENCES gongming_messages(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 recipient_id text REFERENCES gongming_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS gongming_outbox_conversation_idx ON gongming_message_outbox(conversation_id,seq);
CREATE INDEX IF NOT EXISTS gongming_outbox_retention_idx ON gongming_message_outbox(created_at,seq);
CREATE TABLE IF NOT EXISTS gongming_sequences (name text PRIMARY KEY, value bigint NOT NULL CHECK(value>=0));
INSERT INTO gongming_sequences(name,value) VALUES ('message_events',0) ON CONFLICT DO NOTHING;
`
