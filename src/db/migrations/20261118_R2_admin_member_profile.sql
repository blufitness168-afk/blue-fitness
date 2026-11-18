-- PREPARE ONLY: existing members/profile_gender + auth_sessions (NORMAL/KIOSK).
-- Invoker security, same trusted server DB principal as existing admin functions.
BEGIN;
CREATE TABLE admin_member_profile_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id integer NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 actor_role text NOT NULL CHECK(actor_role IN ('ADMIN','OWNER')),
 member_id integer NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL, payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 240),
 before_profile jsonb NOT NULL, after_profile jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(actor_id,request_key)
);
CREATE FUNCTION admin_member_profile_immutable() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Profile audit is append-only'; END $$;
CREATE TRIGGER admin_member_profile_audit_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON admin_member_profile_audit
 FOR EACH STATEMENT EXECUTE FUNCTION admin_member_profile_immutable();

-- Explicit allowlist; never serialize the members row (password/phone/finance etc.).
CREATE FUNCTION admin_member_profile_snapshot(m members) RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path=public,pg_catalog AS $$
 SELECT jsonb_build_object('fullName',m.full_name,'nickname',m.nickname,'gender',m.gender,
  'birthDay',m.birth_day,'birthMonth',m.birth_month,'emergencyName',m.emergency_name,
  'emergencyPhone',m.emergency_phone,'emergencyRelation',m.emergency_relation)
$$;
CREATE FUNCTION admin_member_profile_update(p_session text,p_key uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE s auth_sessions%ROWTYPE; actor members%ROWTYPE; target members%ROWTYPE;
 prior admin_member_profile_audit%ROWTYPE; profile jsonb; expected jsonb; before_value jsonb;
 digest text; field text; max_length integer; day_value integer; month_value integer; target_id integer;
 keys text[] := ARRAY['birthDay','birthMonth','emergencyName','emergencyPhone','emergencyRelation','fullName','gender','nickname'];
BEGIN
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session FOR SHARE;
 IF s.id IS NULL OR s.mode IS DISTINCT FROM 'NORMAL' OR s.revoked_at IS NOT NULL
 OR s.expires_at IS NULL OR s.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'Normal live session required' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
 OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k)
 IS DISTINCT FROM ARRAY['expected','memberCode','profile','reason']::text[]
 OR jsonb_typeof(p_payload->'memberCode') IS DISTINCT FROM 'string'
 OR length(p_payload->>'memberCode') NOT BETWEEN 1 AND 50
 OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string'
 OR length(btrim(p_payload->>'reason')) NOT BETWEEN 1 AND 240 THEN
  RAISE EXCEPTION 'Invalid profile request' USING ERRCODE='22023'; END IF;
 profile:=p_payload->'profile'; expected:=p_payload->'expected';
 IF jsonb_typeof(profile) IS DISTINCT FROM 'object' OR jsonb_typeof(expected) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid profile snapshot' USING ERRCODE='22023'; END IF;
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(profile) k) IS DISTINCT FROM keys
 OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(expected) k) IS DISTINCT FROM keys THEN
  RAISE EXCEPTION 'Invalid profile fields' USING ERRCODE='22023'; END IF;
 FOREACH field IN ARRAY ARRAY['fullName','nickname','gender','emergencyName','emergencyPhone','emergencyRelation'] LOOP
  max_length:=CASE field WHEN 'fullName' THEN 100 WHEN 'nickname' THEN 50 WHEN 'gender' THEN 6
   WHEN 'emergencyName' THEN 100 WHEN 'emergencyPhone' THEN 20 ELSE 50 END;
  IF jsonb_typeof(profile->field) IS DISTINCT FROM 'string'
  OR length(profile->>field)>max_length OR profile->>field IS DISTINCT FROM btrim(profile->>field)
  OR jsonb_typeof(expected->field) NOT IN ('string','null') THEN
   RAISE EXCEPTION 'Invalid profile text' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF length(profile->>'fullName')<2 OR profile->>'gender' NOT IN ('MALE','FEMALE','OTHER')
 OR (profile->>'emergencyPhone'<>'' AND (profile->>'emergencyPhone') !~ '^0[0-9]{8,9}$')
 OR jsonb_typeof(profile->'birthDay') IS DISTINCT FROM 'number'
 OR jsonb_typeof(profile->'birthMonth') IS DISTINCT FROM 'number'
 OR (profile->>'birthDay') !~ '^([1-9]|[12][0-9]|3[01])$'
 OR (profile->>'birthMonth') !~ '^([1-9]|1[0-2])$'
 OR jsonb_typeof(expected->'birthDay') NOT IN ('number','null')
 OR jsonb_typeof(expected->'birthMonth') NOT IN ('number','null') THEN
  RAISE EXCEPTION 'Invalid profile values' USING ERRCODE='22023'; END IF;
 day_value:=(profile->>'birthDay')::integer; month_value:=(profile->>'birthMonth')::integer;
 -- Fixed leap year is validation only; never store a birth year.
 IF day_value>extract(day FROM (make_date(2000,month_value,1)+interval '1 month - 1 day')) THEN
  RAISE EXCEPTION 'Invalid birth date' USING ERRCODE='22023'; END IF;
 SELECT id INTO target_id FROM members WHERE member_code=p_payload->>'memberCode';
 -- Stable order avoids actor/target lock inversion with another profile request.
 PERFORM id FROM members WHERE id IN (s.member_id,target_id) ORDER BY id FOR UPDATE;
 SELECT * INTO actor FROM members WHERE id=s.member_id;
 SELECT * INTO target FROM members WHERE id=target_id;
 IF actor.id IS NULL OR actor.status='SUSPENDED' OR actor.role NOT IN ('ADMIN','OWNER') THEN
  RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
 IF target.id IS NULL OR NOT coalesce((actor.role='ADMIN' AND target.role='MEMBER')
 OR (actor.role='OWNER' AND target.role IN ('MEMBER','ADMIN')),false) THEN
  RAISE EXCEPTION 'Target not allowed' USING ERRCODE='42501'; END IF;
 digest:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 -- Actor row lock serializes this actor's keys, including retries aimed at a different target.
 SELECT * INTO prior FROM admin_member_profile_audit WHERE actor_id=actor.id AND request_key=p_key;
 IF FOUND THEN
  IF prior.payload_hash<>digest THEN RAISE EXCEPTION 'Request key conflict' USING ERRCODE='P0001'; END IF;
  IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('ok',true);
 END IF;
 before_value:=admin_member_profile_snapshot(target);
 IF before_value IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Stale profile' USING ERRCODE='P0001'; END IF;
 UPDATE members SET full_name=profile->>'fullName',nickname=profile->>'nickname',gender=(profile->>'gender')::profile_gender,
  birth_day=day_value,birth_month=month_value,emergency_name=profile->>'emergencyName',
  emergency_phone=profile->>'emergencyPhone',emergency_relation=profile->>'emergencyRelation',updated_at=clock_timestamp()
 WHERE id=target.id;
 INSERT INTO admin_member_profile_audit(actor_id,actor_role,member_id,request_key,payload_hash,reason,before_profile,after_profile)
 VALUES(actor.id,actor.role,target.id,p_key,digest,btrim(p_payload->>'reason'),before_value,profile);
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON admin_member_profile_audit FROM PUBLIC;
REVOKE ALL ON SEQUENCE admin_member_profile_audit_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_member_profile_immutable(),admin_member_profile_snapshot(members),admin_member_profile_update(text,uuid,jsonb) FROM PUBLIC;
COMMIT;
