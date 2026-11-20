-- PREPARE ONLY. Apply after foundation/admission and the chosen finance baseline.
-- Read integration only; no grants, backfill, writer, or data changes.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $upgrade$
DECLARE
 p pg_proc;
 anchor constant text := E' FROM finance_entries WHERE deleted_at IS NULL\n UNION ALL';
 staff_union constant text := $staff$
 UNION ALL
 SELECT f.source_id,f.entry_date::text,f.type,'ต่อสมาชิก',f.amount_satang::numeric/100,
        f.source||' · '||f.source_id,f.source,f.recorded_at,0,m.member_code,m.full_name
 FROM r4_staff_private.finance_source f JOIN public.members m ON m.id=f.member_id
$staff$;
 definition text;
BEGIN
 IF NOT EXISTS (SELECT FROM pg_class WHERE oid=to_regclass('r4_staff_private.finance_source') AND relkind='v')
 OR to_regprocedure('r4_staff_private.admission_term(integer,timestamp with time zone,uuid)') IS NULL THEN
  RAISE EXCEPTION 'R4 staff finance requires the foundation view and staff admission';
 END IF;
 -- Resolve the published producer columns now, not on the first OWNER read.
 PERFORM f.source_id,f.entry_date,f.type,f.amount_satang,f.source,f.recorded_at,f.member_id
 FROM r4_staff_private.finance_source f LIMIT 0;

 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public.real_finance_action(text,text,uuid,jsonb)');
 -- Exact October and R5 bodies (ignoring CRLF). Do not overwrite local changes,
 -- especially altered session gates or a finance reader already composed with R4.
 IF NOT FOUND OR md5(replace(p.prosrc,E'\r\n',E'\n')) NOT IN (
   '6c9ff102389f744b81bdb06a1158bd12', -- 20261024_real_finance
   '53ead5de91e3d125f658b64d23741fbc'  -- 20261118_R5_finance
 ) OR p.prorettype<>'jsonb'::regtype OR p.prosecdef OR p.provolatile<>'v' OR p.proisstrict
 OR p.proretset OR p.proparallel<>'u' OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_catalog']
 OR EXISTS (SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))
            WHERE grantee=0 AND privilege_type='EXECUTE') THEN
  RAISE EXCEPTION 'Unreviewed finance function; expected the private October or R5 invoker';
 END IF;
 definition:=replace(pg_get_functiondef(p.oid),E'\r\n',E'\n');
 IF length(definition)-length(replace(definition,anchor,'')) <> length(anchor) THEN
  RAISE EXCEPTION 'Unexpected finance read anchor';
 END IF;
 -- Same function OID/ACL and same OWNER gate, audit, and mutation code.
 EXECUTE replace(definition,anchor,
  E' FROM finance_entries WHERE deleted_at IS NULL' || rtrim(staff_union,E'\n') || E'\n UNION ALL');
END $upgrade$;
COMMIT;
