-- Apply AFTER 20261118_r3_package_catalog.sql, with the matching R3 application.
-- No order/member/checkin history writes. Keep original ENTRY_ONLY/replay/bounce,
-- auth and latest-PAID entitlement selection; only generalize daily time checks.
-- Paid windows are [opening, closing), Bangkok local time. 24:00 closes the day.
-- Welcome-registration entry retains the existing 07:00 through 22:00 gate.
BEGIN;
CREATE FUNCTION package_catalog_slot_allows(slot text,at_time time) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_catalog AS $$
 SELECT CASE WHEN coalesce(package_catalog_daily_slot_valid(slot),false) AND at_time IS NOT NULL THEN
 extract(epoch FROM at_time)>=extract(epoch FROM left(slot,5)::time)
 AND extract(epoch FROM at_time)<extract(epoch FROM right(slot,5)::time)
 ELSE false END
$$;
DO $upgrade$
DECLARE signature text; definition text; original text;
 closed_gate text := $gate$ ELSIF local_time < time '07:00' OR local_time > time '22:00' THEN reason:='CLOSED';$gate$;
 old_time_check text := $old$IF m.status='ACTIVE' AND m.expire_date>t AND slot IN ('07:00-14:00','07:00-22:00') THEN
   IF slot='07:00-14:00' AND local_time>time '14:00' THEN reason:='OFF_PEAK';
   ELSE reason:='PAID_ENTRY'; END IF;
  ELSE
   SELECT id INTO c FROM coupons$old$;
 new_time_check text := $new$IF m.status='ACTIVE' AND m.expire_date>t AND coalesce(package_catalog_daily_slot_valid(slot),false) THEN
   IF package_catalog_slot_allows(slot,local_time) THEN reason:='PAID_ENTRY';
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
  OR (length(original)-length(replace(original,old_time_check,'')))<>length(old_time_check) THEN
   RAISE EXCEPTION 'Unexpected R3 checkin source: %; review installed function',signature;
  END IF;
  definition:=replace(replace(original,closed_gate,''),old_time_check,new_time_check);
  EXECUTE definition;
 END LOOP;
END $upgrade$;
REVOKE ALL ON FUNCTION package_catalog_slot_allows(text,time) FROM PUBLIC;
COMMIT;
