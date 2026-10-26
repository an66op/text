package platform

// Relational constraints also guard ledger integrity from accidental SQL writes.
// Deferred triggers inspect the final transaction state, so dual-entry transfer,
// balance update, cached response and audit may be persisted in any order.
const normalizedGuards = `
CREATE OR REPLACE FUNCTION gongming_immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'immutable history: %',TG_TABLE_NAME USING ERRCODE='23514';
END $$;
CREATE OR REPLACE TRIGGER gongming_ledger_immutable BEFORE UPDATE OR DELETE ON gongming_ledger FOR EACH ROW EXECUTE FUNCTION gongming_immutable_history();
CREATE OR REPLACE TRIGGER gongming_audits_immutable BEFORE UPDATE OR DELETE ON gongming_audits FOR EACH ROW EXECUTE FUNCTION gongming_immutable_history();
CREATE OR REPLACE TRIGGER gongming_wallet_requests_immutable BEFORE UPDATE OR DELETE ON gongming_wallet_requests FOR EACH ROW EXECUTE FUNCTION gongming_immutable_history();

CREATE OR REPLACE FUNCTION gongming_check_wallet_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner text; current_balance bigint; ledger_balance numeric;
BEGIN
 IF TG_TABLE_NAME='gongming_wallets' THEN owner:=NEW.user_id; ELSE owner:=NEW.wallet_user_id; END IF;
 SELECT balance INTO current_balance FROM gongming_wallets WHERE user_id=owner;
 SELECT COALESCE(sum(amount),0) INTO ledger_balance FROM gongming_ledger WHERE wallet_user_id=owner;
 IF current_balance IS NULL OR current_balance<>ledger_balance THEN
  RAISE EXCEPTION 'wallet balance does not equal immutable ledger' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS gongming_wallet_balance_guard ON gongming_wallets;
CREATE CONSTRAINT TRIGGER gongming_wallet_balance_guard AFTER INSERT OR UPDATE ON gongming_wallets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_wallet_balance();
DROP TRIGGER IF EXISTS gongming_ledger_balance_guard ON gongming_ledger;
CREATE CONSTRAINT TRIGGER gongming_ledger_balance_guard AFTER INSERT ON gongming_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_wallet_balance();

CREATE OR REPLACE FUNCTION gongming_check_transfer_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entries bigint; outgoing bigint; incoming bigint; owners bigint; net numeric;
BEGIN
 SELECT count(*),count(*) FILTER(WHERE kind='transfer_out'),count(*) FILTER(WHERE kind='transfer_in'),count(DISTINCT wallet_user_id),sum(amount)
 INTO entries,outgoing,incoming,owners,net FROM gongming_ledger WHERE entry_id=NEW.entry_id;
 IF NEW.kind='faucet' THEN
  IF entries<>1 OR NEW.amount<>100000 THEN RAISE EXCEPTION 'invalid faucet issuance' USING ERRCODE='23514'; END IF;
 ELSE
  IF entries<>2 OR outgoing<>1 OR incoming<>1 OR owners<>2 OR net<>0 THEN
   RAISE EXCEPTION 'transfer requires two balanced distinct-wallet entries' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS gongming_transfer_pair_guard ON gongming_ledger;
CREATE CONSTRAINT TRIGGER gongming_transfer_pair_guard AFTER INSERT ON gongming_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gongming_check_transfer_pair();
`
