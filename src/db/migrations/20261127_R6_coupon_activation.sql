-- PREPARE ONLY. Install after 20261024_real_benefits_admin.sql; no backfill.
BEGIN;
SET LOCAL search_path TO public, pg_catalog;

ALTER TABLE benefit_definitions
 ADD COLUMN requires_activation boolean NOT NULL DEFAULT false,
 ADD COLUMN activation_duration_minutes integer,
 ADD CONSTRAINT benefit_activation_policy CHECK (
   (NOT requires_activation AND activation_duration_minutes IS NULL)
   OR (requires_activation AND kind='COUPON' AND isfinite(expires_at)
       AND (activation_duration_minutes IS NULL OR activation_duration_minutes>=0)));

-- Legacy readers still see expire_date. For a new grant it initially equals the
-- campaign deadline; activation replaces it with the effective deadline once.
ALTER TABLE coupons
 ADD COLUMN campaign_expires_at timestamptz,
 ADD COLUMN activation_duration_minutes integer,
 ADD COLUMN activated_at timestamptz,
 ADD CONSTRAINT coupon_activation_policy CHECK (
   (campaign_expires_at IS NULL AND activation_duration_minutes IS NULL AND activated_at IS NULL)
   OR (campaign_expires_at IS NOT NULL AND isfinite(campaign_expires_at)
       AND type IN ('FRIEND_PASS','EXTRA_DAYS')
       AND (activation_duration_minutes IS NULL OR activation_duration_minutes>=0)
       AND expire_date IS NOT NULL AND expire_date<=campaign_expires_at
       AND ((activated_at IS NULL AND expire_date=campaign_expires_at AND used_count=0)
            OR (activated_at IS NOT NULL AND activated_at>=created_at AND activated_at<expire_date))));

CREATE OR REPLACE FUNCTION public.real_benefits_admin_action(p_session text,p_action text,p_key uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE s auth_sessions%ROWTYPE; actor members%ROWTYPE; target members%ROWTYPE;
 d benefit_definitions%ROWTYPE; a benefit_assignments%ROWTYPE; c coupons%ROWTYPE;
 prior benefit_action_audit%ROWTYPE; result jsonb; old_expiry timestamptz; t timestamptz;
BEGIN
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session FOR SHARE;
 SELECT * INTO actor FROM members WHERE id=s.member_id FOR UPDATE;
 IF s.id IS NULL OR s.mode<>'NORMAL' OR s.revoked_at IS NOT NULL OR s.expires_at<=clock_timestamp()
 OR actor.id IS NULL OR actor.status='SUSPENDED' OR actor.role NOT IN ('ADMIN','OWNER') THEN
 RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN ('list','create','deactivate','grant','cancel','consume','create_r6_coupon') THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023'; END IF;
 IF p_action='list' THEN
 RETURN jsonb_build_object(
 'couponActivationReady',true,
 'definitions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id DESC) FROM benefit_definitions x),'[]'::jsonb),
 'assignments',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT assigned.*,m.member_code,m.full_name,wallet.type,wallet.title,wallet.status,wallet.used_count,wallet.total_quota,wallet.expire_date FROM benefit_assignments assigned JOIN members m ON m.id=assigned.member_id LEFT JOIN coupons wallet ON wallet.id=assigned.coupon_id ORDER BY assigned.id DESC LIMIT 500) x),'[]'::jsonb),
 'coupons',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT wallet.*,m.member_code,m.full_name,
 CASE WHEN wallet.campaign_expires_at IS NOT NULL AND wallet.status='AVAILABLE' THEN
   CASE WHEN wallet.expire_date<=statement_timestamp() THEN 'EXPIRED'
        WHEN wallet.activated_at IS NULL THEN 'PENDING_ACTIVATION' ELSE 'AVAILABLE' END
 END AS activation_status FROM coupons wallet JOIN members m ON m.id=wallet.member_id ORDER BY wallet.id DESC LIMIT 500) x),'[]'::jsonb),
 'promoOrders',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT r.*,o.promo_code,o.member_id,o.status,o.amount_satang,o.discount_satang,o.upload_deadline FROM benefit_promo_reservations r JOIN package_payment_orders o ON o.id=r.order_id ORDER BY r.created_at DESC LIMIT 500) x),'[]'::jsonb),
  'audit',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM benefit_action_audit ORDER BY created_at DESC LIMIT 100) x),'[]'::jsonb));
 END IF;
 IF p_key IS NULL THEN RAISE EXCEPTION 'Request UUID required' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM benefit_action_audit WHERE actor_id=actor.id AND request_key=p_key;
 IF FOUND THEN
 IF prior.action<>p_action OR prior.payload<>p_payload THEN RAISE EXCEPTION 'Request key reused' USING ERRCODE='22023'; END IF;
 RETURN prior.result; END IF;
 IF p_action IN ('create','create_r6_coupon') THEN
 -- Distinct action: the pre-R6 function must reject, never silently create a legacy coupon.
 IF (p_action='create_r6_coupon' AND (p_payload->>'kind' IS DISTINCT FROM 'COUPON'
   OR COALESCE(jsonb_typeof(p_payload->'activationDurationMinutes'),'missing') NOT IN ('number','null')
   OR (jsonb_typeof(p_payload->'activationDurationMinutes')='number'
       AND (p_payload->>'activationDurationMinutes') !~ '^(0|[1-9][0-9]{0,9})$')
   OR NOT COALESCE(isfinite((p_payload->>'expiresAt')::timestamptz),false)))
 OR (p_action='create' AND p_payload ? 'activationDurationMinutes') THEN
   RAISE EXCEPTION 'Invalid coupon activation policy' USING ERRCODE='22023'; END IF;
 IF (p_payload->>'expiresAt')::timestamptz<=clock_timestamp() THEN RAISE EXCEPTION 'Expired definition'; END IF;
 INSERT INTO benefit_definitions(kind,title,coupon_type,quota,bonus_days,code,discount_type,discount_value,min_satang,max_discount_satang,usage_limit,expires_at,created_by,requires_activation,activation_duration_minutes)
 VALUES(p_payload->>'kind',btrim(p_payload->>'title'),(p_payload->>'couponType')::coupon_type,COALESCE((p_payload->>'quota')::integer,1),COALESCE((p_payload->>'bonusDays')::integer,0),
 p_payload->>'code',p_payload->>'discountType',COALESCE((p_payload->>'discountValue')::integer,0),COALESCE((p_payload->>'minSatang')::integer,0),(p_payload->>'maxDiscountSatang')::integer,COALESCE((p_payload->>'usageLimit')::integer,1),(p_payload->>'expiresAt')::timestamptz,actor.id,p_action='create_r6_coupon',(p_payload->>'activationDurationMinutes')::integer) RETURNING * INTO d;
 result:=to_jsonb(d);
 ELSIF p_action='deactivate' THEN
 SELECT * INTO d FROM benefit_definitions WHERE id=(p_payload->>'definitionId')::integer FOR UPDATE;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Definition missing'; END IF;
 UPDATE benefit_definitions SET active=false WHERE id=d.id;
 result:=jsonb_build_object('definitionId',d.id,'active',false);
 ELSIF p_action='grant' THEN
 SELECT * INTO target FROM members WHERE member_code=p_payload->>'memberCode' FOR UPDATE;
 IF target.id IS NULL OR target.status='SUSPENDED' THEN RAISE EXCEPTION 'Member unavailable'; END IF;
 SELECT * INTO d FROM benefit_definitions WHERE id=(p_payload->>'definitionId')::integer FOR UPDATE;
 IF d.id IS NULL OR NOT d.active OR d.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Definition unavailable'; END IF;
 SELECT * INTO a FROM benefit_assignments WHERE definition_id=d.id AND member_id=target.id;
 IF FOUND THEN RAISE EXCEPTION 'Already assigned'; END IF;
 IF d.kind='COUPON' THEN
 INSERT INTO coupons(member_id,source,type,title,total_quota,used_count,bonus_days_value,expire_date,status,campaign_expires_at,activation_duration_minutes)
 VALUES(target.id,'ADMIN_BENEFIT:'||d.id,d.coupon_type,d.title,d.quota,0,d.bonus_days,d.expires_at,'AVAILABLE',CASE WHEN d.requires_activation THEN d.expires_at END,d.activation_duration_minutes) RETURNING * INTO c;
 END IF;
 INSERT INTO benefit_assignments(definition_id,member_id,coupon_id,granted_by) VALUES(d.id,target.id,c.id,actor.id) RETURNING * INTO a;
 result:=to_jsonb(a);
 ELSIF p_action='cancel' THEN
 SELECT m.* INTO target FROM members m JOIN benefit_assignments x ON x.member_id=m.id WHERE x.id=(p_payload->>'assignmentId')::integer FOR UPDATE OF m;
 SELECT * INTO a FROM benefit_assignments WHERE id=(p_payload->>'assignmentId')::integer FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Assignment missing'; END IF;
 SELECT * INTO d FROM benefit_definitions WHERE id=a.definition_id FOR UPDATE;
 IF d.kind='PROMO' AND EXISTS(SELECT 1 FROM package_payment_orders o WHERE o.member_id=a.member_id AND o.promo_code=d.code
 AND (o.status='PAID' OR (o.status='PENDING' AND (o.upload_deadline>clock_timestamp() OR EXISTS(SELECT 1 FROM package_payment_attempts x WHERE x.order_id=o.id AND x.state IN ('PROCESSING','UNKNOWN','VERIFIED')))))) THEN RAISE EXCEPTION 'Promo already reserved or consumed'; END IF;
 IF a.coupon_id IS NOT NULL THEN
 SELECT * INTO c FROM coupons WHERE id=a.coupon_id FOR UPDATE;
 IF c.used_count>0 THEN RAISE EXCEPTION 'Cannot cancel consumed coupon'; END IF;
 UPDATE coupons SET status='EXPIRED',expire_date=CASE WHEN c.campaign_expires_at IS NOT NULL THEN c.expire_date ELSE least(COALESCE(c.expire_date,clock_timestamp()),clock_timestamp()) END WHERE id=c.id;
 END IF;
 UPDATE benefit_assignments SET cancelled_at=COALESCE(cancelled_at,clock_timestamp()) WHERE id=a.id;
 result:=jsonb_build_object('assignmentId',a.id,'cancelled',true);
 ELSE
 -- Same member-before-coupon lock order as welcome/kiosk and payment finalization.
 SELECT m.* INTO target FROM members m JOIN coupons x ON x.member_id=m.id WHERE x.id=(p_payload->>'couponId')::integer FOR UPDATE OF m;
 SELECT * INTO c FROM coupons WHERE id=(p_payload->>'couponId')::integer FOR UPDATE;
 t:=clock_timestamp();
 IF target.id IS NULL OR target.status='SUSPENDED' OR c.id IS NULL OR c.status<>'AVAILABLE' OR c.created_at>t
 OR (c.campaign_expires_at IS NOT NULL AND c.activated_at IS NULL)
 OR (c.expire_date IS NOT NULL AND c.expire_date<=t) OR c.used_count<0 OR c.used_count>=c.total_quota
 OR c.type NOT IN ('FRIEND_PASS','EXTRA_DAYS') OR EXISTS(SELECT 1 FROM benefit_assignments WHERE coupon_id=c.id AND cancelled_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Coupon unavailable'; END IF;
 old_expiry:=target.expire_date;
 IF c.type='EXTRA_DAYS' THEN
 IF c.total_quota<>1 OR c.used_count<>0 OR c.bonus_days_value NOT BETWEEN 1 AND 365 OR target.status<>'ACTIVE' OR target.expire_date IS NULL OR target.expire_date<=t THEN RAISE EXCEPTION 'Active membership required'; END IF;
 UPDATE members SET expire_date=expire_date+c.bonus_days_value*interval '24 hours',updated_at=t WHERE id=target.id RETURNING * INTO target;
 ELSE
 IF length(btrim(COALESCE(p_payload->>'guestReference',''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Guest reference required' USING ERRCODE='22023'; END IF;
 END IF;
 UPDATE coupons SET used_count=used_count+1,status=CASE WHEN used_count+1=total_quota THEN 'USED'::coupon_status ELSE status END WHERE id=c.id RETURNING * INTO c;
 INSERT INTO benefit_consumptions(coupon_id,member_id,actor_id,request_key,guest_reference,expiry_before,expiry_after)
 VALUES(c.id,target.id,actor.id,p_key,CASE WHEN c.type='FRIEND_PASS' THEN btrim(p_payload->>'guestReference') END,old_expiry,target.expire_date);
 result:=jsonb_build_object('couponId',c.id,'usedCount',c.used_count,'status',c.status,'membershipExpiresAt',target.expire_date);
 END IF;
 INSERT INTO benefit_action_audit(actor_id,request_key,action,payload,result) VALUES(actor.id,p_key,p_action,p_payload,result);
 RETURN result;
END $$;

-- One immutable activation receipt per owned coupon; the coupon ID is the replay key.
CREATE FUNCTION public.r6_activate_coupon(p_session text,p_coupon integer)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE s auth_sessions%ROWTYPE; m members%ROWTYPE; c coupons%ROWTYPE; t timestamptz;
BEGIN
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session FOR SHARE;
 SELECT * INTO m FROM members WHERE id=s.member_id FOR UPDATE;
 IF s.id IS NULL OR s.mode IS DISTINCT FROM 'NORMAL' OR s.revoked_at IS NOT NULL OR s.expires_at<=clock_timestamp()
 OR m.id IS NULL OR m.status='SUSPENDED' THEN
   RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 -- Match cancel/consume's member-before-coupon lock order. No caller-supplied clock.
 SELECT * INTO c FROM coupons WHERE id=p_coupon AND member_id=m.id FOR UPDATE;
 IF c.id IS NULL OR c.campaign_expires_at IS NULL THEN RAISE EXCEPTION 'Coupon unavailable'; END IF;
 IF c.activated_at IS NULL THEN
   t:=clock_timestamp();
   IF c.status<>'AVAILABLE' OR c.created_at>t OR c.campaign_expires_at<=t OR c.used_count<>0
     OR c.total_quota<=0 OR NOT EXISTS (SELECT 1 FROM benefit_assignments a
         WHERE a.coupon_id=c.id AND a.member_id=m.id AND a.cancelled_at IS NULL) THEN
     RAISE EXCEPTION 'Coupon unavailable'; END IF;
   UPDATE coupons SET activated_at=t, expire_date=CASE WHEN c.activation_duration_minutes IS NULL
     THEN c.campaign_expires_at ELSE LEAST(c.campaign_expires_at, t+make_interval(mins =>
       CASE WHEN c.activation_duration_minutes=0 THEN 10 ELSE c.activation_duration_minutes END)) END
   WHERE id=c.id RETURNING * INTO c;
 END IF;
 RETURN jsonb_build_object('couponId',c.id,'activatedAt',c.activated_at,'expiresAt',c.expire_date);
END $$;
REVOKE ALL ON FUNCTION public.r6_activate_coupon(text,integer) FROM PUBLIC;
COMMIT;
