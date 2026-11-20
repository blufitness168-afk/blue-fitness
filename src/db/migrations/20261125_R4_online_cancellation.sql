-- PREPARE ONLY. Requires the complete R3/R4 staff stack, rewards, and 20261124 evidence.
-- No transfer, historical backfill, client grants or automatic activation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog;
SELECT r4_staff_private.assert_paid_writer_stack();
SELECT r4_staff_private.assert_free_purchase_guard();

CREATE TABLE r4_online_private.cancellations (
 order_id uuid PRIMARY KEY REFERENCES r4_online_private.settlement_effects(order_id),
 member_id integer NOT NULL REFERENCES public.members(id),
 actor_id integer NOT NULL REFERENCES public.members(id),
 request_key uuid NOT NULL,
 reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 240 AND reason ~ '[^[:space:]]'),
 cancelled_at timestamptz NOT NULL CHECK (isfinite(cancelled_at)),
 refund_satang integer NOT NULL CHECK (refund_satang>0),
 point_delta integer NOT NULL CHECK (point_delta<=0),
 point_balance_after integer NOT NULL CHECK (point_balance_after>=0),
 UNIQUE (actor_id,request_key)
);
COMMENT ON TABLE r4_online_private.cancellations IS
 'Immutable source-linked OWNER attestation of completed full external refund, revocation of the order term and point compensation. No funds are moved.';
CREATE TRIGGER cancellation_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON r4_online_private.cancellations FOR EACH STATEMENT EXECUTE FUNCTION r4_online_private.reject_mutation();

-- App contract: use this relation for entitlement/current-order selection, not history.
-- Preserve purchase/settlement replay from the original orders; LEFT JOIN cancellations
-- by order_id for the historical cancellation date/amount. Wallet adds point_reversals
-- to the original award/spend ledgers; finance/export uses real_finance_action's rows.
CREATE VIEW r4_online_private.active_paid_orders AS
 SELECT o.* FROM public.package_payment_orders o WHERE o.status='PAID'
 AND NOT EXISTS (SELECT FROM r4_online_private.cancellations c WHERE c.order_id=o.id);
CREATE VIEW r4_online_private.point_reversals AS
 SELECT order_id,member_id,point_delta AS delta,point_balance_after AS balance_after,cancelled_at AS created_at
 FROM r4_online_private.cancellations WHERE point_delta<0;
CREATE VIEW r4_online_private.finance_refunds AS
 SELECT 'online-refund:'||c.order_id AS source_id,c.order_id,c.member_id,'EXPENSE'::text AS type,
 'ONLINE_REFUND'::text AS source,c.refund_satang AS amount_satang,
 (c.cancelled_at AT TIME ZONE 'Asia/Bangkok')::date AS entry_date,c.cancelled_at AS recorded_at
 FROM r4_online_private.cancellations c;

-- Keep the established staff and original income projections. Refund is a separate expense.
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
 FROM r4_staff_private.paid_transfer_cancellations c JOIN r4_staff_private.free_sales s USING(sale_id)
 UNION ALL
 SELECT source_id,order_id,member_id,type,source,amount_satang,entry_date,recorded_at,recorded_at
 FROM r4_online_private.finance_refunds;

DO $readers$
DECLARE r record; d text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('public.kiosk_checkin(text,text,uuid,text)',
    'INTO online_order,snapshot FROM package_payment_orders', 'INTO online_order,snapshot FROM r4_online_private.active_paid_orders'),
  ('public.real_frontdesk_checkin(text,text,uuid,text)',
    'INTO online_order,snapshot FROM package_payment_orders', 'INTO online_order,snapshot FROM r4_online_private.active_paid_orders'),
  ('public.r3_override_current_order(integer,timestamptz)',
    'FROM package_payment_orders o', 'FROM r4_online_private.active_paid_orders o'),
  ('public.r3_override_current_order(integer,timestamptz)',
    'FROM package_payment_orders x', 'FROM r4_online_private.active_paid_orders x'),
  ('r4_staff_private.admission_term(integer,timestamptz,uuid)',
    'SELECT o.id INTO later_order FROM public.package_payment_orders o',
    'SELECT o.id INTO later_order FROM r4_online_private.active_paid_orders o'),
  ('r4_staff_private.admission_term(integer,timestamptz,uuid)',
    'FROM public.package_payment_orders x', 'FROM r4_online_private.active_paid_orders x'),
  ('r4_staff_private.display_terms(text,text)',
    'SELECT o.id INTO online_order FROM public.package_payment_orders o', 'SELECT o.id INTO online_order FROM r4_online_private.active_paid_orders o'),
  ('r4_staff_private.paid_active_expiry(integer,timestamptz)',
    'SELECT id FROM public.package_payment_orders WHERE', 'SELECT id FROM r4_online_private.active_paid_orders WHERE'),
  ('r4_staff_private.paid_cancellation_eligible(r4_staff_private.free_sales,public.members,timestamptz)',
    $old$o.status IN ('PAID','PENDING')$old$,
    $new$o.status='PENDING' OR (o.status='PAID' AND EXISTS (SELECT FROM r4_online_private.active_paid_orders a WHERE a.id=o.id))$new$),
  ('public.real_finance_action(text,text,uuid,jsonb)',
    $old$IN ('STAFF_FREE_CANCELLATION','STAFF_TRANSFER_REFUND')$old$,
    $new$IN ('STAFF_FREE_CANCELLATION','STAFF_TRANSFER_REFUND','ONLINE_REFUND')$new$),
  ('public.real_finance_action(text,text,uuid,jsonb)',
    $old$ELSE f.source||' · '||f.source_id END$old$,
    $new$WHEN f.source='ONLINE_REFUND' THEN 'คืนเงินเต็มนอกระบบ · online:'||f.sale_id ELSE f.source||' · '||f.source_id END$new$)
 ) AS p(signature,anchor,replacement) LOOP
  SELECT replace(pg_get_functiondef(oid),chr(13),'') INTO d FROM pg_proc
  WHERE oid=to_regprocedure(r.signature) AND NOT prosecdef;
  IF d IS NULL OR length(d)-length(replace(d,r.anchor,''))<>length(r.anchor) THEN
   RAISE EXCEPTION 'Unexpected R4 online cancellation reader: %',r.signature USING ERRCODE='0A000';
  END IF;
  EXECUTE replace(d,r.anchor,r.replacement);
 END LOOP;
END $readers$;

-- Do not insert the singleton until the app's current package/history, wallet,
-- and export are running against the above contracts. Delete to pause new writes.
-- Only the trusted migration/backend owner may manage this switch. SQL readers
-- must stay cancellation-aware even when the switch is removed.
CREATE TABLE r4_online_private.reader_cutover (
 version integer PRIMARY KEY CHECK (version=1)
);
COMMENT ON TABLE r4_online_private.reader_cutover IS
 'Empty by default. Version 1 attests application current-package/history/wallet/export reader cutover. Never enable before reader integration.';

CREATE FUNCTION r4_online_private.assert_cancellation_stack() RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM r4_staff_private.assert_paid_writer_stack();
 PERFORM r4_staff_private.assert_free_purchase_guard();
 IF NOT EXISTS (SELECT FROM pg_trigger t WHERE t.tgrelid='public.package_payment_orders'::regclass
   AND t.tgname='z_r4_online_settlement_effects' AND t.tgenabled IN ('O','A')
   AND t.tgfoid='r4_online_private.capture_effects()'::regprocedure)
 OR EXISTS (SELECT FROM (VALUES
  ('public.kiosk_checkin(text,text,uuid,text)','r4_online_private.active_paid_orders'),
  ('public.real_frontdesk_checkin(text,text,uuid,text)','r4_online_private.active_paid_orders'),
  ('public.r3_override_current_order(integer,timestamptz)','r4_online_private.active_paid_orders x'),
  ('r4_staff_private.admission_term(integer,timestamptz,uuid)','r4_online_private.active_paid_orders x'),
  ('r4_staff_private.display_terms(text,text)','r4_online_private.active_paid_orders'),
  ('r4_staff_private.paid_active_expiry(integer,timestamptz)','r4_online_private.active_paid_orders'),
  ('public.real_finance_action(text,text,uuid,jsonb)','ONLINE_REFUND')
 ) AS r(signature,anchor) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(r.signature)
 WHERE p.oid IS NULL OR p.prosecdef OR strpos(p.prosrc,r.anchor)=0) THEN
  RAISE EXCEPTION 'R4 online cancellation readers or evidence unavailable' USING ERRCODE='0A000';
 END IF;
END $$;
SELECT r4_online_private.assert_cancellation_stack();

-- Preview may call this unlocked; only the writer under both locks can act on it.
CREATE FUNCTION r4_online_private.cancellation_eligible(p_order uuid,p_member integer,t timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT EXISTS (
  SELECT FROM public.r3_override_current_order(p_member,t) o
  JOIN r4_online_private.settlement_before b ON b.order_id=o.id AND b.member_id=o.member_id
  JOIN r4_online_private.settlement_effects e ON e.order_id=b.order_id
  JOIN public.entitlement_online_observations v ON v.order_id=e.observation_id
  JOIN public.package_payment_point_ledger l ON l.order_id=o.id
  JOIN public.package_payment_attempts a ON a.id=b.verified_attempt_id AND a.order_id=o.id
  JOIN public.members m ON m.id=o.member_id
  WHERE o.id=p_order AND m.member_code ~ '^BLU-[0-9]{1,12}$'
   AND isfinite(b.captured_at) AND isfinite(e.confirmed_at) AND isfinite(e.expiry_after)
   AND e.confirmed_at<=b.captured_at AND b.captured_at<=t
   AND (b.expiry_before IS NULL OR (isfinite(b.expiry_before) AND b.expiry_before<=e.confirmed_at))
   AND b.status_before IN ('PENDING','ACTIVE','EXPIRED') AND b.points_before>=0
   AND (m.expire_date,m.status::text,m.points,m.updated_at)=(e.expiry_after,e.status_after,e.points_after,e.confirmed_at)
   AND (o.membership_expires_at,o.confirmed_at,o.points_earned,o.amount_satang)=(e.expiry_after,e.confirmed_at,e.award_delta,e.amount_satang)
   AND (v.member_id,v.package_snapshot,v.confirmed_at,v.membership_expires_at,v.point_ledger_order_id,v.points_delta,v.points_balance_after)
      =(o.member_id,o.package_snapshot,e.confirmed_at,e.expiry_after,o.id,e.award_delta,e.points_after)
   AND (l.member_id,l.delta,l.balance_after)=(m.id,e.award_delta,e.points_after)
   AND e.award_delta>=0 AND e.points_after::bigint=b.points_before::bigint+e.award_delta
   AND a.state='VERIFIED' AND a.evidence=o.verification_snapshot
   AND o.amount_satang>0 AND o.discount_satang=0 AND o.promo_code IS NULL AND o.promo_snapshot IS NULL
   AND e.promo_assignment_id IS NULL AND e.issued_coupons='[]'::jsonb
   AND NOT EXISTS (SELECT FROM public.benefit_promo_reservations x WHERE x.order_id=o.id)
   AND NOT EXISTS (SELECT FROM public.coupons c WHERE c.source LIKE 'PACKAGE_ORDER:'||o.id||':%')
   AND NOT EXISTS (SELECT FROM public.package_payment_orders x WHERE x.member_id=m.id AND x.id<>o.id
                   AND (x.status='PENDING' OR x.created_at>=o.created_at))
   AND NOT EXISTS (SELECT FROM r4_staff_private.free_sales x WHERE x.member_id=m.id
                   AND (x.predecessor_order_id=o.id OR x.ends_at>e.confirmed_at OR x.recorded_at>=e.confirmed_at))
   AND NOT EXISTS (SELECT FROM public.r3_member_time_override_events x WHERE x.member_id=m.id
                   AND (x.order_id=o.id OR x.recorded_at>=e.confirmed_at))
   AND NOT EXISTS (SELECT FROM public.reward_point_spend_ledger l WHERE l.member_id=m.id AND l.created_at>=b.captured_at)
   AND NOT EXISTS (SELECT FROM public.redemptions x WHERE x.member_id=m.id AND x.redeemed_at>=b.captured_at)
   AND NOT EXISTS (SELECT FROM public.benefit_consumptions x WHERE x.member_id=m.id AND x.created_at>=b.captured_at)
   AND e.checkin_fingerprint=r4_online_private.checkin_fingerprint(m.id)
 );
$$;

CREATE FUNCTION r4_online_private.preview_online_cancellation(p_session text,p_order uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' SET lock_timeout='750ms' AS $$
DECLARE s public.auth_sessions; result jsonb;
BEGIN
 s:=r4_staff_private.cancellation_owner_session(p_session);
 PERFORM r4_online_private.assert_cancellation_stack();
 IF p_order IS NULL THEN RAISE EXCEPTION 'Order required' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('orderId',o.id,'memberCode',m.member_code,'packageName',o.package_snapshot->>'name',
   'amountSatang',o.amount_satang,'pointsToReverse',o.points_earned,'confirmedAt',o.confirmed_at,
   'eligible',state.blocker IS NULL,'blocker',state.blocker) INTO result
 FROM public.package_payment_orders o JOIN public.members m ON m.id=o.member_id
 LEFT JOIN r4_online_private.cancellations c ON c.order_id=o.id
 CROSS JOIN LATERAL (SELECT CASE
   WHEN c.order_id IS NOT NULL THEN 'ALREADY_CANCELLED'
   WHEN NOT EXISTS (SELECT FROM r4_online_private.reader_cutover WHERE version=1) THEN 'READERS_NOT_ENABLED'
   WHEN NOT r4_online_private.cancellation_eligible(o.id,m.id,clock_timestamp()) THEN 'REVIEW_REQUIRED'
 END AS blocker) state
 WHERE o.id=p_order AND o.status='PAID';
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION r4_online_private.cancel_online_order(p_session text,p_order uuid,p_key uuid,
 p_refund_satang integer,p_reason text,p_refund_confirmed boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' SET lock_timeout='750ms' AS $$
DECLARE s public.auth_sessions; c r4_online_private.cancellations; b r4_online_private.settlement_before;
 m public.members; member_key integer; t timestamptz;
 why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
BEGIN
 s:=r4_staff_private.cancellation_owner_session(p_session);
 PERFORM r4_online_private.assert_cancellation_stack();
 IF p_order IS NULL OR p_key IS NULL OR p_refund_satang IS NULL OR p_refund_satang<=0
   OR why IS NULL OR length(why) NOT BETWEEN 1 AND 240 OR p_refund_confirmed IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Reason and confirmation of completed full external refund required' USING ERRCODE='22023';
 END IF;
 PERFORM 1 FROM r4_online_private.reader_cutover WHERE version=1 FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'R4 online cancellation readers not enabled' USING ERRCODE='55000'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('r4-online-cancellation:'||s.member_id||':'||p_key,0));
 SELECT * INTO c FROM r4_online_private.cancellations WHERE actor_id=s.member_id AND request_key=p_key;
 IF FOUND THEN
  IF (c.order_id,c.refund_satang,c.reason) IS DISTINCT FROM (p_order,p_refund_satang,why) THEN
   RAISE EXCEPTION 'Cancellation request key reused' USING ERRCODE='22023';
  END IF;
 ELSE
  -- Match the member-first order of settlement, purchase, staff writers and admission.
  SELECT member_id INTO member_key FROM public.package_payment_orders WHERE id=p_order;
  SELECT * INTO m FROM public.members WHERE id=member_key FOR UPDATE;
  IF m.id IS NULL OR m.role IS DISTINCT FROM 'MEMBER' THEN
   RAISE EXCEPTION 'Online order cannot be cancelled; review required' USING ERRCODE='55000';
  END IF;
  -- Self-welcome writes coupons + checkins without taking the shared member lock.
  -- SHARE fences INSERT/UPDATE/DELETE/TRUNCATE until commit. READ COMMITTED gives
  -- the following eligibility statement a fresh snapshot after waiting. A lock
  -- timeout or deadlock propagates; never fall back to an unlocked fingerprint.
  LOCK TABLE public.checkins IN SHARE MODE;
  t:=clock_timestamp();
  IF s.expires_at<=t THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
  IF NOT r4_online_private.cancellation_eligible(p_order,m.id,t) THEN
   RAISE EXCEPTION 'Online order cannot be cancelled; review required' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS (SELECT FROM r4_online_private.settlement_effects WHERE order_id=p_order AND amount_satang=p_refund_satang) THEN
   RAISE EXCEPTION 'Refund must equal the original paid amount' USING ERRCODE='22023';
  END IF;
  SELECT * INTO STRICT b FROM r4_online_private.settlement_before WHERE order_id=p_order;
  INSERT INTO r4_online_private.cancellations
   (order_id,member_id,actor_id,request_key,reason,cancelled_at,refund_satang,point_delta,point_balance_after)
  VALUES(p_order,m.id,s.member_id,p_key,why,t,p_refund_satang,b.points_before-m.points,b.points_before) RETURNING * INTO c;
  UPDATE public.members SET expire_date=b.expiry_before,status=b.status_before::public.member_status,points=b.points_before,updated_at=t
   WHERE id=m.id RETURNING * INTO m;
  IF (m.expire_date,m.status::text,m.points) IS DISTINCT FROM (b.expiry_before,b.status_before,b.points_before)
   OR EXISTS (SELECT FROM r4_online_private.active_paid_orders WHERE member_id=m.id)
   OR NOT EXISTS (SELECT FROM r4_staff_private.finance_source WHERE sale_id=p_order AND source='ONLINE_REFUND'
                  AND type='EXPENSE' AND amount_satang=p_refund_satang)
   OR (c.point_delta<0 AND NOT EXISTS (SELECT FROM r4_online_private.point_reversals WHERE order_id=p_order
       AND member_id=m.id AND delta=c.point_delta AND balance_after=m.points)) THEN
   RAISE EXCEPTION 'R4 online cancellation restoration or reader mismatch' USING ERRCODE='55000';
  END IF;
 END IF;
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('orderId',c.order_id,'source','ONLINE_REFUND','status','CANCELLED',
   'cancelledAt',c.cancelled_at,'refundSatang',c.refund_satang,'pointsReversed',-c.point_delta);
END $$;

REVOKE ALL ON r4_online_private.cancellations,r4_online_private.active_paid_orders,r4_online_private.point_reversals,
 r4_online_private.finance_refunds,r4_online_private.reader_cutover FROM PUBLIC;
REVOKE ALL ON FUNCTION r4_online_private.assert_cancellation_stack(),
 r4_online_private.cancellation_eligible(uuid,integer,timestamptz),
 r4_online_private.preview_online_cancellation(text,uuid),
 r4_online_private.cancel_online_order(text,uuid,uuid,integer,text,boolean) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT FROM (
   SELECT nspowner AS owner,nspacl AS acl FROM pg_namespace WHERE oid='r4_online_private'::regnamespace
   UNION ALL SELECT relowner,relacl FROM pg_class WHERE relnamespace='r4_online_private'::regnamespace
   UNION ALL SELECT proowner,proacl FROM pg_proc WHERE pronamespace='r4_online_private'::regnamespace
 ) o CROSS JOIN LATERAL aclexplode(o.acl) a WHERE a.grantee<>o.owner) THEN
  RAISE EXCEPTION 'Unexpected grants on R4 online private objects' USING ERRCODE='0A000';
 END IF;
END $$;
COMMIT;
