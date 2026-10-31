-- PREPARE ONLY: apply after 20261031_package_catalog.sql. No historical rewrite.
BEGIN;
CREATE FUNCTION guard_package_catalog_order_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
DECLARE c public.package_catalog; expected jsonb; snapshot jsonb := NEW.package_snapshot;
BEGIN
 -- FOR KEY SHARE is insufficient: OWNER edits do not change the catalog key.
 -- Hold SHARE until transaction end so validation and INSERT serialize with
 -- OWNER's FOR UPDATE (and ordinary non-key UPDATE). Never lock members here:
 -- both creators and OWNER already take member/session locks before catalog.
 SELECT * INTO c FROM public.package_catalog
 WHERE to_jsonb(id)=snapshot->'id' FOR SHARE;
 IF c.id IS NULL OR NOT c.is_active THEN
 RAISE EXCEPTION 'Package unavailable' USING ERRCODE='P0001'; END IF;
 expected := jsonb_build_object('id',c.id,'name',c.name,'label',c.label,
 'description',c.description,'price',c.price_satang::numeric/100,
 'durationDays',c.duration_days,'timeSlot',c.time_slot,
 'friendCoupons',c.friend_quota,'bonusDays',c.bonus_days,'isActive',c.is_active);
 -- Containment requires every common field, including its JSON type; extra
 -- metadata is allowed for legacy compatibility. Missing/null fields fail closed.
 IF NOT (snapshot @> expected) OR NEW.subtotal_satang IS DISTINCT FROM c.price_satang THEN
 RAISE EXCEPTION 'Package snapshot does not match current catalog' USING ERRCODE='P0001'; END IF;
 IF snapshot ? 'snapshotVersion' THEN
 IF snapshot->'snapshotVersion' IS DISTINCT FROM '2'::jsonb
 OR snapshot->'catalogVersion' IS DISTINCT FROM to_jsonb(c.version)
 OR snapshot->'priceSatang' IS DISTINCT FROM to_jsonb(c.price_satang) THEN
 RAISE EXCEPTION 'Invalid or stale catalog snapshot version' USING ERRCODE='P0001'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_package_catalog_order_insert() FROM PUBLIC;
CREATE TRIGGER package_catalog_order_insert_guard BEFORE INSERT ON public.package_payment_orders
 FOR EACH ROW EXECUTE FUNCTION guard_package_catalog_order_insert();
COMMIT;
