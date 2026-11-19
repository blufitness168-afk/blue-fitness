-- Requires the October payment/benefits/catalog chain and 20261118_r3_package_catalog.sql.
-- No backfill. Only newly quoted orders get a bonusPoints snapshot field.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.package_catalog ADD COLUMN bonus_points integer NOT NULL DEFAULT 0
 CONSTRAINT package_catalog_bonus_points_check CHECK (bonus_points BETWEEN 0 AND 1000000);

-- Reserve the new key under the same lock used to replace the invariant. The
-- old insert guard allowed extra metadata; do not reinterpret it if it exists.
LOCK TABLE public.package_payment_orders IN ACCESS EXCLUSIVE MODE;
DO $migration$
DECLARE old_check name;
BEGIN
 IF EXISTS (SELECT 1 FROM public.package_payment_orders WHERE package_snapshot ? 'bonusPoints') THEN
  RAISE EXCEPTION 'Historical bonusPoints metadata found; review before migration';
 END IF;
 SELECT conname INTO STRICT old_check FROM pg_catalog.pg_constraint
 WHERE conrelid='public.package_payment_orders'::regclass AND contype='c' AND convalidated
   AND pg_get_expr(conbin,conrelid)='(points_earned = (amount_satang / 2000))';
 EXECUTE format('ALTER TABLE public.package_payment_orders DROP CONSTRAINT %I',old_check);
END $migration$;
ALTER TABLE public.package_payment_orders ADD CONSTRAINT package_payment_orders_points_formula_check CHECK (
 CASE WHEN NOT (package_snapshot ? 'bonusPoints') THEN points_earned = amount_satang / 2000
      WHEN jsonb_typeof(package_snapshot->'bonusPoints')='number'
        AND package_snapshot->>'bonusPoints' ~ '^(0|[1-9][0-9]{0,6})$' THEN
       (package_snapshot->>'bonusPoints')::integer BETWEEN 0 AND 1000000
       AND points_earned = amount_satang / 2000 + (package_snapshot->>'bonusPoints')::integer
      ELSE false END);

CREATE OR REPLACE VIEW public.package_catalog_public AS
 SELECT id,name,label,description,price_satang AS "priceSatang",price_satang::numeric/100 AS price,
 duration_days AS "durationDays",time_slot AS "timeSlot",friend_quota AS "friendCoupons",
 bonus_days AS "bonusDays",version,version AS "catalogVersion",is_active AS "isActive",bonus_points AS "bonusPoints"
 FROM public.package_catalog WHERE is_active;

-- Patch exactly the relevant expressions in place, retaining existing ACLs,
-- ownership, replay/locking, and the installed payment security settings.
DO $migration$
DECLARE patch record; original text; updated text; signature regprocedure;
BEGIN
 FOR patch IN SELECT * FROM (VALUES
  ('package_catalog_action(text,text,uuid,jsonb)',
   $old$bonus_days AS "bonusDays",version$old$, $new$bonus_days AS "bonusDays",bonus_points AS "bonusPoints",version$new$),
  ('package_catalog_action(text,text,uuid,jsonb)',
   $old$'friendCoupons','bonusDays','isActive'))$old$, $new$'friendCoupons','bonusDays','bonusPoints','isActive'))$new$),
  ('package_catalog_action(text,text,uuid,jsonb)',
   $old$'friendCoupons','bonusDays') AND$old$, $new$'friendCoupons','bonusDays','bonusPoints') AND$new$),
  ('package_catalog_action(text,text,uuid,jsonb)',
   $old$friend_quota,bonus_days,is_active)$old$, $new$friend_quota,bonus_days,is_active,bonus_points)$new$),
  ('package_catalog_action(text,text,uuid,jsonb)',
   $old$(p_payload->>'bonusDays')::integer,(p_payload->>'isActive')::boolean)$old$,
   $new$(p_payload->>'bonusDays')::integer,(p_payload->>'isActive')::boolean,coalesce((p_payload->>'bonusPoints')::integer,0))$new$),
  ('package_catalog_action(text,text,uuid,jsonb)',
   $old$is_active=coalesce((p_payload->>'isActive')::boolean,is_active),version=version+1$old$,
   $new$is_active=coalesce((p_payload->>'isActive')::boolean,is_active),
 bonus_points=coalesce((p_payload->>'bonusPoints')::integer,bonus_points),version=version+1$new$),
  ('package_catalog_action(text,text,uuid,jsonb)',
   $old$'bonusDays',current_row.bonus_days,'version'$old$, $new$'bonusDays',current_row.bonus_days,'bonusPoints',current_row.bonus_points,'version'$new$),
  ('create_catalog_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb)',
   $old$'bonusDays',c.bonus_days,$old$, $new$'bonusDays',c.bonus_days,'bonusPoints',c.bonus_points,$new$),
  ('create_catalog_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb)',
   $old$floor(c.price_satang::numeric/2000)::integer$old$, $new$c.price_satang/2000+c.bonus_points$new$),
  ('create_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb)',
   $old$floor((subtotal-discount)::numeric/2000)::integer$old$,
   $new$(subtotal-discount)/2000+coalesce((q->'package'->>'bonusPoints')::integer,0)$new$),
  ('guard_package_catalog_order_insert()',
   $old$ IF snapshot ? 'snapshotVersion' THEN$old$,
   $new$ -- Legacy insert callers may omit the field only for zero-bonus packages.
 IF snapshot ? 'bonusPoints' THEN
  IF snapshot->'snapshotVersion' IS DISTINCT FROM '2'::jsonb
     OR snapshot->'bonusPoints' IS DISTINCT FROM to_jsonb(c.bonus_points) THEN
   RAISE EXCEPTION 'Invalid package bonus points snapshot' USING ERRCODE='P0001';
  END IF;
 ELSIF c.bonus_points<>0 THEN
  RAISE EXCEPTION 'Package bonus points snapshot required' USING ERRCODE='P0001';
 END IF;
 IF snapshot ? 'snapshotVersion' THEN$new$)
 ) AS p(function_signature,old_text,new_text)
 LOOP
  signature:=to_regprocedure('public.'||patch.function_signature);
  original:=pg_get_functiondef(signature);
  IF original IS NULL OR (length(original)-length(replace(original,patch.old_text,'')))<>length(patch.old_text) THEN
   RAISE EXCEPTION 'Unexpected baseline for %; review before migration',patch.function_signature;
  END IF;
  updated:=replace(original,patch.old_text,patch.new_text);
  EXECUTE updated;
  IF pg_get_functiondef(signature) IS DISTINCT FROM updated THEN
   RAISE EXCEPTION 'Unexpected rewrite of %',patch.function_signature;
  END IF;
 END LOOP;
END $migration$;
-- Finalization already awards exactly the immutable order points_earned in the
-- member balance and its single point ledger, atomically with the PAID transition.
COMMIT;
