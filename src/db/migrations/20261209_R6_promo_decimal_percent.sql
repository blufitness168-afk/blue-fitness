-- Allow decimal PERCENT promo discount_value (up to 2 decimals, 0.01..100) with Option A exact satang floor.
-- Requires R6 coupon campaigns / promo history migrations applied.
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '5s';

SELECT 'public.real_benefits_admin_action(text,text,uuid,jsonb)'::regprocedure;
SELECT 'public.r6_create_scoped_promo(text,uuid,jsonb)'::regprocedure;
SELECT 'public.create_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb)'::regprocedure;

ALTER TABLE public.benefit_definitions
  ALTER COLUMN discount_value TYPE numeric(12,2) USING discount_value::numeric(12,2);

ALTER TABLE public.benefit_definitions
  DROP CONSTRAINT IF EXISTS benefit_definitions_kind_policy;
ALTER TABLE public.benefit_definitions
  ADD CONSTRAINT benefit_definitions_kind_policy CHECK (
    (kind = 'COUPON' AND coupon_type IS NOT NULL AND code IS NULL AND discount_type IS NULL AND discount_value = 0
      AND ((coupon_type = 'EXTRA_DAYS' AND quota = 1 AND bonus_days > 0)
        OR (coupon_type = 'FRIEND_PASS' AND bonus_days = 0)
        OR (coupon_type = 'CUSTOM' AND campaign_code IS NOT NULL AND bonus_days = 0)))
    OR
    (kind = 'PROMO' AND coupon_type IS NULL AND code IS NOT NULL AND discount_type IS NOT NULL AND discount_value > 0 AND bonus_days = 0
      AND ((discount_type = 'FIXED' AND discount_value = trunc(discount_value) AND discount_value <= 100000000)
        OR (discount_type = 'PERCENT' AND discount_value >= 0.01 AND discount_value <= 100)))
  );

DO $patch$
DECLARE
  ddl text;
  anchor text;
  replacement text;
BEGIN
  ddl := replace(pg_get_functiondef('public.real_benefits_admin_action(text,text,uuid,jsonb)'::regprocedure), chr(13), '');
  anchor := $old$COALESCE((p_payload->>'discountValue')::integer,0)$old$;
  replacement := $new$COALESCE((p_payload->>'discountValue')::numeric(12,2),0)$new$;
  IF length(ddl) - length(replace(ddl, anchor, '')) <> length(anchor) THEN
    RAISE EXCEPTION 'Unexpected real_benefits_admin_action anchor';
  END IF;
  EXECUTE replace(ddl, anchor, replacement);

  ddl := replace(pg_get_functiondef('public.r6_create_scoped_promo(text,uuid,jsonb)'::regprocedure), chr(13), '');
  anchor := $old$   WHEN e.key IN ('minSatang','discountValue','usageLimit') THEN jsonb_typeof(e.value)<>'number' OR e.value::text !~ '^(0|[1-9][0-9]{0,8})$'$old$;
  replacement := $new$   WHEN e.key IN ('minSatang','usageLimit') THEN jsonb_typeof(e.value)<>'number' OR e.value::text !~ '^(0|[1-9][0-9]{0,8})$'
   WHEN e.key='discountValue' THEN jsonb_typeof(e.value)<>'number' OR (CASE WHEN p_payload->>'discountType'='PERCENT' THEN e.value::text !~ '^(0\.[0-9]{1,2}|[1-9][0-9]{0,2}(\.[0-9]{1,2})?)$' OR (e.value::text)::numeric < 0.01 OR (e.value::text)::numeric > 100 ELSE e.value::text !~ '^[1-9][0-9]{0,8}$' END)$new$;
  IF length(ddl) - length(replace(ddl, anchor, '')) <> length(anchor) THEN
    RAISE EXCEPTION 'Unexpected r6_create_scoped_promo key check anchor';
  END IF;
  ddl := replace(ddl, anchor, replacement);

  anchor := $old$(p_payload->>'discountValue')::integer$old$;
  replacement := $new$(p_payload->>'discountValue')::numeric(12,2)$new$;
  IF length(ddl) - length(replace(ddl, anchor, '')) <> length(anchor) THEN
    RAISE EXCEPTION 'Unexpected r6_create_scoped_promo cast anchor';
  END IF;
  EXECUTE replace(ddl, anchor, replacement);

  ddl := replace(pg_get_functiondef('public.create_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb)'::regprocedure), chr(13), '');
  anchor := $old$THEN d.discount_value ELSE floor(subtotal::numeric*d.discount_value/100)::integer$old$;
  replacement := $new$THEN d.discount_value::integer ELSE floor(subtotal::numeric*d.discount_value/100)::integer$new$;
  IF length(ddl) - length(replace(ddl, anchor, '')) <> length(anchor) THEN
    RAISE EXCEPTION 'Unexpected create_package_payment_order discount anchor';
  END IF;
  EXECUTE replace(ddl, anchor, replacement);
END $patch$;

REVOKE ALL ON FUNCTION public.real_benefits_admin_action(text,text,uuid,jsonb),
  public.r6_create_scoped_promo(text,uuid,jsonb),
  public.create_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb) FROM PUBLIC;

COMMIT;
