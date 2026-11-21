-- Prepare only. Apply after 20261024_real_rewards; no historical backfill.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL search_path=public,pg_catalog;

ALTER TABLE public.redemptions
 ADD COLUMN package_days_at_redemption integer,
 ADD COLUMN package_order_at_redemption uuid,
 ADD COLUMN package_sale_at_redemption uuid,
 ADD CONSTRAINT reward_redemption_package_proof CHECK (
   (package_days_at_redemption IS NULL AND num_nonnulls(package_order_at_redemption,package_sale_at_redemption)=0)
   OR (package_days_at_redemption IS NOT NULL AND package_days_at_redemption BETWEEN 1 AND 3660
       AND num_nonnulls(package_order_at_redemption,package_sale_at_redemption)=1));

-- Called only by the redemption writer with the actor row locked and a fresh clock value.
-- Never use these current-state authorities to classify historical redemptions.
CREATE FUNCTION public.reward_redemption_package(p_member integer,p_at timestamptz)
RETURNS TABLE (package_days integer, order_id uuid, sale_id uuid)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE proof record; excluded boolean; days_text text;
BEGIN
 IF EXISTS (SELECT FROM pg_proc
   WHERE oid=to_regprocedure('public.time_supplement_main(integer,timestamptz)')
     AND proretset AND prorettype='pg_catalog.record'::regtype)
   AND to_regclass('r4_staff_private.free_sales') IS NOT NULL THEN
   BEGIN
     EXECUTE 'SELECT order_id,sale_id,package_snapshot,main_end FROM public.time_supplement_main($1,$2)'
       INTO STRICT proof USING p_member,p_at;
   EXCEPTION WHEN no_data_found OR too_many_rows THEN RETURN;
   END;
 ELSIF to_regprocedure('public.r3_override_current_order(integer,timestamptz)') IS NOT NULL THEN
   -- Standalone R3/R6/R7: use the ledger-backed single-term proof, not R6's weaker standalone lookup.
   -- On a mixed or R4-only stack, do not accidentally lend the predecessor's proof to a staff sale.
   IF to_regclass('r4_staff_private.free_sales') IS NOT NULL THEN
     EXECUTE 'SELECT EXISTS (SELECT FROM r4_staff_private.free_sales WHERE member_id=$1)' INTO excluded USING p_member;
     IF excluded THEN RETURN; END IF;
   END IF;
   IF EXISTS (SELECT FROM public.package_payment_orders WHERE member_id=p_member AND status='PENDING') THEN RETURN; END IF;
   BEGIN
     EXECUTE 'SELECT id AS order_id,NULL::uuid AS sale_id,package_snapshot,membership_expires_at AS main_end
       FROM public.r3_override_current_order($1,$2)' INTO STRICT proof USING p_member,p_at;
   EXCEPTION WHEN no_data_found OR too_many_rows THEN RETURN;
   END;
 ELSE
   RETURN;
 END IF;

 IF (proof.order_id IS NULL)=(proof.sale_id IS NULL) OR proof.main_end IS NULL
    OR NOT isfinite(proof.main_end) OR proof.main_end<=p_at THEN RETURN; END IF;
 IF proof.order_id IS NOT NULL AND to_regclass('r4_online_private.cancellations') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS (SELECT FROM r4_online_private.cancellations WHERE order_id=$1)' INTO excluded USING proof.order_id;
   IF excluded THEN RETURN; END IF;
 END IF;
 IF jsonb_typeof(proof.package_snapshot->'durationDays') IS DISTINCT FROM 'number' THEN RETURN; END IF;
 days_text:=proof.package_snapshot->>'durationDays';
 IF days_text !~ '^[1-9][0-9]{0,3}$' THEN RETURN; END IF;
 package_days:=days_text::integer;
 IF package_days>3660 THEN RETURN; END IF;
 order_id:=proof.order_id; sale_id:=proof.sale_id;
 RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.reward_redemption_package(integer,timestamptz) FROM PUBLIC;

-- Preserve existing callers, privileges, request replay and atomic points/stock updates.
DO $patch$
DECLARE p pg_proc; ddl text;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid='public.real_rewards_action(text,text,uuid,jsonb)'::regprocedure;
 IF md5(replace(p.prosrc,chr(13),'')) IS DISTINCT FROM 'e64ed8020e84f5bd1898e4ed096e35dd'
    OR p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_catalog'] OR p.provolatile<>'v' THEN
   RAISE EXCEPTION 'Unreviewed rewards writer' USING ERRCODE='0A000';
 END IF;
 ddl:=replace(pg_get_functiondef(p.oid),chr(13),'');
 ddl:=replace(ddl,' result jsonb; balance integer;', ' proof record; redemption_time timestamptz; result jsonb; balance integer;');
 ddl:=replace(ddl,$old$ INSERT INTO redemptions(member_id,reward_id,points_spent,status,request_key,reward_code,reward_title)
 VALUES(actor.id,r.id,r.point_cost,'PENDING',p_key,gen_random_uuid(),r.title) RETURNING * INTO d;$old$,
 $new$ redemption_time:=clock_timestamp();
 SELECT * INTO proof FROM public.reward_redemption_package(actor.id,redemption_time);
 INSERT INTO redemptions(member_id,reward_id,points_spent,status,request_key,reward_code,reward_title,redeemed_at,
   package_days_at_redemption,package_order_at_redemption,package_sale_at_redemption)
 VALUES(actor.id,r.id,r.point_cost,'PENDING',p_key,gen_random_uuid(),r.title,redemption_time,
   proof.package_days,proof.order_id,proof.sale_id) RETURNING * INTO d;$new$);
 EXECUTE ddl;
END $patch$;
COMMIT;
