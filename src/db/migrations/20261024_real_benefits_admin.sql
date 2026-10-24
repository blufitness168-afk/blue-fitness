-- PREPARE ONLY; do not apply automatically. Requires password/welcome, real payment,
-- PromptPay and kiosk migrations (NORMAL sessions). Deploy with payment-server change.
-- No enum/schema.ts changes, no historical grants/backfill, no payment settlement changes.
BEGIN;
CREATE TABLE benefit_definitions (
 id serial PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('COUPON','PROMO')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 coupon_type coupon_type, quota integer NOT NULL DEFAULT 1 CHECK(quota BETWEEN 1 AND 100),
 bonus_days integer NOT NULL DEFAULT 0 CHECK(bonus_days BETWEEN 0 AND 365),
 code text UNIQUE CHECK(code ~ '^[A-Z0-9_-]{3,40}$'),
 discount_type text CHECK(discount_type IN ('FIXED','PERCENT')),
 discount_value integer NOT NULL DEFAULT 0 CHECK(discount_value BETWEEN 0 AND 100000000),
 min_satang integer NOT NULL DEFAULT 0 CHECK(min_satang BETWEEN 0 AND 100000000),
 max_discount_satang integer CHECK(max_discount_satang BETWEEN 1 AND 100000000),
 usage_limit integer NOT NULL DEFAULT 1 CHECK(usage_limit BETWEEN 1 AND 1000000),
 expires_at timestamptz NOT NULL, active boolean NOT NULL DEFAULT true,
 created_by integer NOT NULL REFERENCES members(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind='COUPON' AND coupon_type IS NOT NULL AND coupon_type IN ('FRIEND_PASS','EXTRA_DAYS') AND code IS NULL AND discount_type IS NULL AND discount_value=0
 AND ((coupon_type='EXTRA_DAYS' AND quota=1 AND bonus_days>0) OR (coupon_type='FRIEND_PASS' AND bonus_days=0)))
 OR (kind='PROMO' AND coupon_type IS NULL AND code IS NOT NULL AND discount_type IS NOT NULL AND discount_value>0 AND bonus_days=0
 AND (discount_type<>'PERCENT' OR discount_value<=100)))
);
CREATE TABLE benefit_assignments (
 id serial PRIMARY KEY, definition_id integer NOT NULL REFERENCES benefit_definitions(id),
 member_id integer NOT NULL REFERENCES members(id), coupon_id integer UNIQUE REFERENCES coupons(id),
 cancelled_at timestamptz, granted_by integer NOT NULL REFERENCES members(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(definition_id,member_id)
);
CREATE TABLE benefit_promo_reservations (
 order_id uuid PRIMARY KEY REFERENCES package_payment_orders(id),
 assignment_id integer NOT NULL REFERENCES benefit_assignments(id),
 actor_id integer NOT NULL REFERENCES members(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE benefit_action_audit (
 actor_id integer NOT NULL REFERENCES members(id), request_key uuid NOT NULL,
 action text NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor_id,request_key)
);
CREATE TABLE benefit_consumptions (
 id serial PRIMARY KEY, coupon_id integer NOT NULL REFERENCES coupons(id), member_id integer NOT NULL REFERENCES members(id),
 actor_id integer NOT NULL REFERENCES members(id), request_key uuid NOT NULL,
 guest_reference text, expiry_before timestamptz, expiry_after timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(actor_id,request_key)
);
CREATE FUNCTION benefit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Benefit audit is append-only'; END $$;
CREATE TRIGGER benefit_audit_guard BEFORE UPDATE OR DELETE ON benefit_action_audit FOR EACH ROW EXECUTE FUNCTION benefit_append_only();
CREATE TRIGGER benefit_consumption_guard BEFORE UPDATE OR DELETE ON benefit_consumptions FOR EACH ROW EXECUTE FUNCTION benefit_append_only();
CREATE TRIGGER benefit_promo_reservation_guard BEFORE UPDATE OR DELETE ON benefit_promo_reservations FOR EACH ROW EXECUTE FUNCTION benefit_append_only();

CREATE FUNCTION real_benefits_admin_action(p_session text,p_action text,p_key uuid,p_payload jsonb)
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
 IF p_action NOT IN ('list','create','deactivate','grant','cancel','consume') THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023'; END IF;
 IF p_action='list' THEN
 RETURN jsonb_build_object(
 'definitions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id DESC) FROM benefit_definitions x),'[]'::jsonb),
 'assignments',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT assigned.*,m.member_code,m.full_name,wallet.type,wallet.title,wallet.status,wallet.used_count,wallet.total_quota,wallet.expire_date FROM benefit_assignments assigned JOIN members m ON m.id=assigned.member_id LEFT JOIN coupons wallet ON wallet.id=assigned.coupon_id ORDER BY assigned.id DESC LIMIT 500) x),'[]'::jsonb),
 'coupons',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT wallet.*,m.member_code,m.full_name FROM coupons wallet JOIN members m ON m.id=wallet.member_id ORDER BY wallet.id DESC LIMIT 500) x),'[]'::jsonb),
 'promoOrders',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT r.*,o.promo_code,o.member_id,o.status,o.amount_satang,o.discount_satang,o.upload_deadline FROM benefit_promo_reservations r JOIN package_payment_orders o ON o.id=r.order_id ORDER BY r.created_at DESC LIMIT 500) x),'[]'::jsonb),
  'audit',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM benefit_action_audit ORDER BY created_at DESC LIMIT 100) x),'[]'::jsonb));
 END IF;
 IF p_key IS NULL THEN RAISE EXCEPTION 'Request UUID required' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM benefit_action_audit WHERE actor_id=actor.id AND request_key=p_key;
 IF FOUND THEN
 IF prior.action<>p_action OR prior.payload<>p_payload THEN RAISE EXCEPTION 'Request key reused' USING ERRCODE='22023'; END IF;
 RETURN prior.result; END IF;
 IF p_action='create' THEN
 IF (p_payload->>'expiresAt')::timestamptz<=clock_timestamp() THEN RAISE EXCEPTION 'Expired definition'; END IF;
 INSERT INTO benefit_definitions(kind,title,coupon_type,quota,bonus_days,code,discount_type,discount_value,min_satang,max_discount_satang,usage_limit,expires_at,created_by)
 VALUES(p_payload->>'kind',btrim(p_payload->>'title'),(p_payload->>'couponType')::coupon_type,COALESCE((p_payload->>'quota')::integer,1),COALESCE((p_payload->>'bonusDays')::integer,0),
 p_payload->>'code',p_payload->>'discountType',COALESCE((p_payload->>'discountValue')::integer,0),COALESCE((p_payload->>'minSatang')::integer,0),(p_payload->>'maxDiscountSatang')::integer,COALESCE((p_payload->>'usageLimit')::integer,1),(p_payload->>'expiresAt')::timestamptz,actor.id) RETURNING * INTO d;
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
 INSERT INTO coupons(member_id,source,type,title,total_quota,used_count,bonus_days_value,expire_date,status)
 VALUES(target.id,'ADMIN_BENEFIT:'||d.id,d.coupon_type,d.title,d.quota,0,d.bonus_days,d.expires_at,'AVAILABLE') RETURNING * INTO c;
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
 UPDATE coupons SET status='EXPIRED',expire_date=least(COALESCE(expire_date,clock_timestamp()),clock_timestamp()) WHERE id=c.id;
 END IF;
 UPDATE benefit_assignments SET cancelled_at=COALESCE(cancelled_at,clock_timestamp()) WHERE id=a.id;
 result:=jsonb_build_object('assignmentId',a.id,'cancelled',true);
 ELSE
 -- Same member-before-coupon lock order as welcome/kiosk and payment finalization.
 SELECT m.* INTO target FROM members m JOIN coupons x ON x.member_id=m.id WHERE x.id=(p_payload->>'couponId')::integer FOR UPDATE OF m;
 SELECT * INTO c FROM coupons WHERE id=(p_payload->>'couponId')::integer FOR UPDATE;
 t:=clock_timestamp();
 IF target.id IS NULL OR target.status='SUSPENDED' OR c.id IS NULL OR c.status<>'AVAILABLE' OR c.created_at>t
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

-- Wrap only order creation; existing provider/evidence/finalization functions stay untouched.
-- The authoritative discount is rebuilt under the definition lock, never trusted from client/TS.
ALTER FUNCTION create_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb) RENAME TO create_package_payment_order_before_benefits;
ALTER FUNCTION create_package_payment_order_before_benefits(uuid,integer,text,uuid,jsonb,jsonb) SET search_path TO public,pg_catalog;
CREATE FUNCTION create_package_payment_order(p_id uuid,p_member integer,p_session text,p_key uuid,p_quote jsonb,p_receiver jsonb)
RETURNS SETOF package_payment_orders LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE m members%ROWTYPE; d benefit_definitions%ROWTYPE; a benefit_assignments%ROWTYPE;
 existing package_payment_orders%ROWTYPE; code_value text; subtotal integer; discount integer; q jsonb; used integer;
BEGIN
 SELECT * INTO m FROM members WHERE id=p_member FOR UPDATE;
 IF m.id IS NULL OR m.status='SUSPENDED' OR NOT EXISTS(SELECT 1 FROM auth_sessions WHERE member_id=p_member AND token_hash=p_session AND mode='NORMAL' AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
 code_value:=NULLIF(upper(btrim(p_quote->'promo'->>'code')),'');
 SELECT * INTO existing FROM package_payment_orders WHERE member_id=p_member AND request_key=p_key;
 IF FOUND THEN
 IF existing.promo_code IS DISTINCT FROM code_value OR existing.package_snapshot->>'id' IS DISTINCT FROM p_quote->'package'->>'id' THEN RAISE EXCEPTION 'Request key reused' USING ERRCODE='22023'; END IF;
 RETURN NEXT existing; RETURN; END IF;
 subtotal:=(p_quote->>'subtotalSatang')::integer; discount:=0;
 q:=jsonb_set(p_quote,'{promo}','null'::jsonb);
 IF code_value IS NOT NULL THEN
 SELECT * INTO d FROM benefit_definitions WHERE code=code_value AND kind='PROMO' FOR UPDATE;
 SELECT * INTO a FROM benefit_assignments WHERE definition_id=d.id AND member_id=p_member;
 IF d.id IS NULL OR NOT d.active OR d.expires_at<=clock_timestamp() OR a.id IS NULL OR a.cancelled_at IS NOT NULL OR subtotal<d.min_satang THEN RAISE EXCEPTION 'Promo unavailable'; END IF;
 -- One use per assignment; pending/unresolved orders reserve it until safely rejected/expired.
 SELECT count(*) INTO used FROM package_payment_orders o WHERE o.member_id=p_member AND o.promo_code=code_value
 AND (o.status='PAID' OR (o.status='PENDING' AND (o.upload_deadline>clock_timestamp() OR EXISTS(SELECT 1 FROM package_payment_attempts x WHERE x.order_id=o.id AND x.state IN ('PROCESSING','UNKNOWN','VERIFIED')))));
 IF used>0 THEN RAISE EXCEPTION 'Assignment already reserved or consumed'; END IF;
 discount:=CASE WHEN d.discount_type='FIXED' THEN d.discount_value ELSE floor(subtotal::numeric*d.discount_value/100)::integer END;
 IF d.max_discount_satang IS NOT NULL THEN discount:=least(discount,d.max_discount_satang); END IF;
 IF discount<=0 OR discount>=subtotal THEN RAISE EXCEPTION 'Invalid discount'; END IF;
 q:=jsonb_set(q,'{promo}',jsonb_build_object('id',d.id,'code',d.code,'usageLimit',d.usage_limit,'usedCount',0,'expiresAt',d.expires_at,'discountType',d.discount_type,'discountValue',d.discount_value,'assignmentId',a.id));
 END IF;
 q:=q||jsonb_build_object('discountSatang',discount,'amountSatang',subtotal-discount,'pointsEarned',floor((subtotal-discount)::numeric/2000)::integer);
 SELECT * INTO existing FROM create_package_payment_order_before_benefits(p_id,p_member,p_session,p_key,q,p_receiver);
 IF a.id IS NOT NULL THEN
 INSERT INTO benefit_promo_reservations(order_id,assignment_id,actor_id) VALUES(existing.id,a.id,p_member);
 END IF;
 RETURN NEXT existing;
END $$;
REVOKE ALL ON FUNCTION real_benefits_admin_action(text,text,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_package_payment_order_before_benefits(uuid,integer,text,uuid,jsonb,jsonb) FROM PUBLIC;
-- CREATE FUNCTION gives the new wrapper its own default ACL; the renamed ACL is not inherited.
REVOKE ALL ON FUNCTION create_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb) FROM PUBLIC;
-- Invoker functions: only the trusted server owner (or explicitly privileged backend role)
-- may execute both functions. Never grant the legacy helper to browser/untrusted roles;
-- its direct caller is trusted just like a role with write access to payment tables.
-- Review any pre-existing named-role grants retained by the rename before deployment.
COMMIT;
