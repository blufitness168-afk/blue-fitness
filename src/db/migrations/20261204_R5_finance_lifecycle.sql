-- PREPARE ONLY. R5 finance reader after the complete R4 settlement/cancellation chain.
-- No writer changes, historical backfill, or grants. Keep the same RPC/OID and row contract.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog;

DO $migration$
DECLARE
 p pg_proc;
 anchor constant text := $old$'INCOME','แพ็กเกจ',
 o.amount_satang$old$;
 classification constant text := $new$'INCOME',
 CASE WHEN EXISTS (
  SELECT FROM r4_online_private.settlement_effects sale_effect
  JOIN public.package_payment_orders prior_order ON prior_order.member_id=o.member_id
   AND prior_order.status='PAID' AND prior_order.membership_expires_at=b.expiry_before
  JOIN r4_online_private.settlement_effects prior_effect ON prior_effect.order_id=prior_order.id
   AND (prior_effect.confirmed_at,prior_effect.expiry_after,prior_effect.amount_satang)
      =(prior_order.confirmed_at,prior_order.membership_expires_at,prior_order.amount_satang)
  JOIN r4_online_private.settlement_before prior_before ON prior_before.order_id=prior_order.id
   AND prior_before.member_id=o.member_id
  WHERE sale_effect.order_id=o.id
   AND (sale_effect.confirmed_at,sale_effect.expiry_after,sale_effect.amount_satang)=(o.confirmed_at,o.membership_expires_at,o.amount_satang)
   AND b.status_before IN ('ACTIVE','EXPIRED') AND isfinite(b.expiry_before) AND isfinite(o.confirmed_at)
   AND prior_effect.confirmed_at<o.confirmed_at AND prior_effect.confirmed_at<b.expiry_before
   AND (b.expiry_before<=o.confirmed_at OR b.status_before='ACTIVE')
   -- Check the prior term as of the sale, not its current cancellation state.
   AND NOT EXISTS (SELECT FROM r4_online_private.cancellations c
     WHERE c.order_id=prior_order.id AND c.cancelled_at<=o.confirmed_at)
   -- R4 staff terms do not update this online expiry snapshot. Do not assume
   -- it was the latest expiry if a staff term already recorded could extend it.
   AND NOT EXISTS (SELECT FROM r4_staff_private.free_sales staff_term
     WHERE staff_term.member_id=b.member_id AND staff_term.recorded_at<=o.confirmed_at
       AND staff_term.ends_at>b.expiry_before)
 ) THEN CASE WHEN b.expiry_before < o.confirmed_at - interval '2160 hours'
             THEN 'สมัครใหม่' ELSE 'ต่อสมาชิก' END
 ELSE 'แพ็กเกจ' END,
 o.amount_satang$new$;
 from_anchor constant text := $old$FROM package_payment_orders o JOIN members m ON m.id=o.member_id WHERE o.status='PAID'$old$;
 from_replacement constant text := $new$FROM package_payment_orders o JOIN members m ON m.id=o.member_id
 LEFT JOIN r4_online_private.settlement_before b ON b.order_id=o.id AND b.member_id=o.member_id
 WHERE o.status='PAID'$new$;
 definition text;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public.real_finance_action(text,text,uuid,jsonb)');
 IF NOT FOUND OR md5(replace(p.prosrc,E'\r\n',E'\n'))<>'ca6c6ec2ef1956dbf70d6f6c42e656df'
 OR p.prorettype<>'jsonb'::regtype OR p.prosecdef OR p.provolatile<>'v' OR p.proisstrict
 OR p.proretset OR p.proparallel<>'u' OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_catalog']
 OR EXISTS (SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))
            WHERE grantee=0 AND privilege_type='EXECUTE') THEN
  RAISE EXCEPTION 'Expected the private R5 finance reader with R4 online cancellations' USING ERRCODE='0A000';
 END IF;
 -- Resolve the evidence relations and check the R4 reader stack before replacing the RPC.
 PERFORM r4_online_private.assert_cancellation_stack();
 PERFORM b.expiry_before,e.expiry_after,c.cancelled_at,s.ends_at
 FROM r4_online_private.settlement_before b, r4_online_private.settlement_effects e,
      r4_online_private.cancellations c, r4_staff_private.free_sales s LIMIT 0;
 definition:=replace(pg_get_functiondef(p.oid),E'\r\n',E'\n');
 IF length(definition)-length(replace(definition,anchor,''))<>length(anchor)
 OR length(definition)-length(replace(definition,from_anchor,''))<>length(from_anchor) THEN
  RAISE EXCEPTION 'Unexpected R5 finance read anchors' USING ERRCODE='0A000';
 END IF;
 EXECUTE replace(replace(definition,anchor,classification),from_anchor,from_replacement);
END $migration$;
COMMIT;
