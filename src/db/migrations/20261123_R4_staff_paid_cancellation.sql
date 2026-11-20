-- Prepare only. Install after staff paid transfer and the target finance reader.
BEGIN;
SET LOCAL search_path = pg_catalog;
SELECT r4_staff_private.assert_paid_writer_stack();

CREATE TABLE r4_staff_private.paid_transfer_cancellations (
 sale_id uuid PRIMARY KEY REFERENCES r4_staff_private.free_sales(sale_id),
 actor_id integer NOT NULL REFERENCES public.members(id),
 request_key uuid NOT NULL,
 reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 240 AND reason ~ '[^[:space:]]'),
 cancelled_at timestamptz NOT NULL CHECK (isfinite(cancelled_at)),
 refund_satang integer NOT NULL CHECK (refund_satang>0),
 point_delta integer NOT NULL CHECK (point_delta<=0),
 point_balance_after integer NOT NULL CHECK (point_balance_after>=0),
 UNIQUE (actor_id,request_key)
);
COMMENT ON TABLE r4_staff_private.paid_transfer_cancellations IS
 'Append-only OWNER attestation of completed external full refund and source-linked reversal of a future staff transfer. No provider operation.';
CREATE TRIGGER paid_transfer_cancellations_append_only BEFORE UPDATE OR DELETE OR TRUNCATE
 ON r4_staff_private.paid_transfer_cancellations FOR EACH STATEMENT
 EXECUTE FUNCTION r4_staff_private.reject_cancellation_mutation();

-- Keep original sale history and award. Publish compensating effects separately.
CREATE OR REPLACE VIEW r4_staff_private.paid_history AS
 SELECT s.sale_id,s.member_id,s.package_name,s.daily_slot,s.amount_satang,s.points_delta,s.starts_at,s.ends_at,
        s.occurred_at,s.recorded_at,c.cancelled_at
 FROM r4_staff_private.free_sales s LEFT JOIN r4_staff_private.paid_transfer_cancellations c USING(sale_id)
 WHERE s.method='STAFF_TRANSFER';
CREATE OR REPLACE VIEW r4_staff_private.paid_point_ledger AS
 SELECT sale_id,member_id,points_delta AS delta,balance_after,recorded_at AS created_at,false AS is_reversal
 FROM r4_staff_private.free_sales WHERE method='STAFF_TRANSFER'
 UNION ALL
 SELECT c.sale_id,s.member_id,c.point_delta,c.point_balance_after,c.cancelled_at,true
 FROM r4_staff_private.paid_transfer_cancellations c JOIN r4_staff_private.free_sales s USING(sale_id)
 WHERE c.point_delta<0;
CREATE OR REPLACE VIEW r4_staff_private.finance_source AS
 SELECT (CASE WHEN method='STAFF_TRANSFER' THEN 'staff-transfer:' ELSE 'staff-free:' END)||sale_id::text AS source_id,
        sale_id,member_id,'INCOME'::text AS type,method AS source,amount_satang,
        (occurred_at AT TIME ZONE 'Asia/Bangkok')::date AS entry_date,occurred_at,recorded_at
 FROM r4_staff_private.free_sales
 UNION ALL
 SELECT 'staff-free-cancellation:'||c.sale_id,c.sale_id,s.member_id,'INCOME','STAFF_FREE_CANCELLATION',0,
        (c.cancelled_at AT TIME ZONE 'Asia/Bangkok')::date,c.cancelled_at,c.cancelled_at
 FROM r4_staff_private.free_sale_cancellations c JOIN r4_staff_private.free_sales s USING(sale_id)
 WHERE s.method='STAFF_FREE'
 UNION ALL
 SELECT 'staff-transfer-refund:'||c.sale_id,c.sale_id,s.member_id,'EXPENSE','STAFF_TRANSFER_REFUND',c.refund_satang,
        (c.cancelled_at AT TIME ZONE 'Asia/Bangkok')::date,c.cancelled_at,c.cancelled_at
 FROM r4_staff_private.paid_transfer_cancellations c JOIN r4_staff_private.free_sales s USING(sale_id);

DO $upgrade$
DECLARE p record; d text;
 filter constant text := ' AND NOT EXISTS (SELECT FROM r4_staff_private.paid_transfer_cancellations c WHERE c.sale_id=s.sale_id)';
BEGIN
 FOR p IN SELECT * FROM (VALUES
  ('r4_staff_private.admission_term(integer,timestamptz,uuid)', 's.starts_at<=p_at AND s.ends_at>p_at', 's.starts_at<=p_at AND s.ends_at>p_at'||filter, 2),
  ('r4_staff_private.display_terms(text,text)', 's.ends_at>t', 's.ends_at>t'||filter, 2),
  ('r4_staff_private.guard_online_purchase()', 's.ends_at > clock_timestamp()', 's.ends_at > clock_timestamp()'||filter, 1),
  ('r4_staff_private.guard_paid_predecessor_expiry()', 'p.ends_at>clock_timestamp()', 'p.ends_at>clock_timestamp() AND p.cancelled_at IS NULL', 1),
  ('public.real_finance_action(text,text,uuid,jsonb)',
   $old$WHEN f.source='STAFF_FREE_CANCELLATION' THEN 'ยกเลิกการสมัคร'$old$,
   $new$WHEN f.source IN ('STAFF_FREE_CANCELLATION','STAFF_TRANSFER_REFUND') THEN 'ยกเลิกการสมัคร'$new$,1),
  ('public.real_finance_action(text,text,uuid,jsonb)',
   $old$ELSE f.source||' · '||f.source_id END$old$,
   $new$WHEN f.source='STAFF_TRANSFER_REFUND' THEN 'คืนเงินเต็มนอกระบบ · staff-transfer:'||f.sale_id ELSE f.source||' · '||f.source_id END$new$,1)
 ) AS r(signature,anchor,replacement,n) LOOP
  SELECT replace(pg_get_functiondef(oid),chr(13),'') INTO d FROM pg_proc
   WHERE oid=to_regprocedure(p.signature) AND NOT prosecdef;
  IF d IS NULL OR length(d)-length(replace(d,p.anchor,''))<>p.n*length(p.anchor) THEN
   RAISE EXCEPTION 'Unexpected staff cancellation reader: %',p.signature;
  END IF;
  EXECUTE replace(d,p.anchor,p.replacement);
 END LOOP;
END $upgrade$;

CREATE FUNCTION r4_staff_private.paid_cancellation_eligible(f r4_staff_private.free_sales,m public.members,t timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT f.sale_id IS NOT NULL AND f.method='STAFF_TRANSFER' AND f.amount_satang>0
  AND m.id=f.member_id AND m.member_code=f.member_code AND m.role='MEMBER' AND m.status='ACTIVE'
  AND f.recorded_at<=t AND t<f.starts_at
  -- The underlying sale grants no coupons. Require the intact settlement-time
  -- balance and deny any reward spend (including legacy redemptions) since award.
  AND m.points=f.balance_after AND m.points>=f.points_delta
  AND NOT EXISTS (SELECT FROM public.reward_point_spend_ledger l WHERE l.member_id=m.id AND l.created_at>=f.recorded_at)
  AND NOT EXISTS (SELECT FROM public.redemptions d WHERE d.member_id=m.id AND d.redeemed_at>=f.recorded_at)
  AND NOT EXISTS (SELECT FROM r4_staff_private.paid_transfer_cancellations c WHERE c.sale_id=f.sale_id)
  AND NOT EXISTS (SELECT FROM public.package_payment_orders o WHERE o.member_id=m.id AND o.id<>f.predecessor_order_id
                   AND (o.status IN ('PAID','PENDING') OR o.created_at>=f.recorded_at))
  AND NOT EXISTS (SELECT FROM r4_staff_private.free_sales x WHERE x.member_id=m.id AND x.sale_id<>f.sale_id
                   AND (x.recorded_at>=f.recorded_at OR x.ends_at>f.starts_at))
  AND NOT EXISTS (SELECT FROM public.checkins c WHERE c.member_id=m.id
                   AND (c.checkin_time>=f.starts_at OR strpos(c.notes,'STAFF_TRANSFER_ENTRY term=STAFF_TRANSFER:'||f.sale_id)>0))
  AND EXISTS (SELECT FROM r4_staff_private.admission_term(m.id,f.starts_at,f.predecessor_order_id) a
              WHERE a.source_kind='STAFF_TRANSFER' AND a.source_id=f.sale_id)
$$;

CREATE FUNCTION r4_staff_private.list_paid_transfer_cancellations(p_session text,p_code text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE s public.auth_sessions; result jsonb;
BEGIN
 PERFORM r4_staff_private.assert_paid_writer_stack();
 s:=r4_staff_private.cancellation_owner_session(p_session);
 IF p_code IS NULL OR p_code !~ '^BLU-[0-9]{1,12}$' THEN
  RAISE EXCEPTION 'Invalid member code' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('saleId',f.sale_id,'packageName',f.package_name,
  'startsAt',f.starts_at,'endsAt',f.ends_at,'amountSatang',f.amount_satang,'pointsToReverse',f.points_delta)
  ORDER BY f.starts_at,f.sale_id),'[]'::jsonb) INTO result
 FROM r4_staff_private.free_sales f JOIN public.members m ON m.id=f.member_id
 WHERE m.member_code=p_code AND r4_staff_private.paid_cancellation_eligible(f,m,clock_timestamp());
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION r4_staff_private.cancel_member_paid_transfer(p_session text,p_code text,p_key uuid,p_sale uuid,
 p_reason text,p_refund_confirmed boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE s public.auth_sessions; f r4_staff_private.free_sales; m public.members;
 c r4_staff_private.paid_transfer_cancellations; t timestamptz;
 why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
BEGIN
 PERFORM r4_staff_private.assert_paid_writer_stack();
 s:=r4_staff_private.cancellation_owner_session(p_session);
 IF p_code IS NULL OR p_code !~ '^BLU-[0-9]{1,12}$' OR p_key IS NULL OR p_sale IS NULL
  OR why IS NULL OR length(why) NOT BETWEEN 1 AND 240 OR p_refund_confirmed IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Reason and confirmation of completed full external refund required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('r4-paid-cancellation:'||s.member_id||':'||p_key,0));
 SELECT * INTO c FROM r4_staff_private.paid_transfer_cancellations WHERE actor_id=s.member_id AND request_key=p_key;
 IF c.sale_id IS NOT NULL AND (c.sale_id,c.reason) IS DISTINCT FROM (p_sale,why) THEN
  RAISE EXCEPTION 'Cancellation request key reused' USING ERRCODE='22023'; END IF;
 SELECT * INTO f FROM r4_staff_private.free_sales WHERE sale_id=p_sale AND member_code=p_code AND method='STAFF_TRANSFER';
 -- Shared row lock with online creation/finalization, staff writers, admission and reward spending.
 SELECT * INTO m FROM public.members WHERE id=f.member_id FOR UPDATE;
 IF m.id IS NULL OR m.member_code IS DISTINCT FROM p_code OR m.role IS DISTINCT FROM 'MEMBER' THEN
  RAISE EXCEPTION 'Future staff transfer cannot be cancelled' USING ERRCODE='55000'; END IF;
 IF c.sale_id IS NULL THEN
  t:=clock_timestamp();
  IF s.expires_at<=t THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
  IF r4_staff_private.paid_cancellation_eligible(f,m,t) IS NOT TRUE THEN
   RAISE EXCEPTION 'Future staff transfer cannot be cancelled; review required' USING ERRCODE='55000'; END IF;
  INSERT INTO r4_staff_private.paid_transfer_cancellations
   (sale_id,actor_id,request_key,reason,cancelled_at,refund_satang,point_delta,point_balance_after)
  VALUES(f.sale_id,s.member_id,p_key,why,t,f.amount_satang,-f.points_delta,m.points-f.points_delta) RETURNING * INTO c;
  IF f.points_delta>0 THEN
   UPDATE public.members SET points=c.point_balance_after,updated_at=t WHERE id=m.id;
  END IF;
  IF EXISTS (SELECT FROM r4_staff_private.admission_term(m.id,f.starts_at,f.predecessor_order_id))
   OR r4_staff_private.paid_active_expiry(m.id,f.starts_at) IS NOT NULL
   OR NOT EXISTS (SELECT FROM r4_staff_private.finance_source v WHERE v.sale_id=f.sale_id
                  AND v.source='STAFF_TRANSFER_REFUND' AND v.type='EXPENSE' AND v.amount_satang=f.amount_satang)
   OR clock_timestamp()>=f.starts_at THEN
   RAISE EXCEPTION 'Staff transfer reader mismatch or term started' USING ERRCODE='55000'; END IF;
 END IF;
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('saleId',c.sale_id,'source','STAFF_TRANSFER_REFUND','status','CANCELLED',
  'cancelledAt',c.cancelled_at,'refundSatang',c.refund_satang,'pointsReversed',-c.point_delta);
END $$;

REVOKE ALL ON r4_staff_private.paid_transfer_cancellations FROM PUBLIC;
REVOKE ALL ON FUNCTION r4_staff_private.paid_cancellation_eligible(r4_staff_private.free_sales,public.members,timestamptz),
 r4_staff_private.list_paid_transfer_cancellations(text,text),
 r4_staff_private.cancel_member_paid_transfer(text,text,uuid,uuid,text,boolean) FROM PUBLIC;
COMMIT;
