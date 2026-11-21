"""R7 kiosk tests in a disposable native loopback PostgreSQL cluster."""
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
import json
import re
from threading import Barrier
from uuid import uuid4

runner = import_module('r4-staff-free-display-postgres-test')
base = runner.base
MIGRATION = '20261130_R7_kiosk_visits'


def exercise(query):
    def scalar(sql):
        return query(sql).stdout.strip()

    def apply(*names):
        for name in names:
            query((base.MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8'))

    def deny(sql, code):
        error = query(sql, check=False)
        assert error.returncode and code in error.stderr, error.stderr

    def scan(code='BLU-3', direction='IN', key=None, token='kiosk', station='desk'):
        return f"SELECT r7_kiosk_scan('{token}','{station}','{key or uuid4()}','{code}','{direction}');"

    def desk(code='BLU-3', direction='IN'):
        return f"SELECT member_scan_admit('token-2','admin','{uuid4()}','{code}','{direction}');"

    def read(sql):
        return json.loads(scalar(sql))

    def race(*calls):
        barrier = Barrier(len(calls))

        def invoke(call):
            barrier.wait()
            return read(call)

        with ThreadPoolExecutor(max_workers=len(calls)) as pool:
            return list(pool.map(invoke, calls))

    fixture = (base.ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    seed = (base.ROOT / 'scripts/r4-staff-free-postgres-test.sql').read_text(encoding='utf-8').split('SELECT test_settle(3)', 1)[0]
    query("CREATE TYPE scanner_type AS ENUM ('WEB_CAMERA','HARDWARE_USB','API_GATE');" +
          re.search(r'await db\.exec\(`([\s\S]*?)`\);', fixture)[1].replace('scanner_type text', 'scanner_type scanner_type'))
    apply(*base.BASE)
    query('ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;')
    apply(*base.CATALOG, *base.R3[:2], '20261118_R6_time_supplement',
          '20261118_R7_visits', '20261118_R2_member_cards')
    base_body = scalar("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='kiosk_checkin(text,text,uuid,text)'::regprocedure;")
    assert base_body == 'aa0ce4b3c5cd4fdccdab04ae2d376fa4', base_body
    # Validate installation and a denial on the base R7 stack in a cloned scratch DB.
    query('CREATE DATABASE blu_modules_test_r7_baseline TEMPLATE postgres;')
    baseline = (base.MIGRATIONS / (MIGRATION + '.sql')).read_text(encoding='utf-8')
    query(baseline, database='blu_modules_test_r7_baseline')
    no_session = query(scan(), check=False, database='blu_modules_test_r7_baseline')
    assert no_session.returncode and '42501' in no_session.stderr
    apply(base.R3[-1])

    query(seed.replace("'catalogVersion',1", "'catalogVersion',2"))
    off_slot = scalar("SELECT CASE WHEN (now() AT TIME ZONE 'Asia/Bangkok')::time < time '12:00' THEN '17:00-17:01' ELSE '05:00-05:01' END;")
    for package, slot in [(1, '00:00-24:00'), (2, off_slot)]:
        scalar(f"SELECT package_catalog_action('token-2','update',gen_random_uuid(),jsonb_build_object('id',{package},'expectedVersion',1,'timeSlot','{slot}'));")
    query("SELECT test_settle(3),test_settle(4),test_settle(5,2),test_settle(6),test_settle(7),test_settle(8,2); INSERT INTO member_cards VALUES(3,'CARD-003',1),(4,'CARD-004',1);")
    old_qr_key, old_card_key = uuid4(), uuid4()
    old_qr = read(f"SELECT kiosk_checkin('kiosk','desk','{old_qr_key}','BLU-3');")
    old_card = read(f"SELECT member_card_admit('kiosk','desk','{old_card_key}','CARD-004',NULL);")
    assert old_qr['ok'] and old_card['ok']
    old_rows = scalar('SELECT jsonb_agg(c ORDER BY id) FROM checkins c;')
    # Source drift must abort the migration and leave neither the audit table nor scan function.
    migration = (base.MIGRATIONS / (MIGRATION + '.sql')).read_text(encoding='utf-8')
    drift = '''DO $drift$ BEGIN EXECUTE replace(pg_get_functiondef('kiosk_checkin(text,text,uuid,text)'::regprocedure),
      'slot text;', 'slot  text;'); END $drift$;'''
    deny(migration.replace('BEGIN;', 'BEGIN;\n' + drift, 1), 'P0001')
    assert scalar("SELECT to_regclass('r7_kiosk_scan_requests') IS NULL AND to_regprocedure('r7_kiosk_scan(text,text,uuid,text,text)') IS NULL;") == 't'
    apply(MIGRATION)
    assert scalar('SELECT jsonb_agg(c ORDER BY id) FROM checkins c;') == old_rows
    assert read(scan(key=old_qr_key)) == old_qr
    assert read(scan('CARD-004', key=old_card_key)) == old_card
    deny(scan(direction='OUT', key=old_qr_key), '22023')
    deny(scan('CARD-004', 'OUT', old_card_key), '22023')
    assert read(scan(direction='OUT'))['reason'] == 'NO_OPEN_VISIT'
    assert scalar('SELECT count(*) FROM r7_visits;') == '0'
    missing_key = uuid4()
    assert read(scan('CARD-999', key=missing_key))['reason'] == 'NOT_FOUND'
    deny(f"SELECT kiosk_checkin('kiosk','desk','{missing_key}','BLU-3');", '22023')
    query("INSERT INTO auth_sessions(member_id,token_hash,expires_at,mode,device_id,revoked_at) VALUES (1,'revoked-kiosk',now()+interval '1 day','KIOSK','desk',now()),(1,'expired-kiosk',now()-interval '1 day','KIOSK','desk',NULL),(3,'member-kiosk',now()+interval '1 day','KIOSK','desk',NULL);")
    for token in ('token-1', 'expired-kiosk', 'revoked-kiosk', 'member-kiosk', 'missing'):
        deny(scan(token=token, key=old_qr_key), '42501')
    deny(scan(station='other'), '42501')
    query("UPDATE members SET status='SUSPENDED' WHERE id=1;")
    deny(scan(), '42501')
    query("UPDATE members SET status='ACTIVE' WHERE id=1; DELETE FROM kiosk_member_bounce;")
    balances = scalar('SELECT jsonb_agg(points ORDER BY id) FROM members;')
    ledger = scalar('SELECT jsonb_agg(l ORDER BY order_id) FROM package_payment_point_ledger l;')
    in_key, out_key = uuid4(), uuid4()
    enter = scan('CARD-003', key=in_key)
    entry, replay = race(enter, enter)
    assert entry == replay and entry['ok']
    assert read(scan())['reason'] == 'ALREADY_IN'
    assert read(desk())['reason'] == 'ALREADY_IN'
    deny(scan('CARD-003', 'OUT', in_key), '22023')
    deny(scan(key=in_key), '22023')
    assert read(scan(direction='OUT'))['reason'] == 'BOUNCE'
    snapshot = read(f"SELECT snapshot FROM r7_visits WHERE id={entry['visitId']};")
    assert snapshot['package'] == read('SELECT package_snapshot FROM package_payment_orders WHERE member_id=3;')
    assert snapshot['usedTimeSlot'] == '00:00-24:00' and snapshot['supplement'] is None
    query("UPDATE members SET status='EXPIRED' WHERE id=3; SELECT pg_sleep(3.1);")
    leave = scan('CARD-003', 'OUT', out_key)
    closed, replay = race(leave, leave)
    assert closed == replay and closed['reason'] == 'EXIT' and closed['visitId'] == entry['visitId']
    assert read(scan(direction='OUT'))['reason'] == 'NO_OPEN_VISIT'
    assert read(scan())['reason'] == 'BOUNCE'
    deny(f"SELECT kiosk_checkin('kiosk','desk','{out_key}','BLU-3');", '22023')
    query("UPDATE member_cards SET card_code=NULL,version=2 WHERE member_id=3; UPDATE member_cards SET card_code='CARD-003',version=2 WHERE member_id=4;")
    assert read(enter) == entry and read(leave) == closed
    assert read(scan('CARD-004', key=old_card_key)) == old_card
    assert read(f"SELECT snapshot FROM r7_visits WHERE id={entry['visitId']};") == snapshot
    assert scalar('SELECT bool_and(exited_at>=entered_at) FROM r7_visits WHERE exited_at IS NOT NULL;') == 't'
    admin, kiosk = race(desk('BLU-4'), scan('CARD-003'))
    assert sorted([admin['reason'], kiosk['reason']]) == ['ALREADY_IN', 'PAID_ENTRY']
    assert scalar('SELECT count(*) FROM r7_visits WHERE member_id=4 AND exited_at IS NULL;') == '1'
    assert read(desk('BLU-4', 'OUT'))['reason'] == 'EXIT'
    assert read(desk('BLU-6'))['ok']
    query('SELECT pg_sleep(3.1);')
    assert read(scan('BLU-6', 'OUT'))['reason'] == 'EXIT'
    assert read(scan('BLU-5'))['reason'] == 'OFF_PEAK'
    grant = read("SELECT time_supplement_action('token-2','grant',gen_random_uuid(),'{\"memberCode\":\"BLU-5\",\"title\":\"Synthetic supplement\",\"timeSlot\":\"00:00-24:00\",\"reason\":\"R7 native test\"}');")
    scalar(f"SELECT time_supplement_action('token-5','activate',gen_random_uuid(),jsonb_build_object('couponId',{grant['couponId']}));")
    result = read(scan('BLU-5'))
    assert result['ok'], result
    supplement = read('SELECT snapshot FROM r7_visits WHERE member_id=5;')
    assert supplement['mainTimeSlot'] == off_slot and supplement['usedTimeSlot'] == '00:00-24:00'
    assert supplement['supplement']['couponId'] == grant['couponId']
    scalar("""SELECT r3_override_write('token-2',gen_random_uuid(),jsonb_build_object('memberCode','BLU-8',
      'expectedVersion',0,'expectedOrderId',id,'timeSlot','00:00-24:00','reason','Synthetic override'))
      FROM package_payment_orders WHERE member_id=8;""")
    assert read(scan('BLU-8'))['ok']
    overridden = read('SELECT snapshot FROM r7_visits WHERE member_id=8;')
    assert overridden['mainTimeSlot'] == off_slot and overridden['overrideTimeSlot'] == overridden['usedTimeSlot'] == '00:00-24:00'
    # Simulate a proven open visit from the previous Bangkok date, not a historical entry-only row.
    query("""WITH c AS (INSERT INTO checkins(member_id,scanner_type,points_awarded,checkin_time)
      VALUES(9,'HARDWARE_USB',0,clock_timestamp()-interval '1 day') RETURNING id,checkin_time)
      INSERT INTO r7_visits(member_id,checkin_id,entered_at,entry_actor,snapshot)
      SELECT 9,c.id,c.checkin_time,1,v.snapshot FROM c CROSS JOIN r7_visits v WHERE v.member_id=8;""")
    assert read(scan('BLU-9', 'OUT'))['reason'] == 'EXIT'
    assert scalar("SELECT (exited_at AT TIME ZONE 'Asia/Bangkok')::date>(entered_at AT TIME ZONE 'Asia/Bangkok')::date FROM r7_visits WHERE member_id=9;") == 't'
    query("""CREATE FUNCTION test_r7_failure() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'injected visit failure' USING ERRCODE='22000'; END $$;
      CREATE TRIGGER test_r7_failure BEFORE INSERT ON r7_visits FOR EACH ROW EXECUTE FUNCTION test_r7_failure();""")
    fail_key = uuid4()
    deny(scan('BLU-7', key=fail_key), '22000')
    assert scalar(f"SELECT EXISTS(SELECT FROM kiosk_requests WHERE request_key='{fail_key}') OR EXISTS(SELECT FROM r7_kiosk_scan_requests WHERE request_key='{fail_key}') OR EXISTS(SELECT FROM checkins WHERE member_id=7);") == 'f'
    query('DROP TRIGGER test_r7_failure ON r7_visits;')
    assert read(scan('BLU-7', key=fail_key))['ok']
    deny('DELETE FROM r7_kiosk_scan_requests;', 'P0001')
    assert scalar('SELECT jsonb_agg(points ORDER BY id) FROM members;') == balances
    assert scalar('SELECT jsonb_agg(l ORDER BY order_id) FROM package_payment_point_ledger l;') == ledger
    assert scalar('SELECT bool_and(points_awarded=0) FROM checkins;') == 't'
    assert scalar('SELECT count(*) FROM checkins c LEFT JOIN r7_visits v ON v.checkin_id=c.id WHERE v.id IS NULL;') == '2'
    # Pin only the admission clock in a rolled-back fixture so welcome entry does not depend on test time.
    welcome_key = uuid4()
    assert scalar(f"""BEGIN;
      DO $clock$ BEGIN EXECUTE replace(pg_get_functiondef('kiosk_checkin(text,text,uuid,text)'::regprocedure),
       't:=clock_timestamp();', 't:=timestamptz ''2030-01-02 10:00:00+07'';'); END $clock$;
      INSERT INTO coupons(member_id,type,source,title,total_quota,used_count,created_at,expire_date)
       VALUES(10,'FREE_ENTRY','WELCOME_REGISTRATION','Synthetic welcome',1,0,'2030-01-01 10:00+07','2030-01-05 10:00+07');
      DO $welcome$ DECLARE receipt jsonb; BEGIN
       receipt:=r7_kiosk_scan('kiosk','desk','{welcome_key}','BLU-10','IN');
       IF receipt->>'reason' IS DISTINCT FROM 'FREE_ENTRY' OR
        receipt IS DISTINCT FROM r7_kiosk_scan('kiosk','desk','{welcome_key}','BLU-10','IN') OR
        NOT EXISTS(SELECT FROM r7_visits v JOIN coupons c ON c.member_id=v.member_id
         WHERE v.member_id=10 AND v.snapshot->>'usedTimeSlot'='07:00-22:00'
         AND v.snapshot->'package'='null'::jsonb AND v.snapshot->>'welcomeCouponId'=c.id::text
         AND c.used_count=1 AND c.status='USED') THEN RAISE EXCEPTION 'Welcome snapshot or replay mismatch'; END IF;
      END $welcome$;
      SELECT true; ROLLBACK;""") == 't'
    print('PASS: legacy replay, kiosk auth, QR/CARD pairing, cross-channel and duplicate races, snapshots (paid/supplement/override/welcome), rollback, no points', flush=True)
    apply('20261201_R7_manual_visits')
    deny((base.MIGRATIONS / '20261203_R7_manual_staff_visits.sql').read_text(encoding='utf-8'), 'P0001')
    assert scalar("SELECT to_regprocedure('r7_manual_staff_source(integer,timestamptz,uuid)') IS NULL;") == 't'
    test_manual(query, scalar, read, deny, race)


def test_manual(query, scalar, read, deny, race):
    def call(key=None, token='token-2', **changes):
        payload = dict(code='BLU-3', inAt='2020-01-01T23:50+07:00', outAt='2020-01-02T00:20+07:00',
                       orderId=None, usedTimeSlot='07:00-22:00', serviceType='Gym', reason='Paper log', note=None)
        payload.update(changes)
        return f"SELECT r7_manual_visit('{token}','{key or uuid4()}',$payload${json.dumps(payload)}$payload$::jsonb);"

    def state():
        return scalar("""SELECT jsonb_build_array((SELECT jsonb_agg(m ORDER BY id) FROM members m),
          (SELECT jsonb_agg(o ORDER BY id) FROM package_payment_orders o),
          (SELECT jsonb_agg(c ORDER BY id) FROM coupons c),
          (SELECT jsonb_agg(l ORDER BY order_id) FROM package_payment_point_ledger l));""")

    def counts():
        return scalar("SELECT jsonb_build_array((SELECT count(*) FROM checkins),(SELECT count(*) FROM r7_visits),(SELECT count(*) FROM r7_visit_requests));")

    query("""INSERT INTO auth_sessions(member_id,token_hash,expires_at,mode,device_id,revoked_at) VALUES
      (2,'owner-kiosk',now()+interval '1 day','KIOSK','desk',NULL),
      (2,'owner-revoked',now()+interval '1 day','NORMAL',NULL,now()),
      (2,'owner-expired',now()-interval '1 second','NORMAL',NULL,NULL);""")
    before = state()
    old_rows = scalar('SELECT jsonb_agg(c ORDER BY id) FROM checkins c WHERE NOT EXISTS(SELECT FROM r7_visits v WHERE v.checkin_id=c.id);')
    original_counts = counts()
    for token in ('token-1', 'token-3', 'owner-kiosk', 'owner-revoked', 'owner-expired', 'missing'):
        deny(call(token=token), '42501')
    for changes, error in [({'outAt': None}, '22023'), ({'outAt': '2020-01-01T22:00+07:00'}, '22023'),
                           ({'outAt': '2999-01-01T22:00+07:00'}, '22023'), ({'inAt': '2020-02-31T22:00+07:00'}, '22008'),
                           ({'reason': '  '}, '22023'), ({'usedTimeSlot': '24:00-24:00'}, '22023'), ({'points': 1}, '22023')]:
        deny(call(**changes), error)
    assert counts() == original_counts
    key = uuid4()
    first, replay = race(call(key), call(key))
    assert first == replay and first['ok']
    deny(call(key, note='changed'), '22023')
    deny(call(key, token='token-1'), '42501')
    visit = first['visitId']
    assert scalar(f"""SELECT snapshot->>'packageSource'='UNKNOWN' AND snapshot->'package'='null'
      AND snapshot->>'usedTimeSlot'='07:00-22:00' AND entry_actor=2 AND exit_actor=2
      AND extract(epoch FROM exited_at-entered_at)=1800 AND c.points_awarded=0
      AND c.scanner_type='MANUAL' AND c.checkin_time=entered_at
      FROM r7_visits v JOIN checkins c ON c.id=v.checkin_id WHERE v.id={visit};""") == 't'
    assert scalar(f"""SELECT payload->'input'->>'reason'='Paper log' AND result->>'visitId'='{visit}'
      AND recorded_at>timestamptz '2020-01-02' FROM r7_visit_requests WHERE actor_id=2 AND request_key='{key}';""") == 't'
    assert read(call())['reason'] == 'OVERLAP'
    pair = dict(inAt='2020-01-03T08:00+07:00', outAt='2020-01-03T09:00+07:00')
    assert sorted(x['reason'] for x in race(call(**pair), call(**pair))) == ['MANUAL_PAIR', 'OVERLAP']

    # Seed an unpaired historical point with a fixed past time to test overlap without a wall-clock race.
    query("INSERT INTO checkins(member_id,scanner_type,checkin_time) VALUES(10,'HARDWARE_USB','2020-01-01 17:00+00');")
    assert read(call(code='BLU-10'))['reason'] == 'OVERLAP'
    query("DELETE FROM checkins WHERE member_id=10 AND checkin_time='2020-01-01 17:00+00';")

    assert scalar('SELECT jsonb_agg(c ORDER BY id) FROM checkins c WHERE NOT EXISTS(SELECT FROM r7_visits v WHERE v.checkin_id=c.id);') == old_rows
    order = read("""SELECT jsonb_build_object('orderId',id,'package',package_snapshot,
      'inAt',to_char(date_trunc('second',paid_at AT TIME ZONE 'Asia/Bangkok')+interval '1 second','YYYY-MM-DD\"T\"HH24:MI:SS')||'+07:00',
      'outAt',to_char(date_trunc('second',paid_at AT TIME ZONE 'Asia/Bangkok')+interval '2 seconds','YYYY-MM-DD\"T\"HH24:MI:SS')||'+07:00')
      FROM package_payment_orders WHERE member_id=7 AND status='PAID';""")
    assert read(call(orderId=order['orderId']))['reason'] == 'OVERLAP'
    assert read(call(code='BLU-7', orderId=order['orderId']))['reason'] == 'PACKAGE_UNVERIFIED'
    assert read(call(code='BLU-10', orderId=order['orderId'], inAt=order['inAt'], outAt=order['outAt']))['reason'] == 'PACKAGE_UNVERIFIED'
    actual = read(call(code='BLU-7', orderId=order['orderId'], inAt=order['inAt'], outAt=order['outAt'], usedTimeSlot=None))
    assert actual['ok'], actual
    snapshot = read(f"SELECT snapshot FROM r7_visits WHERE id={actual['visitId']};")
    assert snapshot['package'] == order['package'] and snapshot['usedTimeSlot'] is None
    query("CREATE TRIGGER fail_manual_audit BEFORE INSERT ON r7_visit_requests FOR EACH STATEMENT EXECUTE FUNCTION r7_audit_guard();")
    before_failure = counts()
    failed = call(code='BLU-9')
    deny(failed, 'P0001')
    assert counts() == before_failure
    query('DROP TRIGGER fail_manual_audit ON r7_visit_requests;')
    assert read(failed)['ok']
    deny(f"DELETE FROM r7_visit_requests WHERE request_key='{key}';", 'P0001')
    deny(f'UPDATE r7_visits SET exited_at=exited_at WHERE id={visit};', 'P0001')
    assert state() == before
    print('PASS: manual OWNER auth, cross-midnight pair, replay and overlap races, preserved/unknown package, immutable audit and rollback, no entitlement/points changes', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()
