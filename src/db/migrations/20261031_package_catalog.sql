-- PREPARE ONLY: after benefits, deployment hardening, receiver-bank and currency-recheck.
-- Invoker/server-only. Public HTTP catalog uses SELECT * FROM package_catalog_public
-- ORDER BY id; no anonymous database grants. Prices are THB; priceSatang is authoritative.
-- OWNER action: list => array (including inactive); update => package object.
-- Update payload: id, expectedVersion, optional camelCase catalog fields.
-- New order input: {package:{id,catalogVersion},promo:{code}}; version is mandatory.
BEGIN;
CREATE TABLE package_catalog (
 id integer PRIMARY KEY CHECK(id BETWEEN 1 AND 10),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 100),
 description text NOT NULL CHECK(length(description)<=2000),
 price_satang integer NOT NULL CHECK(price_satang BETWEEN 1 AND 100000000),
 duration_days integer NOT NULL CHECK(duration_days BETWEEN 1 AND 3660),
 time_slot text NOT NULL CHECK(time_slot IN ('07:00-14:00','07:00-22:00')),
 friend_quota integer NOT NULL CHECK(friend_quota BETWEEN 0 AND 100),
 bonus_days integer NOT NULL CHECK(bonus_days BETWEEN 0 AND 365),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 is_active boolean NOT NULL DEFAULT true
);
INSERT INTO package_catalog(id,name,label,description,price_satang,duration_days,time_slot,friend_quota,bonus_days) VALUES
(1,'BLU 07:00-14:00 รายวัน','รายวัน','เข้าใช้บริการ 1 วัน ช่วง 07:00 - 14:00 น.',9000,1,'07:00-14:00',0,0),
(2,'BLU 07:00-14:00 1 เดือน','1 เดือน','เข้าใช้บริการ 1 เดือน (30 วัน) ช่วง 07:00 - 14:00 น.',90000,30,'07:00-14:00',5,0),
(3,'BLU 07:00-14:00 3 เดือน','3 เดือน','เข้าใช้บริการ 3 เดือน (90 วัน) ช่วง 07:00 - 14:00 น.',240000,90,'07:00-14:00',5,15),
(4,'BLU 07:00-14:00 6 เดือน','6 เดือน','เข้าใช้บริการ 6 เดือน (180 วัน) ช่วง 07:00 - 14:00 น.',420000,180,'07:00-14:00',5,30),
(5,'BLU 07:00-14:00 1 ปี','1 ปี','เข้าใช้บริการ 1 ปี (365 วัน) ช่วง 07:00 - 14:00 น.',720000,365,'07:00-14:00',10,60),
(6,'BLU 07:00-22:00 รายวัน','รายวัน','เข้าใช้บริการ 1 วัน ช่วง 07:00 - 22:00 น.',10000,1,'07:00-22:00',0,0),
(7,'BLU 07:00-22:00 1 เดือน','1 เดือน','เข้าใช้บริการ 1 เดือน (30 วัน) ช่วง 07:00 - 22:00 น.',100000,30,'07:00-22:00',5,0),
(8,'BLU 07:00-22:00 3 เดือน','3 เดือน','เข้าใช้บริการ 3 เดือน (90 วัน) ช่วง 07:00 - 22:00 น.',270000,90,'07:00-22:00',5,15),
(9,'BLU 07:00-22:00 6 เดือน','6 เดือน','เข้าใช้บริการ 6 เดือน (180 วัน) ช่วง 07:00 - 22:00 น.',480000,180,'07:00-22:00',5,30),
(10,'BLU 07:00-22:00 1 ปี','1 ปี','เข้าใช้บริการ 1 ปี (365 วัน) ช่วง 07:00 - 22:00 น.',840000,365,'07:00-22:00',10,60);
CREATE VIEW package_catalog_public AS
 SELECT id,name,label,description,price_satang AS "priceSatang",price_satang::numeric/100 AS price,
 duration_days AS "durationDays",time_slot AS "timeSlot",friend_quota AS "friendCoupons",
 bonus_days AS "bonusDays",version,version AS "catalogVersion",is_active AS "isActive"
 FROM package_catalog WHERE is_active;
CREATE TABLE package_catalog_audit (
 actor_id integer NOT NULL REFERENCES members(id), request_key uuid NOT NULL,
 action text NOT NULL CHECK(action='update'), payload jsonb NOT NULL,
 before_snapshot jsonb NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,request_key)
);
CREATE FUNCTION protect_package_catalog_audit() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Package catalog audit is append-only'; END $$;
CREATE TRIGGER package_catalog_audit_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON package_catalog_audit
 FOR EACH STATEMENT EXECUTE FUNCTION protect_package_catalog_audit();
CREATE FUNCTION protect_package_catalog() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Package catalog cannot be deleted'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.version<>OLD.version+1 THEN
 RAISE EXCEPTION 'Package catalog identity/version is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER package_catalog_guard BEFORE UPDATE OR DELETE ON package_catalog
 FOR EACH ROW EXECUTE FUNCTION protect_package_catalog();
CREATE TRIGGER package_catalog_truncate_guard BEFORE TRUNCATE ON package_catalog
 FOR EACH STATEMENT EXECUTE FUNCTION protect_package_catalog();
CREATE FUNCTION package_catalog_action(p_token text,p_action text,p_key uuid,p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE actor members; old package_catalog; current_row package_catalog; prior package_catalog_audit; result jsonb;
BEGIN
 -- Same member-before-catalog order as creator, with UPDATE from the outset.
 SELECT m.* INTO actor FROM members m WHERE m.id=(SELECT s.member_id FROM auth_sessions s
 WHERE s.token_hash=p_token AND s.mode='NORMAL' AND s.revoked_at IS NULL
 AND s.expires_at>clock_timestamp() LIMIT 1) FOR UPDATE;
 PERFORM 1 FROM auth_sessions WHERE member_id=actor.id AND token_hash=p_token FOR SHARE;
 IF actor.id IS NULL OR actor.role<>'OWNER' OR actor.status='SUSPENDED' OR NOT EXISTS(
 SELECT 1 FROM auth_sessions WHERE member_id=actor.id AND token_hash=p_token AND mode='NORMAL'
 AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN
 RAISE EXCEPTION 'Non-suspended NORMAL OWNER session required' USING ERRCODE='42501'; END IF;
 IF p_action='list' THEN
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) INTO result FROM (
 SELECT id,name,label,description,price_satang AS "priceSatang",price_satang::numeric/100 AS price,
 duration_days AS "durationDays",time_slot AS "timeSlot",friend_quota AS "friendCoupons",
 bonus_days AS "bonusDays",version,version AS "catalogVersion",is_active AS "isActive" FROM package_catalog) c;
 RETURN result;
 END IF;
 IF p_action IS DISTINCT FROM 'update' OR p_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'Invalid catalog action' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM package_catalog_audit WHERE actor_id=actor.id AND request_key=p_key;
 IF FOUND THEN
 IF prior.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'Request key reused' USING ERRCODE='22023'; END IF;
 RETURN prior.result;
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN
 ('id','expectedVersion','name','label','description','priceSatang','durationDays','timeSlot','friendCoupons','bonusDays','isActive'))
 OR coalesce(p_payload->>'id','') !~ '^[1-9][0-9]*$'
 OR coalesce(p_payload->>'expectedVersion','') !~ '^[1-9][0-9]*$' THEN
 RAISE EXCEPTION 'Invalid catalog payload' USING ERRCODE='22023'; END IF;
 -- Reject JSON strings, fractions, nulls and booleans rather than coercing them.
 IF EXISTS(SELECT 1 FROM jsonb_each(p_payload) e WHERE
 (e.key IN ('id','expectedVersion','priceSatang','durationDays','friendCoupons','bonusDays') AND
 (jsonb_typeof(e.value)<>'number' OR e.value::text !~ '^(0|[1-9][0-9]*)$')) OR
 (e.key IN ('name','label','description','timeSlot') AND jsonb_typeof(e.value)<>'string') OR
 (e.key='isActive' AND jsonb_typeof(e.value)<>'boolean')) THEN
 RAISE EXCEPTION 'Invalid catalog field type' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM package_catalog WHERE id=(p_payload->>'id')::integer FOR UPDATE;
 IF old.id IS NULL OR old.version<>(p_payload->>'expectedVersion')::integer THEN
 RAISE EXCEPTION 'Stale catalog version' USING ERRCODE='P0001'; END IF;
 UPDATE package_catalog SET name=coalesce(p_payload->>'name',name),label=coalesce(p_payload->>'label',label),
 description=coalesce(p_payload->>'description',description),price_satang=coalesce((p_payload->>'priceSatang')::integer,price_satang),
 duration_days=coalesce((p_payload->>'durationDays')::integer,duration_days),time_slot=coalesce(p_payload->>'timeSlot',time_slot),
 friend_quota=coalesce((p_payload->>'friendCoupons')::integer,friend_quota),bonus_days=coalesce((p_payload->>'bonusDays')::integer,bonus_days),
 is_active=coalesce((p_payload->>'isActive')::boolean,is_active),version=version+1
 WHERE id=old.id RETURNING * INTO current_row;
 result:=jsonb_build_object('id',current_row.id,'name',current_row.name,'label',current_row.label,
 'description',current_row.description,'priceSatang',current_row.price_satang,'price',current_row.price_satang::numeric/100,
 'durationDays',current_row.duration_days,'timeSlot',current_row.time_slot,'friendCoupons',current_row.friend_quota,
 'bonusDays',current_row.bonus_days,'version',current_row.version,'catalogVersion',current_row.version,'isActive',current_row.is_active);
 INSERT INTO package_catalog_audit(actor_id,request_key,action,payload,before_snapshot,result)
 VALUES(actor.id,p_key,p_action,p_payload,to_jsonb(old),result);
 RETURN result;
END $$;
CREATE FUNCTION create_catalog_package_payment_order(p_id uuid,p_member integer,p_session text,p_key uuid,p_quote jsonb,p_receiver jsonb)
 RETURNS SETOF package_payment_orders LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE m members; existing package_payment_orders; c package_catalog; code text; q jsonb;
BEGIN
 SELECT * INTO m FROM members WHERE id=p_member FOR UPDATE;
 PERFORM 1 FROM auth_sessions WHERE member_id=p_member AND token_hash=p_session FOR SHARE;
 IF m.id IS NULL OR m.status='SUSPENDED' OR NOT EXISTS(SELECT 1 FROM auth_sessions
 WHERE member_id=p_member AND token_hash=p_session AND mode='NORMAL' AND revoked_at IS NULL
 AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
 code:=nullif(upper(btrim(p_quote->'promo'->>'code')),'');
 -- Replay precedes version/availability validation and never rebuilds an old quote.
 SELECT * INTO existing FROM package_payment_orders WHERE member_id=p_member AND request_key=p_key;
 IF FOUND THEN
 IF existing.package_snapshot->>'id' IS DISTINCT FROM p_quote->'package'->>'id'
 OR existing.promo_code IS DISTINCT FROM code THEN RAISE EXCEPTION 'Request key reused' USING ERRCODE='22023'; END IF;
 RETURN NEXT existing; RETURN;
 END IF;
 IF jsonb_typeof(p_quote->'package'->'id') IS DISTINCT FROM 'number'
 OR coalesce(p_quote->'package'->>'id','') !~ '^[1-9][0-9]*$'
 OR jsonb_typeof(p_quote->'package'->'catalogVersion') IS DISTINCT FROM 'number'
 OR coalesce(p_quote->'package'->>'catalogVersion','') !~ '^[1-9][0-9]*$' THEN
 RAISE EXCEPTION 'Package id and catalogVersion required' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM package_catalog WHERE id=(p_quote->'package'->>'id')::integer FOR SHARE;
 IF c.id IS NULL OR NOT c.is_active THEN RAISE EXCEPTION 'Package unavailable'; END IF;
 IF c.version<>(p_quote->'package'->>'catalogVersion')::integer THEN
 RAISE EXCEPTION 'Stale catalog version' USING ERRCODE='P0001'; END IF;
 q:=jsonb_build_object('package',jsonb_build_object('id',c.id,'name',c.name,'label',c.label,
 'description',c.description,'price',c.price_satang::numeric/100,'priceSatang',c.price_satang,
 'durationDays',c.duration_days,'timeSlot',c.time_slot,'friendCoupons',c.friend_quota,'bonusDays',c.bonus_days,
 'isActive',c.is_active,'catalogVersion',c.version,'snapshotVersion',2),
 'subtotalSatang',c.price_satang,'discountSatang',0,'amountSatang',c.price_satang,
 'pointsEarned',floor(c.price_satang::numeric/2000)::integer,'promo',CASE WHEN code IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('code',code) END);
 RETURN QUERY SELECT * FROM create_package_payment_order(p_id,p_member,p_session,p_key,q,p_receiver);
END $$;
REVOKE ALL ON package_catalog,package_catalog_public,package_catalog_audit FROM PUBLIC;
REVOKE ALL ON FUNCTION package_catalog_action(text,text,uuid,jsonb),create_catalog_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb),protect_package_catalog(),protect_package_catalog_audit() FROM PUBLIC;
DO $guard$ BEGIN
 IF (SELECT prosrc FROM pg_proc WHERE oid='issue_paid_package_benefits()'::regprocedure) IS DISTINCT FROM $expected$
DECLARE friends integer; days integer;
BEGIN
 IF OLD.status<>'PENDING' OR NEW.status<>'PAID' OR NEW.package_benefits_version IS DISTINCT FROM 1 THEN
 RETURN NEW; END IF;
 -- package_snapshot is immutable and comes from quotePackage's server catalog,
 -- not the browser payload. Fail closed for malformed new snapshots.
 IF jsonb_typeof(NEW.package_snapshot->'friendCoupons') IS DISTINCT FROM 'number'
 OR jsonb_typeof(NEW.package_snapshot->'bonusDays') IS DISTINCT FROM 'number'
 OR (NEW.package_snapshot->>'friendCoupons') !~ '^(0|5|10)$'
 OR (NEW.package_snapshot->>'bonusDays') !~ '^(0|15|30|60)$' THEN
 RAISE EXCEPTION 'Invalid package benefit snapshot'; END IF;
 friends:=(NEW.package_snapshot->>'friendCoupons')::integer;
 days:=(NEW.package_snapshot->>'bonusDays')::integer;
 IF NEW.membership_expires_at IS NULL THEN RAISE EXCEPTION 'Membership expiry required'; END IF;
 IF friends>0 THEN
 INSERT INTO coupons(member_id,source,type,title,total_quota,used_count,bonus_days_value,expire_date,status)
 VALUES(NEW.member_id,'PACKAGE_ORDER:'||NEW.id||':FRIEND_PASS','FRIEND_PASS','คูปองพาเพื่อนจากแพ็กเกจ',friends,0,0,NEW.membership_expires_at,'AVAILABLE');
 END IF;
 IF days>0 THEN
 INSERT INTO coupons(member_id,source,type,title,total_quota,used_count,bonus_days_value,expire_date,status)
 VALUES(NEW.member_id,'PACKAGE_ORDER:'||NEW.id||':EXTRA_DAYS','EXTRA_DAYS','คูปองเพิ่มวันจากแพ็กเกจ',1,0,days,NEW.membership_expires_at,'AVAILABLE');
 END IF;
 RETURN NEW;
END $expected$ THEN
 RAISE EXCEPTION 'Unexpected issue_paid_package_benefits source; review migration'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION issue_paid_package_benefits() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE friends integer; days integer;
BEGIN
 IF OLD.status<>'PENDING' OR NEW.status<>'PAID' OR NEW.package_benefits_version IS DISTINCT FROM 1 THEN
 RETURN NEW; END IF;
 -- package_snapshot is immutable and comes from quotePackage's server catalog,
 -- not the browser payload. Fail closed for malformed new snapshots.
 IF jsonb_typeof(NEW.package_snapshot->'friendCoupons') IS DISTINCT FROM 'number'
 OR jsonb_typeof(NEW.package_snapshot->'bonusDays') IS DISTINCT FROM 'number'
 OR (CASE WHEN NEW.package_snapshot->'snapshotVersion' = '2'::jsonb THEN
 (NEW.package_snapshot->>'friendCoupons') !~ '^(0|[1-9][0-9]{0,2})$'
 OR (NEW.package_snapshot->>'bonusDays') !~ '^(0|[1-9][0-9]{0,2})$'
 OR (NEW.package_snapshot->>'friendCoupons')::numeric NOT BETWEEN 0 AND 100
 OR (NEW.package_snapshot->>'bonusDays')::numeric NOT BETWEEN 0 AND 365
 ELSE
(NEW.package_snapshot->>'friendCoupons') !~ '^(0|5|10)$'
 OR (NEW.package_snapshot->>'bonusDays') !~ '^(0|15|30|60)$' END) THEN
 RAISE EXCEPTION 'Invalid package benefit snapshot'; END IF;
 friends:=(NEW.package_snapshot->>'friendCoupons')::integer;
 days:=(NEW.package_snapshot->>'bonusDays')::integer;
 IF NEW.membership_expires_at IS NULL THEN RAISE EXCEPTION 'Membership expiry required'; END IF;
 IF friends>0 THEN
 INSERT INTO coupons(member_id,source,type,title,total_quota,used_count,bonus_days_value,expire_date,status)
 VALUES(NEW.member_id,'PACKAGE_ORDER:'||NEW.id||':FRIEND_PASS','FRIEND_PASS','คูปองพาเพื่อนจากแพ็กเกจ',friends,0,0,NEW.membership_expires_at,'AVAILABLE');
 END IF;
 IF days>0 THEN
 INSERT INTO coupons(member_id,source,type,title,total_quota,used_count,bonus_days_value,expire_date,status)
 VALUES(NEW.member_id,'PACKAGE_ORDER:'||NEW.id||':EXTRA_DAYS','EXTRA_DAYS','คูปองเพิ่มวันจากแพ็กเกจ',1,0,days,NEW.membership_expires_at,'AVAILABLE');
 END IF;
 RETURN NEW;
END $$;
COMMIT;
