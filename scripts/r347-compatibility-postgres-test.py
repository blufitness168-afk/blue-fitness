"""Combined R3/R4/R6/R7 migration on a disposable SCRAM loopback cluster."""
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
import json
import re
from threading import Barrier
from uuid import uuid4

runner = import_module('r4-staff-free-display-postgres-test')
base = runner.base
MIGRATION = '20261202_R347_admission_compatibility'


def exercise(query):
    def scalar(sql):
        return query(sql).stdout.strip()

    def apply(*names):
        for name in names:
            query((base.MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8'))

    source = (base.ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    fixture = re.search(r'await db\.exec\(`([\s\S]*?)`\);', source)[1]
    seed = (base.ROOT / 'scripts/r4-staff-free-postgres-test.sql').read_text(encoding='utf-8').split('SELECT test_settle(3)', 1)[0]
    query("CREATE TYPE scanner_type AS ENUM ('WEB_CAMERA','HARDWARE_USB','API_GATE');" +
          fixture.replace('scanner_type text', 'scanner_type scanner_type'))
    query('ALTER TABLE members ADD COLUMN avatar_changed boolean DEFAULT false;')
    apply(*base.BASE, '20261024_real_rewards')
    query('ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;')
    apply(*base.CATALOG, '20261118_R2_member_cards', '20261118_R2_staff_avatar', *base.R3,
          '20261118_R4_online_provenance', '20261118_R5_finance', '20261119_R4_staff_free_foundation',
          '20261119_R4_staff_free_admission', '20261119_R4_staff_free_finance', '20261119_R4_staff_free_writer',
          runner.DISPLAY, '20261120_R4_staff_free_z_cancellation', '20261121_R4_staff_free_purchase_guard',
          '20261122_R4_staff_paid_transfer', '20261123_R4_staff_paid_cancellation',
          '20261124_R4_online_settlement_evidence', '20261125_R4_online_cancellation')
    def read(sql):
        return json.loads(scalar(sql))

    def deny(sql, code):
        error = query(sql, check=False)
        assert error.returncode and code in error.stderr, (sql, error.stderr)

    def desk(mid, direction='IN', key=None):
        return f"SELECT member_scan_admit('token-2','admin','{key or uuid4()}','BLU-{mid}','{direction}');"

    def kiosk(code, direction='IN', key=None):
        return f"SELECT r7_kiosk_scan('kiosk','desk','{key or uuid4()}','{code}','{direction}');"

    def grant(mid, key=None, token='token-2'):
        payload = json.dumps(dict(memberCode=f'BLU-{mid}', title='Synthetic supplement',
                                  timeSlot='00:00-24:00', reason='Synthetic grant'))
        return f"SELECT time_supplement_action('{token}','grant','{key or uuid4()}','{payload}');"

    def activate(mid, cid, key=None):
        return (f"SELECT time_supplement_action('token-{mid}','activate','{key or uuid4()}',"
                f"jsonb_build_object('couponId',{cid}));")

    def race(*calls):
        barrier = Barrier(len(calls), timeout=5)

        def invoke(call):
            barrier.wait()
            return read(call)

        with ThreadPoolExecutor(max_workers=len(calls)) as pool:
            return list(pool.map(invoke, calls))

    query(seed.replace("'catalogVersion',1", "'catalogVersion',2"))
    off_slot = scalar("SELECT CASE WHEN (now() AT TIME ZONE 'Asia/Bangkok')::time < time '12:00' THEN '17:00-17:01' ELSE '05:00-05:01' END;")
    for package, slot in ((1, off_slot), (2, off_slot), (6, '00:00-24:00')):
        query(f"SELECT package_catalog_action('token-2','update',gen_random_uuid(),jsonb_build_object('id',{package},'expectedVersion',1,'timeSlot','{slot}'));")
    query("SELECT test_settle(3,6),test_settle(4),test_settle(5),test_settle(6,6),test_settle(7,6),test_settle(8,6),test_settle(9,2);")
    query('INSERT INTO member_cards VALUES(3,\'CARD-003\',1),(4,\'CARD-004\',1);')
    old_key = uuid4()
    old_receipt = read(f"SELECT member_card_admit('kiosk','desk','{old_key}','CARD-003',NULL);")
    assert old_receipt['ok'] and 'visitId' not in old_receipt, old_receipt
    query("""CREATE FUNCTION test_combined_money() RETURNS jsonb LANGUAGE sql AS $$
      SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(p)-ARRAY['checkout_coupon_id','checkout_coupon_snapshot','checkout_coupon_points'] ORDER BY id) FROM package_payment_orders p),
       (SELECT jsonb_agg(p ORDER BY id) FROM package_payment_attempts p),
       (SELECT jsonb_agg(l ORDER BY order_id) FROM package_payment_point_ledger l),
       (SELECT jsonb_agg(r ORDER BY trans_ref) FROM payment_transfer_refs r),
       (SELECT jsonb_agg(v ORDER BY source_id) FROM r4_staff_private.finance_source v),
       (SELECT jsonb_agg(m.points ORDER BY m.id) FROM members m)) $$;
      CREATE ROLE combined_untrusted NOLOGIN;
      CREATE ROLE combined_legacy_acl NOLOGIN;
      GRANT EXECUTE ON FUNCTION kiosk_checkin(text,text,uuid,text) TO combined_legacy_acl;""")
    before = scalar('SELECT test_combined_money();')
    old_rows = scalar('SELECT jsonb_agg(c ORDER BY id) FROM checkins c;')
    combined = (base.MIGRATIONS / (MIGRATION + '.sql')).read_text(encoding='utf-8')
    drift = """DO $drift$ BEGIN EXECUTE replace(pg_get_functiondef('public.kiosk_checkin(text,text,uuid,text)'::regprocedure),
        'slot text;', 'slot  text;'); END $drift$;"""
    deny(combined.replace("BEGIN;", "BEGIN;" + chr(10) + drift, 1), "P0001")
    assert scalar("SELECT to_regclass('r7_visits') IS NULL AND to_regclass('time_supplement_grants') IS NULL;") == 't'
    apply(MIGRATION, '20261201_R7_manual_visits', '20261203_R7_manual_staff_visits',
          '20261126_R5_finance_import', '20261127_R6_coupon_activation',
          '20261128_R6_promo_scope', '20261129_R6_staff_grant_targeting',
          '20261201_R6_coupon_campaigns', '20261203_R6_checkout_coupons',
          '20261204_R5_finance_lifecycle', '20261205_R36_current_term_targeting',
                    '20261206_R6_promo_definition_history', '20261207_R4_owner_package_cancellation')
    assert scalar('SELECT test_combined_money();') == before
    assert scalar("SELECT strpos(pg_get_functiondef('r4_online_private.cancel_online_order(text,uuid,uuid,integer,text,boolean)'::regprocedure), $q$m.role NOT IN ('MEMBER','OWNER')$q$)>0;") == 't'
    assert scalar('SELECT jsonb_agg(c ORDER BY id) FROM checkins c;') == old_rows
    assert scalar("""SELECT has_function_privilege('combined_legacy_acl','kiosk_checkin(text,text,uuid,text)','EXECUTE')
      AND NOT has_function_privilege('combined_untrusted','r7_kiosk_scan(text,text,uuid,text,text)','EXECUTE')
      AND NOT has_function_privilege('combined_untrusted','time_supplement_action(text,text,uuid,jsonb)','EXECUTE')
      AND NOT has_table_privilege('combined_untrusted','r7_visits','SELECT,INSERT')
      AND NOT has_table_privilege('combined_untrusted','time_supplement_grants','SELECT,INSERT');""") == 't'
    assert read(kiosk('CARD-003', key=old_key)) == old_receipt
    deny(kiosk('CARD-003', 'OUT', old_key), '22023')
    assert read(kiosk('BLU-3', 'OUT'))['reason'] == 'NO_OPEN_VISIT'
    deny(grant(4, token='token-4'), '42501')
    deny(grant(10), 'P0001')
    print('PASS: reviewed source guard, original receipts and business state, no new public rights', flush=True)

    sales = {}
    for mid, method in ((4, 'free_sale'), (5, 'paid_transfer')):
        offer = f"r4_staff_private.preview_{method}('token-2','BLU-{mid}')"
        suffix = ',true,NULL' if method == 'paid_transfer' else ''
        result = read(f"SELECT r4_staff_private.record_{method}('token-2',gen_random_uuid(),'BLU-{mid}',"
                      f"{offer},'Synthetic term'{suffix});")
        sales[mid] = result['saleId']
        assert result['dailySlot'] == off_slot
    online_grant = read(grant(4))
    assert scalar(f"SELECT main_order_id IS NOT NULL AND staff_sale_id IS NULL FROM time_supplement_grants WHERE coupon_id={online_grant['couponId']};") == 't'
    assert read(desk(5))['reason'] == 'OFF_PEAK'
    concurrent = race(desk(6), kiosk('BLU-6'))
    assert sorted(x['reason'] for x in concurrent) == ['ALREADY_IN', 'PAID_ENTRY'], concurrent
    assert read(desk(6, 'OUT'))['reason'] == 'EXIT'
    assert read(kiosk('BLU-6'))['reason'] == 'BOUNCE'

    query("""SELECT r3_override_write('token-2',gen_random_uuid(),jsonb_build_object('memberCode','BLU-9',
      'expectedVersion',0,'expectedOrderId',id,'timeSlot','00:00-24:00','reason','Synthetic override'))
      FROM package_payment_orders WHERE member_id=9;""")
    assert read(desk(9))['ok']
    snapshot = read('SELECT snapshot FROM r7_visits WHERE member_id=9;')
    assert snapshot['mainTimeSlot'] == off_slot and snapshot['usedTimeSlot'] == snapshot['overrideTimeSlot'] == '00:00-24:00'
    assert snapshot['supplement'] is None and snapshot['packageSource'] == 'ONLINE_PAID'

    # A used online supplement is a consumed benefit even before a visit. An
    # unspent grant does not block cancellation, but cannot activate afterwards.
    for mid in (7, 8):
        assert scalar(f"SELECT r4_online_private.cancellation_eligible(id,{mid},clock_timestamp()) FROM package_payment_orders WHERE member_id={mid};") == 't'
    cid = read(grant(7))['couponId']
    read(activate(7, cid))
    assert scalar("SELECT r4_online_private.cancellation_eligible(id,7,clock_timestamp()) FROM package_payment_orders WHERE member_id=7;") == 'f'
    unused = read(grant(8))['couponId']
    query('INSERT INTO r4_online_private.reader_cutover VALUES(1);')
    refund = read("""SELECT r4_online_private.cancel_online_order('token-2',id,gen_random_uuid(),
       amount_satang,'Synthetic external refund',true) FROM package_payment_orders WHERE member_id=8;""")
    deny(activate(8, unused), 'P0001')
    assert scalar("SELECT status='PAID' FROM package_payment_orders WHERE member_id=8;") == 't', refund
    print('PASS: real R4 writers, scheduled term stays separate, online override and cancellation, shared IN race', flush=True)


    # Pin the effective business instant, not auth, in the synthetic cluster
    # only. Real sales above are scheduled from real finalizer evidence.
    query("""UPDATE auth_sessions SET expires_at=clock_timestamp()+interval '3 days' WHERE expires_at>clock_timestamp();
      DO $test_clock$ DECLARE sig regprocedure; d text; BEGIN
       FOREACH sig IN ARRAY ARRAY['time_supplement_action(text,text,uuid,jsonb)'::regprocedure,
        'kiosk_checkin(text,text,uuid,text)'::regprocedure,'real_frontdesk_checkin(text,text,uuid,text)'::regprocedure,
        'r7_kiosk_scan(text,text,uuid,text,text)'::regprocedure,'r7_visit_action(text,text,uuid,text,text)'::regprocedure] LOOP
        d:=pg_get_functiondef(sig);
        EXECUTE replace(d,'t:=clock_timestamp();',
         $replacement$t:=coalesce(nullif(current_setting('test.r347_at',true),'')::timestamptz,clock_timestamp());$replacement$);
       END LOOP; END $test_clock$;""")

    def at(mid, sql, offset='0 seconds'):
        # Select Bangkok noon within the one-day term. Both fixture slots exclude noon.
        return f"""DO $at$ BEGIN PERFORM set_config('test.r347_at',
          ((date_trunc('day',starts_at AT TIME ZONE 'Asia/Bangkok') + interval '12 hours'
            + CASE WHEN (starts_at AT TIME ZONE 'Asia/Bangkok')::time > time '12:00'
              THEN interval '1 day' ELSE interval '0' END + interval '{offset}') AT TIME ZONE 'Asia/Bangkok')::text,true)
          FROM r4_staff_private.free_sales WHERE member_id={mid}; END $at$; {sql}"""

    stable_money = scalar('SELECT test_combined_money();')
    deny(at(4, activate(4, online_grant['couponId'])), 'P0001')
    assert read(at(4, kiosk('CARD-004')))['reason'] == 'OFF_PEAK'
    for mid, source_kind in ((4, 'STAFF_FREE'), (5, 'STAFF_TRANSFER')):
        grant_sql = at(mid, grant(mid))
        first = read(grant_sql)
        assert read(grant_sql) == first
        second = read(at(mid, grant(mid)))
        first_use, second_use = race(at(mid, activate(mid, first['couponId'])), at(mid, activate(mid, second['couponId'])))
        assert first_use == second_use
        used = first_use['couponId']
        assert scalar(f"""SELECT count(*)=1 AND bool_and(g.staff_sale_id='{sales[mid]}' AND g.main_order_id IS NULL)
          FROM time_supplement_grants g JOIN time_supplement_activations a USING(coupon_id) WHERE g.member_id={mid};""") == 't'
        scan_in = kiosk('CARD-004') if mid == 4 else desk(mid)
        if mid == 4:
            query("""CREATE FUNCTION test_fail_combined_visit() RETURNS trigger LANGUAGE plpgsql AS
              $$ BEGIN RAISE EXCEPTION 'Synthetic late visit failure' USING ERRCODE='22000'; END $$;
              CREATE TRIGGER test_fail_combined_visit BEFORE INSERT ON r7_visits FOR EACH ROW
              EXECUTE FUNCTION test_fail_combined_visit();""")
            deny(at(mid, scan_in), '22000')
            assert scalar('SELECT NOT EXISTS(SELECT FROM checkins WHERE member_id=4);') == 't'
            query('DROP TRIGGER test_fail_combined_visit ON r7_visits;')
        entry = read(at(mid, scan_in))
        assert entry['ok'] and entry == read(at(mid, scan_in)), entry
        snapshot = read(f"SELECT snapshot FROM r7_visits WHERE id={entry['visitId']};")
        assert snapshot['staffSaleId'] == sales[mid] and snapshot['packageSource'] == source_kind
        assert snapshot['orderId'] is None and snapshot['package']['timeSlot'] == off_slot
        assert snapshot['usedTimeSlot'] == '00:00-24:00' and snapshot['supplement']['couponId'] == used
        scan_out = desk(mid, 'OUT') if mid == 4 else kiosk('BLU-5', 'OUT')
        assert read(at(mid, scan_out, '4 seconds'))['visitId'] == entry['visitId']
        assert read(f"SELECT snapshot FROM r7_visits WHERE id={entry['visitId']};") == snapshot
    assert stable_money == scalar('SELECT test_combined_money();')
    print('PASS: free/transfer term binding, concurrent single activation, kiosk/frontdesk snapshots and OUT, atomic failure', flush=True)

    payload = json.dumps(dict(code='BLU-3', inAt='2020-01-01T23:50+07:00', outAt='2020-01-02T00:20+07:00',
                              orderId=None, usedTimeSlot=None, serviceType='Gym', reason='Synthetic log', note=None))
    manual_key = uuid4()
    manual = f"SELECT r7_manual_visit('token-2','{manual_key}',$payload${payload}$payload$::jsonb);"
    deny(manual.replace('token-2', 'token-1'), '42501')
    pair, replay = race(manual, manual)
    assert pair == replay and pair['ok']
    assert read(manual.replace(str(manual_key), str(uuid4())))['reason'] == 'OVERLAP'
    assert scalar(f"""SELECT extract(epoch FROM exited_at-entered_at)=1800 AND snapshot->>'packageSource'='UNKNOWN'
       FROM r7_visits WHERE id={pair['visitId']};""") == 't'
    assert scalar('SELECT bool_and(points_awarded=0) FROM checkins;') == 't'
    assert stable_money == scalar('SELECT test_combined_money();')
    print('PASS: OWNER manual visit, replay and overlap, no payment, finance or point mutation', flush=True)

    # The replacement purchase is queued: the latest order does not by itself prove
    # a current term. Use the immutable settlement evidence at the actual boundary.
    query('SELECT test_settle(10,2); SELECT test_settle(10,2);')
    assert scalar('SELECT count(*) FROM time_supplement_main(10,clock_timestamp());') == '0'
    assert scalar('''SELECT count(*)=1 AND bool_and(t.order_id=b.order_id AND t.sale_id IS NULL)
      FROM r4_online_private.settlement_before b
      CROSS JOIN LATERAL time_supplement_main(10,b.expiry_before) t WHERE b.member_id=10;''') == 't'
    definition = read("""SELECT real_benefits_admin_action('token-2','create_r6_campaign',gen_random_uuid(),
      '{"title":"Combined points","campaignCode":"COMBINEDPOINTS","campaignKind":"POINTS","description":"Synthetic",
        "usesPerCoupon":1,"bonusDays":0,"perMember":1,"total":4,"activationDurationMinutes":null,
        "expiresAt":"2099-01-01T00:00:00Z","checkoutUnit":"POINTS","checkoutValue":10,"checkoutCap":5}'::jsonb);""")
    p = dict(definitionId=definition['id'], memberCode='BLU-3', recipientGroup='ALL')
    def targeting(action, payload, key='NULL'):
        return f"SELECT real_benefits_admin_action('token-2','{action}',{key},$p${json.dumps(payload)}$p$::jsonb);"
    preview = read(targeting('grant_preview',p))
    targeted = targeting('grant_targeted', {**p, 'proof': preview['proof']}, f"'{uuid4()}'")
    issued = read(targeted)
    assert issued == read(targeted)
    deny(targeting('grant_preview', {**p, 'memberCode': 'BLU-10'}), 'P0001')
    renewal_id = scalar('SELECT id FROM package_payment_orders WHERE member_id=10 ORDER BY confirmed_at DESC LIMIT 1;')
    report = read("SELECT real_finance_action('token-2','read',NULL,'{}');")
    row = next(r for r in report['records'] if r['id'] == f'package:{renewal_id}')
    assert row['category'] == 'ต่อสมาชิก', row
    deny("SELECT real_finance_action('token-1','read',NULL,'{}');", '42501')
    query("""DO $owner_fixture$ DECLARE mid integer; BEGIN
      INSERT INTO members(member_code,full_name,status,role,points) VALUES('BLU-18','Synthetic owner','ACTIVE','MEMBER',0) RETURNING id INTO mid;
      INSERT INTO auth_sessions(member_id,token_hash,expires_at) VALUES(mid,'token-'||mid,now()+interval '1 day');
      PERFORM test_settle(mid,6);
      UPDATE members SET role='OWNER' WHERE id=mid;
    END $owner_fixture$;""")
    own = read("SELECT r4_online_private.preview_online_cancellation('token-2',o.id) FROM package_payment_orders o JOIN members m ON m.id=o.member_id WHERE m.member_code='BLU-18' AND o.status='PAID';")
    if own['eligible']:
        own_cancel = read(f"SELECT r4_online_private.cancel_online_order('token-2','{own['orderId']}','{uuid4()}',{own['amountSatang']},'Synthetic owner self cancellation',true);")
        assert own_cancel['status'] == 'CANCELLED' and own_cancel['orderId'] == own['orderId']
    else:
        raise AssertionError(f'Expected eligible OWNER-owned order in isolated fixture: {own}')
    print('PASS: OWNER account can cancel its own evidenced online package; other MEMBER flow retains original guards', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()
