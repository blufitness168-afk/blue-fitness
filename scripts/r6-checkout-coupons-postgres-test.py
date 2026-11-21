"""R6 checkout with actual SQL and synthetic evidence, in a disposable loopback cluster."""
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

    def deny(sql, code='P0001'):
        result = query(sql, check=False)
        assert result.returncode and code in result.stderr, (code, result.stdout, result.stderr)

    def apply(*names):
        for name in names:
            query((base.MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8'))

    def staff(action, payload, key=None, actor=1):
        k = 'NULL' if action == 'grant_preview' else f"'{key or uuid4()}'"
        return f"SELECT real_benefits_admin_action('token-{actor}','{action}',{k},$p${json.dumps(payload)}$p$::jsonb);"

    def checkout(cid, mid=4, key=None, promo=None, version=1, token=None):
        data = dict(package=dict(id=2, catalogVersion=version), checkoutCouponId=cid, promo=promo)
        receiver = dict(promptpay='0890000000', bankCode='002', bankAccount='1234567890', name='SYNTHETIC')
        return (f"SELECT to_jsonb(o) FROM r6_create_checkout_coupon_order(gen_random_uuid(),{mid},'{token or f'token-{mid}'}',"
                f"'{key or uuid4()}',$p${json.dumps(data)}$p$,$r${json.dumps(receiver)}$r$) o;")

    def options(mid=4, token='token-4'):
        return json.loads(scalar(f"SELECT r6_checkout_coupon_options({mid},'{token}');"))

    def campaign(**kw):
        return dict(title='Checkout fixture', campaignCode='C'+uuid4().hex.upper(), campaignKind='DISCOUNT', description='Synthetic',
                    usesPerCoupon=2, bonusDays=0, perMember=1, total=3, activationDurationMinutes=None,
                    expiresAt='2099-01-01T00:00:00Z', checkoutUnit='PERCENT', checkoutValue=5, checkoutCap=2500) | kw

    def create(**kw):
        return json.loads(scalar(staff('create_r6_campaign', campaign(**kw))))['id']

    def grant(did, mid=4, activate=True):
        p = dict(definitionId=did, memberCode=f'BLU-{mid}', recipientGroup='ALL')
        proof = json.loads(scalar(staff('grant_preview', p)))['proof']
        row = json.loads(scalar(staff('grant_targeted', {**p, 'proof': proof})))
        if activate:
            query(f"SELECT r6_activate_coupon('token-{mid}',{row['coupon_id']});")
        return row

    def claim(oid, mid):
        return scalar(f"SELECT id FROM claim_package_payment_attempt('{oid}',{mid},'token-{mid}',gen_random_uuid(),repeat('a',64),false);")

    def evidence(order, aid, amount):
        query(f"""UPDATE package_payment_attempts SET state='VERIFIED',evidence=jsonb_build_object(
        'transRef','synthetic-{aid}','paidAt',clock_timestamp(),'amountSatang',{amount},'bankCode','002',
        'receiverEvidence','REGISTERED_ACCOUNT_V2','providerStrategy','EASYSLIP_V2_REGISTERED_ACCOUNT','orderId','{order['id']}',
        'receiverIdentity',jsonb_build_object('matchingType','BANK_ACCOUNT','bankCode','002','bankAccount','1234567890',
        'name','SYNTHETIC','expectedName','SYNTHETIC','normalizedName','SYNTHETIC')) WHERE id='{aid}';""")

    fixture = (base.ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    seed = (base.ROOT / 'scripts/r4-staff-free-postgres-test.sql').read_text(encoding='utf-8').split('SELECT test_settle(3)', 1)[0]
    query(re.search(r'await db\.exec\(`([\s\S]*?)`\);', fixture)[1])
    query('ALTER TABLE members ADD COLUMN avatar_changed boolean DEFAULT false;')
    apply(*base.BASE, '20261024_real_rewards')
    query('ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;')
    apply(*base.CATALOG, '20261118_R2_member_cards', '20261118_R2_staff_avatar', *base.R3,
          '20261118_R4_online_provenance', '20261119_R4_staff_free_foundation', '20261119_R4_staff_free_admission',
          '20261119_R4_staff_free_finance', '20261119_R4_staff_free_writer', runner.DISPLAY, '20261120_R4_staff_free_z_cancellation',
          '20261121_R4_staff_free_purchase_guard', '20261122_R4_staff_paid_transfer', '20261123_R4_staff_paid_cancellation',
          '20261124_R4_online_settlement_evidence', '20261125_R4_online_cancellation',
          '20261127_R6_coupon_activation', '20261128_R6_promo_scope', '20261129_R6_staff_grant_targeting', '20261201_R6_coupon_campaigns')
    query(seed + 'SELECT test_settle(4,2),test_settle(5,2),test_settle(6,2),test_settle(7,2),test_settle(8,2);')
    old = "SELECT jsonb_agg(to_jsonb(o)-ARRAY['checkout_coupon_id','checkout_coupon_snapshot','checkout_coupon_points'] ORDER BY id) FROM package_payment_orders o;"
    before = scalar(old)
    deny(checkout(1), '42883')
    assert scalar(old) == before
    apply('20261203_R6_checkout_coupons')
    assert scalar(old) == before
    query('CREATE ROLE checkout_untrusted NOLOGIN;')
    deny('SET ROLE checkout_untrusted;' + checkout(1), '42501')
    deny("SET ROLE checkout_untrusted; SELECT r6_checkout_coupon_options(4,'token-4');", '42501')
    for invalid in (dict(checkoutValue=101), dict(checkoutUnit='POINTS'), dict(checkoutCap=0), dict(campaignKind='GIFT')):
        r = query(staff('create_r6_campaign', campaign(**invalid)), check=False)
        assert r.returncode and any(code in r.stderr for code in ('22023', '23514')), r.stderr
    deny(staff('create_r6_campaign', campaign(), actor=4), '42501')
    creation = staff('create_r6_campaign', campaign())
    definition = json.loads(scalar(creation))
    assert json.loads(scalar(creation)) == definition
    leaf = grant(definition['id'], activate=False)
    cid = leaf['coupon_id']
    deny(checkout(cid), 'P6C01')
    assert options() == []
    query(f"SELECT r6_activate_coupon('token-4',{cid});")
    assert [c['id'] for c in options()] == [cid]
    assert options(4, 'token-5') == []
    deny(checkout(cid, mid=5), 'P6C01')
    deny(checkout(cid, token='revoked'), '42501')
    deny(checkout(cid, promo={'code': 'OTHER'}), '22023')
    deny(checkout(cid, version=2))
    deny(staff('consume', {'couponId': cid}))
    key = uuid4()
    order = json.loads(scalar(checkout(cid, key=key)))
    oid = order['id']
    assert order['discount_satang'] == 2500 and order['amount_satang'] == order['subtotal_satang'] - 2500
    assert order['points_earned'] == order['amount_satang'] // 2000
    assert scalar(f'SELECT used_count FROM coupons WHERE id={cid};') == '0' and options() == []
    assert json.loads(scalar(checkout(cid, key=key))) == order
    deny(checkout(cid+1, key=key), '22023')
    deny(checkout(cid, key=key, version=2), '22023')
    deny(staff('cancel', {'assignmentId': leaf['id']}))
    deny(f"UPDATE package_payment_orders SET checkout_coupon_snapshot='{{}}' WHERE id='{oid}';")
    query(f"UPDATE package_payment_orders SET status='REJECTED',rejection_reason='CUSTOMER_CANCELLED' WHERE id='{oid}';")
    assert [c['id'] for c in options()] == [cid]
    assert json.loads(scalar(checkout(cid, key=key)))['status'] == 'REJECTED'
    print('PASS: historical orders, ACL, campaign validation, activation and ownership, capped discount, replay and safe release', flush=True)

    barrier = Barrier(2, timeout=10)

    def race(sql):
        barrier.wait()
        return query('BEGIN; SELECT pg_backend_pid();'+sql+'SELECT pg_sleep(0.15); COMMIT;', check=False)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(race, [checkout(cid), checkout(cid)]))
    assert results[0].stdout.splitlines()[0] != results[1].stdout.splitlines()[0]
    assert sorted(r.returncode == 0 for r in results) == [False, True]
    order = json.loads(next(r for r in results if r.returncode == 0).stdout.splitlines()[1])
    aid = claim(order['id'], 4)
    assert scalar(f"BEGIN; UPDATE package_payment_attempts SET state='UNKNOWN' WHERE id='{aid}';"
                  f"SELECT r6_checkout_coupon_held({cid}); ROLLBACK;") == 't'
    assert options() == []
    deny(staff('cancel', {'assignmentId': leaf['id']}))
    evidence(order, aid, order['amount_satang'])
    settle = f"SELECT status FROM finalize_package_payment('{order['id']}',4,'token-4','{aid}');"
    assert scalar(settle) == scalar(settle) == 'PAID'
    assert scalar(f'SELECT used_count FROM coupons WHERE id={cid};') == '1'
    assert scalar(f'SELECT count(*) FROM benefit_consumptions WHERE coupon_id={cid};') == '1'
    history = json.loads(scalar("SELECT r6_coupon_history('token-4',false,NULL,NULL,NULL,'DISCOUNT',NULL,NULL);"))
    assert history['rows'][0]['id'] == cid and history['rows'][0]['used_at']
    print('PASS: concurrent checkout, unresolved hold, idempotent finalization and member usage history', flush=True)

    points = grant(create(campaignKind='POINTS', checkoutUnit='POINTS', checkoutValue=300, checkoutCap=45), 5)['coupon_id']
    query("SELECT package_catalog_action('token-1','update',gen_random_uuid(),'{\"id\":2,\"expectedVersion\":1,\"bonusPoints\":12}');")
    order = json.loads(scalar(checkout(points, mid=5, version=2)))
    oid = order['id']
    assert order['discount_satang'] == 0 and order['checkout_coupon_points'] == 45
    assert order['points_earned'] == order['amount_satang'] // 2000 + 12 + 45
    aid = claim(oid, 5)
    evidence(order, aid, order['amount_satang'])
    settle = f"SELECT status FROM finalize_package_payment('{oid}',5,'token-5','{aid}');"
    query(f"""CREATE FUNCTION test_reject_use() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.coupon_id={points} THEN RAISE EXCEPTION 'Synthetic write failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_reject_use BEFORE INSERT ON benefit_consumptions FOR EACH ROW EXECUTE FUNCTION test_reject_use();""")
    balance = scalar('SELECT points FROM members WHERE id=5;')
    deny(settle)
    assert scalar('SELECT points FROM members WHERE id=5;') == balance
    assert scalar(f"SELECT count(*) FROM package_payment_point_ledger WHERE order_id='{oid}';") == '0'
    assert scalar(f'SELECT used_count FROM coupons WHERE id={points};') == '0'
    query('DROP TRIGGER test_reject_use ON benefit_consumptions;')
    assert scalar(settle) == scalar(settle) == 'PAID'
    assert scalar(f"SELECT delta FROM package_payment_point_ledger WHERE order_id='{oid}';") == str(order['points_earned'])
    assert int(scalar('SELECT points FROM members WHERE id=5;')) == int(balance) + order['points_earned']
    assert scalar(f"SELECT r4_online_private.cancellation_eligible('{oid}',5,clock_timestamp());") == 'f'
    full = grant(create(checkoutValue=100, checkoutCap=None), 6)['coupon_id']
    deny(checkout(full, mid=6, version=2), 'P6C02')
    fixed = grant(create(checkoutUnit='SATANG', checkoutValue=1001, checkoutCap=None, activationDurationMinutes=0), 7)['coupon_id']
    query(f"UPDATE coupons SET created_at=created_at-interval '20 minutes',activated_at=activated_at-interval '20 minutes',expire_date=expire_date-interval '20 minutes' WHERE id={fixed};")
    deny(checkout(fixed, mid=7, version=2), 'P6C01')
    assert options(7, 'token-7') == []
    fixed = grant(create(checkoutUnit='SATANG', checkoutValue=1001, checkoutCap=None), 8)['coupon_id']
    order = json.loads(scalar(checkout(fixed, mid=8, version=2)))
    assert order['discount_satang'] == 1001
    aid = claim(order['id'], 8)
    evidence(order, aid, order['subtotal_satang'])
    deny(f"SELECT status FROM finalize_package_payment('{order['id']}',8,'token-8','{aid}');")
    assert scalar(f"SELECT status FROM package_payment_orders WHERE id='{order['id']}';") == 'PENDING'
    assert scalar(f'SELECT used_count FROM coupons WHERE id={fixed};') == '0'
    assert scalar(f'SELECT r6_checkout_coupon_held({fixed});') == 't'
    print('PASS: capped bonus on top of package award, atomic rollback and retry, cancellation blocker, no zero-pay order, expiry, fixed satang and amount mismatch', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()
