"""Combined R8 reward entitlement & R7 single-station AUTO IN/OUT multi-connection race tests on native PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
import json
import re
from threading import Barrier
from uuid import uuid4

runner = import_module('r4-staff-free-display-postgres-test')
base = runner.base


def exercise(query):
    def scalar(sql):
        return query(sql).stdout.strip()

    def apply(*names):
        for name in names:
            query((base.MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8'))

    def read(sql):
        return json.loads(scalar(sql))

    def deny(sql, code):
        error = query(sql, check=False)
        assert error.returncode and code in error.stderr, (sql, error.stderr)

    def kiosk(code, direction='AUTO', key=None, at=None):
        call = f"SELECT r7_kiosk_scan('kiosk','desk','{key or uuid4()}','{code}','{direction}');"
        if not at:
            return call
        return f"BEGIN; DO $r10$ BEGIN PERFORM set_config('test.r10_at', '{at}', true); END $r10$; {call} COMMIT;"

    def race(*calls):
        barrier = Barrier(len(calls), timeout=5)

        def invoke(call):
            barrier.wait()
            return read(call)

        with ThreadPoolExecutor(max_workers=len(calls)) as pool:
            return list(pool.map(invoke, calls))

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
          '20261124_R4_online_settlement_evidence', '20261125_R4_online_cancellation',
          '20261202_R347_admission_compatibility', '20261201_R7_manual_visits',
          '20261203_R7_manual_staff_visits', '20261126_R5_finance_import',
          '20261127_R6_coupon_activation', '20261128_R6_promo_scope',
          '20261129_R6_staff_grant_targeting', '20261201_R6_coupon_campaigns',
          '20261203_R6_checkout_coupons', '20261204_R5_finance_lifecycle',
          '20261205_R36_current_term_targeting', '20261206_R6_promo_definition_history',
          '20261207_R8_reward_redemption_entitlement', '20261208_R7_kiosk_auto_inout')

    query("CREATE ROLE r10_untrusted NOLOGIN;")
    assert scalar("""SELECT NOT has_function_privilege('r10_untrusted','r7_kiosk_scan(text,text,uuid,text,text)','EXECUTE')
      AND NOT has_function_privilege('r10_untrusted','r7_visit_action(text,text,uuid,text,text)','EXECUTE')
      AND NOT has_function_privilege('r10_untrusted','reward_redemption_package(integer,timestamptz)','EXECUTE')
      AND NOT has_table_privilege('r10_untrusted','r7_visits','SELECT,INSERT,UPDATE,DELETE');""") == 't'

    query(seed.replace("'catalogVersion',1", "'catalogVersion',2"))
    off_slot = scalar("SELECT CASE WHEN (now() AT TIME ZONE 'Asia/Bangkok')::time < time '12:00' THEN '17:00-17:01' ELSE '05:00-05:01' END;")
    for package, slot in ((1, off_slot), (2, '00:00-24:00'), (6, '00:00-24:00')):
        query(f"SELECT package_catalog_action('token-2','update',gen_random_uuid(),jsonb_build_object('id',{package},'expectedVersion',1,'timeSlot','{slot}'));")
    query("SELECT test_settle(3,6),test_settle(4,2),test_settle(6,6);"
          "INSERT INTO member_cards VALUES(3,'CARD-003',1),(4,'CARD-004',1);"
          "UPDATE members SET avatar_url='https://res.cloudinary.com/demo/image/upload/member3.jpg', points=100 WHERE id=3;"
          "UPDATE members SET avatar_url='https://res.cloudinary.com/demo/image/upload/member4.jpg' WHERE id=4;"
          "UPDATE members SET avatar_url='https://res.cloudinary.com/demo/image/upload/member6.jpg' WHERE id=6;")

    # 1. Verify R8 reward redemption entitlement proof on real stack
    expected_days = int(scalar("SELECT (package_snapshot->>'durationDays')::int FROM package_payment_orders WHERE member_id=3 AND status='PAID' ORDER BY confirmed_at DESC LIMIT 1;"))
    reward = read("""SELECT real_rewards_action('token-2','save',gen_random_uuid(),
      '{"title":"R10 Bottle","description":null,"imageUrl":null,"pointCost":10,"stock":5,"isActive":true}'::jsonb);""")
    redeem = read(f"SELECT real_rewards_action('token-3','redeem',gen_random_uuid(),jsonb_build_object('rewardId',{reward['id']}));")
    assert scalar(f"""SELECT package_days_at_redemption={expected_days}
      AND package_order_at_redemption IS NOT NULL AND package_sale_at_redemption IS NULL
      FROM redemptions WHERE id={redeem['id']};""") == 't'
    print('PASS: R8 reward redemption entitlement snapshot on native stack', flush=True)

    # Pin controllable business clock inside admission functions (keeping auth sessions valid for 5 days)
    query("""UPDATE auth_sessions SET expires_at=clock_timestamp()+interval '5 days' WHERE expires_at>clock_timestamp();
      DO $r10_clock$ DECLARE sig regprocedure; d text; BEGIN
       FOREACH sig IN ARRAY ARRAY[
        'kiosk_checkin(text,text,uuid,text)'::regprocedure,
        'r7_kiosk_scan(text,text,uuid,text,text)'::regprocedure,
        'r7_visit_action(text,text,uuid,text,text)'::regprocedure] LOOP
        d:=replace(pg_get_functiondef(sig),chr(13),'');
        d:=replace(d,'t:=clock_timestamp();',$rep$t:=coalesce(nullif(current_setting('test.r10_at',true),'')::timestamptz,clock_timestamp());$rep$);
        d:=replace(d,'t := clock_timestamp();',$rep$t := coalesce(nullif(current_setting('test.r10_at',true),'')::timestamptz,clock_timestamp());$rep$);
        IF position('test.r10_at' IN d)=0 THEN RAISE EXCEPTION 'Clock patch missed in %',sig; END IF;
        EXECUTE d;
       END LOOP; END $r10_clock$;""")

    # 2. Verify NOT_FOUND member shape + AUTO IN via card + replay + key reuse rejection + 60s entry bounce
    assert read(kiosk('BLU-999')) == {'ok': False, 'reason': 'NOT_FOUND', 'member': None}
    key1 = uuid4()
    entry1 = read(kiosk('CARD-003', key=key1))
    assert entry1['ok'] and entry1['reason'] == 'PAID_ENTRY' and entry1.get('visitId'), entry1
    v1 = entry1['visitId']
    assert read(kiosk('CARD-003', key=key1)) == entry1
    deny(kiosk('BLU-3', key=key1), '22023')
    deny(kiosk('CARD-003', direction='OUT', key=key1), '22023')
    bounce_in = read(kiosk('BLU-3'))
    assert bounce_in['ok'] is False and bounce_in['reason'] == 'BOUNCE' and bounce_in['visitId'] == v1
    assert bounce_in['member'] == {'name': 'Synthetic', 'photo': 'https://res.cloudinary.com/demo/image/upload/member3.jpg'}
    assert scalar(f"SELECT exited_at IS NULL FROM r7_visits WHERE id={v1};") == 't'

    # 3. Concurrent AUTO EXIT race after >= 60 seconds (1 EXIT + 1 BOUNCE) and 10s post-exit bounce
    snap_before = scalar(f"SELECT snapshot::text FROM r7_visits WHERE id={v1};")
    t_exit = scalar("SELECT (clock_timestamp() + interval '65 seconds')::text;")
    race_exit = race(kiosk('CARD-003', at=t_exit), kiosk('BLU-3', at=t_exit))
    assert sorted(x['reason'] for x in race_exit) == ['BOUNCE', 'EXIT'], race_exit
    exit_winner = next(x for x in race_exit if x['reason'] == 'EXIT')
    assert exit_winner['ok'] and exit_winner['visitId'] == v1
    assert exit_winner['member'] == {'name': 'Synthetic', 'photo': 'https://res.cloudinary.com/demo/image/upload/member3.jpg'}
    assert scalar(f"SELECT exited_at IS NOT NULL AND snapshot::text=$s${snap_before}$s$ FROM r7_visits WHERE id={v1};") == 't'
    t_post_exit = scalar("SELECT (clock_timestamp() + interval '67 seconds')::text;")
    post_exit_bounce = read(kiosk('CARD-003', at=t_post_exit))
    assert post_exit_bounce['ok'] is False and post_exit_bounce['reason'] == 'BOUNCE'
    assert post_exit_bounce['member'] == {'name': 'Synthetic', 'photo': 'https://res.cloudinary.com/demo/image/upload/member3.jpg'}
    print('PASS: AUTO IN, replay/conflict, 60s bounce, concurrent AUTO EXIT race, 10s post-exit bounce, photo payload', flush=True)

    # 4. Forgotten previous-day exit (Bangkok date) stays NULL; new Bangkok day admits fresh IN and can EXIT
    day0_entry = read(kiosk('BLU-4'))
    assert day0_entry['ok'] and day0_entry['reason'] == 'PAID_ENTRY', day0_entry
    v_day0 = day0_entry['visitId']
    t_next_day = scalar("SELECT (clock_timestamp() + interval '1 day 2 minutes')::text;")
    day1_entry = read(kiosk('CARD-004', at=t_next_day))
    assert day1_entry['ok'] and day1_entry['reason'] == 'PAID_ENTRY' and day1_entry['visitId'] != v_day0, day1_entry
    v_day1 = day1_entry['visitId']
    assert scalar(f"SELECT exited_at IS NULL AND exit_actor IS NULL FROM r7_visits WHERE id={v_day0};") == 't'
    assert scalar(f"SELECT exited_at IS NULL FROM r7_visits WHERE id={v_day1};") == 't'
    t_next_day_exit = scalar("SELECT (clock_timestamp() + interval '1 day 3 minutes 10 seconds')::text;")
    day1_exit = read(kiosk('BLU-4', at=t_next_day_exit))
    assert day1_exit['ok'] and day1_exit['reason'] == 'EXIT' and day1_exit['visitId'] == v_day1
    assert day1_exit['member'] == {'name': 'Synthetic', 'photo': 'https://res.cloudinary.com/demo/image/upload/member4.jpg'}
    assert scalar(f"SELECT exited_at IS NULL FROM r7_visits WHERE id={v_day0};") == 't'
    print('PASS: forgotten previous-day open visit stays NULL and next Bangkok day admits fresh IN/OUT', flush=True)

    # 5. Concurrent AUTO IN race on BLU-6 (1 PAID_ENTRY + 1 BOUNCE, single open row)
    race_in = race(kiosk('BLU-6'), kiosk('BLU-6'))
    assert sorted(x['reason'] for x in race_in) == ['BOUNCE', 'PAID_ENTRY'], race_in
    assert scalar('SELECT count(*) FROM r7_visits WHERE member_id=6 AND exited_at IS NULL;') == '1'
    print('PASS: concurrent AUTO IN race yields 1 PAID_ENTRY + 1 BOUNCE', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()
