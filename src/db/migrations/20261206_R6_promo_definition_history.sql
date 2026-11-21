-- Prepare only; append after the R6 campaign/checkout and R36 targeting migration.
BEGIN;
SET LOCAL search_path=public,pg_catalog;
SET LOCAL lock_timeout='5s';

ALTER TABLE public.benefit_definitions
 ADD COLUMN promo_description text,
 ADD COLUMN promo_recipient_limit integer,
 ADD CONSTRAINT r6_promo_definition_details CHECK (
   (promo_description IS NULL OR (kind='PROMO' AND length(btrim(promo_description)) BETWEEN 1 AND 500))
   AND (promo_recipient_limit IS NULL OR (kind='PROMO' AND promo_recipient_limit BETWEEN 1 AND 1000000)));

-- Update only the scoped definition writer. Preserve both old audit receipts and its ACL.
DO $patch$
DECLARE ddl text; p record;
BEGIN
 SELECT replace(pg_get_functiondef(oid),chr(13),'') INTO ddl FROM pg_proc
 WHERE oid=to_regprocedure('public.r6_create_scoped_promo(text,uuid,jsonb)') AND NOT prosecdef;
 FOR p IN SELECT * FROM (VALUES
  ($old$ARRAY['maxSatang','eligiblePackageIds']$old$,
   $new$ARRAY['maxSatang','eligiblePackageIds','promoDescription','promoRecipientLimit']$new$),
  ($old$   WHEN e.key='eligiblePackageIds' THEN$old$,
   $new$   WHEN e.key='promoDescription' THEN jsonb_typeof(e.value)<>'string' OR length(btrim(e.value #>> '{}')) NOT BETWEEN 1 AND 500
   WHEN e.key='promoRecipientLimit' THEN e.value<>'null'::jsonb AND (jsonb_typeof(e.value)<>'number' OR e.value::text !~ '^[1-9][0-9]{0,6}$')
   WHEN e.key='eligiblePackageIds' THEN$new$),
  ($old$eligible_package_ids,max_discount_satang,usage_limit,expires_at,created_by)$old$,
   $new$eligible_package_ids,max_discount_satang,usage_limit,expires_at,created_by,promo_description,promo_recipient_limit)$new$),
  ($old$deadline,actor.id)
 RETURNING * INTO d;$old$,
   $new$deadline,actor.id,btrim(p_payload->>'promoDescription'),(p_payload->>'promoRecipientLimit')::integer)
 RETURNING * INTO d;$new$)
 ) AS x(anchor,replacement) LOOP
  IF ddl IS NULL OR length(ddl)-length(replace(ddl,p.anchor,''))<>length(p.anchor) THEN
   RAISE EXCEPTION 'Unexpected scoped promo writer' USING ERRCODE='0A000'; END IF;
  ddl:=replace(ddl,p.anchor,p.replacement);
 END LOOP;
 EXECUTE ddl;
END $patch$;

-- One lifetime assignment per promo/member, including cancelled assignments.
-- Check at INSERT, including confirmation vs. another staff member's concurrent grant.
CREATE FUNCTION public.r6_guard_promo_recipient_limit() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE cap integer;
BEGIN
 SELECT promo_recipient_limit INTO cap FROM benefit_definitions WHERE id=NEW.definition_id AND kind='PROMO' FOR UPDATE;
 IF cap IS NULL THEN RETURN NEW; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Promo recipient limit requires READ COMMITTED' USING ERRCODE='0A000'; END IF;
 IF (SELECT count(*) FROM benefit_assignments WHERE definition_id=NEW.definition_id)>=cap THEN
  RAISE EXCEPTION 'Promo recipient quota reached' USING ERRCODE='P6001'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER r6_guard_promo_recipient_limit BEFORE INSERT ON public.benefit_assignments
 FOR EACH ROW EXECUTE FUNCTION public.r6_guard_promo_recipient_limit();
CREATE INDEX r6_promo_assignment_member_history ON public.benefit_assignments(member_id,id DESC) WHERE coupon_id IS NULL;
CREATE INDEX r6_promo_reservation_assignment ON public.benefit_promo_reservations(assignment_id);

-- Show assignment facts and payment state only; never expose orders, prices actually paid, slips or audits.
CREATE FUNCTION public.r6_promo_history(p_session text,p_staff boolean,p_before integer,p_member_code text,
 p_name text,p_code text,p_status text,p_days integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public,pg_catalog AS $$
DECLARE viewer integer; result jsonb; t timestamptz:=statement_timestamp();
BEGIN
 SELECT m.id INTO viewer FROM auth_sessions s JOIN members m ON m.id=s.member_id
 WHERE s.token_hash=p_session AND s.mode='NORMAL' AND s.revoked_at IS NULL AND s.expires_at>t
 AND m.status<>'SUSPENDED' AND (NOT p_staff OR m.role IN ('ADMIN','OWNER'));
 IF viewer IS NULL OR p_staff IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 WITH page AS MATERIALIZED (
   SELECT a.id,m.member_code,m.full_name,a.created_at AS issued_at,a.recipient_duration_days,d.title,d.code,
     d.promo_description AS description,d.expires_at,d.discount_type,d.discount_value,d.min_satang,d.max_satang,
     d.max_discount_satang,d.eligible_package_ids,u.used_at,h.status
   FROM benefit_assignments a JOIN benefit_definitions d ON d.id=a.definition_id JOIN members m ON m.id=a.member_id
   CROSS JOIN LATERAL (
     SELECT bool_or(o.status='PAID') AS used, max(o.confirmed_at) FILTER (WHERE o.status='PAID') AS used_at,
       bool_or(o.status='PENDING' AND (o.upload_deadline>t OR EXISTS (
         SELECT FROM package_payment_attempts x WHERE x.order_id=o.id AND x.state IN ('PROCESSING','UNKNOWN','VERIFIED')))) AS reserved
     FROM benefit_promo_reservations r JOIN package_payment_orders o ON o.id=r.order_id
     WHERE r.assignment_id=a.id AND o.member_id=a.member_id AND o.promo_code=d.code
   ) u
   CROSS JOIN LATERAL (SELECT CASE WHEN u.used THEN 'USED' WHEN u.reserved THEN 'RESERVED'
     WHEN a.cancelled_at IS NOT NULL THEN 'CANCELLED' WHEN d.expires_at<=t THEN 'EXPIRED'
     WHEN NOT d.active THEN 'DISABLED' ELSE 'ASSIGNED' END AS status) h
   WHERE d.kind='PROMO' AND a.coupon_id IS NULL AND (p_staff OR m.id=viewer) AND (p_before IS NULL OR a.id<p_before)
     AND (p_member_code IS NULL OR m.member_code=p_member_code)
     AND (p_name IS NULL OR strpos(lower(d.title),lower(p_name))>0)
     AND (p_code IS NULL OR d.code=p_code) AND (p_status IS NULL OR h.status=p_status)
     AND (p_days IS NULL OR a.recipient_duration_days=p_days)
   ORDER BY a.id DESC LIMIT 51
 ), shown AS MATERIALIZED (SELECT * FROM page ORDER BY id DESC LIMIT 50)
 SELECT jsonb_build_object('rows',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY id DESC) FROM shown x),'[]'::jsonb),
   'nextBefore',CASE WHEN (SELECT count(*) FROM page)>50 THEN (SELECT min(id) FROM shown) END) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.r6_guard_promo_recipient_limit(), public.r6_promo_history(text,boolean,integer,text,text,text,text,integer) FROM PUBLIC;
COMMIT;
