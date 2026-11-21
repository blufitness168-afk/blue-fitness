-- Prepare only. Requires the R4-first combined admission and R6 checkout campaign stack.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL search_path=public,pg_catalog;

-- A newly settled renewal may be queued behind an existing online term. Do not
-- assign its snapshot until its start, and do not infer a start from aggregate expiry.
CREATE OR REPLACE FUNCTION time_supplement_main(p_member integer,p_at timestamptz)
RETURNS TABLE (order_id uuid, sale_id uuid, package_snapshot jsonb, main_end timestamptz)
LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 WITH latest AS MATERIALIZED (
  SELECT * FROM r4_online_private.active_paid_orders WHERE member_id=p_member
  ORDER BY paid_at DESC NULLS LAST,created_at DESC,id DESC LIMIT 1
 ), term AS MATERIALIZED (
  SELECT a.* FROM r4_staff_private.admission_term(p_member,p_at,(SELECT id FROM latest)) a
 ), standalone AS (
  SELECT o.id AS order_id,o.package_snapshot,o.membership_expires_at
  FROM r3_override_current_order(p_member,p_at) o JOIN latest l ON l.id=o.id
  WHERE NOT EXISTS (SELECT FROM term)
 ), renewal AS (
  SELECT o.id,o.package_snapshot,o.membership_expires_at
  FROM latest o JOIN members m ON m.id=o.member_id
  JOIN r4_online_private.settlement_before b ON b.order_id=o.id AND b.member_id=m.id
  JOIN r4_online_private.settlement_effects e ON e.order_id=o.id
  JOIN LATERAL (SELECT greatest(b.expiry_before,o.confirmed_at) AS starts_at,
    CASE WHEN jsonb_typeof(o.package_snapshot->'durationDays')='number'
      AND (o.package_snapshot->>'durationDays') ~ '^[1-9][0-9]{0,3}$'
    THEN (o.package_snapshot->>'durationDays')::integer END AS duration) k ON true
  WHERE NOT EXISTS (SELECT FROM standalone) AND NOT EXISTS (SELECT FROM term)
    AND o.status='PAID' AND m.status='ACTIVE' AND m.expire_date=o.membership_expires_at
    AND NOT EXISTS (SELECT FROM r4_staff_private.free_sales f WHERE f.member_id=m.id)
    AND NOT EXISTS (SELECT FROM package_payment_orders x WHERE x.member_id=m.id AND x.status='PENDING')
    AND isfinite(o.confirmed_at) AND isfinite(b.expiry_before) AND isfinite(o.membership_expires_at)
    AND b.status_before IN ('ACTIVE','EXPIRED') AND (b.status_before='ACTIVE' OR b.expiry_before<=o.confirmed_at)
    AND (e.confirmed_at,e.expiry_after,e.amount_satang)=(o.confirmed_at,o.membership_expires_at,o.amount_satang)
    AND package_catalog_daily_slot_valid(o.package_snapshot->>'timeSlot')
    AND k.duration BETWEEN 1 AND 3660 AND k.starts_at<=p_at AND p_at<o.membership_expires_at
    AND o.membership_expires_at=k.starts_at+k.duration*interval '24 hours'
    AND (SELECT count(*) FROM r4_online_private.active_paid_orders prev
      JOIN r4_online_private.settlement_before pb ON pb.order_id=prev.id AND pb.member_id=m.id
      JOIN r4_online_private.settlement_effects pe ON pe.order_id=prev.id
      WHERE prev.member_id=m.id AND prev.id<>o.id AND prev.status='PAID'
        AND prev.membership_expires_at=b.expiry_before AND prev.confirmed_at<o.confirmed_at
        AND (pe.confirmed_at,pe.expiry_after,pe.amount_satang)=(prev.confirmed_at,prev.membership_expires_at,prev.amount_satang))=1
    AND NOT EXISTS (SELECT FROM r4_online_private.active_paid_orders x
      WHERE x.member_id=m.id AND x.id<>o.id AND x.status='PAID'
        AND (x.confirmed_at IS NULL OR x.confirmed_at>=o.confirmed_at OR x.membership_expires_at IS NULL
          OR x.membership_expires_at>b.expiry_before))
 )
 SELECT order_id,NULL::uuid,package_snapshot,membership_expires_at FROM standalone
 UNION ALL SELECT id,NULL::uuid,package_snapshot,membership_expires_at FROM renewal
 UNION ALL
 SELECT NULL::uuid,f.sale_id,r347_staff_package(f),f.ends_at
 FROM term a JOIN r4_staff_private.free_sales f ON f.sale_id=a.source_id
 WHERE a.source_kind IN ('STAFF_FREE','STAFF_TRANSFER')
$$;

DO $patch$
DECLARE p pg_proc; ddl text; r record;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid='public.real_benefits_admin_action(text,text,uuid,jsonb)'::regprocedure;
 IF p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_catalog']
    OR strpos(p.prosrc,'checkout_unit,checkout_value,checkout_cap')=0 THEN
   RAISE EXCEPTION 'Expected reviewed R6 checkout benefits function' USING ERRCODE='0A000'; END IF;
 ddl:=replace(pg_get_functiondef(p.oid),chr(13),'');
 FOR r IN SELECT * FROM (VALUES
  ('main_order package_payment_orders%ROWTYPE;', 'main_term record;'),
  ($old$ -- Do not infer precedence for staff terms, mixed history, in-flight purchases, or refunds.
 -- Read the optional ledgers only on stacks that have them. Missing required privileges fail closed.
 IF to_regnamespace('r4_staff_private') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS (SELECT FROM r4_staff_private.free_sales WHERE member_id=$1)' INTO excluded USING target.id;
   IF excluded THEN RAISE EXCEPTION 'Staff term history is not supported'; END IF;
 END IF;
 IF (SELECT count(*) FROM package_payment_orders WHERE member_id=target.id AND status='PAID')<>1
 OR EXISTS (SELECT FROM package_payment_orders WHERE member_id=target.id AND status='PENDING')$old$,
   $new$ IF EXISTS (SELECT FROM package_payment_orders WHERE member_id=target.id AND status='PENDING')$new$),
  ($old$ SELECT * INTO main_order FROM public.r3_override_current_order(target.id,t);
 IF main_order.id IS NULL OR NOT isfinite(main_order.membership_expires_at)
 OR NOT isfinite(main_order.confirmed_at) OR jsonb_typeof(main_order.package_snapshot->'durationDays') IS DISTINCT FROM 'number'
 THEN RAISE EXCEPTION 'Unproven current package'; END IF;
 IF to_regclass('r4_online_private.cancellations') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS (SELECT FROM r4_online_private.cancellations WHERE order_id=$1)' INTO excluded USING main_order.id;
   IF excluded THEN RAISE EXCEPTION 'Order cancelled'; END IF;
 END IF;
 duration := (main_order.package_snapshot->>'durationDays')::integer;$old$,
   $new$ SELECT * INTO main_term FROM public.time_supplement_main(target.id,t);
 IF NOT FOUND OR NOT isfinite(main_term.main_end) OR main_term.main_end<=t
 OR (main_term.order_id IS NULL)=(main_term.sale_id IS NULL)
 OR jsonb_typeof(main_term.package_snapshot->'durationDays') IS DISTINCT FROM 'number'
 OR (main_term.package_snapshot->>'durationDays') !~ '^[1-9][0-9]{0,3}$'
 THEN RAISE EXCEPTION 'Unproven current package'; END IF;
 duration := (main_term.package_snapshot->>'durationDays')::integer;$new$),
  ('main_order.id,duration,extract(epoch FROM main_order.membership_expires_at)',
   'main_term.order_id,main_term.sale_id,duration,extract(epoch FROM main_term.main_end)'),
  ('''packageExpiresAt'',main_order.membership_expires_at', '''packageExpiresAt'',main_term.main_end')
 ) x(anchor,replacement) LOOP
  IF length(ddl)-length(replace(ddl,r.anchor,''))<>length(r.anchor) THEN
    RAISE EXCEPTION 'Unexpected R6 targeting anchor' USING ERRCODE='0A000'; END IF;
  ddl:=replace(ddl,r.anchor,r.replacement);
 END LOOP;
 EXECUTE ddl;
END $patch$;
COMMIT;
