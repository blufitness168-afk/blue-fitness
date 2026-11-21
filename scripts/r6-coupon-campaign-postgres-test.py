"""R6 campaign and history integration in a disposable native PostgreSQL cluster."""
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
        assert result.returncode and code in result.stderr, (code, result.stderr)

    def apply(*names):
        for name in names:
            query((base.MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8'))

    def admin(action, payload, key=None, actor=1):
        key = 'NULL' if action in ('list', 'grant_preview') else f"'{key or uuid4()}'"
        return f"SELECT real_benefits_admin_action('token-{actor}','{action}',{key},$p${json.dumps(payload)}$p$::jsonb);"

    def selection(did, member=4):
        return dict(definitionId=did, memberCode=f'BLU-{member}', recipientGroup='ALL')

    def preview(did, member=4, actor=1):
        p = selection(did, member)
        row = json.loads(scalar(admin('grant_preview', p, actor=actor)))
        return {**p, 'proof': row['proof']}

    def history(token='token-1', args='true,NULL,NULL,NULL,NULL,NULL,NULL'):
        return f"SELECT r6_coupon_history('{token}',{args});"

    def list_page(token='token-1', args='true,NULL,NULL,NULL,NULL,NULL,NULL'):
        return json.loads(scalar(history(token, args)))

    fixture = (base.ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    seed = (base.ROOT / 'scripts/r4-staff-free-postgres-test.sql').read_text(encoding='utf-8').split('SELECT test_settle(3)', 1)[0]
    query(re.search(r'await db\.exec\(`([\s\S]*?)`\);', fixture)[1])
    query('ALTER TABLE members ADD COLUMN avatar_changed boolean DEFAULT false;')
    apply(*base.BASE, '20261024_real_rewards')
    query('ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;')
    apply(*base.CATALOG, '20261118_R2_member_cards', '20261118_R2_staff_avatar', *base.R3)
    query(seed)
    legacy = dict(kind='COUPON', title='Legacy', couponType='FRIEND_PASS', quota=1, bonusDays=0, expiresAt='2099-01-01T00:00:00Z')
    did = json.loads(scalar(admin('create', legacy)))['id']
    old = admin('grant', dict(definitionId=did, memberCode='BLU-3'))
    old_receipt = scalar(old)
    apply('20261127_R6_coupon_activation', '20261128_R6_promo_scope', '20261129_R6_staff_grant_targeting')
    query('SELECT test_settle(4,2),test_settle(5,3),test_settle(6,4);')
    spec = dict(title='Water bottle', campaignCode='GIFT2026', campaignKind='GIFT', description='Give a water bottle at the counter',
                usesPerCoupon=2, bonusDays=0, perMember=2, total=3, activationDurationMinutes=0, expiresAt='2099-01-01T00:00:00Z')
    create = admin('create_r6_campaign', spec)
    deny(create, '22023')
    deny(history(), '42883')
    apply('20261201_R6_coupon_campaigns')
    assert scalar(old) == old_receipt
    assert json.loads(scalar(admin('list', {})))['couponCampaignReady'] is True
    query('CREATE ROLE campaign_untrusted NOLOGIN;')
    deny('SET ROLE campaign_untrusted;' + history(), '42501')
    for token in ('token-4', 'revoked', 'kiosk', 'expired', 'missing'):
        deny(history(token), '42501')
    for patch in ({'campaignKind': 'DISCOUNT'}, {'perMember': None}, {'total': 1}, {'usesPerCoupon': '2'}, {'bonusDays': 1}, {'activationDurationMinutes': -1}):
        result = query(admin('create_r6_campaign', {**spec, **patch}), check=False)
        assert result.returncode and any(code in result.stderr for code in ('22023', '23514')), result.stderr
    deny(admin('create_r6_campaign', spec, actor=4), '42501')
    first_result = scalar(create)
    assert scalar(create) == first_result
    did = json.loads(first_result)['id']
    deny(admin('create_r6_campaign', spec), '23505')
    p = preview(did)
    first = admin('grant_targeted', p)
    receipt = json.loads(scalar(first))
    assert json.loads(scalar(first)) == receipt
    deny(admin('grant_targeted', p))  # Even with a different UUID, a preview cannot issue a second leaf.
    cid = receipt['coupon_id']
    use = admin('consume', {'couponId': cid})
    deny(use)
    deny(f"SELECT r6_activate_coupon('token-5',{cid});")
    activation = f"SELECT r6_activate_coupon('token-4',{cid});"
    activated = scalar(activation)
    assert scalar(activation) == activated
    assert json.loads(scalar(use))['usedCount'] == 1
    assert json.loads(scalar(use))['usedCount'] == 1
    assert json.loads(scalar(admin('consume', {'couponId': cid})))['status'] == 'USED'
    deny(admin('consume', {'couponId': cid}))
    second = json.loads(scalar(admin('grant_targeted', preview(did))))
    assert second['issue_number'] == 2 and second['recipient_duration_days'] == 30
    query(admin('cancel', {'assignmentId': second['id']}))
    deny(admin('grant_preview', selection(did)), 'P6001')
    assert json.loads(scalar(first)) == receipt
    print('PASS: guarded install, legacy replay, campaign validation, distinct per-member and per-leaf limits, manual fulfillment and cancelled leaf accounting', flush=True)

    barrier = Barrier(2, timeout=10)

    def race(sql):
        barrier.wait()
        return query('BEGIN; SELECT pg_backend_pid();' + sql + 'SELECT pg_sleep(0.2); COMMIT;', check=False)

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(race, [admin('grant_targeted', preview(did, 5)), admin('grant_targeted', preview(did, 6, 2), actor=2)]))
    assert outcomes[0].stdout.splitlines()[0] != outcomes[1].stdout.splitlines()[0]
    assert sorted(r.returncode == 0 for r in outcomes) == [False, True]
    assert any('P6001' in r.stderr for r in outcomes)
    assert scalar(f'SELECT count(*) FROM benefit_assignments WHERE definition_id={did};') == '3'
    used = list_page(args="true,NULL,'BLU-4','gift2026','GIFT','USED',30")['rows']
    assert [r['id'] for r in used] == [cid] and used[0]['used_at'] and used[0]['used_count'] == 2
    assert len(used[0]['use_times']) == 2 and used[0]['use_times'][0] == used[0]['used_at']
    assert not {'guest_reference', 'amount_satang', 'member_id'} & used[0].keys()
    assert list_page(args="true,NULL,NULL,'Water bottle','GIFT','CANCELLED',30")['rows'][0]['id'] == second['coupon_id']
    assert not list_page('token-5', "false,NULL,'BLU-4','gift2026',NULL,NULL,NULL")['rows']
    assert all(r['member_code'] == 'BLU-4' for r in list_page('token-4', 'false,NULL,NULL,NULL,NULL,NULL,NULL')['rows'])
    query("""INSERT INTO coupons(member_id,type,title,status,total_quota,used_count)
       SELECT 4,'CUSTOM','Pagination fixture','AVAILABLE',1,0 FROM generate_series(1,52);""")
    top = list_page(args="true,NULL,'BLU-4','Pagination fixture',NULL,NULL,NULL")
    tail = list_page(args=f"true,{top['nextBefore']},'BLU-4','Pagination fixture',NULL,NULL,NULL")
    assert len(top['rows']) == 50 and len(tail['rows']) == 2 and tail['nextBefore'] is None
    assert len({r['id'] for r in top['rows'] + tail['rows']}) == 52
    print('PASS: concurrent last campaign leaf, history filters/keyset pagination, role and ownership', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()
