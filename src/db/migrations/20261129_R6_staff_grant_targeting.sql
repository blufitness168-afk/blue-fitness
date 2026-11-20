-- PREPARE ONLY. Reuse R3 standalone online proof; never classify by latest order or catalog label.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog;

DO $patch$
DECLARE fn oid := to_regprocedure('public.real_benefits_admin_action(text,text,uuid,jsonb)');
 proof oid := to_regprocedure('public.r3_override_current_order(integer,timestamptz)');
 ddl text; r record;
BEGIN
 IF to_regclass('public.member_cards') IS NULL OR NOT EXISTS (
   SELECT FROM pg_proc WHERE oid=proof AND NOT prosecdef AND provolatile='s'
    AND proconfig=ARRAY['search_path=public, pg_catalog']
    AND md5(replace(prosrc,chr(13),'')) IN ('6ef9802f4dffa1d5215ba72bfa8e1d73','21fa307486660f5c7c9090e2052bd0e2')
 ) THEN RAISE EXCEPTION 'Expected R2 CARD and reviewed R3 entitlement proof' USING ERRCODE='0A000'; END IF;
 SELECT replace(pg_get_functiondef(oid),chr(13),'') INTO ddl FROM pg_proc WHERE oid=fn
   AND NOT prosecdef AND proconfig=ARRAY['search_path=public, pg_catalog']
   AND md5(replace(prosrc,chr(13),''))='04dfb000e81cf8dd751ecf57a079d4a6';
 IF ddl IS NULL THEN RAISE EXCEPTION 'Expected reviewed R6 activation benefits action' USING ERRCODE='0A000'; END IF;

 FOR r IN SELECT * FROM (VALUES
 ($old$old_expiry timestamptz; t timestamptz;$old$,
  $new$old_expiry timestamptz; t timestamptz;
 main_order package_payment_orders%ROWTYPE; recipient_group text; duration integer; fingerprint text;
 lookup_code text; excluded boolean;$new$),
 ($old$IF p_action NOT IN ('list','create','deactivate','grant','cancel','consume','create_r6_coupon')$old$,
  $new$IF p_action IS NULL OR p_action NOT IN ('list','create','deactivate','grant','grant_targeted','grant_preview','cancel','consume','create_r6_coupon')$new$),
 ($old$'couponActivationReady',true,$old$, $new$'couponActivationReady',true,'grantTargetingReady',true,$new$),
 ($old$ IF p_key IS NULL THEN$old$, $new$ IF p_action<>'grant_preview' THEN
 IF p_key IS NULL THEN$new$),
 ($old$ IF prior.action<>p_action OR prior.payload<>p_payload THEN$old$,
  $new$ IF prior.action IS DISTINCT FROM p_action OR prior.payload IS DISTINCT FROM p_payload THEN$new$),
 ($old$ RETURN prior.result; END IF;$old$, $new$ RETURN prior.result; END IF;
 END IF;$new$),
 ($old$ ELSIF p_action='grant' THEN
 SELECT * INTO target FROM members WHERE member_code=p_payload->>'memberCode' FOR UPDATE;
 IF target.id IS NULL OR target.status='SUSPENDED' THEN RAISE EXCEPTION 'Member unavailable'; END IF;
 SELECT * INTO d FROM benefit_definitions WHERE id=(p_payload->>'definitionId')::integer FOR UPDATE;
 IF d.id IS NULL OR NOT d.active OR d.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Definition unavailable'; END IF;
 SELECT * INTO a FROM benefit_assignments WHERE definition_id=d.id AND member_id=target.id;
 IF FOUND THEN RAISE EXCEPTION 'Already assigned'; END IF;$old$,
  $new$ ELSIF p_action='grant' THEN
 RAISE EXCEPTION 'New grants require targeting' USING ERRCODE='22023';
 ELSIF p_action IN ('grant_preview','grant_targeted') THEN
 -- Entitlement writers serialize on members; eligibility must see their committed changes after waits.
 IF current_setting('transaction_isolation')<>'read committed' THEN
   RAISE EXCEPTION 'Grant targeting requires READ COMMITTED' USING ERRCODE='0A000'; END IF;
 lookup_code := p_payload->>'memberCode';
 recipient_group := p_payload->>'recipientGroup';
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
 OR (p_payload - ARRAY['definitionId','memberCode','recipientGroup','proof']) <> '{}'::jsonb
 OR jsonb_typeof(p_payload->'definitionId') IS DISTINCT FROM 'number'
 OR (p_payload->>'definitionId') !~ '^[1-9][0-9]{0,9}$'
 OR jsonb_typeof(p_payload->'memberCode') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_payload->'recipientGroup') IS DISTINCT FROM 'string'
 OR recipient_group NOT IN ('ALL','1','30','90','180','365')
 OR (p_action='grant_preview' AND (p_key IS NOT NULL OR p_payload ? 'proof' OR lookup_code !~ '^(BLU-[0-9]{1,12}|CARD-[0-9]{1,95})$'))
 OR (p_action='grant_targeted' AND (lookup_code !~ '^BLU-[0-9]{1,12}$'
     OR jsonb_typeof(p_payload->'proof') IS DISTINCT FROM 'string' OR (p_payload->>'proof') !~ '^[a-f0-9]{64}$'))
 THEN RAISE EXCEPTION 'Invalid grant targeting payload' USING ERRCODE='22023'; END IF;
 IF lookup_code LIKE 'CARD-%' THEN
   SELECT m.* INTO target FROM public.member_cards mc JOIN members m ON m.id=mc.member_id
     WHERE mc.card_code=lookup_code FOR UPDATE OF m;
   IF NOT EXISTS (SELECT FROM public.member_cards WHERE card_code=lookup_code AND member_id=target.id)
   THEN RAISE EXCEPTION 'Card unavailable'; END IF;
 ELSE
   SELECT * INTO target FROM members WHERE member_code=lookup_code FOR UPDATE;
 END IF;
 IF target.id IS NULL OR target.role<>'MEMBER' OR target.status<>'ACTIVE'
 OR target.member_code !~ '^BLU-[0-9]{1,12}$' THEN RAISE EXCEPTION 'Member unavailable'; END IF;
 SELECT * INTO d FROM benefit_definitions WHERE id=(p_payload->>'definitionId')::integer FOR UPDATE;
 IF d.id IS NULL OR NOT d.active THEN RAISE EXCEPTION 'Definition unavailable'; END IF;
 IF EXISTS (SELECT FROM benefit_assignments WHERE definition_id=d.id AND member_id=target.id)
 THEN RAISE EXCEPTION 'Already assigned'; END IF;
 -- Do not infer precedence for staff terms, mixed history, in-flight purchases, or refunds.
 -- Read the optional ledgers only on stacks that have them. Missing required privileges fail closed.
 IF to_regnamespace('r4_staff_private') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS (SELECT FROM r4_staff_private.free_sales WHERE member_id=$1)' INTO excluded USING target.id;
   IF excluded THEN RAISE EXCEPTION 'Staff term history is not supported'; END IF;
 END IF;
 IF (SELECT count(*) FROM package_payment_orders WHERE member_id=target.id AND status='PAID')<>1
 OR EXISTS (SELECT FROM package_payment_orders WHERE member_id=target.id AND status='PENDING')
 THEN RAISE EXCEPTION 'Unproven current package'; END IF;
 t:=clock_timestamp();
 IF s.expires_at<=t THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 IF d.expires_at<=t THEN RAISE EXCEPTION 'Definition unavailable'; END IF;
 SELECT * INTO main_order FROM public.r3_override_current_order(target.id,t);
 IF main_order.id IS NULL OR NOT isfinite(main_order.membership_expires_at)
 OR NOT isfinite(main_order.confirmed_at) OR jsonb_typeof(main_order.package_snapshot->'durationDays') IS DISTINCT FROM 'number'
 THEN RAISE EXCEPTION 'Unproven current package'; END IF;
 IF to_regclass('r4_online_private.cancellations') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS (SELECT FROM r4_online_private.cancellations WHERE order_id=$1)' INTO excluded USING main_order.id;
   IF excluded THEN RAISE EXCEPTION 'Order cancelled'; END IF;
 END IF;
 duration := (main_order.package_snapshot->>'durationDays')::integer;
 IF duration NOT BETWEEN 1 AND 3660 THEN RAISE EXCEPTION 'Unproven package duration'; END IF;
 IF recipient_group<>'ALL' AND recipient_group<>duration::text THEN RAISE EXCEPTION 'Package group mismatch'; END IF;
 -- Bind confirmation to the named recipient and the reviewed term, without returning order identifiers.
 fingerprint := encode(sha256(convert_to(jsonb_build_array(actor.id,d.id,target.id,target.member_code,recipient_group,
   main_order.id,duration,extract(epoch FROM main_order.membership_expires_at))::text,'UTF8')),'hex');
 IF p_action='grant_preview' THEN
   RETURN jsonb_build_object('definitionId',d.id,'definitionTitle',d.title,'memberCode',target.member_code,
     'fullName',target.full_name,'recipientGroup',recipient_group,'durationDays',duration,
     'packageExpiresAt',main_order.membership_expires_at,'proof',fingerprint);
 END IF;
 IF (p_payload->>'proof') IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Grant preview changed'; END IF;$new$)
 ) AS patch(anchor, replacement) LOOP
   IF length(ddl)-length(replace(ddl,r.anchor,''))<>length(r.anchor) THEN
     RAISE EXCEPTION 'Unexpected benefits function anchor' USING ERRCODE='0A000'; END IF;
   ddl := replace(ddl,r.anchor,r.replacement);
 END LOOP;
 EXECUTE ddl;
END $patch$;
COMMIT;
