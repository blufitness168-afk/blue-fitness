-- PREPARE ONLY. No existing migrations or entitlement functions are replaced.
-- October admission baseline is sufficient. R3/R6/R7 are optional, never installed here.
BEGIN;
DO $$
DECLARE signature text; function_id oid;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.kiosk_checkin(text,text,uuid,text)','public.real_frontdesk_checkin(text,text,uuid,text)'] LOOP
  function_id:=to_regprocedure(signature);
  IF function_id IS NULL OR (SELECT prorettype FROM pg_proc WHERE oid=function_id) IS DISTINCT FROM 'jsonb'::regtype THEN
   RAISE EXCEPTION 'Existing admission prerequisite missing or incompatible'; END IF;
 END LOOP;
 function_id:=to_regprocedure('public.r7_visit_action(text,text,uuid,text,text)');
 IF function_id IS NOT NULL AND (SELECT prorettype FROM pg_proc WHERE oid=function_id) IS DISTINCT FROM 'jsonb'::regtype THEN
  RAISE EXCEPTION 'Existing optional admission signature incompatible'; END IF;
END $$;
CREATE TABLE member_cards (
 member_id integer PRIMARY KEY REFERENCES members(id) ON DELETE RESTRICT,
 card_code text UNIQUE CHECK(card_code ~ '^CARD-[0-9]{1,95}$'),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483647)
);
CREATE TABLE member_card_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id integer NOT NULL REFERENCES members(id), actor_role text NOT NULL CHECK(actor_role IN ('ADMIN','OWNER')),
 member_id integer NOT NULL REFERENCES members(id), request_key uuid NOT NULL,
 payload_hash text NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 240),
 before_card text, after_card text, before_version integer NOT NULL, after_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(actor_id,request_key)
);
CREATE TABLE member_card_scan_requests (
 actor_id integer NOT NULL REFERENCES members(id), station text NOT NULL, channel text NOT NULL,
 request_key uuid NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor_id,station,channel,request_key)
);
CREATE FUNCTION member_card_immutable() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$ BEGIN RAISE EXCEPTION 'Card audit is append-only'; END $$;
CREATE TRIGGER member_card_audit_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON member_card_audit
 FOR EACH STATEMENT EXECUTE FUNCTION member_card_immutable();
CREATE TRIGGER member_card_scan_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON member_card_scan_requests
 FOR EACH STATEMENT EXECUTE FUNCTION member_card_immutable();

-- Same target policy as profile, including suspended targets; binding never grants admission.
CREATE FUNCTION member_card_target(p_session text,p_code text) RETURNS integer LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
DECLARE s public.auth_sessions%ROWTYPE; a public.members%ROWTYPE; m public.members%ROWTYPE; target_id integer;
BEGIN
 SELECT * INTO s FROM public.auth_sessions WHERE token_hash=p_session FOR SHARE;
 IF s.id IS NULL OR s.mode IS DISTINCT FROM 'NORMAL' OR s.revoked_at IS NOT NULL
 OR s.expires_at IS NULL OR s.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'Normal live session required' USING ERRCODE='42501'; END IF;
 SELECT id INTO target_id FROM public.members WHERE member_code=p_code;
 PERFORM id FROM public.members WHERE id IN (s.member_id,target_id) ORDER BY id FOR UPDATE;
 SELECT * INTO a FROM public.members WHERE id=s.member_id;
 SELECT * INTO m FROM public.members WHERE id=target_id;
 IF a.id IS NULL OR a.status='SUSPENDED' OR NOT coalesce(
  (a.role='ADMIN' AND m.role='MEMBER') OR (a.role='OWNER' AND m.role IN ('MEMBER','ADMIN')),false) THEN
  RAISE EXCEPTION 'Target not allowed' USING ERRCODE='42501'; END IF;
 RETURN m.id;
END $$;
CREATE FUNCTION member_card_read(p_session text,p_code text) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
DECLARE target_id integer; result jsonb;
BEGIN
 target_id:=public.member_card_target(p_session,p_code);
 SELECT jsonb_build_object('cardCode',c.card_code,'version',coalesce(c.version,0)) INTO result
 FROM (SELECT 1) seed LEFT JOIN public.member_cards c ON c.member_id=target_id;
 IF NOT EXISTS(SELECT 1 FROM public.auth_sessions WHERE token_hash=p_session AND expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;
CREATE FUNCTION member_card_update(p_session text,p_key uuid,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
DECLARE target_id integer; actor_id_value integer; actor_role_value text; previous public.member_card_audit%ROWTYPE;
 current_card text; current_version integer; digest text;
BEGIN
 IF p_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid card request' USING ERRCODE='22023'; END IF;
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k)
 IS DISTINCT FROM ARRAY['cardCode','expectedVersion','memberCode','reason']::text[]
 OR jsonb_typeof(p_payload->'memberCode') IS DISTINCT FROM 'string'
 OR length(p_payload->>'memberCode') NOT BETWEEN 1 AND 50
 OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string'
 OR length(btrim(p_payload->>'reason')) NOT BETWEEN 1 AND 240
 OR jsonb_typeof(p_payload->'expectedVersion') IS DISTINCT FROM 'number'
 OR (p_payload->>'expectedVersion') !~ '^(0|[1-9][0-9]{0,9})$'
 OR (p_payload->>'expectedVersion')::numeric>2147483646
 OR NOT (jsonb_typeof(p_payload->'cardCode')='null' OR
  (jsonb_typeof(p_payload->'cardCode')='string' AND p_payload->>'cardCode' ~ '^CARD-[0-9]{1,95}$')) THEN
  RAISE EXCEPTION 'Invalid card request' USING ERRCODE='22023'; END IF;
 -- Small frontdesk registry: serialize binding changes and CARD resolution through admission.
 -- This also protects absent bindings and releases; never steal/reassign another member's row.
 PERFORM pg_advisory_xact_lock(724192,2);
 target_id:=public.member_card_target(p_session,p_payload->>'memberCode');
 SELECT s.member_id,m.role::text INTO actor_id_value,actor_role_value FROM public.auth_sessions s
 JOIN public.members m ON m.id=s.member_id WHERE s.token_hash=p_session;
 digest:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 SELECT * INTO previous FROM public.member_card_audit WHERE actor_id=actor_id_value AND request_key=p_key;
 IF FOUND THEN
  IF previous.payload_hash<>digest THEN RAISE EXCEPTION 'Card request conflict' USING ERRCODE='P0001'; END IF;
 ELSE
  SELECT card_code,version INTO current_card,current_version FROM public.member_cards WHERE member_id=target_id;
  current_version:=coalesce(current_version,0);
  IF current_version<>(p_payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION 'Card request conflict' USING ERRCODE='P0001'; END IF;
  IF EXISTS(SELECT 1 FROM public.member_cards WHERE card_code=p_payload->>'cardCode' AND member_id<>target_id) THEN
   RAISE EXCEPTION 'Card request conflict' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.member_cards(member_id,card_code,version) VALUES(target_id,p_payload->>'cardCode',current_version+1)
  ON CONFLICT(member_id) DO UPDATE SET card_code=excluded.card_code,version=excluded.version;
  INSERT INTO public.member_card_audit(actor_id,actor_role,member_id,request_key,payload_hash,reason,before_card,after_card,before_version,after_version)
  VALUES(actor_id_value,actor_role_value,target_id,p_key,digest,btrim(p_payload->>'reason'),current_card,p_payload->>'cardCode',current_version,current_version+1);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.auth_sessions WHERE token_hash=p_session AND expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;

-- Resolve and choose the installed admission version BEFORE any mutation.
-- Own replay record pins the original result even after unbind/rebind or later R7 rollout.
CREATE FUNCTION member_scan_admit(p_session text,p_station text,p_key uuid,p_code text,p_direction text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE s public.auth_sessions%ROWTYPE; a public.members%ROWTYPE; prior public.member_card_scan_requests%ROWTYPE;
 code text; channel_value text; payload_value jsonb; result_value jsonb; has_r7 boolean;
BEGIN
 IF p_key IS NULL OR p_code IS NULL OR p_code !~ '^(BLU-[0-9]{1,12}|CARD-[0-9]{1,95})$' OR p_station IS NULL
 OR length(p_station) NOT BETWEEN 1 AND 200 OR (p_direction IS NOT NULL AND p_direction NOT IN ('IN','OUT')) THEN
  RAISE EXCEPTION 'Invalid scan' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(724192,2);
 SELECT * INTO s FROM public.auth_sessions WHERE token_hash=p_session FOR SHARE;
 SELECT * INTO a FROM public.members WHERE id=s.member_id FOR SHARE;
 channel_value:=CASE WHEN p_direction IS NULL THEN 'KIOSK' ELSE 'NORMAL' END;
 IF s.id IS NULL OR s.mode IS DISTINCT FROM channel_value OR s.revoked_at IS NOT NULL
 OR s.expires_at IS NULL OR s.expires_at<=clock_timestamp() OR a.id IS NULL OR a.status='SUSPENDED'
 OR a.role NOT IN ('ADMIN','OWNER') OR (channel_value='KIOSK' AND s.device_id IS DISTINCT FROM p_station) THEN
  RAISE EXCEPTION 'Live staff session required' USING ERRCODE='42501'; END IF;
 has_r7:=to_regprocedure('public.r7_visit_action(text,text,uuid,text,text)') IS NOT NULL;
 -- Unsupported is not an admission result or a durable request; do not insert anything.
 IF channel_value='NORMAL' AND p_direction='OUT' AND NOT has_r7 THEN
  RAISE EXCEPTION 'OUT unsupported on installed legacy admission' USING ERRCODE='0A000',DETAIL='MEMBER_SCAN_OUT_UNSUPPORTED_BEFORE_WRITE'; END IF;
 payload_value:=jsonb_build_object('code',p_code,'direction',p_direction);
 SELECT * INTO prior FROM public.member_card_scan_requests
 WHERE actor_id=a.id AND station=p_station AND channel=channel_value AND request_key=p_key;
 IF FOUND THEN
  IF prior.payload<>payload_value THEN RAISE EXCEPTION 'Scan request conflict' USING ERRCODE='22023'; END IF;
  result_value:=prior.result;
 ELSE
  IF p_code LIKE 'CARD-%' THEN
   SELECT m.member_code INTO code FROM public.member_cards c JOIN public.members m ON m.id=c.member_id WHERE c.card_code=p_code;
  ELSE code:=p_code; END IF;
  IF code IS NULL THEN result_value:=jsonb_build_object('ok',false,'reason','NOT_FOUND');
  ELSIF channel_value='KIOSK' THEN
   result_value:=public.kiosk_checkin(p_session,p_station,p_key,code);
  ELSIF has_r7 THEN
   result_value:=public.r7_visit_action(p_session,p_station,p_key,code,p_direction);
  ELSE
   -- Deliberately no exception handler/fallback after either function starts.
   result_value:=public.real_frontdesk_checkin(p_session,p_station,p_key,code);
  END IF;
  IF channel_value='NORMAL' THEN result_value:=result_value||jsonb_build_object('outSupported',has_r7); END IF;
  INSERT INTO public.member_card_scan_requests(actor_id,station,channel,request_key,payload,result)
  VALUES(a.id,p_station,channel_value,p_key,payload_value,result_value);
 END IF;
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 RETURN result_value;
END $$;
-- Retain the CARD-only entrypoint used by kiosk; no duplicate admission/replay logic.
CREATE FUNCTION member_card_admit(p_session text,p_station text,p_key uuid,p_card text,p_direction text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_card IS NULL OR p_card !~ '^CARD-[0-9]{1,95}$' THEN
  RAISE EXCEPTION 'Invalid card scan' USING ERRCODE='22023'; END IF;
 RETURN public.member_scan_admit(p_session,p_station,p_key,p_card,p_direction);
END $$;
REVOKE ALL ON member_cards,member_card_audit,member_card_scan_requests FROM PUBLIC;
REVOKE ALL ON SEQUENCE member_card_audit_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION member_card_immutable(),member_card_target(text,text),member_card_read(text,text),
 member_card_update(text,uuid,jsonb),member_card_admit(text,text,uuid,text,text),member_scan_admit(text,text,uuid,text,text) FROM PUBLIC;
COMMIT;
