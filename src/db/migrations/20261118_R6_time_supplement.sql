-- PREPARE ONLY. Requires R3 catalog + checkin migrations. No backfill.
-- Conservative compatibility: exactly one proven standalone online PAID main.
BEGIN;
CREATE TABLE time_supplement_grants (
 coupon_id integer PRIMARY KEY REFERENCES coupons(id) ON DELETE RESTRICT,
 member_id integer NOT NULL REFERENCES members(id),
 main_order_id uuid NOT NULL REFERENCES package_payment_orders(id),
 main_snapshot jsonb NOT NULL, main_expires_at timestamptz NOT NULL,
 daily_slot text NOT NULL CHECK(package_catalog_daily_slot_valid(daily_slot)),
 granted_by integer NOT NULL REFERENCES members(id), reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 240),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE time_supplement_activations (
 coupon_id integer PRIMARY KEY REFERENCES time_supplement_grants(coupon_id),
 member_id integer NOT NULL REFERENCES members(id),
 activated_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 CHECK(expires_at>activated_at)
);
CREATE TABLE time_supplement_requests (
 actor_id integer NOT NULL REFERENCES members(id), request_key uuid NOT NULL,
 action text NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor_id,request_key)
);
CREATE FUNCTION time_supplement_immutable() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Time supplement audit is append-only'; END $$;
CREATE TRIGGER time_supplement_grant_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON time_supplement_grants
 FOR EACH STATEMENT EXECUTE FUNCTION time_supplement_immutable();
CREATE TRIGGER time_supplement_activation_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON time_supplement_activations
 FOR EACH STATEMENT EXECUTE FUNCTION time_supplement_immutable();
CREATE TRIGGER time_supplement_request_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON time_supplement_requests
 FOR EACH STATEMENT EXECUTE FUNCTION time_supplement_immutable();

-- Caller holds member lock. Do not infer intervals from aggregate expiry or latest PAID.
CREATE FUNCTION time_supplement_main(p_member integer,p_at timestamptz)
RETURNS SETOF package_payment_orders LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 SELECT o.* FROM package_payment_orders o JOIN members m ON m.id=o.member_id
 WHERE m.id=p_member AND m.status='ACTIVE' AND m.expire_date>p_at
 AND o.status='PAID' AND o.confirmed_at<=p_at AND o.membership_expires_at>p_at
 AND m.expire_date=o.membership_expires_at
 AND coalesce(o.package_snapshot->>'durationDays','') ~ '^[1-9][0-9]{0,3}$'
 AND o.membership_expires_at=o.confirmed_at +
   (CASE WHEN coalesce(o.package_snapshot->>'durationDays','') ~ '^[1-9][0-9]{0,3}$'
     THEN (o.package_snapshot->>'durationDays')::integer ELSE 0 END)*interval '24 hours'
 AND coalesce(package_catalog_daily_slot_valid(o.package_snapshot->>'timeSlot'),false)
 AND (SELECT count(*) FROM package_payment_orders x WHERE x.member_id=m.id AND x.status='PAID')=1
$$;
CREATE FUNCTION time_supplement_window_end(p_slot text,p_at timestamptz,p_main_end timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path=public,pg_catalog AS $$
 SELECT CASE WHEN coalesce(package_catalog_slot_allows(p_slot,(p_at AT TIME ZONE 'Asia/Bangkok')::time),false)
 THEN least(p_main_end,(((p_at AT TIME ZONE 'Asia/Bangkok')::date + right(p_slot,5)::time) AT TIME ZONE 'Asia/Bangkok')) END
$$;
CREATE FUNCTION time_supplement_allows(p_member integer,p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM time_supplement_activations a
 JOIN time_supplement_grants g USING(coupon_id) JOIN coupons c ON c.id=g.coupon_id
 JOIN time_supplement_main(p_member,p_at) o ON o.id=g.main_order_id
 WHERE a.member_id=p_member AND g.member_id=p_member AND c.member_id=p_member
 AND a.activated_at<=p_at AND a.expires_at>p_at AND g.main_expires_at=o.membership_expires_at
 AND g.main_snapshot=o.package_snapshot AND c.type='CUSTOM' AND c.source='TIME_SUPPLEMENT:'||g.coupon_id
 AND c.status='USED' AND c.total_quota=1 AND c.used_count=1 AND c.bonus_days_value=0
 AND c.expire_date>p_at AND package_catalog_slot_allows(g.daily_slot,(p_at AT TIME ZONE 'Asia/Bangkok')::time))
$$;
CREATE FUNCTION time_supplement_action(p_session text,p_action text,p_key uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE s auth_sessions%ROWTYPE; actor members%ROWTYPE; m members%ROWTYPE; o package_payment_orders%ROWTYPE;
 g time_supplement_grants%ROWTYPE; c coupons%ROWTYPE; a time_supplement_activations%ROWTYPE;
 prior time_supplement_requests%ROWTYPE; result jsonb; t timestamptz; ending timestamptz; cid integer;
BEGIN
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session FOR SHARE;
 -- Serialize this actor before taking member locks (including self activation upgrades).
 PERFORM pg_advisory_xact_lock(hashtextextended('time-supplement-actor:'||s.member_id,0));
 SELECT * INTO actor FROM members WHERE id=s.member_id FOR SHARE;
 IF s.id IS NULL OR s.mode<>'NORMAL' OR s.revoked_at IS NOT NULL OR s.expires_at<=clock_timestamp()
 OR actor.id IS NULL OR actor.status='SUSPENDED' THEN RAISE EXCEPTION 'Normal session required' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('list','grant','activate') THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023'; END IF;
 IF p_action='grant' AND actor.role NOT IN ('ADMIN','OWNER') THEN RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
 IF p_action='list' THEN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('couponId',gg.coupon_id,'title',cc.title,'timeSlot',gg.daily_slot,
   'expiresAt',cc.expire_date,'usedCount',cc.used_count,'activatedAt',aa.activated_at,'activeUntil',aa.expires_at,
   'active',coalesce(aa.expires_at>clock_timestamp() AND time_supplement_allows(actor.id,clock_timestamp()),false)) ORDER BY gg.coupon_id DESC)
   FROM time_supplement_grants gg JOIN coupons cc ON cc.id=gg.coupon_id
   LEFT JOIN time_supplement_activations aa USING(coupon_id) WHERE gg.member_id=actor.id),'[]'::jsonb);
 END IF;
 IF p_key IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('time-supplement-request:'||actor.id||':'||p_key,0));
 SELECT * INTO prior FROM time_supplement_requests WHERE actor_id=actor.id AND request_key=p_key;
 IF FOUND THEN
  IF prior.action<>p_action OR prior.payload<>p_payload THEN RAISE EXCEPTION 'Request key reused' USING ERRCODE='22023'; END IF;
  RETURN prior.result;
 END IF;
 IF p_action='grant' THEN
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k) IS DISTINCT FROM ARRAY['memberCode','reason','timeSlot','title']::text[]
  OR jsonb_typeof(p_payload->'memberCode')<>'string' OR jsonb_typeof(p_payload->'reason')<>'string'
  OR jsonb_typeof(p_payload->'timeSlot')<>'string' OR jsonb_typeof(p_payload->'title')<>'string'
  OR length(btrim(p_payload->>'title')) NOT BETWEEN 1 AND 120 OR length(btrim(p_payload->>'reason')) NOT BETWEEN 1 AND 240
  OR NOT coalesce(package_catalog_daily_slot_valid(p_payload->>'timeSlot'),false) THEN RAISE EXCEPTION 'Invalid grant' USING ERRCODE='22023'; END IF;
  SELECT * INTO m FROM members WHERE member_code=p_payload->>'memberCode' FOR UPDATE;
 ELSE
  IF p_payload IS DISTINCT FROM jsonb_build_object('couponId',p_payload->'couponId')
  OR jsonb_typeof(p_payload->'couponId') IS DISTINCT FROM 'number' OR (p_payload->>'couponId') !~ '^[1-9][0-9]{0,8}$'
  THEN RAISE EXCEPTION 'Invalid activation' USING ERRCODE='22023'; END IF;
  SELECT * INTO m FROM members WHERE id=actor.id FOR UPDATE;
 END IF;
 t:=clock_timestamp();
 SELECT * INTO o FROM time_supplement_main(m.id,t);
 IF o.id IS NULL THEN RAISE EXCEPTION 'Proven active standalone main required'; END IF;
 IF p_action='grant' THEN
  -- One coupon per request, no price, days, bulk targeting, implicit future grants or cancellation.
  INSERT INTO coupons(member_id,type,source,title,total_quota,used_count,bonus_days_value,expire_date,status)
  VALUES(m.id,'CUSTOM','TIME_SUPPLEMENT_REQUEST:'||actor.id||':'||p_key,btrim(p_payload->>'title'),1,0,0,o.membership_expires_at,'AVAILABLE') RETURNING id INTO cid;
  UPDATE coupons SET source='TIME_SUPPLEMENT:'||cid WHERE id=cid;
  INSERT INTO time_supplement_grants(coupon_id,member_id,main_order_id,main_snapshot,main_expires_at,daily_slot,granted_by,reason)
  VALUES(cid,m.id,o.id,o.package_snapshot,o.membership_expires_at,p_payload->>'timeSlot',actor.id,btrim(p_payload->>'reason'));
  result:=jsonb_build_object('couponId',cid,'timeSlot',p_payload->>'timeSlot','expiresAt',o.membership_expires_at);
 ELSE
  -- Any concurrent coupon activation for this member converges on the already-active result.
  SELECT a0.* INTO a FROM time_supplement_activations a0 WHERE a0.member_id=m.id AND a0.expires_at>t ORDER BY a0.activated_at LIMIT 1;
  SELECT * INTO g FROM time_supplement_grants WHERE coupon_id=(p_payload->>'couponId')::integer AND member_id=m.id;
  IF g.coupon_id IS NULL THEN RAISE EXCEPTION 'Coupon unavailable'; END IF;
  IF a.coupon_id IS NOT NULL AND time_supplement_allows(m.id,t) THEN
   result:=jsonb_build_object('couponId',a.coupon_id,'activatedAt',a.activated_at,'expiresAt',a.expires_at);
  ELSE
   SELECT * INTO c FROM coupons WHERE id=g.coupon_id FOR UPDATE;
   IF g.main_order_id<>o.id OR g.main_snapshot<>o.package_snapshot OR g.main_expires_at<>o.membership_expires_at
   OR c.member_id<>m.id OR c.type<>'CUSTOM' OR c.source<>'TIME_SUPPLEMENT:'||g.coupon_id
   OR c.status<>'AVAILABLE' OR c.total_quota<>1 OR c.used_count<>0 OR c.bonus_days_value<>0
   OR c.created_at>t OR c.expire_date IS NULL OR c.expire_date<=t THEN RAISE EXCEPTION 'Coupon unavailable'; END IF;
   ending:=time_supplement_window_end(g.daily_slot,t,least(o.membership_expires_at,c.expire_date));
   IF ending IS NULL OR ending<=t THEN RAISE EXCEPTION 'Outside Bangkok window'; END IF;
   UPDATE coupons SET used_count=1,status='USED' WHERE id=c.id;
   INSERT INTO time_supplement_activations VALUES(c.id,m.id,t,ending) RETURNING * INTO a;
   result:=jsonb_build_object('couponId',a.coupon_id,'activatedAt',a.activated_at,'expiresAt',a.expires_at);
  END IF;
 END IF;
 INSERT INTO time_supplement_requests(actor_id,request_key,action,payload,result) VALUES(actor.id,p_key,p_action,p_payload,result);
 RETURN result;
END $$;
-- Guard source drift; preserve auth, request replay, bounce and actual PAID snapshot selection.
DO $upgrade$
DECLARE signature text; original text; anchor text := $anchor$IF package_catalog_slot_allows(slot,local_time) THEN reason:='PAID_ENTRY';$anchor$;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.kiosk_checkin(text,text,uuid,text)','public.real_frontdesk_checkin(text,text,uuid,text)'] LOOP
  original:=pg_get_functiondef(signature::regprocedure);
  IF length(original)-length(replace(original,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'Unexpected R6 checkin source: %',signature; END IF;
  EXECUTE replace(original,anchor,$new$IF package_catalog_slot_allows(slot,local_time) OR time_supplement_allows(m.id,t) THEN reason:='PAID_ENTRY';$new$);
 END LOOP;
END $upgrade$;
REVOKE ALL ON time_supplement_grants,time_supplement_activations,time_supplement_requests FROM PUBLIC;
REVOKE ALL ON FUNCTION time_supplement_immutable(),time_supplement_main(integer,timestamptz),time_supplement_window_end(text,timestamptz,timestamptz),time_supplement_allows(integer,timestamptz),time_supplement_action(text,text,uuid,jsonb) FROM PUBLIC;
COMMIT;
