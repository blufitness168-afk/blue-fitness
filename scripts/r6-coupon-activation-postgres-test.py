"""R6: native SQL on a fresh, disposable SCRAM loopback cluster; no app credentials."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
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

    def admin(action, payload, key=None, actor=1):
        return f"SELECT real_benefits_admin_action('token-{actor}','{action}','{key or uuid4()}',$p${json.dumps(payload)}$p$::jsonb);"

    def definition(minutes=None, kind='FRIEND_PASS', ends='2099-01-01T00:00:00Z'):
        return dict(kind='COUPON', title=kind, couponType=kind, quota=1, bonusDays=3 if kind == 'EXTRA_DAYS' else 0,
                    expiresAt=ends, activationDurationMinutes=minutes)

    def grant(spec, member=3, action='create_r6_coupon'):
        d = json.loads(scalar(admin(action, spec)))
        return json.loads(scalar(admin('grant', {'definitionId': d['id'], 'memberCode': f'BLU-{member}'})))

    def activate(cid, token='token-3'):
        return f"SELECT r6_activate_coupon('{token}',{cid});"

    def use(cid, key=None, actor=1):
        return admin('consume', {'couponId': cid, 'guestReference': 'synthetic-guest'}, key, actor)

    def wallet_row(cid):
        # Run the actual coupon slice of the wallet SELECT, not a test approximation.
        return json.loads(scalar(f'SELECT to_jsonb(c) FROM members m CROSS JOIN LATERAL ({wallet_sql}) c WHERE m.id=3 AND c.id={cid};'))

    fixture = (base.ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    wallet = (base.ROOT / 'src/lib/real-member-wallet-server.ts').read_text(encoding='utf-8')
    wallet_sql = re.search(r"'coupons',[^\n]+\n([\s\S]+?)\n\s*\) c\), '\[\]'::jsonb\)", wallet)[1]
    query(re.search(r'await db\.exec\(`([\s\S]*?)`\);', fixture)[1])
    for name in base.BASE:
        query((base.MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8'))
    query("""INSERT INTO members(member_code,full_name,status,role,expire_date)
      SELECT 'BLU-'||i,'Synthetic','ACTIVE',CASE WHEN i=1 THEN 'ADMIN' WHEN i=2 THEN 'OWNER' ELSE 'MEMBER' END,now()+interval '7 days'
      FROM generate_series(1,4) i;
      INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'token-'||id,now()+interval '1 day' FROM members;
      INSERT INTO auth_sessions(member_id,token_hash,expires_at,revoked_at,mode,device_id) VALUES
        (3,'expired',now(),NULL,'NORMAL',NULL),(3,'revoked',now()+interval '1 day',now(),'NORMAL',NULL),
        (1,'kiosk',now()+interval '1 day',NULL,'KIOSK','LOCAL_FRONT_DESK');""")
    legacy_spec = {k: v for k, v in definition().items() if k != 'activationDurationMinutes'}
    legacy = grant(legacy_spec, action='create')['coupon_id']
    legacy_before = wallet_row(legacy)
    assert legacy_before['status'] == 'AVAILABLE' and legacy_before['campaignExpiresAt'] is None
    deny(admin('create_r6_coupon', definition()), '22023')
    assert 'couponActivationReady' not in json.loads(scalar(admin('list', {})))
    query((base.MIGRATIONS / '20261127_R6_coupon_activation.sql').read_text(encoding='utf-8'))
    assert json.loads(scalar(admin('list', {})))['couponActivationReady'] is True
    assert wallet_row(legacy) == legacy_before
    deny(activate(legacy))
    assert json.loads(scalar(use(legacy)))['status'] == 'USED'
    assert wallet_row(grant(legacy_spec, action='create')['coupon_id'])['status'] == 'AVAILABLE'
    query('CREATE ROLE r6_untrusted NOLOGIN;')
    deny('SET ROLE r6_untrusted; ' + activate(legacy), '42501')
    assert scalar("SELECT has_function_privilege('r6_untrusted','real_benefits_admin_action(text,text,uuid,jsonb)','EXECUTE');") == 'f'
    for invalid in (-1, 0.5, '0', True, 2147483648):
        result = query(admin('create_r6_coupon', definition(invalid)), check=False)
        assert result.returncode and any(code in result.stderr for code in ('22023', '22003'))
    deny(admin('create_r6_coupon', legacy_spec), '22023')
    deny(admin('create_r6_coupon', definition(), actor=3), '42501')
    for token in ('missing', 'expired', 'revoked', 'kiosk'):
        deny(activate(legacy, token), '42501')
    print('PASS: pre-migration wallet/readiness and fail-closed create, legacy behavior, validation and SQL ACL/session guards', flush=True)

    blank = grant(definition())['coupon_id']
    zero = grant(definition(0))['coupon_id']
    positive = grant(definition(6, 'EXTRA_DAYS'))['coupon_id']
    cap = grant(definition(2147483647))['coupon_id']
    cancelled = grant(definition(0))
    deny(activate(blank, 'token-4'))
    query("UPDATE members SET status='SUSPENDED' WHERE id=3;")
    deny(activate(blank), '42501')
    query("UPDATE members SET status='ACTIVE' WHERE id=3;")
    deny(use(zero))
    assert wallet_row(zero)['status'] == 'PENDING_ACTIVATION'
    assert wallet_row(blank)['activationDurationMinutes'] is None
    assert wallet_row(zero)['activationDurationMinutes'] == 0
    expiry_before = scalar('SELECT expire_date FROM members WHERE id=3;')
    barrier = Barrier(2, timeout=5)

    def race(sql):
        barrier.wait()
        return query('BEGIN; SELECT pg_backend_pid(); ' + sql + ' SELECT pg_sleep(0.3); COMMIT;', check=False)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(race, [activate(zero), activate(zero)]))
    assert all(not r.returncode for r in results)
    pids_and_rows = [r.stdout.splitlines()[:2] for r in results]
    assert pids_and_rows[0][0] != pids_and_rows[1][0]
    assert json.loads(pids_and_rows[0][1]) == json.loads(pids_and_rows[1][1]) == json.loads(scalar(activate(zero)))
    for cid, condition in [(blank, 'expire_date=campaign_expires_at'), (zero, "expire_date=activated_at+interval '10 mins'"),
                           (positive, "expire_date=activated_at+interval '6 mins'"), (cap, 'expire_date=campaign_expires_at')]:
        query(activate(cid))
        assert scalar(f'SELECT ({condition}) AND used_count=0 FROM coupons WHERE id={cid};') == 't'
        assert wallet_row(cid)['status'] == 'AVAILABLE'
    assert scalar('SELECT expire_date FROM members WHERE id=3;') == expiry_before
    cap_receipt = scalar(activate(cap))
    cap_assignment = int(scalar(f'SELECT id FROM benefit_assignments WHERE coupon_id={cap};'))
    query(admin('cancel', {'assignmentId': cap_assignment}))
    assert scalar(activate(cap)) == cap_receipt and wallet_row(cap)['status'] == 'EXPIRED'
    deny(use(cap))
    query(admin('cancel', {'assignmentId': cancelled['id']}))
    deny(activate(cancelled['coupon_id']))
    deny(use(cancelled['coupon_id']))
    attempts = [use(positive, uuid4()), use(positive, uuid4(), actor=2)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(race, attempts))
    assert sorted(r.returncode == 0 for r in outcomes) == [False, True]
    assert any('P0001' in r.stderr for r in outcomes)
    winner = next(i for i, r in enumerate(outcomes) if r.returncode == 0)
    consumed = json.loads(outcomes[winner].stdout.splitlines()[1])
    assert consumed['status'] == 'USED' and json.loads(scalar(attempts[winner])) == consumed
    assert scalar(f'SELECT count(*) FROM benefit_consumptions WHERE coupon_id={positive};') == '1'
    assert scalar(f"SELECT expire_date='{expiry_before}'::timestamptz+interval '3 days' FROM members WHERE id=3;") == 't'
    print('PASS: concurrent activation receipt, blank/0/positive/campaign cap, no use on activation, cancellation, last use contention and single bonus', flush=True)

    # Use a disposable-only clock for exact boundaries after testing the real clock above.
    query("""DO $$ DECLARE f text; BEGIN FOREACH f IN ARRAY ARRAY[
      'r6_activate_coupon(text,integer)','real_benefits_admin_action(text,text,uuid,jsonb)'] LOOP
      EXECUTE replace(pg_get_functiondef(f::regprocedure), 'clock_timestamp()',
        'COALESCE(NULLIF(current_setting(''test.r6_at'',true),'''')::timestamptz,clock_timestamp())');
      END LOOP; END $$;""")
    ends = '2098-12-31T23:57:00Z'
    query("UPDATE auth_sessions SET expires_at='2100-01-01Z' WHERE token_hash LIKE 'token-%';")
    capped = grant(definition(0, ends=ends))['coupon_id']
    pending = grant(definition(0, ends=ends))['coupon_id']
    def at(clock, sql):
        return f"SET test.r6_at='{clock}'; " + sql
    receipt = json.loads(scalar(at('2098-12-31T23:55:00Z', activate(capped))))
    assert datetime.fromisoformat(receipt['expiresAt']) == datetime.fromisoformat(ends)
    deny(at(ends, activate(pending)))
    deny(at(ends, use(capped)))
    assert json.loads(scalar(at(ends, activate(capped)))) == receipt
    timed_end = scalar(f'SELECT expire_date FROM coupons WHERE id={zero};')
    deny(at(timed_end, use(zero)))
    receipt_key = uuid4()
    first = scalar(at('2098-12-31T23:56:59.999999Z', use(capped, receipt_key)))
    assert first == scalar(at(ends, use(capped, receipt_key)))
    assert scalar("SELECT count(*) FROM coupons WHERE campaign_expires_at IS NOT NULL AND activated_at IS NULL AND used_count<>0;") == '0'
    print('PASS: earlier-of with short campaign, exact expiry boundaries, retry never restarts, previously committed consume replays', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()
