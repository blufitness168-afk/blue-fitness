"""Promo definition, recipient quota and history on a disposable combined PostgreSQL stack."""
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

    def read(sql):
        return json.loads(scalar(sql))

    def deny(sql, code):
        result = query(sql, check=False)
        assert result.returncode and code in result.stderr, (code, result.stderr)

    def apply(*names):
        for name in names:
            query((base.MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8'))

    def payload(value):
        return f'$p${json.dumps(value)}$p$::jsonb'

    def action(name, body, actor=1, key=None):
        key = 'NULL' if name == 'grant_preview' else f"'{key or uuid4()}'"
        return f"SELECT real_benefits_admin_action('token-{actor}','{name}',{key},{payload(body)});"

    def create(data, key=None):
        return f"SELECT r6_create_scoped_promo('token-1','{key or uuid4()}',{payload(data)});"

    def grant(did, mid, actor=1):
        data = dict(definitionId=did, memberCode=f'BLU-{mid}', recipientGroup='30')
        proof = read(action('grant_preview', data, actor))['proof']
        return action('grant_targeted', {**data, 'proof': proof}, actor)

    def hist(token='token-1', staff='true', args='NULL,NULL,NULL,NULL,NULL,NULL'):
        return f"SELECT r6_promo_history('{token}',{staff},{args});"

    fixture = (base.ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    seed = (base.ROOT / 'scripts/r4-staff-free-postgres-test.sql').read_text(encoding='utf-8').split('SELECT test_settle(3)', 1)[0]
    query("CREATE TYPE scanner_type AS ENUM ('WEB_CAMERA','HARDWARE_USB','API_GATE');" +
          re.search(r'await db\.exec\(`([\s\S]*?)`\);', fixture)[1].replace('scanner_type text', 'scanner_type scanner_type'))
    query('ALTER TABLE members ADD COLUMN avatar_changed boolean DEFAULT false;')
    apply(*base.BASE, '20261024_real_rewards')
    query('ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;')
    apply(*base.CATALOG, '20261118_R2_member_cards', '20261118_R2_staff_avatar', *base.R3,
          '20261118_R4_online_provenance', '20261118_R5_finance', '20261119_R4_staff_free_foundation',
          '20261119_R4_staff_free_admission', '20261119_R4_staff_free_finance', '20261119_R4_staff_free_writer',
          runner.DISPLAY, '20261120_R4_staff_free_z_cancellation', '20261121_R4_staff_free_purchase_guard',
          '20261122_R4_staff_paid_transfer', '20261123_R4_staff_paid_cancellation', '20261124_R4_online_settlement_evidence',
          '20261125_R4_online_cancellation', '20261202_R347_admission_compatibility', '20261126_R5_finance_import',
          '20261127_R6_coupon_activation', '20261128_R6_promo_scope', '20261129_R6_staff_grant_targeting',
          '20261201_R6_coupon_campaigns', '20261203_R6_checkout_coupons', '20261204_R5_finance_lifecycle',
          '20261205_R36_current_term_targeting')
    query(seed + 'SELECT test_settle(4,2),test_settle(5,2),test_settle(6,2),test_settle(7,2);')
    spec = dict(kind='PROMO', title='Renewal offer', code='LEGACY', discountType='PERCENT', discountValue=5,
                minSatang=90000, maxSatang=110000, maxDiscountSatang=4000, usageLimit=1,
                eligiblePackageIds=[2], expiresAt='2099-01-01T00:00:00Z')
    legacy = create(spec)
    legacy_definition = read(legacy)
    old = read(grant(legacy_definition['id'], 4))
    before = scalar('SELECT jsonb_agg(o ORDER BY id) FROM package_payment_orders o;')
    apply('20261206_R6_promo_definition_history')
    assert scalar('SELECT jsonb_agg(o ORDER BY id) FROM package_payment_orders o;') == before
    assert read(legacy) == legacy_definition
    legacy_row = read(hist(args="NULL,'BLU-4',NULL,'LEGACY',NULL,NULL"))['rows'][0]
    assert legacy_row['id'] == old['id'] and legacy_row['description'] is None
    query('CREATE ROLE promo_history_untrusted NOLOGIN;')
    deny('SET ROLE promo_history_untrusted;' + hist(), '42501')
    deny(hist('token-4'), '42501')
    for token in ('revoked', 'expired', 'kiosk'):
        deny(hist(token, 'false'), '42501')
    for patch in ({'promoRecipientLimit': 0}, {'promoRecipientLimit': '2'}, {'promoDescription': ' '}, {'promoDescription': 55}):
        deny(create({**spec, **patch, 'code': 'INVALID'}), '22023')
    request_key = uuid4()
    body = {**spec, 'code': 'CHECK5', 'promoDescription': '  Synthetic terms  ', 'promoRecipientLimit': 2}
    receipt = read(create(body, request_key))
    assert receipt == read(create(body, request_key)) and receipt['promo_description'] == 'Synthetic terms'
    assert receipt['promo_recipient_limit'] == 2 and receipt['usage_limit'] == 1
    deny(create({**body, 'promoRecipientLimit': 3}, request_key), '22023')
    did = receipt['id']
    assigned = read(grant(did, 4))
    race_calls = [grant(did, 5), grant(did, 6, 2)]
    barrier = Barrier(2, timeout=10)

    def race(sql):
        barrier.wait()
        return query('BEGIN; SELECT pg_backend_pid();'+sql+'SELECT pg_sleep(0.15); COMMIT;', check=False)

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcome = list(pool.map(race, race_calls))
    assert sorted(r.returncode == 0 for r in outcome) == [False, True]
    assert any('P6001' in r.stderr for r in outcome)
    winner = json.loads(next(r for r in outcome if not r.returncode).stdout.splitlines()[1])
    query(action('cancel', {'assignmentId': winner['id']}))
    deny(grant(did, 7), 'P6001')
    assert read(hist('token-4','false',"NULL,NULL,'renewal','CHECK5','ASSIGNED',30"))['rows'][0]['id'] == assigned['id']
    assert read(hist('token-7','false'))['rows'] == []
    assert len(read(hist(args="NULL,NULL,NULL,'CHECK5','CANCELLED',30"))['rows']) == 1
    receiver = payload(dict(promptpay='0890000000', bankCode='002', bankAccount='1234567890', name='SYNTHETIC'))
    quote = payload(dict(package=dict(id=2, catalogVersion=1), promo=dict(code='CHECK5')))
    buy = f"SELECT to_jsonb(o) FROM create_catalog_package_payment_order(gen_random_uuid(),4,'token-4',gen_random_uuid(),{quote},{receiver}) o;"
    order = read(buy)
    assert order['discount_satang'] == 4000
    oid = order['id']
    assert read(hist(args="NULL,NULL,NULL,'CHECK5','RESERVED',30"))['rows'][0]['used_at'] is None
    query(f"UPDATE package_payment_orders SET status='REJECTED',rejection_reason='CUSTOMER_CANCELLED' WHERE id='{oid}';")
    assert read(hist(args="NULL,NULL,NULL,'CHECK5','ASSIGNED',30"))['rows'][0]['id'] == assigned['id']
    order = read(buy)
    oid, aid = order['id'], uuid4()
    query(f"SELECT claim_package_payment_attempt('{oid}',4,'token-4','{aid}',repeat('a',64),false);")
    proof = dict(transRef=str(uuid4()), amountSatang=order['amount_satang'], bankCode='002', orderId=oid,
                 paidAt=order['created_at'], receiverEvidence='REGISTERED_ACCOUNT_V2', providerStrategy='EASYSLIP_V2_REGISTERED_ACCOUNT',
                 receiverIdentity=dict(matchingType='BANK_ACCOUNT', bankCode='002', bankAccount='1234567890',
                                       name='SYNTHETIC', expectedName='SYNTHETIC', normalizedName='SYNTHETIC'))
    query(f"UPDATE package_payment_attempts SET state='VERIFIED',evidence={payload(proof)} WHERE id='{aid}';")
    assert scalar(f"SELECT status FROM finalize_package_payment('{oid}',4,'token-4','{aid}');") == 'PAID'
    used = read(hist('token-2', args="NULL,'BLU-4','RENEW','CHECK5','USED',30"))['rows'][0]
    assert used['used_at'] and used['description'] == 'Synthetic terms'
    assert not ({'amount_satang', 'order_id', 'receiver_snapshot', 'member_id'} & used.keys())
    query(f"INSERT INTO benefit_definitions(kind,title,code,discount_type,discount_value,expires_at,created_by) SELECT 'PROMO','Pagination','PAGE'||i,'FIXED',100,now()+interval '1 day',1 FROM generate_series(1,51) i; INSERT INTO benefit_assignments(definition_id,member_id,granted_by) SELECT id,4,1 FROM benefit_definitions WHERE title='Pagination';")
    first = read(hist('token-4', 'false', "NULL,NULL,'Pagination',NULL,NULL,NULL"))
    second = read(hist('token-4', 'false', f"{first['nextBefore']},NULL,'Pagination',NULL,NULL,NULL"))
    assert len(first['rows']) == 50 and len(second['rows']) == 1 and second['nextBefore'] is None
    assert len({row['id'] for row in first['rows'] + second['rows']}) == 51
    print('PASS: combined R36/R347 stack, unchanged old orders/replay, concurrent recipient cap, cancellation, scoped discount, reservation and use history, ownership/ACL and pagination', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()
