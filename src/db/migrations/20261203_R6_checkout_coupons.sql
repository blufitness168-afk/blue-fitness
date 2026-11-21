-- PREPARE ONLY. Append after R6 campaigns, R3 bonus points and R4 online cancellation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL search_path=public,pg_catalog;

ALTER TABLE benefit_definitions DROP CONSTRAINT coupon_campaign_policy,
 ADD COLUMN checkout_unit text,
 ADD COLUMN checkout_value integer,
 ADD COLUMN checkout_cap integer,
 ADD CONSTRAINT coupon_campaign_policy CHECK (
   (campaign_code IS NULL AND campaign_kind IS NULL AND campaign_description IS NULL AND campaign_per_member IS NULL AND campaign_total IS NULL AND campaign_issued=0)
   OR (campaign_code IS NOT NULL AND kind='COUPON' AND requires_activation
       AND campaign_kind IS NOT NULL AND campaign_kind IN ('FRIEND_PASS','EXTRA_DAYS','GIFT','FREEBIE','OTHER','DISCOUNT','POINTS')
       AND coupon_type::text=CASE WHEN campaign_kind IN ('FRIEND_PASS','EXTRA_DAYS') THEN campaign_kind ELSE 'CUSTOM' END
       AND campaign_description IS NOT NULL AND length(btrim(campaign_description)) BETWEEN 1 AND 500
       AND campaign_per_member IS NOT NULL AND campaign_per_member BETWEEN 1 AND 100
       AND campaign_total IS NOT NULL AND campaign_total BETWEEN campaign_per_member AND 1000000 AND campaign_issued BETWEEN 0 AND campaign_total)),
 ADD CONSTRAINT r6_checkout_value_policy CHECK (CASE
   WHEN campaign_kind='DISCOUNT' THEN checkout_unit IS NOT NULL AND checkout_value IS NOT NULL AND (
     (checkout_unit='SATANG' AND checkout_value BETWEEN 1 AND 100000000) OR
     (checkout_unit='PERCENT' AND checkout_value BETWEEN 1 AND 100))
     AND (checkout_cap IS NULL OR checkout_cap BETWEEN 1 AND 100000000)
   WHEN campaign_kind='POINTS' THEN checkout_unit IS NOT DISTINCT FROM 'POINTS'
     AND checkout_value IS NOT NULL AND checkout_value BETWEEN 1 AND 1000000
     AND (checkout_cap IS NULL OR checkout_cap BETWEEN 1 AND 1000000)
   ELSE checkout_unit IS NULL AND checkout_value IS NULL AND checkout_cap IS NULL END);

-- The immutable order is the reservation and its historical value snapshot.
ALTER TABLE package_payment_orders
 ADD COLUMN checkout_coupon_id integer REFERENCES coupons(id) ON DELETE RESTRICT,
 ADD COLUMN checkout_coupon_snapshot jsonb,
 ADD COLUMN checkout_coupon_points integer NOT NULL DEFAULT 0,
 DROP CONSTRAINT package_payment_orders_points_formula_check,
 ADD CONSTRAINT package_payment_orders_points_formula_check CHECK (
 CASE WHEN NOT (package_snapshot ? 'bonusPoints') THEN points_earned = amount_satang / 2000 + checkout_coupon_points
      WHEN jsonb_typeof(package_snapshot->'bonusPoints')='number'
        AND package_snapshot->>'bonusPoints' ~ '^(0|[1-9][0-9]{0,6})$' THEN
       (package_snapshot->>'bonusPoints')::integer BETWEEN 0 AND 1000000
       AND points_earned = amount_satang / 2000 + (package_snapshot->>'bonusPoints')::integer + checkout_coupon_points
      ELSE false END),
 ADD CONSTRAINT r6_checkout_order_policy CHECK (
   (checkout_coupon_id IS NULL AND checkout_coupon_snapshot IS NULL AND checkout_coupon_points=0)
   OR (checkout_coupon_id IS NOT NULL AND checkout_coupon_snapshot IS NOT NULL AND promo_code IS NULL AND promo_snapshot IS NULL
       AND ((checkout_coupon_snapshot->>'kind'='DISCOUNT' AND discount_satang>0 AND checkout_coupon_points=0)
         OR (checkout_coupon_snapshot->>'kind'='POINTS' AND discount_satang=0 AND checkout_coupon_points BETWEEN 1 AND 1000000)) IS TRUE));
CREATE INDEX r6_checkout_order_coupon ON package_payment_orders(checkout_coupon_id) WHERE checkout_coupon_id IS NOT NULL;

-- Keep the R3/R4 functions returning SETOF package_payment_orders aligned with the active projection.
CREATE OR REPLACE VIEW r4_online_private.active_paid_orders AS
 SELECT o.* FROM public.package_payment_orders o WHERE o.status='PAID'
 AND NOT EXISTS (SELECT FROM r4_online_private.cancellations c WHERE c.order_id=o.id);

-- A deadline or a provider failure isn't proof that no money moved. Only the
-- existing explicit not-transferred cancellation, with zero attempts, releases.
CREATE FUNCTION public.r6_checkout_coupon_held(p_coupon integer) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 SELECT EXISTS (SELECT FROM package_payment_orders o WHERE o.checkout_coupon_id=p_coupon AND o.status<>'PAID'
  AND NOT (o.status='REJECTED' AND o.rejection_reason='CUSTOMER_CANCELLED'
    AND NOT EXISTS (SELECT FROM package_payment_attempts a WHERE a.order_id=o.id)));
$$;

CREATE FUNCTION public.r6_checkout_reserve() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE d benefit_definitions; c coupons; a benefit_assignments; t timestamptz; benefit integer;
BEGIN
 IF NEW.checkout_coupon_id IS NULL THEN RETURN NEW; END IF;
 IF NEW.status<>'PENDING' OR NEW.promo_code IS NOT NULL OR NEW.promo_snapshot IS NOT NULL
    OR NEW.package_snapshot->'snapshotVersion' IS DISTINCT FROM '2'::jsonb
    OR current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Invalid checkout coupon order' USING ERRCODE='22023'; END IF;
 -- Checkout takes the member lock first. Use the same order as staff cancel: assignment, definition, leaf.
 SELECT * INTO a FROM benefit_assignments WHERE coupon_id=NEW.checkout_coupon_id AND member_id=NEW.member_id FOR UPDATE;
 SELECT * INTO d FROM benefit_definitions WHERE id=a.definition_id FOR SHARE;
 SELECT * INTO c FROM coupons WHERE id=a.coupon_id AND member_id=NEW.member_id FOR UPDATE;
 t:=clock_timestamp();
 IF c.id IS NULL OR a.cancelled_at IS NOT NULL OR d.campaign_kind NOT IN ('DISCOUNT','POINTS') OR d.checkout_unit IS NULL
    OR c.source IS DISTINCT FROM 'ADMIN_BENEFIT:'||d.id||':'||a.issue_number OR c.type<>'CUSTOM'
    OR c.status<>'AVAILABLE' OR c.used_count>=c.total_quota OR c.activated_at IS NULL OR c.activated_at>t
    OR c.expire_date IS NULL OR c.expire_date<=t OR r6_checkout_coupon_held(c.id) THEN
  RAISE EXCEPTION 'Checkout coupon unavailable' USING ERRCODE='P6C01'; END IF;
 benefit:=least(CASE WHEN d.checkout_unit='PERCENT' THEN (NEW.subtotal_satang::bigint*d.checkout_value/100)::integer
                     ELSE d.checkout_value END,d.checkout_cap);
 IF benefit<=0 OR (d.campaign_kind='DISCOUNT' AND benefit>=NEW.subtotal_satang) THEN
  RAISE EXCEPTION 'Checkout coupon requires a positive payable amount' USING ERRCODE='P6C02'; END IF;
 NEW.discount_satang:=CASE WHEN d.campaign_kind='DISCOUNT' THEN benefit ELSE 0 END;
 NEW.amount_satang:=NEW.subtotal_satang-NEW.discount_satang;
 NEW.checkout_coupon_points:=CASE WHEN d.campaign_kind='POINTS' THEN benefit ELSE 0 END;
 NEW.points_earned:=NEW.amount_satang/2000+COALESCE((NEW.package_snapshot->>'bonusPoints')::integer,0)+NEW.checkout_coupon_points;
 NEW.checkout_coupon_snapshot:=jsonb_build_object('definitionId',d.id,'assignmentId',a.id,'kind',d.campaign_kind,
   'title',c.title,'code',d.campaign_code,'unit',d.checkout_unit,'value',d.checkout_value,'cap',d.checkout_cap,'eligibleUntil',c.expire_date);
 RETURN NEW;
END $$;

CREATE FUNCTION public.r6_checkout_order_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF (NEW.checkout_coupon_id,NEW.checkout_coupon_snapshot,NEW.checkout_coupon_points)
      IS DISTINCT FROM (OLD.checkout_coupon_id,OLD.checkout_coupon_snapshot,OLD.checkout_coupon_points) THEN
  RAISE EXCEPTION 'Checkout coupon snapshot is immutable'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.r6_checkout_consume_paid() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 -- Do not reprice at payment: activation/expiry were checked at reservation;
 -- normal transfer and upload deadlines/evidence still apply in the finalizer.
 UPDATE coupons SET used_count=used_count+1,
   status=CASE WHEN used_count+1=total_quota THEN 'USED'::coupon_status ELSE status END
 WHERE id=NEW.checkout_coupon_id AND member_id=NEW.member_id AND status='AVAILABLE' AND used_count<total_quota;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reserved checkout coupon inconsistent' USING ERRCODE='55000'; END IF;
 INSERT INTO benefit_consumptions(coupon_id,member_id,actor_id,request_key,created_at)
 VALUES(NEW.checkout_coupon_id,NEW.member_id,NEW.member_id,gen_random_uuid(),NEW.confirmed_at);
 RETURN NEW;
END $$;
CREATE TRIGGER r6_checkout_reserve BEFORE INSERT ON package_payment_orders
 FOR EACH ROW EXECUTE FUNCTION r6_checkout_reserve();
CREATE TRIGGER r6_checkout_order_guard BEFORE UPDATE ON package_payment_orders
 FOR EACH ROW EXECUTE FUNCTION r6_checkout_order_guard();
CREATE TRIGGER r6_checkout_consume_paid AFTER UPDATE OF status ON package_payment_orders
 FOR EACH ROW WHEN (OLD.status='PENDING' AND NEW.status='PAID' AND NEW.checkout_coupon_id IS NOT NULL)
 EXECUTE FUNCTION r6_checkout_consume_paid();

CREATE FUNCTION public.r6_checkout_coupon_options(p_member integer,p_session text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id DESC),'[]'::jsonb) FROM (
  SELECT c.id,c.title,d.campaign_code AS code,d.campaign_kind AS kind,d.checkout_unit AS unit,d.checkout_value AS value,d.checkout_cap AS cap
  FROM auth_sessions s JOIN members m ON m.id=s.member_id JOIN coupons c ON c.member_id=m.id
  JOIN benefit_assignments a ON a.coupon_id=c.id AND a.member_id=m.id JOIN benefit_definitions d ON d.id=a.definition_id
  WHERE m.id=p_member AND s.token_hash=p_session AND s.mode='NORMAL' AND s.revoked_at IS NULL
    AND s.expires_at>statement_timestamp() AND m.status<>'SUSPENDED'
    AND d.campaign_kind IN ('DISCOUNT','POINTS') AND a.cancelled_at IS NULL
    AND c.source='ADMIN_BENEFIT:'||d.id||':'||a.issue_number AND c.type='CUSTOM'
    AND c.status='AVAILABLE' AND c.used_count<c.total_quota AND c.activated_at<=statement_timestamp()
    AND c.expire_date>statement_timestamp() AND NOT r6_checkout_coupon_held(c.id)
  ORDER BY c.id DESC LIMIT 100
 ) x;
$$;

-- Require the expected upstream anchors and retain existing invoker ACLs.
DO $patch$
DECLARE p record; ddl text;
BEGIN
 FOR p IN SELECT * FROM (VALUES
 ('public.create_catalog_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb)',
  $old$ code:=nullif(upper(btrim(p_quote->'promo'->>'code')),'');$old$,
  $new$ code:=nullif(upper(btrim(p_quote->'promo'->>'code')),'');
 IF p_quote->>'checkoutCouponId' IS NOT NULL AND (code IS NOT NULL OR
    jsonb_typeof(p_quote->'checkoutCouponId')<>'number' OR p_quote->>'checkoutCouponId' !~ '^[1-9][0-9]{0,9}$') THEN
  RAISE EXCEPTION 'Invalid checkout coupon selection' USING ERRCODE='22023'; END IF;$new$),
 ('public.create_catalog_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb)',
  $old$ OR existing.promo_code IS DISTINCT FROM code THEN$old$,
  $new$ OR existing.checkout_coupon_id IS DISTINCT FROM (p_quote->>'checkoutCouponId')::integer
 OR (existing.checkout_coupon_id IS NOT NULL AND existing.package_snapshot->'catalogVersion' IS DISTINCT FROM p_quote->'package'->'catalogVersion')
 OR existing.promo_code IS DISTINCT FROM code THEN$new$),
 ('public.create_catalog_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb)',
  $old$'pointsEarned',c.price_satang/2000+c.bonus_points$old$,
  $new$'checkoutCouponId',p_quote->'checkoutCouponId','pointsEarned',c.price_satang/2000+c.bonus_points$new$),
 ('public.create_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb)',
  $old$ IF existing.promo_code IS DISTINCT FROM code_value OR$old$,
  $new$ IF existing.checkout_coupon_id IS DISTINCT FROM (p_quote->>'checkoutCouponId')::integer
 OR existing.promo_code IS DISTINCT FROM code_value OR$new$),
 ('public.create_package_payment_order_before_benefits(uuid,integer,text,uuid,jsonb,jsonb)',
  $old$ IF existing.id IS NOT NULL THEN RETURN NEXT existing; RETURN; END IF;$old$,
  $new$ IF existing.id IS NOT NULL THEN
  IF existing.checkout_coupon_id IS DISTINCT FROM (p_quote->>'checkoutCouponId')::integer THEN
   RAISE EXCEPTION 'Request key reused' USING ERRCODE='22023'; END IF;
  RETURN NEXT existing; RETURN; END IF;$new$),
 ('public.create_package_payment_order_before_benefits(uuid,integer,text,uuid,jsonb,jsonb)',
  $old$points_earned,created_at,expires_at,upload_deadline)$old$,
  $new$points_earned,created_at,expires_at,upload_deadline,checkout_coupon_id)$new$),
 ('public.create_package_payment_order_before_benefits(uuid,integer,text,uuid,jsonb,jsonb)',
  $old$started+interval '45 minutes') RETURNING *;$old$,
  $new$started+interval '45 minutes',(p_quote->>'checkoutCouponId')::integer) RETURNING *;$new$),
 ('public.real_benefits_admin_action(text,text,uuid,jsonb)',
  $old$'total','expiresAt','activationDurationMinutes'])$old$,
  $new$'total','expiresAt','activationDurationMinutes','checkoutUnit','checkoutValue','checkoutCap'])$new$),
 ('public.real_benefits_admin_action(text,text,uuid,jsonb)',
  $old$ OR NOT isfinite((p_payload->>'expiresAt')::timestamptz) OR$old$,
  $new$ OR (p_payload ? 'checkoutUnit' AND jsonb_typeof(p_payload->'checkoutUnit') NOT IN ('string','null'))
 OR EXISTS (SELECT FROM unnest(ARRAY['checkoutValue','checkoutCap']) AS k(name) WHERE p_payload ? k.name
    AND p_payload->k.name<>'null'::jsonb AND (jsonb_typeof(p_payload->k.name)<>'number' OR p_payload->>k.name !~ '^[1-9][0-9]{0,8}$'))
 OR NOT isfinite((p_payload->>'expiresAt')::timestamptz) OR$new$),
 ('public.real_benefits_admin_action(text,text,uuid,jsonb)',
  $old$campaign_code,campaign_kind,campaign_description,campaign_per_member,campaign_total)$old$,
  $new$campaign_code,campaign_kind,campaign_description,campaign_per_member,campaign_total,checkout_unit,checkout_value,checkout_cap)$new$),
 ('public.real_benefits_admin_action(text,text,uuid,jsonb)',
  $old$(p_payload->>'total')::integer)
 RETURNING * INTO d;$old$,
  $new$(p_payload->>'total')::integer,
   p_payload->>'checkoutUnit',(p_payload->>'checkoutValue')::integer,(p_payload->>'checkoutCap')::integer)
 RETURNING * INTO d;$new$),
 ('public.real_benefits_admin_action(text,text,uuid,jsonb)',
  $old$ IF c.used_count>0 THEN RAISE EXCEPTION 'Cannot cancel consumed coupon'; END IF;$old$,
  $new$ IF c.used_count>0 OR public.r6_checkout_coupon_held(c.id) THEN RAISE EXCEPTION 'Cannot cancel reserved or consumed coupon'; END IF;$new$),
 ('r4_online_private.cancellation_eligible(uuid,integer,timestamptz)',
  $old$   AND e.promo_assignment_id IS NULL$old$,
  $new$   AND NOT EXISTS (SELECT FROM public.package_payment_orders co WHERE co.id=o.id AND co.checkout_coupon_id IS NOT NULL)
   AND e.promo_assignment_id IS NULL$new$)
 ) AS x(signature,anchor,replacement) LOOP
  ddl:=replace(pg_get_functiondef(to_regprocedure(p.signature)),chr(13),'');
  IF ddl IS NULL OR length(ddl)-length(replace(ddl,p.anchor,''))<>length(p.anchor) THEN
   RAISE EXCEPTION 'Unexpected checkout baseline: % (%)',p.signature,p.anchor USING ERRCODE='0A000'; END IF;
  EXECUTE replace(ddl,p.anchor,p.replacement);
 END LOOP;
END $patch$;

-- Separate entry point: app deployed ahead of schema must not silently buy at full price.
CREATE FUNCTION public.r6_create_checkout_coupon_order(p_id uuid,p_member integer,p_session text,p_key uuid,p_quote jsonb,p_receiver jsonb)
RETURNS SETOF package_payment_orders LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE o package_payment_orders;
BEGIN
 IF jsonb_typeof(p_quote->'checkoutCouponId') IS DISTINCT FROM 'number' THEN
  RAISE EXCEPTION 'Checkout coupon required' USING ERRCODE='22023'; END IF;
 SELECT * INTO STRICT o FROM public.create_catalog_package_payment_order(p_id,p_member,p_session,p_key,p_quote,p_receiver);
 IF o.checkout_coupon_id IS DISTINCT FROM (p_quote->>'checkoutCouponId')::integer THEN
  RAISE EXCEPTION 'Checkout coupon was not reserved' USING ERRCODE='55000'; END IF;
 RETURN NEXT o;
END $$;
REVOKE ALL ON FUNCTION public.r6_create_checkout_coupon_order(uuid,integer,text,uuid,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.r6_checkout_coupon_held(integer), public.r6_checkout_reserve(), public.r6_checkout_order_guard(),
 public.r6_checkout_consume_paid(), public.r6_checkout_coupon_options(integer,text) FROM PUBLIC;
COMMIT;
