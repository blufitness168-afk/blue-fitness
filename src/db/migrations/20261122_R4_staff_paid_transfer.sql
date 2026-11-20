-- Prepare only. Requires the complete R4 free stack through the purchase guard.
BEGIN;
SET LOCAL search_path = pg_catalog;
SELECT r4_staff_private.assert_writer_stack();
DO $$ BEGIN
 IF to_regprocedure('r4_staff_private.guard_online_purchase()') IS NULL
 OR to_regprocedure('r4_staff_private.cancel_free_sale_impl(text,uuid,uuid,text,text)') IS NULL
 OR to_regprocedure('r4_staff_private.display_terms(text,text)') IS NULL THEN
  RAISE EXCEPTION 'Complete R4 free stack required';
 END IF;
END $$;

-- Keep the existing term table/FKs, append-only trigger, predecessor uniqueness and
-- shared member lock. The historical table name does not discriminate the method.
ALTER TABLE r4_staff_private.free_sales
 DROP CONSTRAINT free_sales_amount_satang_check,
 DROP CONSTRAINT free_sales_method_check,
 DROP CONSTRAINT free_sales_check2,
 ADD COLUMN transfer_at_input timestamptz,
 ADD COLUMN points_delta integer,
 ADD COLUMN balance_after integer,
 ADD CONSTRAINT staff_sale_method_check CHECK (
   isfinite(occurred_at) AND occurred_at<=recorded_at AND recorded_at<starts_at AND (
    (method='STAFF_FREE' AND amount_satang=0 AND occurred_at=recorded_at
     AND transfer_at_input IS NULL AND points_delta IS NULL AND balance_after IS NULL)
    OR (method='STAFF_TRANSFER' AND amount_satang=catalog_price_satang
     AND occurred_at=coalesce(transfer_at_input,recorded_at)
     AND (transfer_at_input IS NULL OR (actor_role='OWNER' AND transfer_at_input<recorded_at))
     AND points_delta IS NOT NULL AND points_delta=amount_satang/2000
     AND balance_after IS NOT NULL AND balance_after>=points_delta)));
COMMENT ON TABLE r4_staff_private.free_sales IS 'Shared append-only R4 staff sale and term authority; method distinguishes free and staff-confirmed bank transfer.';

DO $upgrade$
DECLARE p record; d text;
BEGIN
 FOR p IN SELECT * FROM (VALUES
 ('r4_staff_private.admission_term(integer,timestamptz,uuid)', $old$source_kind:='STAFF_FREE';$old$, $new$source_kind:=f.method;$new$),
 ('public.kiosk_checkin(text,text,uuid,text)', $old$ELSIF term_kind='STAFF_FREE' THEN$old$, $new$ELSIF term_kind IN ('STAFF_FREE','STAFF_TRANSFER') THEN$new$),
 ('public.real_frontdesk_checkin(text,text,uuid,text)', $old$ELSIF term_kind='STAFF_FREE' THEN$old$, $new$ELSIF term_kind IN ('STAFF_FREE','STAFF_TRANSFER') THEN$new$),
 ('public.kiosk_checkin(text,text,uuid,text)', $old$ELSE reason||COALESCE(' coupon='||c::text,'') END$old$, $new$WHEN term_kind='STAFF_TRANSFER' THEN 'STAFF_TRANSFER_ENTRY term=STAFF_TRANSFER:'||term_id::text
               ELSE reason||COALESCE(' coupon='||c::text,'') END$new$),
 ('public.real_frontdesk_checkin(text,text,uuid,text)', $old$ELSE reason||COALESCE(' coupon='||c::text,'') END$old$, $new$WHEN term_kind='STAFF_TRANSFER' THEN 'STAFF_TRANSFER_ENTRY term=STAFF_TRANSFER:'||term_id::text
               ELSE reason||COALESCE(' coupon='||c::text,'') END$new$),
 ('r4_staff_private.display_terms(text,text)', $old$term_kind='STAFF_FREE' AND term_id=s.sale_id$old$, $new$term_kind=s.method AND term_id=s.sale_id$new$),
 ('r4_staff_private.display_terms(text,text)', $old$ELSE 'BLOCKED' END
  ) ORDER BY$old$, $new$ELSE 'BLOCKED' END
  ) || CASE WHEN s.method='STAFF_TRANSFER' THEN jsonb_build_object('source',s.method) ELSE '{}'::jsonb END ORDER BY$new$)
 ) AS r(signature,anchor,replacement) LOOP
  SELECT replace(pg_get_functiondef(oid),chr(13),'') INTO d FROM pg_proc
   WHERE oid=to_regprocedure(p.signature) AND NOT prosecdef;
  IF d IS NULL OR length(d)-length(replace(d,p.anchor,''))<>length(p.anchor) THEN
   RAISE EXCEPTION 'Unexpected R4 staff transfer reader anchor: %',p.signature;
  END IF;
  EXECUTE replace(d,p.anchor,p.replacement);
 END LOOP;
END $upgrade$;

CREATE OR REPLACE VIEW r4_staff_private.finance_source AS
 SELECT (CASE WHEN method='STAFF_TRANSFER' THEN 'staff-transfer:' ELSE 'staff-free:' END)||sale_id::text AS source_id,
        sale_id,member_id,'INCOME'::text AS type,method AS source,amount_satang,
        (occurred_at AT TIME ZONE 'Asia/Bangkok')::date AS entry_date,occurred_at,recorded_at
 FROM r4_staff_private.free_sales
 UNION ALL
 SELECT 'staff-free-cancellation:'||c.sale_id,c.sale_id,s.member_id,'INCOME','STAFF_FREE_CANCELLATION',0,
        (c.cancelled_at AT TIME ZONE 'Asia/Bangkok')::date,c.cancelled_at,c.cancelled_at
 FROM r4_staff_private.free_sale_cancellations c
 JOIN r4_staff_private.free_sales s ON s.sale_id=c.sale_id WHERE s.method='STAFF_FREE';

CREATE VIEW r4_staff_private.paid_history AS
 SELECT sale_id,member_id,package_name,daily_slot,amount_satang,points_delta,starts_at,ends_at,occurred_at,recorded_at,
        NULL::timestamptz AS cancelled_at
 FROM r4_staff_private.free_sales WHERE method='STAFF_TRANSFER';
CREATE VIEW r4_staff_private.paid_point_ledger AS
 SELECT sale_id,member_id,points_delta AS delta,balance_after,recorded_at AS created_at,false AS is_reversal
 FROM r4_staff_private.free_sales WHERE method='STAFF_TRANSFER';

-- Same proof as admission, with the actual latest online predecessor candidate.
CREATE FUNCTION r4_staff_private.paid_active_expiry(p_member integer,p_at timestamptz) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT p.ends_at FROM r4_staff_private.paid_history p
 WHERE p.member_id=p_member AND p.starts_at<=p_at AND p.ends_at>p_at
 AND EXISTS (SELECT FROM r4_staff_private.admission_term(p_member,p_at,(
  SELECT id FROM public.package_payment_orders WHERE member_id=p_member AND status='PAID'
  ORDER BY paid_at DESC NULLS LAST,created_at DESC,id DESC LIMIT 1
 )) a WHERE a.source_kind='STAFF_TRANSFER' AND a.source_id=p.sale_id)
$$;

-- An EXTRA_DAYS redemption changes the legacy predecessor proof. Reject that
-- legacy expiry mutation while a paid term is outstanding; do not lose the term.
CREATE FUNCTION r4_staff_private.guard_paid_predecessor_expiry() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.expire_date IS DISTINCT FROM OLD.expire_date AND EXISTS (
  SELECT FROM r4_staff_private.paid_history p WHERE p.member_id=OLD.id AND p.ends_at>clock_timestamp()
 ) THEN RAISE EXCEPTION 'Legacy expiry cannot change during a staff transfer term' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER r4_paid_predecessor_expiry BEFORE UPDATE OF expire_date ON public.members
FOR EACH ROW EXECUTE FUNCTION r4_staff_private.guard_paid_predecessor_expiry();

CREATE FUNCTION r4_staff_private.assert_paid_writer_stack() RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM r4_staff_private.assert_writer_stack();
 IF EXISTS (
  SELECT FROM (VALUES
    ('public.kiosk_checkin(text,text,uuid,text)', 'STAFF_TRANSFER_ENTRY term=STAFF_TRANSFER:'),
    ('public.real_frontdesk_checkin(text,text,uuid,text)', 'STAFF_TRANSFER_ENTRY term=STAFF_TRANSFER:'),
    ('r4_staff_private.display_terms(text,text)', 'term_kind=s.method AND term_id=s.sale_id'),
    ('r4_staff_private.admission_term(integer,timestamptz,uuid)', 'source_kind:=f.method')
  ) AS r(signature,anchor)
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure(r.signature)
  WHERE p.oid IS NULL OR p.prosecdef OR strpos(p.prosrc,r.anchor)=0
 ) OR EXISTS (
  SELECT FROM (VALUES
   ('public.package_payment_orders','a_r4_staff_free_online_purchase_guard','r4_staff_private.guard_online_purchase()'),
   ('public.members','r4_paid_predecessor_expiry','r4_staff_private.guard_paid_predecessor_expiry()')
  ) AS r(rel,trigger_name,signature)
  WHERE NOT EXISTS (SELECT FROM pg_trigger t WHERE t.tgrelid=to_regclass(r.rel)
    AND t.tgname=r.trigger_name AND t.tgfoid=to_regprocedure(r.signature) AND t.tgenabled IN ('O','A'))
 ) THEN RAISE EXCEPTION 'R4 staff transfer readers or guards unavailable' USING ERRCODE='0A000'; END IF;
END $$;

CREATE FUNCTION r4_staff_private.paid_quote(f r4_staff_private.free_sales) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT r4_staff_private.sale_term(f)||jsonb_build_object('amountSatang',f.catalog_price_satang)
$$;
CREATE FUNCTION r4_staff_private.locked_paid_offer(p_code text) RETURNS r4_staff_private.free_sales
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE f r4_staff_private.free_sales;
BEGIN
 f:=r4_staff_private.locked_offer(p_code);
 IF f.member_id IS NULL OR EXISTS (SELECT FROM public.coupons c WHERE c.member_id=f.member_id
  AND c.type='EXTRA_DAYS' AND c.status='AVAILABLE' AND c.used_count<c.total_quota
  AND (c.expire_date IS NULL OR c.expire_date>f.recorded_at)) THEN RETURN NULL; END IF;
 RETURN f;
END $$;
CREATE FUNCTION r4_staff_private.preview_paid_transfer(p_session text,p_code text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE s public.auth_sessions; f r4_staff_private.free_sales;
BEGIN
 PERFORM r4_staff_private.assert_paid_writer_stack();
 s:=r4_staff_private.staff_session(p_session);
 f:=r4_staff_private.locked_paid_offer(p_code);
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 RETURN CASE WHEN f.member_id IS NOT NULL THEN r4_staff_private.paid_quote(f) END;
END $$;

CREATE FUNCTION r4_staff_private.record_paid_transfer(p_session text,p_key uuid,p_code text,
 p_offer jsonb,p_reason text,p_confirmed boolean,p_transfer_at timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE s public.auth_sessions; f r4_staff_private.free_sales; staff_role text;
 why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g'); balance integer;
BEGIN
 PERFORM r4_staff_private.assert_paid_writer_stack();
 s:=r4_staff_private.staff_session(p_session);
 SELECT role INTO staff_role FROM public.members WHERE id=s.member_id;
 IF p_transfer_at IS NOT NULL AND staff_role<>'OWNER' THEN
  RAISE EXCEPTION 'Only OWNER may record an earlier transfer' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_code IS NULL OR p_code !~ '^BLU-[0-9]{1,12}$'
 OR jsonb_typeof(p_offer) IS DISTINCT FROM 'object' OR p_confirmed IS DISTINCT FROM true
 OR why IS NULL OR length(why) NOT BETWEEN 1 AND 240 OR NOT coalesce(isfinite(p_transfer_at),true) THEN
  RAISE EXCEPTION 'Invalid staff transfer request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('r4-free-sale:'||s.member_id||':'||p_key,0));
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM r4_staff_private.free_sales WHERE actor_id=s.member_id AND request_key=p_key;
 IF FOUND THEN
  IF (f.method,f.member_code,r4_staff_private.paid_quote(f),f.reason,f.transfer_at_input)
    IS DISTINCT FROM ('STAFF_TRANSFER'::text,p_code,p_offer,why,p_transfer_at) THEN
   RAISE EXCEPTION 'Request key reused' USING ERRCODE='22023'; END IF;
 ELSE
  f:=r4_staff_private.locked_paid_offer(p_code);
  IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
  IF f.member_id IS NULL OR r4_staff_private.paid_quote(f) IS DISTINCT FROM p_offer THEN
   RAISE EXCEPTION 'Transfer quote changed or member ineligible' USING ERRCODE='55000'; END IF;
  IF p_transfer_at IS NOT NULL AND (p_transfer_at>=f.recorded_at OR NOT EXISTS (
   SELECT FROM public.r3_override_current_order(f.member_id,p_transfer_at) o WHERE o.id=f.predecessor_order_id AND o.package_snapshot->'catalogVersion'=to_jsonb(f.catalog_version)
  )) THEN
   RAISE EXCEPTION 'Backdate outside the proven predecessor and current catalog version' USING ERRCODE='55000'; END IF;
  SELECT points INTO balance FROM public.members WHERE id=f.member_id;
  INSERT INTO r4_staff_private.free_sales(member_id,member_code,predecessor_order_id,actor_id,actor_role,
   request_key,reason,package_id,catalog_version,package_name,duration_days,daily_slot,catalog_price_satang,
   amount_satang,method,occurred_at,recorded_at,starts_at,ends_at,transfer_at_input,points_delta,balance_after)
  VALUES(f.member_id,f.member_code,f.predecessor_order_id,s.member_id,staff_role,p_key,why,f.package_id,
   f.catalog_version,f.package_name,f.duration_days,f.daily_slot,f.catalog_price_satang,f.catalog_price_satang,
   'STAFF_TRANSFER',coalesce(p_transfer_at,f.recorded_at),f.recorded_at,f.starts_at,f.ends_at,p_transfer_at,
   f.catalog_price_satang/2000,balance+f.catalog_price_satang/2000) RETURNING * INTO f;
  UPDATE public.members SET points=f.balance_after,updated_at=f.recorded_at WHERE id=f.member_id;
  IF r4_staff_private.paid_active_expiry(f.member_id,f.starts_at) IS DISTINCT FROM f.ends_at
  OR NOT EXISTS (SELECT FROM r4_staff_private.finance_source v WHERE v.sale_id=f.sale_id
    AND (v.member_id,v.source_id,v.source,v.amount_satang,v.entry_date)=
      (f.member_id,'staff-transfer:'||f.sale_id,'STAFF_TRANSFER',f.amount_satang,(f.occurred_at AT TIME ZONE 'Asia/Bangkok')::date))
  OR f.starts_at<=clock_timestamp() THEN
   RAISE EXCEPTION 'Staff transfer reader mismatch or predecessor expired' USING ERRCODE='55000'; END IF;
 END IF;
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('saleId',f.sale_id,'source',f.method,'amountSatang',f.amount_satang,
  'pointsEarned',f.points_delta,'occurredAt',f.occurred_at,'recordedAt',f.recorded_at,
  'startsAt',f.starts_at,'endsAt',f.ends_at,'dailySlot',f.daily_slot);
END $$;

REVOKE ALL ON r4_staff_private.paid_history,r4_staff_private.paid_point_ledger FROM PUBLIC;
REVOKE ALL ON FUNCTION r4_staff_private.assert_paid_writer_stack(), r4_staff_private.paid_active_expiry(integer,timestamptz),
 r4_staff_private.guard_paid_predecessor_expiry(),r4_staff_private.paid_quote(r4_staff_private.free_sales),
 r4_staff_private.locked_paid_offer(text),r4_staff_private.preview_paid_transfer(text,text),
 r4_staff_private.record_paid_transfer(text,uuid,text,jsonb,text,boolean,timestamptz) FROM PUBLIC;
SELECT r4_staff_private.assert_paid_writer_stack();
COMMIT;
