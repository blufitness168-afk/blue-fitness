-- PREPARE ONLY. Requires existing hardened password auth and NORMAL/KIOSK sessions.
BEGIN;
CREATE TABLE admin_member_password_requests (
 actor_id integer NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL, member_id integer NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 240),
 body_mac text NOT NULL CHECK(body_mac ~ '^[a-f0-9]{64}$'),
 target_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz, PRIMARY KEY(actor_id,request_key)
);
CREATE INDEX admin_member_password_request_time ON admin_member_password_requests(created_at);
CREATE INDEX admin_member_password_target_time ON admin_member_password_requests(member_id,created_at);
CREATE TABLE admin_member_password_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id integer NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 actor_role text NOT NULL CHECK(actor_role IN ('ADMIN','OWNER')),
 member_id integer NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 240),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(actor_id,request_key)
);
CREATE FUNCTION admin_member_password_immutable() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Password audit is append-only'; END $$;
CREATE TRIGGER admin_member_password_audit_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON admin_member_password_audit
 FOR EACH STATEMENT EXECUTE FUNCTION admin_member_password_immutable();

-- Both phases independently authorize persisted session + current locked roles/status.
-- No raw password, client role, actor ID or arbitrary JSON crosses this SQL interface.
CREATE FUNCTION admin_member_password_action(p_session text,p_key uuid,p_payload jsonb,p_hash text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE s auth_sessions%ROWTYPE; a members%ROWTYPE; m members%ROWTYPE;
 r admin_member_password_requests%ROWTYPE; target_id integer; discovered_actor_id integer; version text;
BEGIN
 -- Discovery only: never hold an actor session lock while waiting for member rows.
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session;
 IF s.id IS NULL OR s.mode IS DISTINCT FROM 'NORMAL' OR s.revoked_at IS NOT NULL
 OR s.expires_at IS NULL OR s.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'Normal live session required' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023'; END IF;
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k)
 IS DISTINCT FROM ARRAY['bodyMac','memberCode','reason']::text[]
 OR jsonb_typeof(p_payload->'memberCode') IS DISTINCT FROM 'string'
 OR length(p_payload->>'memberCode') NOT BETWEEN 1 AND 50
 OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string'
 OR length(p_payload->>'reason') NOT BETWEEN 1 AND 240
 OR p_payload->>'reason' IS DISTINCT FROM btrim(p_payload->>'reason')
 OR jsonb_typeof(p_payload->'bodyMac') IS DISTINCT FROM 'string'
 OR (p_payload->>'bodyMac') !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Invalid request fields' USING ERRCODE='22023'; END IF;
 SELECT id INTO target_id FROM members WHERE member_code=p_payload->>'memberCode';
 discovered_actor_id:=s.member_id;
 PERFORM id FROM members WHERE id IN (discovered_actor_id,target_id) ORDER BY id FOR UPDATE;
 -- A concurrent OWNER reset of this ADMIN must finish before this session is locked/rechecked.
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session FOR SHARE;
 IF s.id IS NULL OR s.member_id IS DISTINCT FROM discovered_actor_id OR s.mode IS DISTINCT FROM 'NORMAL'
 OR s.revoked_at IS NOT NULL OR s.expires_at IS NULL OR s.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'Normal live session required' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM members WHERE id=discovered_actor_id;
 SELECT * INTO m FROM members WHERE id=target_id;
 SELECT xmin::text INTO version FROM members WHERE id=target_id;
 IF a.id IS NULL OR a.status='SUSPENDED' OR a.role NOT IN ('ADMIN','OWNER')
 OR m.id IS NULL OR m.id=a.id OR m.status='SUSPENDED'
 OR NOT coalesce((a.role='ADMIN' AND m.role='MEMBER') OR (a.role='OWNER' AND m.role IN ('MEMBER','ADMIN')),false) THEN
  RAISE EXCEPTION 'Target or staff not allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM admin_member_password_requests WHERE actor_id=a.id AND request_key=p_key FOR UPDATE;
 IF FOUND THEN
  IF r.member_id<>m.id OR r.reason<>p_payload->>'reason' OR r.body_mac<>p_payload->>'bodyMac' THEN
   RAISE EXCEPTION 'Request conflict' USING ERRCODE='P0001'; END IF;
  IF r.completed_at IS NOT NULL THEN
   IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
   RETURN 'done'; -- Historical success only. Never rewrite even after a newer reset.
  END IF;
  IF p_hash IS NULL THEN RETURN 'busy'; END IF;
  IF r.created_at<=clock_timestamp()-interval '2 minutes' OR r.target_version<>version THEN
   RAISE EXCEPTION 'Expired or stale claim' USING ERRCODE='P0001'; END IF;
 ELSE
  IF p_hash IS NOT NULL THEN RAISE EXCEPTION 'Claim required' USING ERRCODE='P0001'; END IF;
  -- One shared advisory lock serializes global quota admission across staff accounts.
  PERFORM pg_advisory_xact_lock(18261118,2);
  IF (SELECT count(*) FROM admin_member_password_requests WHERE actor_id=a.id AND created_at>clock_timestamp()-interval '15 minutes')>=5
  OR (SELECT count(*) FROM admin_member_password_requests WHERE member_id=m.id AND created_at>clock_timestamp()-interval '15 minutes')>=3
  OR (SELECT count(*) FROM admin_member_password_requests WHERE created_at>clock_timestamp()-interval '1 minute')>=50 THEN
   RETURN 'limited'; END IF;
  INSERT INTO admin_member_password_requests(actor_id,request_key,member_id,reason,body_mac,target_version)
  VALUES(a.id,p_key,m.id,p_payload->>'reason',p_payload->>'bodyMac',version);
  IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
  RETURN 'claimed';
 END IF;
 IF p_hash !~ '^scrypt\$32768\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$' THEN
  RAISE EXCEPTION 'Invalid password encoding' USING ERRCODE='22023'; END IF;
 UPDATE members SET password_hash=p_hash,updated_at=clock_timestamp() WHERE id=m.id;
 UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE member_id=m.id AND revoked_at IS NULL;
 UPDATE auth_otp_challenges SET consumed_at=clock_timestamp()
 WHERE phone=m.phone AND purpose IN ('PASSWORD_SETUP','PASSWORD_RESET') AND consumed_at IS NULL;
 UPDATE auth_password_tickets SET consumed_at=clock_timestamp() WHERE phone=m.phone AND consumed_at IS NULL;
 INSERT INTO admin_member_password_audit(actor_id,actor_role,member_id,request_key,reason)
 VALUES(a.id,a.role,m.id,p_key,r.reason);
 UPDATE admin_member_password_requests SET completed_at=clock_timestamp() WHERE actor_id=a.id AND request_key=p_key;
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 RETURN 'done';
END $$;
REVOKE ALL ON admin_member_password_requests,admin_member_password_audit FROM PUBLIC;
REVOKE ALL ON SEQUENCE admin_member_password_audit_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_member_password_immutable(),admin_member_password_action(text,uuid,jsonb,text) FROM PUBLIC;
COMMIT;
