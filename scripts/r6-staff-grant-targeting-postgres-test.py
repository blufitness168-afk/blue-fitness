"""R6 targeting on disposable native PostgreSQL; never uses app credentials."""
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

    def admin(action, payload, key='NULL', token='token-1'):
        return f"SELECT real_benefits_admin_action('{token}','{action}',{key},$p${json.dumps(payload)}$p$::jsonb);"

    def uuid():
        return f"'{uuid4()}'"

    def definition(action='create_r6_coupon', **overrides):
        value = dict(kind='COUPON', title='Native grant fixture', couponType='FRIEND_PASS', quota=1,
                     bonusDays=0, expiresAt='2099-01-01T00:00:00Z')
        if action == 'create_r6_coupon':
            value['activationDurationMinutes'] = 0
        return json.loads(scalar(admin(action, {**value, **overrides}, uuid())))['id']

    def selection(did, code='BLU-4', group='30'):
        return dict(definitionId=did, memberCode=code, recipientGroup=group)

    def preview(did, code='BLU-4', group='30', token='token-1'):
        return json.loads(scalar(admin('grant_preview', selection(did, code, group), token=token)))

    def payload(row):
        return {field: row[field] for field in ('definitionId', 'memberCode', 'recipientGroup', 'proof')}

    def snapshot():
        return scalar('''SELECT jsonb_build_array(
          (SELECT jsonb_agg(c ORDER BY id) FROM coupons c),
          (SELECT jsonb_agg(a ORDER BY id) FROM benefit_assignments a),
          (SELECT jsonb_agg(a ORDER BY actor_id,request_key) FROM benefit_action_audit a),
          (SELECT jsonb_agg(m ORDER BY id) FROM members m),
          (SELECT jsonb_agg(o ORDER BY id) FROM package_payment_orders o));''')

    fixture = (base.ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    seed = (base.ROOT / 'scripts/r4-staff-free-postgres-test.sql').read_text(encoding='utf-8').split('SELECT test_settle(3)', 1)[0]
    migration = (base.MIGRATIONS / '20261129_R6_staff_grant_targeting.sql').read_text(encoding='utf-8')
    query(re.search(r'await db\.exec\(`([\s\S]*?)`\);', fixture)[1])
    query('ALTER TABLE members ADD COLUMN avatar_changed boolean DEFAULT false;')
    apply(*base.BASE, '20261024_real_rewards')
    query('ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;')
    apply(*base.CATALOG, '20261118_R2_member_cards', '20261118_R2_staff_avatar', *base.R3)
    query(seed)
    deny(migration, '0A000')
    historical = definition('create')
    old = admin('grant', dict(definitionId=historical, memberCode='BLU-3'), uuid())
    old_receipt = scalar(old)
    apply('20261127_R6_coupon_activation', '20261128_R6_promo_scope')
    before = snapshot()
    d = definition()
    deny(admin('grant_preview', selection(d)), '22023')
    deny(admin('grant_targeted', {**selection(d), 'proof': '0' * 64}, uuid()), '22023')
    # Exercise installation on stock R3; use an outer rollback in this scratch DB only.
    query(migration.rsplit('COMMIT;', 1)[0] + 'ROLLBACK;')
    assert 'grantTargetingReady' not in json.loads(scalar(admin('list', {})))
    assert json.loads(before)[0:2] == json.loads(snapshot())[0:2]
    apply('20261118_R4_online_provenance', '20261118_R5_finance', '20261119_R4_staff_free_foundation',
          '20261119_R4_staff_free_admission', '20261119_R4_staff_free_finance', '20261119_R4_staff_free_writer',
          runner.DISPLAY, '20261120_R4_staff_free_z_cancellation', '20261121_R4_staff_free_purchase_guard',
          '20261122_R4_staff_paid_transfer', '20261123_R4_staff_paid_cancellation',
          '20261124_R4_online_settlement_evidence', '20261125_R4_online_cancellation')
    deny(migration.replace('BEGIN;', '''BEGIN;
      ALTER FUNCTION real_benefits_admin_action(text,text,uuid,jsonb) SECURITY DEFINER;''', 1), '0A000')
    query('''INSERT INTO r4_online_private.reader_cutover VALUES (1);
      SELECT test_settle(3,6),test_settle(4,2),test_settle(5,3),test_settle(6,4),test_settle(7,5),test_settle(8,6),test_settle(9,6);
      INSERT INTO member_cards(member_id,card_code,version) VALUES(4,'CARD-123456',1);
      CREATE ROLE targeted_untrusted NOLOGIN;''')
    before = snapshot()
    query(migration)
    assert snapshot() == before and scalar(old) == old_receipt
    assert json.loads(scalar(admin('list', {})))['grantTargetingReady'] is True
    deny(admin('grant', dict(definitionId=d, memberCode='BLU-4'), uuid()), '22023')
    deny('SET ROLE targeted_untrusted;' + admin('grant_preview', selection(d)), '42501')
    for token in ('token-3', 'kiosk', 'revoked', 'expired', 'not-found'):
        deny(admin('grant_preview', selection(d), token=token), '42501')
    deny('BEGIN ISOLATION LEVEL REPEATABLE READ;' + admin('grant_preview', selection(d)), '0A000')
    for member, group in ((3, '1'), (4, '30'), (5, '90'), (6, '180'), (7, '365')):
        assert preview(d, f'BLU-{member}', group)['durationDays'] == int(group)
    card = preview(d, 'CARD-123456')
    assert card == preview(d) and card['memberCode'] == 'BLU-4' and len(card['proof']) == 64
    assert set(card) == {'definitionId', 'definitionTitle', 'memberCode', 'recipientGroup', 'durationDays', 'packageExpiresAt', 'fullName', 'proof'}
    assert preview(d, group='ALL')['durationDays'] == 30
    for code, group in (('BLU-4', '1'), ('BLU-10', 'ALL'), ('CARD-999', 'ALL')):
        deny(admin('grant_preview', selection(d, code, group)))
    deny(admin('grant_preview', selection(d, group='31')), '22023')
    deny(admin('grant_preview', selection(d), uuid()), '22023')
    deny(admin('grant_targeted', {**payload(card), 'proof': '0' * 64}, uuid()))
    deny(admin('grant_targeted', {**payload(card), 'recipientGroup': 'ALL'}, uuid()))
    deny(admin('grant_targeted', payload(card), uuid(), 'token-2'))
    assert snapshot() == before
    print('PASS: guarded install on R3 and R4-cancellation stacks, historical receipt/data retained, old writer closed, SQL auth and read-only BLU/CARD previews for all five groups + ALL', flush=True)

    # Deactivate and edit live catalog; paid snapshot is still the targeting source.
    query('UPDATE package_catalog SET duration_days=31,is_active=false,version=2 WHERE id=2;')
    assert preview(d) == card
    key = uuid()
    grant = admin('grant_targeted', payload(card), key)
    competing = admin('grant_targeted', payload(preview(d, token='token-2')), uuid(), 'token-2')
    barrier = Barrier(2, timeout=10)

    def race(sql):
        barrier.wait()
        return query('BEGIN; SELECT pg_backend_pid();' + sql + 'SELECT pg_sleep(0.2); COMMIT;', check=False)

    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(race, (grant, competing)))
    assert rows[0].stdout.splitlines()[0] != rows[1].stdout.splitlines()[0]
    assert sorted(r.returncode == 0 for r in rows) == [False, True]
    assert any('P0001' in r.stderr for r in rows)
    winner = next(i for i, r in enumerate(rows) if r.returncode == 0)
    receipt = json.loads(rows[winner].stdout.splitlines()[1])
    mint = receipt['coupon_id']
    assert scalar(f'SELECT activated_at IS NULL AND activation_duration_minutes=0 AND used_count=0 FROM coupons WHERE id={mint};') == 't'
    assert scalar(f'SELECT count(*) FROM benefit_assignments WHERE definition_id={d};') == '1'
    deny(admin('grant_targeted', {**payload(card), 'recipientGroup': 'ALL'}, key), '22023' if winner == 0 else 'P0001')
    print('PASS: snapshot survives catalog edits; two-connection grant race mints exactly one pending-activation coupon', flush=True)

    p = json.loads(scalar("SELECT r6_create_scoped_promo('token-2',gen_random_uuid(),"
                          "'{\"kind\":\"PROMO\",\"title\":\"Scope\",\"code\":\"NATIVE\",\"discountType\":\"FIXED\",\"discountValue\":100,\"minSatang\":0,\"maxDiscountSatang\":null,\"maxSatang\":200000,\"eligiblePackageIds\":[6],\"usageLimit\":10,\"expiresAt\":\"2099-01-01T00:00:00Z\"}');"))['id']
    # Confirm through a non-owner backend using explicit invoker privileges, not superuser bypass.
    query('''CREATE ROLE targeted_backend NOLOGIN;
      GRANT EXECUTE ON FUNCTION real_benefits_admin_action(text,text,uuid,jsonb),
        r3_override_current_order(integer,timestamptz), package_catalog_daily_slot_valid(text) TO targeted_backend;
      GRANT SELECT,UPDATE ON auth_sessions,members,benefit_definitions TO targeted_backend;
      GRANT SELECT ON member_cards,package_payment_orders,package_payment_point_ledger,payment_transfer_refs TO targeted_backend;
      GRANT SELECT,INSERT ON benefit_action_audit,benefit_assignments TO targeted_backend;
      GRANT USAGE ON SEQUENCE benefit_assignments_id_seq TO targeted_backend;''')
    backend = 'SET ROLE targeted_backend; '
    promo_preview = admin('grant_preview', selection(p, 'BLU-3', '1'))
    deny(backend + promo_preview, '42501')
    query('''GRANT USAGE ON SCHEMA r4_staff_private,r4_online_private TO targeted_backend;
      GRANT SELECT ON r4_staff_private.free_sales,r4_online_private.cancellations,
        r4_online_private.active_paid_orders TO targeted_backend;''')
    promo = json.loads(scalar(backend + admin('grant_targeted', payload(json.loads(scalar(backend + promo_preview))), uuid())))
    assert promo['coupon_id'] is None
    stale = {mid: admin('grant_targeted', payload(preview(d, f'BLU-{mid}', 'ALL')), uuid()) for mid in (3, 5, 6, 7, 8, 9)}
    query('''UPDATE members SET status='EXPIRED' WHERE id=3;
      UPDATE members SET expire_date=expire_date - interval '1 second' WHERE id=4;
      UPDATE members SET expire_date=now() WHERE id=5;
      SELECT test_settle(6,6);
      SELECT test_buy(7,6);
      SELECT r4_staff_private.record_free_sale('token-1',gen_random_uuid(),'BLU-9',
        r4_staff_private.preview_free_sale('token-1','BLU-9'),'Synthetic future term');
      SELECT r4_online_private.cancel_online_order('token-2',id,gen_random_uuid(),amount_satang,'Synthetic refund',true)
        FROM package_payment_orders WHERE member_id=8;''')
    # Cancellation must not be accepted even if the legacy aggregate happens to match again.
    query("UPDATE members m SET status='ACTIVE',expire_date=o.membership_expires_at FROM package_payment_orders o WHERE m.id=o.member_id AND m.id=8;")
    before = snapshot()
    for attempt in stale.values():
        deny(attempt)
    d2 = definition()
    deny(admin('grant_preview', selection(d2, group='ALL')))
    assert json.loads(before)[0:2] == json.loads(snapshot())[0:2]
    assert json.loads(scalar((grant, competing)[winner])) == receipt
    assert scalar(f"SELECT status FROM coupons WHERE id={mint};") == 'AVAILABLE'
    print('PASS: scoped promo grant, expiry/status/aggregate drift, renewal, pending payment, staff term and online refund deny; durable replay survives drift', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()
