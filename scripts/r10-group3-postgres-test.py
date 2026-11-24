"""Native PostgreSQL 18.4 checks for Group 3 features: decimal PERCENT promos, member categories, and OWNER special access."""
from importlib import import_module
import json
import re
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
          '20261207_R8_reward_redemption_entitlement', '20261208_R7_kiosk_auto_inout',
          '20261209_R6_promo_decimal_percent', '20261210_member_category_and_owner_special_access')

    query('CREATE ROLE g3_untrusted NOLOGIN;')
    assert scalar("""SELECT NOT has_function_privilege('g3_untrusted','member_category_read(text,text)','EXECUTE')
      AND NOT has_function_privilege('g3_untrusted','member_category_update(text,uuid,jsonb)','EXECUTE')
      AND NOT has_function_privilege('g3_untrusted','owner_special_access_read(text,text)','EXECUTE')
      AND NOT has_function_privilege('g3_untrusted','owner_special_access_write(text,uuid,jsonb)','EXECUTE')
      AND NOT has_table_privilege('g3_untrusted','member_categories','SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege('g3_untrusted','owner_special_access','SELECT,INSERT,UPDATE,DELETE');""") == 't'

    query(seed.replace("'catalogVersion',1", "'catalogVersion',2"))
    # Set package 7 to 3,300 THB (330,000 satang) so 9.1% = 30,030 satang (300.30 THB -> 2,999.70 THB payable)
    query("SELECT package_catalog_action('token-2','update',gen_random_uuid(),'{\"id\":7,\"expectedVersion\":1,\"priceSatang\":330000,\"timeSlot\":\"00:00-24:00\"}'::jsonb);")

    # 1. Decimal PERCENT promo (9.1%) via both scoped & core writers + exact satang discount (Option A)
    promo = read("""SELECT r6_create_scoped_promo('token-2',gen_random_uuid(),
      '{"kind":"PROMO","title":"Soft Opening 9.1%","code":"SO91","discountType":"PERCENT","discountValue":9.1,
        "minSatang":0,"maxSatang":null,"maxDiscountSatang":null,"usageLimit":5,"expiresAt":"2099-01-01T00:00:00Z"}'::jsonb);""")
    assert str(promo['discount_value']) == '9.10' or float(promo['discount_value']) == 9.1, promo
    promo_core = read("""SELECT real_benefits_admin_action('token-2','create',gen_random_uuid(),
      '{"kind":"PROMO","title":"Core 9.09%","code":"SO909","discountType":"PERCENT","discountValue":9.09,
        "minSatang":0,"maxDiscountSatang":null,"usageLimit":5,"expiresAt":"2099-01-01T00:00:00Z"}'::jsonb);""")
    assert float(promo_core['discount_value']) == 9.09, promo_core
    deny("""SELECT r6_create_scoped_promo('token-2',gen_random_uuid(),
      '{"kind":"PROMO","title":"Bad Fixed","code":"BADFIX","discountType":"FIXED","discountValue":10.5,
        "minSatang":0,"maxSatang":null,"maxDiscountSatang":null,"usageLimit":5,"expiresAt":"2099-01-01T00:00:00Z"}'::jsonb);""", '22023')
    deny("""SELECT r6_create_scoped_promo('token-2',gen_random_uuid(),
      '{"kind":"PROMO","title":"Bad Pct","code":"BADPCT","discountType":"PERCENT","discountValue":9.123,
        "minSatang":0,"maxSatang":null,"maxDiscountSatang":null,"usageLimit":5,"expiresAt":"2099-01-01T00:00:00Z"}'::jsonb);""", '22023')

    query(f"INSERT INTO benefit_assignments(definition_id,member_id,granted_by) VALUES({promo['id']},3,2);")
    order = read("""SELECT to_jsonb(o) FROM create_catalog_package_payment_order(
      gen_random_uuid(),3,'token-3',gen_random_uuid(),
      '{"package":{"id":7,"catalogVersion":2},"promo":{"code":"SO91"}}'::jsonb,
      '{"promptpay":"0890000000","bankCode":"002","bankAccount":"1234567890","name":"SYNTHETIC"}'::jsonb) o;""")
    assert order['subtotal_satang'] == 330000 and order['discount_satang'] == 30030 and order['amount_satang'] == 299970, order
    print('PASS: 9.1% decimal PERCENT promo creates exact satang discount (30,030) and rejects 3-decimal/fractional FIXED', flush=True)

    # 2. Member categories: ADMIN -> MEMBER ok, ADMIN -> ADMIN denied, OWNER -> ADMIN ok, replay/audit
    assert read("SELECT member_category_read('token-1','BLU-4');") == {'category': 'MEMBER', 'version': 0}
    cat_key = uuid4()
    c_payload = json.dumps({'memberCode': 'BLU-4', 'category': 'TRAINER', 'reason': 'Trainer onboarding', 'expectedVersion': 0})
    assert read(f"SELECT member_category_update('token-1','{cat_key}',$c${c_payload}$c$::jsonb);") == {'ok': True}
    assert read(f"SELECT member_category_update('token-1','{cat_key}',$c${c_payload}$c$::jsonb);") == {'ok': True}
    deny(f"SELECT member_category_update('token-1','{cat_key}',$c${json.dumps({'memberCode': 'BLU-4', 'category': 'STAFF', 'reason': 'Other', 'expectedVersion': 0})}$c$::jsonb);", 'P0001')
    assert read("SELECT member_category_read('token-2','BLU-4');") == {'category': 'TRAINER', 'version': 1}
    deny(f"SELECT member_category_update('token-1','{uuid4()}',$c${json.dumps({'memberCode': 'BLU-1', 'category': 'STAFF', 'reason': 'Self', 'expectedVersion': 0})}$c$::jsonb);", '42501')
    assert read(f"SELECT member_category_update('token-2','{uuid4()}',$c${json.dumps({'memberCode': 'BLU-1', 'category': 'STAFF', 'reason': 'Staff record', 'expectedVersion': 0})}$c$::jsonb);") == {'ok': True}
    print('PASS: member categories role scope, replay, conflict, and persistence', flush=True)

    # 3. OWNER-only special access: ADMIN denied; OWNER grants null-expiry 00:00-24:00 -> kiosk & frontdesk admit with zero points/finance
    deny(f"SELECT owner_special_access_write('token-1','{uuid4()}',$s${json.dumps({'action': 'SET', 'memberCode': 'BLU-4', 'dailySlot': '00:00-24:00', 'expiresAt': None, 'note': 'Trainer', 'reason': 'Try ADMIN', 'expectedVersion': 0})}$s$::jsonb);", '42501')
    assert read(f"SELECT owner_special_access_write('token-2','{uuid4()}',$s${json.dumps({'action': 'SET', 'memberCode': 'BLU-4', 'dailySlot': '00:00-24:00', 'expiresAt': None, 'note': 'Trainer unlimited', 'reason': 'Approved by OWNER', 'expectedVersion': 0})}$s$::jsonb);") == {'ok': True}
    sa = read("SELECT owner_special_access_read('token-1','BLU-4');")
    assert sa['active'] is True and sa['expiresAt'] is None and sa['dailySlot'] == '00:00-24:00' and sa['version'] == 1, sa

    entry = read(f"SELECT r7_kiosk_scan('kiosk','desk','{uuid4()}','BLU-4','AUTO');")
    assert entry['ok'] is True and entry['reason'] == 'PAID_ENTRY' and entry.get('visitId'), entry
    assert scalar(f"SELECT snapshot->>'packageSource'='OWNER_SPECIAL' AND points_awarded=0 FROM r7_visits JOIN checkins ON checkins.id=r7_visits.checkin_id WHERE r7_visits.id={entry['visitId']};") == 't'
    assert scalar("SELECT finance_entries_count FROM (SELECT count(*) AS finance_entries_count FROM finance_entries) t;") == '0'

    # Close BLU-4 visit via OUT, then verify SUSPENDED still blocks even with active special access
    assert read(f"SELECT r7_visit_action('token-1','desk','{uuid4()}','BLU-4','OUT');")['reason'] == 'EXIT'
    query("UPDATE members SET status='SUSPENDED' WHERE id=4;")
    assert read(f"SELECT r7_kiosk_scan('kiosk','desk','{uuid4()}','BLU-4','IN');")['reason'] == 'SUSPENDED'
    query("UPDATE members SET status='EXPIRED' WHERE id=4;")

    # Expired special access & revoke on BLU-5 -> no longer admitted via special access
    assert read(f"SELECT owner_special_access_write('token-2','{uuid4()}',$s${json.dumps({'action': 'SET', 'memberCode': 'BLU-5', 'dailySlot': '00:00-24:00', 'expiresAt': '2020-01-01T00:00:00Z', 'note': 'Past expiry', 'reason': 'Test expiry', 'expectedVersion': 0})}$s$::jsonb);") == {'ok': True}
    expired_scan = read(f"SELECT r7_kiosk_scan('kiosk','desk','{uuid4()}','BLU-5','IN');")
    assert expired_scan['reason'] in ('NO_ENTITLEMENT', 'CLOSED'), expired_scan
    assert read(f"SELECT owner_special_access_write('token-2','{uuid4()}',$s${json.dumps({'action': 'REVOKE', 'memberCode': 'BLU-4', 'reason': 'Left gym', 'expectedVersion': 1})}$s$::jsonb);") == {'ok': True}
    assert read("SELECT owner_special_access_read('token-2','BLU-4');")['active'] is False
    print('PASS: OWNER-only special access (null expiry, kiosk admit, suspended block, expiry & revoke)', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()
