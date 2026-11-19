-- Apply AFTER 20261118_r3_package_catalog.sql, with the matching R3 application.
-- No order/member/checkin history writes. Keep original ENTRY_ONLY/replay/bounce,
-- auth and latest-PAID entitlement selection; only generalize daily time checks.
-- New order windows are [opening, closing), Bangkok local time. 24:00 closes the day.
-- Original paid snapshots retain the October closing instant and CLOSED reason.
-- Welcome-registration entry retains the existing 07:00 through 22:00 gate.
BEGIN;
SET LOCAL search_path=public,pg_catalog;
CREATE FUNCTION package_catalog_slot_allows(slot text,at_time time) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_catalog AS $$
 SELECT CASE WHEN coalesce(package_catalog_daily_slot_valid(slot),false) AND at_time IS NOT NULL THEN
 extract(epoch FROM at_time)>=extract(epoch FROM left(slot,5)::time)
 AND extract(epoch FROM at_time)<extract(epoch FROM right(slot,5)::time)
 ELSE false END
$$;
CREATE FUNCTION package_catalog_legacy_paid_slot(snapshot jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_catalog AS $$
 SELECT coalesce(NOT (snapshot ? 'r3HalfOpenTimeSlot')
  AND snapshot->>'timeSlot' IN ('07:00-14:00','07:00-22:00'),false)
$$;

-- October and R3 can quote identical slot text and snapshotVersion. Mark only
-- inserts, at the common catalog guard (including old callers); never backfill.
DO $policy$
DECLARE original text; anchor text := ' RETURN NEW;';
BEGIN
 IF EXISTS (SELECT FROM package_payment_orders WHERE package_snapshot ? 'r3HalfOpenTimeSlot') THEN
  RAISE EXCEPTION 'Historical r3HalfOpenTimeSlot metadata found; review before migration'; END IF;
 original:=pg_get_functiondef('public.guard_package_catalog_order_insert()'::regprocedure);
 IF (length(original)-length(replace(original,anchor,'')))<>length(anchor) THEN
  RAISE EXCEPTION 'Unexpected R3 catalog insert guard; review installed function'; END IF;
 EXECUTE replace(original,anchor,$stamp$ NEW.package_snapshot:=snapshot||'{"r3HalfOpenTimeSlot":true}'::jsonb;
 RETURN NEW;$stamp$);
END $policy$;

DO $upgrade$
DECLARE signature text; definition text; original text;
 slot_decl text := 'slot text; reason text;';
 slot_select text := $select$SELECT package_snapshot->>'timeSlot' INTO slot FROM package_payment_orders$select$;
 closed_gate text := $gate$ ELSIF local_time < time '07:00' OR local_time > time '22:00' THEN reason:='CLOSED';$gate$;
 old_time_check text := $old$IF m.status='ACTIVE' AND m.expire_date>t AND slot IN ('07:00-14:00','07:00-22:00') THEN
   IF slot='07:00-14:00' AND local_time>time '14:00' THEN reason:='OFF_PEAK';
   ELSE reason:='PAID_ENTRY'; END IF;
  ELSE
   SELECT id INTO c FROM coupons$old$;
 new_time_check text := $new$slot:=snapshot->>'timeSlot';
  IF m.status='ACTIVE' AND m.expire_date>t AND coalesce(package_catalog_daily_slot_valid(slot),false) THEN
   IF package_catalog_slot_allows(slot,local_time) THEN reason:='PAID_ENTRY';
   ELSIF package_catalog_legacy_paid_slot(snapshot) AND local_time=right(slot,5)::time THEN reason:='PAID_ENTRY';
   ELSIF package_catalog_legacy_paid_slot(snapshot) AND (local_time < time '07:00' OR local_time > time '22:00') THEN reason:='CLOSED';
   ELSE reason:='OFF_PEAK'; END IF;
  ELSIF local_time < time '07:00' OR local_time > time '22:00' THEN reason:='CLOSED';
  ELSE
   SELECT id INTO c FROM coupons$new$;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.kiosk_checkin(text,text,uuid,text)','public.real_frontdesk_checkin(text,text,uuid,text)'] LOOP
  original:=pg_get_functiondef(signature::regprocedure);
  -- Exact, single source anchors: refuse drift rather than silently changing
  -- a different deployed entitlement/auth implementation.
  IF (length(original)-length(replace(original,closed_gate,'')))<>length(closed_gate)
  OR (length(original)-length(replace(original,slot_decl,'')))<>length(slot_decl)
  OR (length(original)-length(replace(original,slot_select,'')))<>length(slot_select)
  OR (length(original)-length(replace(original,old_time_check,'')))<>length(old_time_check) THEN
   RAISE EXCEPTION 'Unexpected R3 checkin source: %; review installed function',signature;
  END IF;
  definition:=replace(replace(original,closed_gate,''),old_time_check,new_time_check);
  definition:=replace(replace(definition,slot_decl,'slot text; snapshot jsonb; reason text;'),
   slot_select,'SELECT package_snapshot INTO snapshot FROM package_payment_orders');
  EXECUTE definition;
 END LOOP;
END $upgrade$;
REVOKE ALL ON FUNCTION package_catalog_slot_allows(text,time),package_catalog_legacy_paid_slot(jsonb) FROM PUBLIC;
COMMIT;
