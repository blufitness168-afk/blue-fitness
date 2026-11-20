-- Prepare only. Requires the October benefits/catalog chain and catalog INSERT guard.
-- No backfill. Coupon activation and payment settlement routines are not replaced.
BEGIN;
SET LOCAL search_path=public,pg_catalog;
SET LOCAL lock_timeout='5s';

ALTER TABLE public.benefit_definitions
 ADD COLUMN max_satang integer,
 ADD COLUMN eligible_package_ids integer[],
 ADD CONSTRAINT benefit_promo_scope_check CHECK (
   (max_satang IS NULL OR (kind='PROMO' AND max_satang BETWEEN min_satang AND 100000000))
   AND (eligible_package_ids IS NULL OR (kind='PROMO' AND array_ndims(eligible_package_ids)=1
     AND cardinality(eligible_package_ids) BETWEEN 1 AND 100
     AND array_position(eligible_package_ids,NULL) IS NULL AND 0 < ALL(eligible_package_ids))));

-- Separate entry point keeps both legacy create/replay and the coupon activation
-- migration independent. The same actor lock and audit key fence both writers.
CREATE FUNCTION public.r6_create_scoped_promo(p_session text,p_key uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
DECLARE s auth_sessions; actor members; prior benefit_action_audit; d benefit_definitions;
 maximum integer; ids integer[]; matched integer; deadline timestamptz; result jsonb;
BEGIN
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session FOR SHARE;
 SELECT * INTO actor FROM members WHERE id=s.member_id FOR UPDATE;
 IF s.id IS NULL OR s.mode<>'NORMAL' OR s.revoked_at IS NOT NULL OR s.expires_at<=clock_timestamp()
 OR actor.id IS NULL OR actor.status='SUSPENDED' OR actor.role NOT IN ('ADMIN','OWNER') THEN
  RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid promo request' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM benefit_action_audit WHERE actor_id=actor.id AND request_key=p_key;
 IF FOUND THEN
  IF prior.action IS DISTINCT FROM 'create_r6_promo' OR prior.payload IS DISTINCT FROM p_payload THEN
   RAISE EXCEPTION 'Request key reused' USING ERRCODE='22023'; END IF;
  RETURN prior.result;
 END IF;
 IF p_payload->>'kind' IS DISTINCT FROM 'PROMO'
 OR NOT (p_payload ?& ARRAY['title','code','discountType','discountValue','minSatang','maxDiscountSatang','usageLimit','expiresAt'])
 OR NOT (p_payload ?| ARRAY['maxSatang','eligiblePackageIds'])
 OR EXISTS(SELECT FROM jsonb_each(p_payload) e WHERE CASE
   WHEN e.key IN ('kind','title','code','discountType','expiresAt') THEN jsonb_typeof(e.value)<>'string'
   WHEN e.key IN ('minSatang','discountValue','usageLimit') THEN jsonb_typeof(e.value)<>'number' OR e.value::text !~ '^(0|[1-9][0-9]{0,8})$'
   WHEN e.key IN ('maxSatang','maxDiscountSatang') THEN e.value<>'null'::jsonb AND (jsonb_typeof(e.value)<>'number' OR e.value::text !~ '^(0|[1-9][0-9]{0,8})$')
   WHEN e.key='eligiblePackageIds' THEN jsonb_typeof(e.value) NOT IN ('null','array')
   ELSE true END) THEN
  RAISE EXCEPTION 'Invalid promo fields' USING ERRCODE='22023'; END IF;
 maximum:=(p_payload->>'maxSatang')::integer;
 IF maximum IS NOT NULL AND maximum NOT BETWEEN (p_payload->>'minSatang')::integer AND 100000000 THEN
  RAISE EXCEPTION 'Invalid maximum subtotal' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_payload->'eligiblePackageIds')='array' THEN
  IF jsonb_array_length(p_payload->'eligiblePackageIds') NOT BETWEEN 1 AND 100 OR EXISTS(
    SELECT FROM jsonb_array_elements(p_payload->'eligiblePackageIds') e(value)
    WHERE jsonb_typeof(e.value)<>'number' OR e.value::text !~ '^[1-9][0-9]{0,9}$') THEN
   RAISE EXCEPTION 'Invalid eligible package IDs' USING ERRCODE='22023'; END IF;
  SELECT array_agg(value::integer ORDER BY value::integer) INTO ids
   FROM jsonb_array_elements_text(p_payload->'eligiblePackageIds');
  -- Count after locking: rejects duplicates, missing and inactive IDs.
  SELECT count(*) INTO matched FROM (
   SELECT id FROM package_catalog WHERE id=ANY(ids) AND is_active ORDER BY id FOR SHARE
  ) active_packages;
  IF matched<>cardinality(ids) THEN
   RAISE EXCEPTION 'Invalid or unavailable eligible packages' USING ERRCODE='22023'; END IF;
 END IF;
 deadline:=(p_payload->>'expiresAt')::timestamptz;
 IF NOT isfinite(deadline) OR deadline<=clock_timestamp() THEN
  RAISE EXCEPTION 'Expired definition' USING ERRCODE='22023'; END IF;
 INSERT INTO benefit_definitions(kind,title,code,discount_type,discount_value,min_satang,max_satang,
   eligible_package_ids,max_discount_satang,usage_limit,expires_at,created_by)
 VALUES('PROMO',btrim(p_payload->>'title'),p_payload->>'code',p_payload->>'discountType',
   (p_payload->>'discountValue')::integer,(p_payload->>'minSatang')::integer,maximum,ids,
   (p_payload->>'maxDiscountSatang')::integer,(p_payload->>'usageLimit')::integer,deadline,actor.id)
 RETURNING * INTO d;
 result:=to_jsonb(d);
 INSERT INTO benefit_action_audit(actor_id,request_key,action,payload,result)
 VALUES(actor.id,p_key,'create_r6_promo',p_payload,result);
 RETURN result;
END $$;

CREATE FUNCTION public.r6_promo_scope_allows(p_maximum integer,p_packages integer[],p_package jsonb,p_subtotal integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_catalog AS $$
 SELECT (p_maximum IS NULL OR coalesce(p_subtotal<=p_maximum,false))
    AND (p_packages IS NULL OR coalesce(to_jsonb(p_packages) @> jsonb_build_array(p_package),false));
$$;

CREATE FUNCTION public.r6_assert_promo_scope(p_code text,p_package jsonb,p_subtotal integer)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
DECLARE d benefit_definitions;
BEGIN
 IF p_code IS NULL THEN RETURN; END IF;
 -- Use the same lock as reservation immediately, not SHARE followed by upgrade.
 SELECT * INTO d FROM benefit_definitions WHERE code=p_code AND kind='PROMO' FOR UPDATE;
 IF d.id IS NULL OR NOT r6_promo_scope_allows(d.max_satang,d.eligible_package_ids,p_package,p_subtotal) THEN
  RAISE EXCEPTION 'Promo unavailable' USING ERRCODE='P0001'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.r6_create_scoped_promo(text,uuid,jsonb),
 public.r6_promo_scope_allows(integer,integer[],jsonb,integer),
 public.r6_assert_promo_scope(text,jsonb,integer) FROM PUBLIC;

-- Keep installed ACLs/OIDs and October/R3 catalog behavior. Fingerprint the
-- October bodies and their R3 check-in/bonus variants before patching.
LOCK TABLE public.package_payment_orders IN ACCESS EXCLUSIVE MODE;
DO $migration$
DECLARE patch record; original text; updated text; signature regprocedure;
BEGIN
 IF NOT EXISTS (SELECT FROM pg_trigger WHERE tgrelid='public.package_payment_orders'::regclass
   AND tgname='package_catalog_order_insert_guard' AND tgtype=7 AND NOT tgisinternal
   AND tgenabled IN ('O','A') AND tgqual IS NULL AND tgnargs=0
   AND tgfoid=to_regprocedure('public.guard_package_catalog_order_insert()')) THEN
  RAISE EXCEPTION 'Expected enabled catalog INSERT guard'; END IF;
 FOR patch IN SELECT * FROM (VALUES
  ('create_catalog_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb)',
   ARRAY['8b239eaa43d468c92c68cc085925c246','683fa1b082bcc31f7e8d59a38a5638ac'],
   $old$ q:=jsonb_build_object('package',$old$,
   $new$ PERFORM public.r6_assert_promo_scope(code,to_jsonb(c.id),c.price_satang);
 q:=jsonb_build_object('package',$new$),
  ('create_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb)',
   ARRAY['f4029ce6d044072dcd34597728587398','fb4c9f2e980f29f223e43472234c3209'],
   $old$ -- One use per assignment;$old$,
   $new$ IF NOT public.r6_promo_scope_allows(d.max_satang,d.eligible_package_ids,p_quote->'package'->'id',subtotal) THEN
  RAISE EXCEPTION 'Promo unavailable' USING ERRCODE='P0001'; END IF;
 -- One use per assignment;$new$),
  ('guard_package_catalog_order_insert()',
   ARRAY['68ce6d838f070ee9278c250ba16f297c','e62fc2dd12ca3ea3fe26e33a592d0843','3fd73f94f141bfe425add34263cccb44'],
   $old$ IF snapshot ? 'snapshotVersion' THEN$old$,
   $new$ IF NEW.promo_code IS DISTINCT FROM NEW.promo_snapshot->>'code' THEN
  RAISE EXCEPTION 'Promo snapshot/code mismatch' USING ERRCODE='P0001'; END IF;
 PERFORM public.r6_assert_promo_scope(NEW.promo_code,to_jsonb(c.id),c.price_satang);
 IF snapshot ? 'snapshotVersion' THEN$new$)
 ) AS p(function_signature,allowed_bodies,old_text,new_text)
 LOOP
  signature:=to_regprocedure('public.'||patch.function_signature);
  SELECT pg_get_functiondef(oid) INTO original FROM pg_proc WHERE oid=signature AND NOT prosecdef
   AND proconfig=ARRAY['search_path=public, pg_catalog']
   AND md5(replace(prosrc,chr(13),''))=ANY(patch.allowed_bodies);
  IF original IS NULL OR (length(original)-length(replace(original,patch.old_text,'')))<>length(patch.old_text) THEN
   RAISE EXCEPTION 'Unexpected baseline for %; review before migration',patch.function_signature; END IF;
  updated:=replace(original,patch.old_text,patch.new_text);
  EXECUTE updated;
  IF pg_get_functiondef(signature) IS DISTINCT FROM updated THEN
   RAISE EXCEPTION 'Unexpected rewrite of %',patch.function_signature; END IF;
 END LOOP;
END $migration$;
COMMIT;
