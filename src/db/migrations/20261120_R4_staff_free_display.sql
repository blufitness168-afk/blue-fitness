-- PREPARE ONLY: additive read projection, after R4 foundation + admission.
BEGIN;
SET LOCAL search_path = pg_catalog;

DO $$ BEGIN
 IF to_regclass('r4_staff_private.free_sales') IS NULL OR
    to_regprocedure('r4_staff_private.admission_term(integer,timestamptz,uuid)') IS NULL THEN
  RAISE EXCEPTION 'R4 staff display requires foundation and admission';
 END IF;
END $$;

CREATE FUNCTION r4_staff_private.display_terms(p_session text, p_target_code text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog SET timezone = 'UTC' AS $$
DECLARE
 t timestamptz := statement_timestamp();
 actor_id integer; actor_role text; target_id integer;
 online_order uuid; term_kind text; term_id uuid;
BEGIN
 SELECT m.id, m.role INTO actor_id, actor_role
 FROM public.auth_sessions s JOIN public.members m ON m.id=s.member_id
 WHERE s.token_hash=p_session AND s.mode='NORMAL' AND s.revoked_at IS NULL
   AND s.expires_at>t AND m.status<>'SUSPENDED';

 IF actor_role='MEMBER' AND p_target_code IS NULL THEN
  target_id := actor_id;
 ELSIF actor_role IN ('ADMIN','OWNER') AND p_target_code IS NOT NULL THEN
  SELECT m.id INTO target_id FROM public.members m WHERE m.member_code=p_target_code AND m.role='MEMBER';
 ELSE
  RAISE EXCEPTION 'Live normal member or staff session required' USING ERRCODE='42501';
 END IF;

 IF EXISTS (SELECT FROM r4_staff_private.free_sales s
             WHERE s.member_id=target_id AND s.starts_at<=t AND s.ends_at>t) THEN
  -- Same PAID ordering as both admission paths. Reuse the stable proof on
  -- this statement's snapshot, without admission's lock/side effects or slot gate.
  SELECT o.id INTO online_order FROM public.package_payment_orders o
  WHERE o.member_id=target_id AND o.status='PAID'
  ORDER BY o.paid_at DESC NULLS LAST,o.created_at DESC,o.id DESC LIMIT 1;
  SELECT a.source_kind, a.source_id INTO term_kind, term_id
  FROM r4_staff_private.admission_term(target_id,t,online_order) a;
 END IF;

 RETURN COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
   'packageName',s.package_name,'startsAt',s.starts_at,'endsAt',s.ends_at,'dailySlot',s.daily_slot,
   'status',CASE WHEN s.starts_at>t THEN 'SCHEDULED'
                 WHEN term_kind='STAFF_FREE' AND term_id=s.sale_id THEN 'ACTIVE'
                 WHEN term_kind='ONLINE_PAID' THEN 'SUPERSEDED'
                 ELSE 'BLOCKED' END
  ) ORDER BY s.starts_at,s.sale_id)
  FROM r4_staff_private.free_sales s WHERE s.member_id=target_id AND s.ends_at>t
 ),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION r4_staff_private.display_terms(text,text) FROM PUBLIC;
COMMIT;
