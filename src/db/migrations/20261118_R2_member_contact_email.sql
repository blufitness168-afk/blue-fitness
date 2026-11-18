-- PREPARE ONLY. Contact data, never an authentication identifier.
BEGIN;
CREATE FUNCTION member_contact_email_valid(e text) RETURNS boolean LANGUAGE sql IMMUTABLE
SET search_path=public,pg_catalog AS $$
 SELECT e IS NULL OR (length(e) BETWEEN 3 AND 254 AND octet_length(e)=length(e)
 AND e=lower(e COLLATE "C") AND e=btrim(e) AND e !~ '[[:space:][:cntrl:]]'
 AND e ~ '^[a-z0-9_+''.-]*[a-z0-9_+-]@([a-z0-9][a-z0-9-]*\.)+[a-z]{2,}$' AND e !~ '^\.'
 AND e !~ '\.\.' AND split_part(e,'@',1) !~ '\.$')
$$;
CREATE TABLE member_contact_details (
 member_id integer PRIMARY KEY REFERENCES members(id) ON DELETE RESTRICT,
 email text CHECK(member_contact_email_valid(email)),
 version integer NOT NULL DEFAULT 0 CHECK(version>=0)
);
-- Shared contact emails are allowed; no email lookup or identity matching index.
CREATE TABLE member_contact_email_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id integer NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 actor_role text NOT NULL CHECK(actor_role IN ('ADMIN','OWNER')),
 member_id integer NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL, payload_hash text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 240),
 before_email text, after_email text, before_version integer NOT NULL, after_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(actor_id,request_key),
 CHECK(after_version=before_version+1), CHECK(payload_hash ~ '^[a-f0-9]{64}$')
);
CREATE FUNCTION member_contact_email_immutable() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Contact audit is append-only'; END $$;
CREATE TRIGGER member_contact_email_audit_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON member_contact_email_audit
 FOR EACH STATEMENT EXECUTE FUNCTION member_contact_email_immutable();

-- Locks follow the password slice: ordered members, then session; reauthorize after locking.
CREATE FUNCTION member_contact_email_guard(p_session text,p_code text) RETURNS integer LANGUAGE plpgsql
SET search_path=public,pg_catalog AS $$
DECLARE aid integer; tid integer; a members%ROWTYPE; t members%ROWTYPE; s auth_sessions%ROWTYPE;
BEGIN
 IF p_code IS NULL OR length(p_code) NOT BETWEEN 1 AND 50 THEN
  RAISE EXCEPTION 'Invalid target' USING ERRCODE='22023'; END IF;
 SELECT member_id INTO aid FROM auth_sessions WHERE token_hash=p_session;
 SELECT id INTO tid FROM members WHERE member_code=p_code;
 PERFORM id FROM members WHERE id IN (aid,tid) ORDER BY id FOR UPDATE;
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session FOR SHARE;
 SELECT * INTO a FROM members WHERE id=aid;
 SELECT * INTO t FROM members WHERE id=tid;
 IF s.id IS NULL OR s.member_id IS DISTINCT FROM aid OR s.mode IS DISTINCT FROM 'NORMAL'
 OR s.revoked_at IS NOT NULL OR s.expires_at IS NULL OR s.expires_at<=clock_timestamp()
 OR a.id IS NULL OR a.status='SUSPENDED' OR a.role NOT IN ('ADMIN','OWNER')
 OR t.id IS NULL OR NOT coalesce((a.role='ADMIN' AND t.role='MEMBER')
 OR (a.role='OWNER' AND t.role IN ('MEMBER','ADMIN')),false) THEN
  RAISE EXCEPTION 'Contact access denied' USING ERRCODE='42501'; END IF;
 RETURN tid;
END $$;
CREATE FUNCTION member_contact_email_read(p_session text,p_code text) RETURNS jsonb LANGUAGE plpgsql
SET search_path=public,pg_catalog AS $$
DECLARE tid integer; e text; v integer;
BEGIN
 tid:=member_contact_email_guard(p_session,p_code);
 SELECT email,version INTO e,v FROM member_contact_details WHERE member_id=tid;
 RETURN jsonb_build_object('email',e,'version',coalesce(v,0));
END $$;
CREATE FUNCTION member_contact_email_update(p_session text,p_key uuid,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql
SET search_path=public,pg_catalog AS $$
DECLARE tid integer; aid integer; ar text; e text; old_email text; v integer; digest text;
 prior member_contact_email_audit%ROWTYPE;
BEGIN
 IF p_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid contact request' USING ERRCODE='22023'; END IF;
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k)
 IS DISTINCT FROM ARRAY['email','expectedVersion','memberCode','reason']::text[]
 OR jsonb_typeof(p_payload->'memberCode') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string'
 OR length(btrim(p_payload->>'reason')) NOT BETWEEN 1 AND 240
 OR jsonb_typeof(p_payload->'expectedVersion') IS DISTINCT FROM 'number'
 OR (p_payload->>'expectedVersion') !~ '^(0|[1-9][0-9]{0,9})$'
 OR (p_payload->>'expectedVersion')::numeric>2147483646
 OR jsonb_typeof(p_payload->'email') NOT IN ('string','null') THEN
  RAISE EXCEPTION 'Invalid contact fields' USING ERRCODE='22023'; END IF;
 e:=p_payload->>'email';
 IF NOT member_contact_email_valid(e) THEN RAISE EXCEPTION 'Invalid contact email' USING ERRCODE='22023'; END IF;
 tid:=member_contact_email_guard(p_session,p_payload->>'memberCode');
 SELECT m.id,m.role::text INTO aid,ar FROM members m JOIN auth_sessions s ON s.member_id=m.id WHERE s.token_hash=p_session;
 digest:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 SELECT * INTO prior FROM member_contact_email_audit WHERE actor_id=aid AND request_key=p_key;
 IF FOUND THEN
  IF prior.payload_hash<>digest THEN RAISE EXCEPTION 'Request conflict' USING ERRCODE='P0001'; END IF;
  RETURN jsonb_build_object('ok',true);
 END IF;
 SELECT email,version INTO old_email,v FROM member_contact_details WHERE member_id=tid;
 v:=coalesce(v,0);
 IF v<>(p_payload->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Stale contact' USING ERRCODE='P0001'; END IF;
 INSERT INTO member_contact_details(member_id,email,version) VALUES(tid,e,v+1)
 ON CONFLICT(member_id) DO UPDATE SET email=excluded.email,version=excluded.version;
 INSERT INTO member_contact_email_audit(actor_id,actor_role,member_id,request_key,payload_hash,reason,before_email,after_email,before_version,after_version)
 VALUES(aid,ar,tid,p_key,digest,btrim(p_payload->>'reason'),old_email,e,v,v+1);
 IF NOT EXISTS(SELECT 1 FROM auth_sessions WHERE token_hash=p_session AND expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON member_contact_details,member_contact_email_audit FROM PUBLIC;
REVOKE ALL ON SEQUENCE member_contact_email_audit_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION member_contact_email_valid(text),member_contact_email_immutable(),member_contact_email_guard(text,text),member_contact_email_read(text,text),member_contact_email_update(text,uuid,jsonb) FROM PUBLIC;
COMMIT;
