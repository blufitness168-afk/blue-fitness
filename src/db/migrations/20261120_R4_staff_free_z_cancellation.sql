-- PREPARE ONLY: install after R4 writer, finance and display. No grants or backfill.
BEGIN;
SET LOCAL search_path = pg_catalog;

SELECT r4_staff_private.assert_writer_stack();
DO $$ BEGIN
 IF to_regprocedure('r4_staff_private.record_free_sale(text,uuid,text,jsonb,text)') IS NULL THEN
  RAISE EXCEPTION 'R4 cancellation requires the staff-free writer';
 END IF;
END $$;

CREATE TABLE r4_staff_private.free_sale_cancellations (
 sale_id uuid PRIMARY KEY REFERENCES r4_staff_private.free_sales(sale_id),
 actor_id integer NOT NULL REFERENCES public.members(id),
 request_key uuid NOT NULL,
 reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 240 AND reason ~ '[^[:space:]]'),
 cancelled_at timestamptz NOT NULL CHECK (isfinite(cancelled_at)),
 UNIQUE (actor_id,request_key)
);
COMMENT ON TABLE r4_staff_private.free_sale_cancellations IS
 'Append-only OWNER cancellation of a future zero-satang STAFF_FREE term; no refund or legacy mutation.';
CREATE FUNCTION r4_staff_private.reject_cancellation_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'Staff free cancellations are append-only' USING ERRCODE='55000';
END $$;
CREATE TRIGGER free_sale_cancellations_append_only BEFORE UPDATE OR DELETE OR TRUNCATE
 ON r4_staff_private.free_sale_cancellations FOR EACH STATEMENT
 EXECUTE FUNCTION r4_staff_private.reject_cancellation_mutation();

-- Pin reviewed readers and preserve their OIDs, ACLs, signatures and remaining behavior.
DO $upgrade$
DECLARE p record; installed pg_proc; definition text;
 filter constant text := ' AND NOT EXISTS (SELECT FROM r4_staff_private.free_sale_cancellations c WHERE c.sale_id=s.sale_id)';
 old_finance constant text := $old$f.type,'ต่อสมาชิก',f.amount_satang::numeric/100,
        f.source||' · '||f.source_id$old$;
 new_finance constant text := $new$f.type,CASE WHEN f.source='STAFF_FREE_CANCELLATION' THEN 'ยกเลิกการสมัคร' ELSE 'ต่อสมาชิก' END,f.amount_satang::numeric/100,
        CASE WHEN f.source='STAFF_FREE_CANCELLATION' THEN 'ยกเลิกเทอมฟรี · ไม่คืนเงิน · staff-free:'||f.sale_id ELSE f.source||' · '||f.source_id END$new$;
BEGIN
 FOR p IN SELECT * FROM (VALUES
  ('r4_staff_private.admission_term(integer,timestamptz,uuid)', ARRAY['517d5d4579f637a1f95bef91e6122bda'],
   's.starts_at<=p_at AND s.ends_at>p_at', 's.starts_at<=p_at AND s.ends_at>p_at'||filter, 2, 's', ARRAY['search_path=pg_catalog']),
  ('r4_staff_private.display_terms(text,text)', ARRAY['0d0640589a0b3a8b73f02f4e045143b6'],
   's.ends_at>t', 's.ends_at>t'||filter, 2, 's', ARRAY['search_path=pg_catalog','TimeZone=UTC']),
  ('public.real_finance_action(text,text,uuid,jsonb)', ARRAY['e9d9f7cd6373b521547e6dc933c6fc3c','41854aee8035a8cf448917be2a39d792'],
   old_finance,new_finance,1,'v',ARRAY['search_path=public, pg_catalog'])
 ) AS r(signature, hashes, anchor, replacement, occurrences, volatility, config) LOOP
  SELECT * INTO installed FROM pg_proc WHERE oid=to_regprocedure(p.signature);
  IF NOT FOUND OR NOT (md5(replace(installed.prosrc,chr(13),''))=ANY(p.hashes))
   OR installed.prosecdef OR installed.provolatile::text<>p.volatility
   OR installed.proconfig IS DISTINCT FROM p.config OR installed.proisstrict
   OR installed.proparallel<>'u' OR installed.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
   OR EXISTS (SELECT FROM aclexplode(coalesce(installed.proacl,acldefault('f',installed.proowner)))
              WHERE grantee=0 AND privilege_type='EXECUTE') THEN
   RAISE EXCEPTION 'Unreviewed R4 cancellation reader: %',p.signature
    USING DETAIL=format('Installed hash=%s config=%s',md5(replace(installed.prosrc,chr(13),'')),installed.proconfig);
  END IF;
  definition:=replace(pg_get_functiondef(installed.oid),chr(13),'');
  IF length(definition)-length(replace(definition,p.anchor,'')) <> p.occurrences*length(p.anchor) THEN
   RAISE EXCEPTION 'Unexpected R4 cancellation reader anchor: %',p.signature;
  END IF;
  EXECUTE replace(definition,p.anchor,p.replacement);
 END LOOP;
END $upgrade$;

-- Keep the original row byte-for-byte at the same source ID. A second locked
-- zero-amount lifecycle row carries the cancellation's own Bangkok date.
CREATE OR REPLACE VIEW r4_staff_private.finance_source AS
 SELECT 'staff-free:' || sale_id::text AS source_id, sale_id, member_id,
        'INCOME'::text AS type, method AS source, amount_satang,
        (occurred_at AT TIME ZONE 'Asia/Bangkok')::date AS entry_date,
        occurred_at, recorded_at
 FROM r4_staff_private.free_sales
 UNION ALL
 SELECT 'staff-free-cancellation:'||c.sale_id, c.sale_id, s.member_id,
        'INCOME', 'STAFF_FREE_CANCELLATION', 0,
        (c.cancelled_at AT TIME ZONE 'Asia/Bangkok')::date, c.cancelled_at, c.cancelled_at
 FROM r4_staff_private.free_sale_cancellations c
 JOIN r4_staff_private.free_sales s ON s.sale_id=c.sale_id;

CREATE FUNCTION r4_staff_private.cancellation_owner_session(p_session text)
RETURNS public.auth_sessions LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE s public.auth_sessions;
BEGIN
 PERFORM r4_staff_private.assert_writer_stack();
 -- staff_session locks the actor before the session. Require OWNER even for replay.
 s:=r4_staff_private.staff_session(p_session);
 IF NOT EXISTS (SELECT FROM public.members WHERE id=s.member_id AND role='OWNER') THEN
  RAISE EXCEPTION 'Live normal OWNER session required' USING ERRCODE='42501';
 END IF;
 RETURN s;
END $$;

CREATE FUNCTION r4_staff_private.free_sale_cancellation_eligible(
 f r4_staff_private.free_sales,m public.members,t timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
 RETURN f.sale_id IS NOT NULL AND f.method='STAFF_FREE' AND f.amount_satang=0
  AND m.role IS NOT DISTINCT FROM 'MEMBER' AND m.status IS NOT DISTINCT FROM 'ACTIVE'
  AND m.member_code IS NOT DISTINCT FROM f.member_code AND f.recorded_at<=t AND f.starts_at>t
  AND NOT EXISTS (SELECT FROM r4_staff_private.free_sale_cancellations WHERE sale_id=f.sale_id)
  AND NOT EXISTS (SELECT FROM public.package_payment_orders o WHERE o.member_id=m.id
              AND (o.status='PENDING' OR (o.id<>f.predecessor_order_id AND o.created_at>=f.recorded_at)))
  AND NOT EXISTS (SELECT FROM r4_staff_private.free_sales x WHERE x.member_id=m.id AND x.sale_id<>f.sale_id
              AND x.ends_at>f.starts_at)
  AND NOT EXISTS (SELECT FROM public.checkins c WHERE c.member_id=m.id
              AND strpos(c.notes,'STAFF_FREE_ENTRY term=STAFF_FREE:'||f.sale_id)>0)
  AND EXISTS (SELECT FROM r4_staff_private.admission_term(m.id,f.starts_at,f.predecessor_order_id) a
              WHERE a.source_kind='STAFF_FREE' AND a.source_id=f.sale_id);
END $$;

CREATE FUNCTION r4_staff_private.list_free_sale_cancellations(p_session text,p_code text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog SET timezone = 'UTC' AS $$
DECLARE s public.auth_sessions; candidates jsonb;
BEGIN
 s:=r4_staff_private.cancellation_owner_session(p_session);
 IF p_code IS NULL OR p_code !~ '^BLU-[0-9]{1,12}$' THEN
  RAISE EXCEPTION 'Invalid member code' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('saleId',q.sale_id,'packageName',q.package_name,
         'startsAt',q.starts_at,'endsAt',q.ends_at) ORDER BY q.starts_at,q.sale_id),'[]'::jsonb)
 INTO candidates
 FROM (
  SELECT f.sale_id,f.package_name,f.starts_at,f.ends_at
  FROM public.members m JOIN r4_staff_private.free_sales f ON f.member_id=m.id AND f.member_code=m.member_code
  WHERE m.member_code=p_code AND m.role='MEMBER' AND m.status='ACTIVE'
   AND f.starts_at>statement_timestamp()
   AND r4_staff_private.free_sale_cancellation_eligible(f,m,clock_timestamp())
  ORDER BY f.starts_at,f.sale_id LIMIT 20
 ) q;
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 RETURN candidates;
END $$;

CREATE FUNCTION r4_staff_private.cancel_free_sale_impl(p_session text,p_key uuid,p_sale uuid,p_reason text,p_code text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog SET timezone = 'UTC' AS $$
DECLARE
 s public.auth_sessions; f r4_staff_private.free_sales; m public.members;
 e r4_staff_private.free_sale_cancellations; t timestamptz;
 why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
BEGIN
 s:=r4_staff_private.cancellation_owner_session(p_session);
 IF p_key IS NULL OR p_sale IS NULL OR why IS NULL OR length(why) NOT BETWEEN 1 AND 240 THEN
  RAISE EXCEPTION 'Invalid staff free cancellation request' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('r4-free-cancellation:'||s.member_id||':'||p_key,0));
 SELECT * INTO e FROM r4_staff_private.free_sale_cancellations WHERE actor_id=s.member_id AND request_key=p_key;
 IF e.sale_id IS NULL OR p_code IS NOT NULL THEN
  SELECT * INTO f FROM r4_staff_private.free_sales WHERE sale_id=p_sale AND (p_code IS NULL OR member_code=p_code);
  -- Same target lock as online creation/settlement, staff writer and admission.
  -- Check the live code under this lock before either mutating or returning a replay.
  SELECT * INTO m FROM public.members WHERE id=f.member_id FOR UPDATE;
  IF p_code IS NOT NULL AND (m.member_code IS DISTINCT FROM p_code OR m.role IS DISTINCT FROM 'MEMBER') THEN
   RAISE EXCEPTION 'Future staff free term cannot be cancelled' USING ERRCODE='55000'; END IF;
 END IF;
 IF e.sale_id IS NOT NULL THEN
  IF (e.sale_id,e.reason) IS DISTINCT FROM (p_sale,why) THEN
   RAISE EXCEPTION 'Cancellation request key reused' USING ERRCODE='22023'; END IF;
 ELSE
  t:=clock_timestamp();
  IF s.expires_at<=t THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
  IF r4_staff_private.free_sale_cancellation_eligible(f,m,t) IS NOT TRUE THEN
   RAISE EXCEPTION 'Future staff free term cannot be cancelled' USING ERRCODE='55000'; END IF;
  t:=clock_timestamp();
  IF s.expires_at<=t THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
  IF t<f.recorded_at OR t>=f.starts_at THEN
   RAISE EXCEPTION 'Future staff free term cannot be cancelled' USING ERRCODE='55000'; END IF;
  INSERT INTO r4_staff_private.free_sale_cancellations(sale_id,actor_id,request_key,reason,cancelled_at)
  VALUES(f.sale_id,s.member_id,p_key,why,t) RETURNING * INTO e;
  IF EXISTS (SELECT FROM r4_staff_private.admission_term(m.id,f.starts_at,f.predecessor_order_id))
   OR NOT EXISTS (SELECT FROM r4_staff_private.finance_source v WHERE v.sale_id=f.sale_id
                  AND v.source='STAFF_FREE_CANCELLATION' AND v.amount_satang=0 AND v.recorded_at=t) THEN
   RAISE EXCEPTION 'Staff free cancellation reader mismatch' USING ERRCODE='55000'; END IF;
  IF clock_timestamp()>=f.starts_at THEN
   RAISE EXCEPTION 'Staff free term started during cancellation' USING ERRCODE='55000'; END IF;
 END IF;
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('saleId',e.sale_id,'source','STAFF_FREE_CANCELLATION','status','CANCELLED',
   'cancelledAt',e.cancelled_at,'amountSatang',0);
END $$;

-- Preserve the private sale-ID entry point; HTTP must use the member-bound entry point.
CREATE FUNCTION r4_staff_private.cancel_free_sale(p_session text,p_key uuid,p_sale uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
 RETURN r4_staff_private.cancel_free_sale_impl(p_session,p_key,p_sale,p_reason,NULL);
END $$;

CREATE FUNCTION r4_staff_private.cancel_member_free_sale(p_session text,p_code text,p_key uuid,p_sale uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
 IF p_code IS NULL OR p_code !~ '^BLU-[0-9]{1,12}$' THEN
  RAISE EXCEPTION 'Invalid member code' USING ERRCODE='22023'; END IF;
 RETURN r4_staff_private.cancel_free_sale_impl(p_session,p_key,p_sale,p_reason,p_code);
END $$;

REVOKE ALL ON r4_staff_private.free_sale_cancellations FROM PUBLIC;
REVOKE ALL ON FUNCTION r4_staff_private.reject_cancellation_mutation(),
 r4_staff_private.cancellation_owner_session(text),
 r4_staff_private.free_sale_cancellation_eligible(r4_staff_private.free_sales,public.members,timestamptz),
 r4_staff_private.list_free_sale_cancellations(text,text),
 r4_staff_private.cancel_free_sale_impl(text,uuid,uuid,text,text),
 r4_staff_private.cancel_member_free_sale(text,text,uuid,uuid,text),
 r4_staff_private.cancel_free_sale(text,uuid,uuid,text) FROM PUBLIC;
COMMIT;
