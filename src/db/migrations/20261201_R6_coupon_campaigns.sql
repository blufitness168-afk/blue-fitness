-- PREPARE ONLY. Requires 20261129_R6_staff_grant_targeting.sql (and its prerequisites).
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL search_path=public,pg_catalog;

ALTER TABLE benefit_definitions
 ADD COLUMN campaign_code text UNIQUE CHECK (campaign_code ~ '^[A-Z0-9_-]{3,40}$'),
 ADD COLUMN campaign_kind text,
 ADD COLUMN campaign_description text,
 ADD COLUMN campaign_per_member integer,
 ADD COLUMN campaign_total integer,
 ADD COLUMN campaign_issued integer NOT NULL DEFAULT 0,
 ADD CONSTRAINT coupon_campaign_policy CHECK (
   (campaign_code IS NULL AND campaign_kind IS NULL AND campaign_description IS NULL AND campaign_per_member IS NULL AND campaign_total IS NULL AND campaign_issued=0)
   OR (campaign_code IS NOT NULL AND kind='COUPON' AND requires_activation
       AND campaign_kind IS NOT NULL AND campaign_kind IN ('FRIEND_PASS','EXTRA_DAYS','GIFT','FREEBIE','OTHER')
       AND coupon_type::text=CASE WHEN campaign_kind IN ('FRIEND_PASS','EXTRA_DAYS') THEN campaign_kind ELSE 'CUSTOM' END
       AND campaign_description IS NOT NULL AND length(btrim(campaign_description)) BETWEEN 1 AND 500
       AND campaign_per_member IS NOT NULL AND campaign_per_member BETWEEN 1 AND 100
       AND campaign_total IS NOT NULL AND campaign_total BETWEEN campaign_per_member AND 1000000 AND campaign_issued BETWEEN 0 AND campaign_total)),
 DROP CONSTRAINT benefit_definitions_check,
 ADD CONSTRAINT benefit_definitions_kind_policy CHECK (
   (kind='COUPON' AND coupon_type IS NOT NULL AND code IS NULL AND discount_type IS NULL AND discount_value=0
    AND ((coupon_type='EXTRA_DAYS' AND quota=1 AND bonus_days>0)
      OR (coupon_type='FRIEND_PASS' AND bonus_days=0)
      OR (coupon_type='CUSTOM' AND campaign_code IS NOT NULL AND bonus_days=0)))
   OR (kind='PROMO' AND coupon_type IS NULL AND code IS NOT NULL AND discount_type IS NOT NULL AND discount_value>0
     AND bonus_days=0 AND (discount_type<>'PERCENT' OR discount_value<=100)));

ALTER TABLE coupons DROP CONSTRAINT coupon_activation_policy,
 ADD CONSTRAINT coupon_activation_policy CHECK (
   (campaign_expires_at IS NULL AND activation_duration_minutes IS NULL AND activated_at IS NULL)
   OR (campaign_expires_at IS NOT NULL AND isfinite(campaign_expires_at)
       AND (type IN ('FRIEND_PASS','EXTRA_DAYS') OR (type='CUSTOM' AND coalesce(source,'') ~ '^ADMIN_BENEFIT:[1-9][0-9]*:[1-9][0-9]*$'))
       AND (activation_duration_minutes IS NULL OR activation_duration_minutes>=0)
       AND expire_date IS NOT NULL AND expire_date<=campaign_expires_at
       AND ((activated_at IS NULL AND expire_date=campaign_expires_at AND used_count=0)
            OR (activated_at IS NOT NULL AND activated_at>=created_at AND activated_at<expire_date))));

ALTER TABLE benefit_assignments ADD COLUMN issue_number integer NOT NULL DEFAULT 1 CHECK(issue_number BETWEEN 1 AND 100),
 ADD COLUMN recipient_duration_days integer CHECK(recipient_duration_days BETWEEN 1 AND 3660),
 DROP CONSTRAINT benefit_assignments_definition_id_member_id_key,
 ADD CONSTRAINT benefit_assignments_issue_key UNIQUE(definition_id,member_id,issue_number);
CREATE INDEX r6_coupon_member_history ON coupons(member_id,id DESC);
CREATE INDEX r6_coupon_use_history ON benefit_consumptions(coupon_id,created_at DESC,id DESC);

-- Preserve the installed invoker ACL, legacy receipts and existing recipient-proof logic.
DO $patch$
DECLARE ddl text; r record;
BEGIN
 SELECT replace(pg_get_functiondef(oid),chr(13),'') INTO ddl FROM pg_proc
 WHERE oid=to_regprocedure('public.real_benefits_admin_action(text,text,uuid,jsonb)') AND NOT prosecdef
   AND proconfig=ARRAY['search_path=public, pg_catalog']
   AND md5(replace(prosrc,chr(13),''))='7914d06f5c7840493bd0ae275d30f84f';
 IF ddl IS NULL THEN RAISE EXCEPTION 'Expected targeted R6 invoker action' USING ERRCODE='0A000'; END IF;
 FOR r IN SELECT * FROM (VALUES
 ($old$lookup_code text; excluded boolean;$old$,
  $new$lookup_code text; excluded boolean; issued_to_member integer := 0; manual boolean;$new$),
 ($old$'grant_preview','cancel','consume','create_r6_coupon')$old$,
  $new$'grant_preview','cancel','consume','create_r6_coupon','create_r6_campaign')$new$),
 ($old$'grantTargetingReady',true,$old$, $new$'grantTargetingReady',true,'couponCampaignReady',true,$new$),
 ($old$ IF p_action IN ('create','create_r6_coupon') THEN$old$,
  $new$ IF p_action='create_r6_campaign' THEN
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
 OR (p_payload - ARRAY['title','campaignCode','campaignKind','description','usesPerCoupon','bonusDays','perMember','total','expiresAt','activationDurationMinutes']) <> '{}'::jsonb
 OR jsonb_typeof(p_payload->'title') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_payload->'campaignCode') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_payload->'campaignKind') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_payload->'description') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_payload->'expiresAt') IS DISTINCT FROM 'string'
 OR EXISTS (SELECT FROM unnest(ARRAY['usesPerCoupon','bonusDays','perMember','total']) AS k(name)
   WHERE jsonb_typeof(p_payload->k.name) IS DISTINCT FROM 'number' OR (p_payload->>k.name) !~ '^(0|[1-9][0-9]{0,6})$')
 OR COALESCE(jsonb_typeof(p_payload->'activationDurationMinutes'),'missing') NOT IN ('number','null')
 OR (jsonb_typeof(p_payload->'activationDurationMinutes')='number' AND (p_payload->>'activationDurationMinutes') !~ '^(0|[1-9][0-9]{0,9})$')
 OR NOT isfinite((p_payload->>'expiresAt')::timestamptz) OR (p_payload->>'expiresAt')::timestamptz<=clock_timestamp()
 THEN RAISE EXCEPTION 'Invalid coupon campaign' USING ERRCODE='22023'; END IF;
 INSERT INTO benefit_definitions(kind,title,coupon_type,quota,bonus_days,expires_at,created_by,requires_activation,activation_duration_minutes,
   campaign_code,campaign_kind,campaign_description,campaign_per_member,campaign_total)
 VALUES('COUPON',btrim(p_payload->>'title'),(CASE WHEN p_payload->>'campaignKind' IN ('FRIEND_PASS','EXTRA_DAYS')
   THEN p_payload->>'campaignKind' ELSE 'CUSTOM' END)::coupon_type,(p_payload->>'usesPerCoupon')::integer,(p_payload->>'bonusDays')::integer,
   (p_payload->>'expiresAt')::timestamptz,actor.id,true,(p_payload->>'activationDurationMinutes')::integer,
   p_payload->>'campaignCode',p_payload->>'campaignKind',btrim(p_payload->>'description'),(p_payload->>'perMember')::integer,(p_payload->>'total')::integer)
 RETURNING * INTO d;
 result:=to_jsonb(d);
 ELSIF p_action IN ('create','create_r6_coupon') THEN$new$),
 ($old$ IF EXISTS (SELECT FROM benefit_assignments WHERE definition_id=d.id AND member_id=target.id)
 THEN RAISE EXCEPTION 'Already assigned'; END IF;$old$,
  $new$ IF d.campaign_code IS NULL THEN
   IF EXISTS (SELECT FROM benefit_assignments WHERE definition_id=d.id AND member_id=target.id)
   THEN RAISE EXCEPTION 'Already assigned'; END IF;
 ELSE
   -- The definition row is locked above; each successful issue advances its lifetime counter.
   SELECT count(*) INTO issued_to_member FROM benefit_assignments WHERE definition_id=d.id AND member_id=target.id;
   IF issued_to_member>=d.campaign_per_member OR d.campaign_issued>=d.campaign_total THEN
     RAISE EXCEPTION 'Coupon issue quota exhausted' USING ERRCODE='P6001'; END IF;
 END IF;$new$),
 ($old$ IF p_action='grant_preview' THEN
   RETURN jsonb_build_object('definitionId'$old$,
  $new$ IF d.campaign_code IS NOT NULL THEN
   fingerprint := encode(sha256(convert_to(jsonb_build_array(fingerprint,issued_to_member)::text,'UTF8')),'hex');
 END IF;
 IF p_action='grant_preview' THEN
   RETURN jsonb_build_object('definitionId'$new$),
 ($old$ VALUES(target.id,'ADMIN_BENEFIT:'||d.id,d.coupon_type,$old$,
  $new$ VALUES(target.id,'ADMIN_BENEFIT:'||d.id||CASE WHEN d.campaign_code IS NOT NULL THEN ':'||(issued_to_member+1) ELSE '' END,d.coupon_type,$new$),
 ($old$ INSERT INTO benefit_assignments(definition_id,member_id,coupon_id,granted_by) VALUES(d.id,target.id,c.id,actor.id) RETURNING * INTO a;$old$,
  $new$ INSERT INTO benefit_assignments(definition_id,member_id,coupon_id,granted_by,issue_number,recipient_duration_days)
 VALUES(d.id,target.id,c.id,actor.id,issued_to_member+1,duration) RETURNING * INTO a;
 IF d.campaign_code IS NOT NULL THEN
   UPDATE benefit_definitions SET campaign_issued=campaign_issued+1 WHERE id=d.id;
 END IF;$new$),
 ($old$ t:=clock_timestamp();
 IF target.id IS NULL OR target.status='SUSPENDED' OR c.id IS NULL$old$,
  $new$ manual := c.type='CUSTOM' AND EXISTS (SELECT FROM benefit_assignments x JOIN benefit_definitions b ON b.id=x.definition_id
   WHERE x.coupon_id=c.id AND x.member_id=c.member_id AND b.campaign_kind IN ('GIFT','FREEBIE','OTHER')
   AND c.source='ADMIN_BENEFIT:'||b.id||':'||x.issue_number AND c.campaign_expires_at IS NOT NULL);
 t:=clock_timestamp();
 IF target.id IS NULL OR target.status='SUSPENDED' OR c.id IS NULL$new$),
 ($old$ OR c.type NOT IN ('FRIEND_PASS','EXTRA_DAYS') OR EXISTS$old$,
  $new$ OR (c.type NOT IN ('FRIEND_PASS','EXTRA_DAYS') AND NOT manual) OR EXISTS$new$),
 ($old$ ELSE
 IF length(btrim(COALESCE(p_payload->>'guestReference',''))) NOT BETWEEN 1 AND 120$old$,
  $new$ ELSIF c.type='FRIEND_PASS' THEN
 IF length(btrim(COALESCE(p_payload->>'guestReference',''))) NOT BETWEEN 1 AND 120$new$)
 ) AS patch(anchor,replacement) LOOP
   IF length(ddl)-length(replace(ddl,r.anchor,''))<>length(r.anchor) THEN
     RAISE EXCEPTION 'Unexpected targeted benefits action' USING ERRCODE='0A000'; END IF;
   ddl:=replace(ddl,r.anchor,r.replacement);
 END LOOP;
 EXECUTE ddl;
END $patch$;

-- Staff sees coupon facts only (not payment, guest references, audit payloads); member sees own rows only.
CREATE FUNCTION r6_coupon_history(p_session text,p_staff boolean,p_before integer,p_member_code text,p_query text,
 p_kind text,p_status text,p_days integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,pg_catalog AS $$
DECLARE viewer integer; result jsonb;
BEGIN
 SELECT m.id INTO viewer FROM auth_sessions s JOIN members m ON m.id=s.member_id
 WHERE s.token_hash=p_session AND s.mode='NORMAL' AND s.revoked_at IS NULL AND s.expires_at>statement_timestamp()
   AND m.status<>'SUSPENDED' AND (NOT p_staff OR m.role IN ('ADMIN','OWNER'));
 IF viewer IS NULL OR p_staff IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 WITH page AS MATERIALIZED (
   SELECT c.id,c.member_id,c.title,COALESCE(d.campaign_kind,c.type::text) AS kind,d.campaign_code AS code,d.campaign_description AS description,
     m.member_code,m.full_name,c.total_quota,c.used_count,c.created_at,c.expire_date,c.campaign_expires_at,c.activated_at,
     c.activation_duration_minutes,a.recipient_duration_days,a.id AS assignment_id,h.status
   FROM coupons c JOIN members m ON m.id=c.member_id
   LEFT JOIN benefit_assignments a ON a.coupon_id=c.id AND a.member_id=c.member_id
   LEFT JOIN benefit_definitions d ON d.id=a.definition_id
   CROSS JOIN LATERAL (SELECT CASE WHEN a.cancelled_at IS NOT NULL THEN 'CANCELLED'
     WHEN c.status='AVAILABLE' AND c.expire_date<=statement_timestamp() THEN 'EXPIRED'
     WHEN c.status='AVAILABLE' AND c.campaign_expires_at IS NOT NULL AND c.activated_at IS NULL THEN 'PENDING_ACTIVATION'
     ELSE c.status::text END AS status) h
   WHERE (p_staff OR c.member_id=viewer) AND (p_before IS NULL OR c.id<p_before)
     AND (p_member_code IS NULL OR m.member_code=p_member_code)
     AND (p_query IS NULL OR strpos(lower(c.title),lower(p_query))>0 OR strpos(lower(d.campaign_code),lower(p_query))>0)
     AND (p_kind IS NULL OR COALESCE(d.campaign_kind,c.type::text)=p_kind)
     AND (p_status IS NULL OR h.status=p_status) AND (p_days IS NULL OR a.recipient_duration_days=p_days)
   ORDER BY c.id DESC LIMIT 51
 ), shown AS MATERIALIZED (SELECT * FROM page ORDER BY id DESC LIMIT 50)
 SELECT jsonb_build_object('rows',COALESCE((SELECT jsonb_agg((to_jsonb(x)-'member_id')||jsonb_build_object('used_at',u.last_use,'use_times',u.times) ORDER BY x.id DESC)
   FROM shown x CROSS JOIN LATERAL (
     SELECT max(created_at) AS last_use, COALESCE(jsonb_agg(created_at ORDER BY created_at DESC,id DESC),'[]'::jsonb) AS times
     FROM benefit_consumptions WHERE coupon_id=x.id AND member_id=x.member_id
   ) u),'[]'::jsonb),'nextBefore',CASE WHEN (SELECT count(*) FROM page)>50 THEN (SELECT min(id) FROM shown) END)
 INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION r6_coupon_history(text,boolean,integer,text,text,text,text,integer) FROM PUBLIC;
COMMIT;
