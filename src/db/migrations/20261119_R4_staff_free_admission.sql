-- PREPARE ONLY: foundation + R3 override admission, without R6/R7.
BEGIN;
SET LOCAL search_path = pg_catalog;

-- The hot admission path must not scan every historical staff sale.
CREATE INDEX free_sales_member_start_idx ON r4_staff_private.free_sales(member_id,starts_at);

-- No row = keep existing admission. A row discriminates a staff term, a proven
-- superseding online order (still subject to R3), or a conflict (no fallback).
-- Only call after locking the member and sampling the admission clock.
CREATE FUNCTION r4_staff_private.admission_term(p_member integer,p_at timestamptz,p_online_order uuid)
RETURNS TABLE (source_kind text, source_id uuid, daily_slot text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE f r4_staff_private.free_sales; m public.members; later_order uuid;
BEGIN
 SELECT * INTO f FROM r4_staff_private.free_sales s
 WHERE s.member_id=p_member AND s.starts_at<=p_at AND s.ends_at>p_at
 ORDER BY s.starts_at,s.sale_id LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 source_kind:='BLOCKED';
 IF current_setting('transaction_isolation') <> 'read committed'
 OR EXISTS (SELECT FROM r4_staff_private.free_sales s WHERE s.member_id=p_member
            AND s.starts_at<=p_at AND s.ends_at>p_at AND s.sale_id<>f.sale_id) THEN
  RETURN NEXT; RETURN;
 END IF;
 SELECT * INTO m FROM public.members WHERE id=p_member;
 IF m.role IS DISTINCT FROM 'MEMBER' OR m.status IS DISTINCT FROM 'ACTIVE'
 OR m.member_code IS DISTINCT FROM f.member_code THEN RETURN NEXT; RETURN; END IF;

 -- A real later payment may take over, but never lend its expiry to R4, let an
 -- earlier/broader slot win, or resurrect the staff term when the payment expires.
 IF p_online_order IS DISTINCT FROM f.predecessor_order_id THEN
  SELECT o.id INTO later_order FROM public.package_payment_orders o
  JOIN public.package_payment_point_ledger l ON l.order_id=o.id AND l.member_id=o.member_id
  JOIN public.payment_transfer_refs r ON r.trans_ref=o.trans_ref AND r.source='PACKAGE_ORDER:'||o.id
  WHERE o.id=p_online_order AND o.member_id=p_member AND o.status='PAID'
  AND o.created_at>f.recorded_at AND o.confirmed_at>=o.created_at
    AND o.confirmed_at<=p_at AND o.paid_at<=o.confirmed_at
  AND o.membership_expires_at=m.expire_date AND m.expire_date>p_at
  AND public.package_catalog_daily_slot_valid(o.package_snapshot->>'timeSlot')
  AND NOT EXISTS (SELECT FROM public.package_payment_orders x WHERE x.member_id=p_member
                  AND x.status='PAID' AND x.id<>o.id AND x.confirmed_at>=o.confirmed_at);
  IF later_order IS NOT NULL THEN source_kind:='ONLINE_PAID'; source_id:=later_order; END IF;
  RETURN NEXT; RETURN;
 END IF;

 -- Reuse R3 standalone proof at the sale's recording instant: that proof at
 -- p_at would (correctly) reject the now-expired predecessor. Never extend the
 -- aggregate or infer an online term for anyone without this explicit row.
 IF NOT EXISTS (SELECT FROM public.r3_override_current_order(p_member,f.recorded_at) o
                WHERE o.id=f.predecessor_order_id AND o.membership_expires_at=f.starts_at
                AND o.package_snapshot->'id'=to_jsonb(f.package_id))
 OR EXISTS (SELECT FROM public.package_payment_orders o WHERE o.member_id=p_member AND o.status='PENDING') THEN
  RETURN NEXT; RETURN;
 END IF;
 source_kind:='STAFF_FREE'; source_id:=f.sale_id; daily_slot:=f.daily_slot;
 RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION r4_staff_private.admission_term(integer,timestamptz,uuid) FROM PUBLIC;

DO $upgrade$
DECLARE p record; definition text; proc_row pg_proc;
BEGIN
 IF to_regprocedure('public.time_supplement_allows(integer,timestamptz)') IS NOT NULL
 OR to_regclass('public.r7_visits') IS NOT NULL
 OR to_regprocedure('public.r7_visit_action(text,text,uuid,text,text)') IS NOT NULL THEN
  RAISE EXCEPTION 'R4 staff admission requires the R3-only admission stack';
 END IF;
 FOR p IN SELECT * FROM (VALUES
  ('public.kiosk_checkin(text,text,uuid,text)','a8add39529e048015a8a5700c87c894f'),
  ('public.real_frontdesk_checkin(text,text,uuid,text)','7f81339c50808d9fa2232225e2e49321')
 ) AS f(signature,body_hash) LOOP
  SELECT * INTO proc_row FROM pg_proc WHERE oid=to_regprocedure(p.signature);
  IF md5(replace(proc_row.prosrc,chr(13),'')) IS DISTINCT FROM p.body_hash
  OR proc_row.prosecdef OR proc_row.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_catalog']
  OR proc_row.provolatile<>'v' THEN
   RAISE EXCEPTION 'Unreviewed R3 admission source: %',p.signature
    USING DETAIL=format('Installed hash=%s config=%s volatility=%s',md5(replace(proc_row.prosrc,chr(13),'')),proc_row.proconfig,proc_row.provolatile);
  END IF;
  definition:=replace(pg_get_functiondef(proc_row.oid),chr(13),'');
  definition:=replace(definition,'slot text; snapshot jsonb;',
   'slot text; snapshot jsonb; online_order uuid; term_kind text; term_id uuid; staff_slot text;');
  definition:=replace(definition,'SELECT package_snapshot INTO snapshot FROM package_payment_orders',
   'SELECT id,package_snapshot INTO online_order,snapshot FROM package_payment_orders');
  definition:=replace(definition,$old$  IF m.status='ACTIVE' AND m.expire_date>t AND coalesce(package_catalog_daily_slot_valid(slot),false) THEN$old$,
   $new$  SELECT a.source_kind,a.source_id,a.daily_slot INTO term_kind,term_id,staff_slot
  FROM r4_staff_private.admission_term(m.id,t,online_order) a;
  IF term_kind='BLOCKED' THEN reason:='NO_ENTITLEMENT';
  ELSIF term_kind='STAFF_FREE' THEN
   -- PAID_ENTRY is the existing UI's package-entry success code, not payment provenance.
   IF package_catalog_slot_allows(staff_slot,local_time) THEN reason:='PAID_ENTRY';
   ELSE reason:='OFF_PEAK'; END IF;
  ELSIF m.status='ACTIVE' AND m.expire_date>t AND coalesce(package_catalog_daily_slot_valid(slot),false) THEN$new$);
  -- Break the old R6 textual attachment anchor deliberately. R7 would also
  -- need a staff-aware snapshot before it can become the frontdesk entrypoint.
  definition:=replace(definition,'IF package_catalog_slot_allows(slot,local_time)',
   'IF public.package_catalog_slot_allows(slot,local_time)');
  definition:=replace(definition,$old$||reason||COALESCE(' coupon='||c::text,'')$old$,
   $new$||CASE WHEN term_kind='STAFF_FREE' THEN 'STAFF_FREE_ENTRY term=STAFF_FREE:'||term_id::text
               ELSE reason||COALESCE(' coupon='||c::text,'') END$new$);
  EXECUTE definition;
 END LOOP;
END $upgrade$;
COMMIT;
