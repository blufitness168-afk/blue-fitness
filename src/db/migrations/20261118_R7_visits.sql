-- PREPARE ONLY; apply after R3 catalog/checkin and R6 time supplement.
-- Never replace entitlement functions or infer exits for historical checkins.
BEGIN;
DO $$ BEGIN
 IF position('time_supplement_allows' IN pg_get_functiondef('real_frontdesk_checkin(text,text,uuid,text)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'R7 requires installed R3 + R6 checkin chain';
 END IF;
END $$;
CREATE TABLE r7_visits (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 member_id integer NOT NULL REFERENCES members(id),
 checkin_id integer NOT NULL UNIQUE REFERENCES checkins(id),
 entered_at timestamptz NOT NULL,
 exited_at timestamptz,
 entry_actor integer NOT NULL REFERENCES members(id),
 exit_actor integer REFERENCES members(id),
 snapshot jsonb NOT NULL,
 CHECK(exited_at IS NULL OR exited_at>=entered_at),
 CHECK((exited_at IS NULL)=(exit_actor IS NULL))
);
CREATE UNIQUE INDEX r7_one_open_visit ON r7_visits(member_id) WHERE exited_at IS NULL;
CREATE TABLE r7_visit_requests (
 actor_id integer NOT NULL REFERENCES members(id), request_key uuid NOT NULL,
 payload jsonb NOT NULL,result jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,request_key)
);
CREATE FUNCTION r7_visit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'R7 audit is append-only'; END IF;
 IF OLD.exited_at IS NOT NULL OR NEW.exited_at IS NULL OR NEW.exit_actor IS NULL
 OR (to_jsonb(NEW)-'exited_at'-'exit_actor') IS DISTINCT FROM (to_jsonb(OLD)-'exited_at'-'exit_actor') THEN
  RAISE EXCEPTION 'Only first paired exit may update a visit'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER r7_visit_guard BEFORE UPDATE OR DELETE ON r7_visits FOR EACH ROW EXECUTE FUNCTION r7_visit_guard();
CREATE FUNCTION r7_audit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN RAISE EXCEPTION 'R7 audit is append-only'; END $$;
CREATE TRIGGER r7_request_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON r7_visit_requests FOR EACH STATEMENT EXECUTE FUNCTION r7_audit_guard();
CREATE TRIGGER r7_truncate_guard BEFORE TRUNCATE ON r7_visits FOR EACH STATEMENT EXECUTE FUNCTION r7_audit_guard();
CREATE FUNCTION r7_visit_action(p_session text,p_station text,p_key uuid,p_code text,p_direction text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE s auth_sessions%ROWTYPE; staff members%ROWTYPE; m members%ROWTYPE;
 prior r7_visit_requests%ROWTYPE; v r7_visits%ROWTYPE; payload jsonb; result jsonb; t timestamptz; snap jsonb;
BEGIN
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session FOR SHARE;
 SELECT * INTO staff FROM members WHERE id=s.member_id FOR SHARE;
 IF s.id IS NULL OR s.mode<>'NORMAL' OR s.revoked_at IS NOT NULL OR s.expires_at<=clock_timestamp()
 OR staff.id IS NULL OR staff.role NOT IN ('ADMIN','OWNER') OR staff.status='SUSPENDED' THEN
  RAISE EXCEPTION 'Normal staff session required' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_code IS NULL OR p_code !~ '^BLU-[0-9]{1,12}$' OR p_direction IS NULL OR p_direction NOT IN ('IN','OUT')
 OR p_station IS NULL THEN RAISE EXCEPTION 'Invalid visit request' USING ERRCODE='22023'; END IF;
 payload:=jsonb_build_object('code',p_code,'direction',p_direction,'station',p_station);
 PERFORM pg_advisory_xact_lock(hashtextextended('r7-request:'||staff.id||':'||p_key,0));
 SELECT * INTO prior FROM r7_visit_requests WHERE actor_id=staff.id AND request_key=p_key;
 IF FOUND THEN
  IF prior.payload<>payload THEN RAISE EXCEPTION 'Request key reused' USING ERRCODE='22023'; END IF;
  RETURN prior.result;
 END IF;
 SELECT * INTO m FROM members WHERE member_code=p_code FOR UPDATE;
 t:=clock_timestamp();
 SELECT * INTO v FROM r7_visits WHERE member_id=m.id AND exited_at IS NULL FOR UPDATE;
 IF m.id IS NULL THEN result:=jsonb_build_object('ok',false,'reason','NOT_FOUND');
 ELSIF p_direction='OUT' THEN
  IF v.id IS NULL THEN result:=jsonb_build_object('ok',false,'reason','NO_OPEN_VISIT');
  ELSE
   UPDATE r7_visits SET exited_at=t,exit_actor=staff.id WHERE id=v.id;
   result:=jsonb_build_object('ok',true,'reason','EXIT','visitId',v.id,'checkedAt',t);
  END IF;
 ELSIF v.id IS NOT NULL THEN result:=jsonb_build_object('ok',false,'reason','ALREADY_IN','visitId',v.id);
 ELSE
  -- Actor-scoped inner key avoids collisions with legacy station-scoped requests.
  result:=real_frontdesk_checkin(p_session,p_station||':R7:'||staff.id,p_key,p_code);
  IF coalesce((result->>'ok')::boolean,false) THEN
   IF EXISTS(SELECT 1 FROM r7_visits WHERE checkin_id=(result->>'checkinId')::integer) THEN
    RAISE EXCEPTION 'Unexpected inner request replay'; END IF;
   t:=(result->>'checkedAt')::timestamptz;
      SELECT jsonb_build_object('reason',result->>'reason','package',o.package_snapshot,'orderId',o.id,
    'mainTimeSlot',o.package_snapshot->>'timeSlot',
        'usedTimeSlot',CASE WHEN result->>'reason'='FREE_ENTRY' THEN '07:00-22:00'
         WHEN package_catalog_slot_allows(o.package_snapshot->>'timeSlot',(t AT TIME ZONE 'Asia/Bangkok')::time)
           OR (package_catalog_legacy_paid_slot(o.package_snapshot)
            AND (t AT TIME ZONE 'Asia/Bangkok')::time=right(o.package_snapshot->>'timeSlot',5)::time) THEN o.package_snapshot->>'timeSlot'
         ELSE (SELECT g.daily_slot FROM time_supplement_grants g JOIN time_supplement_activations a USING(coupon_id)
          WHERE g.member_id=m.id AND a.activated_at<=t AND a.expires_at>t
          AND package_catalog_slot_allows(g.daily_slot,(t AT TIME ZONE 'Asia/Bangkok')::time) ORDER BY a.activated_at LIMIT 1) END,
    'supplement',CASE WHEN time_supplement_allows(m.id,t) THEN
      (SELECT jsonb_build_object('couponId',g.coupon_id,'timeSlot',g.daily_slot,'expiresAt',a.expires_at)
       FROM time_supplement_grants g JOIN time_supplement_activations a USING(coupon_id)
       WHERE g.member_id=m.id AND a.activated_at<=t AND a.expires_at>t ORDER BY a.activated_at LIMIT 1) END)
   INTO snap FROM (SELECT 1) seed LEFT JOIN LATERAL
    (SELECT id,package_snapshot FROM package_payment_orders WHERE member_id=m.id AND status='PAID'
     ORDER BY paid_at DESC NULLS LAST,created_at DESC,id DESC LIMIT 1) o ON result->>'reason'='PAID_ENTRY';
   INSERT INTO r7_visits(member_id,checkin_id,entered_at,entry_actor,snapshot)
   VALUES(m.id,(result->>'checkinId')::integer,(result->>'checkedAt')::timestamptz,staff.id,snap) RETURNING * INTO v;
   result:=result||jsonb_build_object('visitId',v.id);
  END IF;
 END IF;
 INSERT INTO r7_visit_requests(actor_id,request_key,payload,result) VALUES(staff.id,p_key,payload,result);
 RETURN result;
END $$;
REVOKE ALL ON r7_visits,r7_visit_requests FROM PUBLIC;
REVOKE ALL ON FUNCTION r7_visit_action(text,text,uuid,text,text),r7_visit_guard(),r7_audit_guard() FROM PUBLIC;
COMMIT;
