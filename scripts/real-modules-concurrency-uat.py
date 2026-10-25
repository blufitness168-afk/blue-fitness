"""Disposable real PostgreSQL races. Default probes only; never reads DATABASE_URL.
Requires psql and an explicitly named EMPTY local DB. No providers, no HTTP.
Base tables are a minimal contract, not a full production-schema clone.
Leaves fixtures for inspection: destroy/recreate the disposable database afterwards.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import uuid

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = [
    '20261009_real_package_payments.sql', '20261010_payment_promptpay.sql',
    '20261024_kiosk.sql', '20261024_real_rewards.sql',
    '20261024_real_benefits_admin.sql', '20261024_real_finance.sql',
    '20261024_real_frontdesk.sql', '20261025_package_payment_benefits.sql',
]
BASE = """
CREATE TYPE member_status AS ENUM ('PENDING','ACTIVE','EXPIRED','SUSPENDED');
CREATE TYPE coupon_type AS ENUM ('FREE_ENTRY','FRIEND_PASS','EXTRA_DAYS','CUSTOM');
CREATE TYPE coupon_status AS ENUM ('AVAILABLE','USED','EXPIRED');
CREATE TABLE members(id serial PRIMARY KEY,phone text,full_name text,member_code text UNIQUE,
 status member_status,role text,points integer NOT NULL DEFAULT 0,expire_date timestamptz,
 updated_at timestamptz,avatar_url text);
CREATE TABLE auth_sessions(id serial PRIMARY KEY,member_id integer REFERENCES members(id),
 token_hash text UNIQUE,expires_at timestamptz,revoked_at timestamptz);
CREATE TABLE payments(id serial PRIMARY KEY,easyslip_trans_ref varchar(100));
CREATE TABLE coupons(id serial PRIMARY KEY,member_id integer REFERENCES members(id),type coupon_type,
 source text,title text,status coupon_status DEFAULT 'AVAILABLE',total_quota integer,
 used_count integer,bonus_days_value integer DEFAULT 0,created_at timestamptz DEFAULT now(),
 expire_date timestamptz,UNIQUE(member_id,source));
CREATE TABLE checkins(id serial PRIMARY KEY,member_id integer,scanner_type text,
 scanner_device_id text,points_awarded integer,notes text,checkin_time timestamptz DEFAULT now());
CREATE TABLE rewards(id serial PRIMARY KEY,title text NOT NULL,description text,image_url text,
 point_cost integer NOT NULL,stock integer NOT NULL DEFAULT 0,is_active boolean DEFAULT true,
 created_at timestamptz DEFAULT now());
CREATE TABLE redemptions(id serial PRIMARY KEY,member_id integer REFERENCES members(id),
 reward_id integer REFERENCES rewards(id),points_spent integer,
 redeemed_at timestamptz DEFAULT now(),status text DEFAULT 'COMPLETED');
"""


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def key():
    return str(uuid.uuid4())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-disposable', action='store_true')
    parser.add_argument('--host', choices=['127.0.0.1', '::1'], default='127.0.0.1')
    parser.add_argument('--port', type=int, default=5432)
    parser.add_argument('--database')
    parser.add_argument('--user', default='postgres')
    parser.add_argument('--confirm-disposable-empty', action='store_true')
    args = parser.parse_args()
    if not args.run_disposable:
        print(json.dumps({'mode': 'probe-only', 'psql_available': bool(shutil.which('psql')),
                          'real_concurrency': 'NOT RUN', 'database_connections': 0}))
        return
    if not args.confirm_disposable_empty or not re.fullmatch(r'blu_modules_test_[a-z0-9_]+', args.database or ''):
        parser.error('Requires --confirm-disposable-empty and database blu_modules_test_<suffix>')
    if not shutil.which('psql'):
        parser.exit(2, 'BLOCKED: psql unavailable; no DB connection attempted.\n')
    # Explicit loopback endpoint; remove libpq service/SSL/options overrides. Do not load .env.
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG') and k != 'DATABASE_URL'}
    env.update(PGCONNECT_TIMEOUT='5', PGAPPNAME='blu_modules_isolated_uat')
    command = ['psql', '-X', '-qAt', '-w', '-h', args.host, '-p', str(args.port),
               '-U', args.user, '-d', args.database, '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=sqlstate']

    def run(sql):
        return subprocess.run(command, input="SET statement_timeout='15s'; SET lock_timeout='5s';\n" + sql,
                              text=True, encoding='utf-8', capture_output=True, env=env, timeout=25)

    def checked(sql):
        r = run(sql)
        if r.returncode:
            # Never print raw connection errors, SQL or credentials.
            codes = re.findall(r'\b(?:[0-9]{2}[A-Z0-9]{3}|P0001)\b', r.stderr)
            raise RuntimeError('SQL failed; SQLSTATE=' + ','.join(codes))
        return r.stdout.strip()

    def truth(sql):
        assert checked('SELECT ' + sql + ';') == 't', 'Invariant failed'

    def action(function, actor, operation, payload, request=None):
        return ('SELECT ' + function + '(' + ','.join(map(literal, [f'token-{actor}', operation,
                request or key(), json.dumps(payload, ensure_ascii=False)])) + '::jsonb);')

    def call(function, actor, operation, payload, request=None):
        return json.loads(checked(action(function, actor, operation, payload, request)))

    def race(sqls, successes, same=False, error=None):
        barrier = threading.Barrier(len(sqls))
        def worker(sql):
            barrier.wait(timeout=10)
            # Hold completed writes briefly so competing transactions overlap.
            return run('BEGIN; SELECT pg_backend_pid(); ' + sql + ' SELECT pg_sleep(0.2); COMMIT;')
        with ThreadPoolExecutor(max_workers=len(sqls)) as pool:
            results = list(pool.map(worker, sqls))
        pids = [r.stdout.splitlines()[0] for r in results]
        assert len(set(pids)) == len(sqls), 'Not independent PostgreSQL backends'
        count = sum(r.returncode == 0 for r in results)
        allowed = successes if isinstance(successes, tuple) else (successes,)
        assert count in allowed, 'Unexpected race success count: ' + str(count) + '; ' + '; '.join(
            re.sub(r'[^A-Z0-9=\n]', '', r.stderr) for r in results if r.returncode)
        if error:
            assert all(error in r.stderr for r in results if r.returncode), 'Unexpected loser SQLSTATE'
        values = [r.stdout.splitlines()[1] for r in results if r.returncode == 0]
        if same:
            assert len(set(values)) == 1, 'Replay returned differing results'
        return values

    # Guard before any DDL. Server must itself report loopback and no public user relations.
    identity = json.loads(checked("SELECT json_build_object('db',current_database(),'local',"
        "inet_server_addr() IN ('127.0.0.1'::inet,'::1'::inet),'empty',NOT EXISTS("
        "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' "
        "AND c.relkind IN ('r','p','v','m','S','f')));"))
    assert identity == {'db': args.database, 'local': True, 'empty': True}, 'Refused nonempty/nonlocal DB'
    checked(BASE)
    for migration in MIGRATIONS:
        checked((ROOT / 'src/db/migrations' / migration).read_text(encoding='utf-8'))
    print('PASS actual eight migrations compile against isolated minimal base contract')
    checked("""INSERT INTO members(member_code,full_name,status,role,points,expire_date)
    VALUES('M1','Fixture one','ACTIVE','MEMBER',100,now()+interval '30 days'),
    ('M2','Fixture two','ACTIVE','MEMBER',100,now()+interval '30 days'),
    ('A1','Fixture admin','ACTIVE','ADMIN',0,now()+interval '30 days'),
    ('O1','Fixture owner','ACTIVE','OWNER',0,now()+interval '30 days'),
    ('O2','Fixture owner two','ACTIVE','OWNER',0,now()+interval '30 days');
    INSERT INTO auth_sessions(member_id,token_hash,expires_at)
    SELECT id,'token-'||id,now()+interval '1 day' FROM members;
    INSERT INTO rewards(title,point_cost,stock) VALUES('Last item',30,1),('Replay item',30,2);""")
    rewards = 'real_rewards_action'
    race([action(rewards, i, 'redeem', {'rewardId': 1}) for i in (1, 2)], 1, error='P0001')
    truth('(SELECT stock=0 FROM rewards WHERE id=1) AND (SELECT count(*)=1 FROM reward_point_spend_ledger)')
    request = key()
    race([action(rewards, 1, 'redeem', {'rewardId': 2}, request)] * 2, 2, same=True)
    truth('(SELECT stock=1 FROM rewards WHERE id=2) AND (SELECT count(*)=2 FROM reward_point_spend_ledger)')
    code = checked('SELECT reward_code FROM redemptions WHERE reward_id=2')
    race([action(rewards, i, 'deliver', {'rewardCode': code}) for i in (3, 4)], 2, same=True)
    truth("(SELECT status='COMPLETED' AND completed_by IN (3,4) FROM redemptions WHERE reward_id=2)")
    print('PASS rewards last-stock, same-key debit replay, cross-staff delivery races')

    benefits = 'real_benefits_admin_action'
    definition = call(benefits, 3, 'create', {'kind': 'COUPON', 'title': 'Race bonus',
        'couponType': 'EXTRA_DAYS', 'quota': 1, 'bonusDays': 15, 'expiresAt': '2099-01-01T00:00:00Z'})
    grant_payload = {'definitionId': definition['id'], 'memberCode': 'M1'}
    race([action(benefits, i, 'grant', grant_payload) for i in (3, 4)], 1, error='P0001')
    coupon = int(checked("SELECT id FROM coupons WHERE member_id=1 AND type='EXTRA_DAYS'"))
    before = checked('SELECT extract(epoch FROM expire_date) FROM members WHERE id=1')
    race([action(benefits, i, 'consume', {'couponId': coupon, 'guestReference': ''}) for i in (3, 4)], 1, error='P0001')
    truth(f'(SELECT extract(epoch FROM expire_date)-{before}=15*86400 FROM members WHERE id=1) '
          'AND (SELECT count(*)=1 FROM benefit_consumptions)')
    print('PASS benefits cross-staff duplicate grant and single bonus extension races')

    finance = 'real_finance_action'
    payload = {'date': '2026-10-24', 'type': 'INCOME', 'category': 'รายได้อื่น (ไม่ใช่แพ็กเกจ)',
               'amountSatang': 1234, 'note': 'Isolated fixture'}
    request = key()
    values = race([action(finance, 4, 'create', payload, request)] * 2, 2, same=True)
    entry = json.loads(values[0])
    race([action(finance, i, 'update', {**payload, 'id': entry['id'], 'version': 1,
          'amountSatang': i * 100}) for i in (4, 5)], 1, error='P0001')
    race([action(finance, i, 'delete', {'id': entry['id'], 'version': 2, 'reason': 'UAT'})
          for i in (4, 5)], 1, error='P0001')
    truth('(SELECT count(*)=3 FROM finance_audit) AND (SELECT version=3 AND deleted_at IS NOT NULL FROM finance_entries)')
    print('PASS finance duplicate create, cross-owner stale update and delete races')

    # Actual clock, no rewritten function bodies. Admission race requires opening hours.
    is_open = checked("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::time BETWEEN time '07:00' AND time '22:00'") == 't'
    if is_open:
        checked("INSERT INTO coupons(member_id,type,source,title,status,total_quota,used_count,expire_date) "
                "VALUES(2,'FREE_ENTRY','WELCOME_REGISTRATION','Fixture','AVAILABLE',1,0,now()+interval '1 day')")
        request = key()
        scan = f"SELECT real_frontdesk_checkin('token-3','UAT',{literal(request)},'M2');"
        race([scan, scan], 2, same=True)
        truth('(SELECT count(*)=1 FROM checkins) AND (SELECT used_count=1 FROM coupons WHERE member_id=2)')
        print('PASS frontdesk same-key replay consumes welcome and creates checkin once')
    else:
        print('GAP frontdesk admission races: actual Bangkok clock outside 07:00-22:00; no clock rewrite')

    # Isolated evidence fixture ONLY. Actual claim/finalize functions settle it; no provider calls.
    quote = {'package': {'id': 2, 'name': 'Fixture', 'durationDays': 30, 'timeSlot': '07:00-22:00',
                        'friendCoupons': 5, 'bonusDays': 15}, 'subtotalSatang': 90000,
             'discountSatang': 0, 'amountSatang': 90000, 'pointsEarned': 45, 'promo': None}
    receiver = {'promptpay': '0973355322', 'bankCode': '004', 'bankAccount': '0528938965', 'name': 'OFFLINE FIXTURE'}
    orders = [key(), key()]
    attempts = []
    for member, order in enumerate(orders, 1):
        checked(f"SELECT id FROM create_package_payment_order('{order}',{member},'token-{member}','{key()}',{literal(json.dumps(quote))}::jsonb,{literal(json.dumps(receiver))}::jsonb)")
        lease = key()
        claims = f"SELECT lease_token FROM claim_package_payment_attempt('{order}',{member},'token-{member}','{lease}','{str(member)*64}',false);"
        race([claims, claims], 2, same=True)
        attempts.append(checked(f"SELECT id FROM package_payment_attempts WHERE order_id='{order}'"))
    # Same registered-account contract as payment-integration.test.sql; never bypass validation.
    checked("UPDATE package_payment_attempts SET state='VERIFIED',evidence=jsonb_build_object("
            "'transRef','ISOLATED-SAME-TRANSFER','paidAt',clock_timestamp(),'amountSatang',90000,"
            "'bankCode','004','receiverEvidence','REGISTERED_ACCOUNT_V2',"
            "'providerStrategy','EASYSLIP_V2_REGISTERED_ACCOUNT','orderId',order_id,"
            "'receiverIdentity',jsonb_build_object('matchingType','BANK_ACCOUNT',"
            "'bankCode','004','bankAccount','0528938965','name','OFFLINE FIXTURE',"
            "'expectedName','OFFLINE FIXTURE','normalizedName','OFFLINEFIXTURE'))")
    settles = [f"SELECT status FROM finalize_package_payment('{o}',{i},'token-{i}','{a}');"
               for i, (o, a) in enumerate(zip(orders, attempts), 1)]
    results = race(settles, 2)
    assert sorted(results) == ['PAID', 'REJECTED']
    paid = results.index('PAID')
    race([settles[paid]] * 2, 2, same=True)
    truth("(SELECT count(*)=1 FROM package_payment_point_ledger) AND "
          "(SELECT count(*)=1 FROM payment_transfer_refs WHERE trans_ref='ISOLATED-SAME-TRANSFER') AND "
          "(SELECT count(*)=2 FROM coupons WHERE source LIKE 'PACKAGE_ORDER:%') AND "
          "(SELECT count(*)=1 FROM package_payment_resolution_audit WHERE reason_code='DUPLICATE_TRANS_REF')")
    print('PASS payment identical claim, global transfer uniqueness, paid replay and package coupon issuance races')
    # Persisted reservation capacity, not an in-memory promo counter.
    promo = call(benefits, 3, 'create', {'kind': 'PROMO', 'title': 'Last capacity',
                 'code': 'ISOLATED_LAST_CAPACITY', 'discountType': 'FIXED',
                 'discountValue': 1000, 'usageLimit': 1, 'expiresAt': '2099-01-01T00:00:00Z'})
    for member_code in ('O1', 'O2'):
        call(benefits, 3, 'grant', {'definitionId': promo['id'], 'memberCode': member_code})
    # Deliberately untrusted quote values: the wrapper must rebuild these from persisted data.
    promo_quote = {**quote, 'promo': {'code': 'ISOLATED_LAST_CAPACITY', 'usageLimit': 999,
                  'usedCount': 0, 'expiresAt': '2099-01-01T00:00:00Z'}}
    creates = [f"SELECT id FROM create_package_payment_order('{key()}',{i},'token-{i}',"
               f"'{key()}',{literal(json.dumps(promo_quote))}::jsonb,"
               f"{literal(json.dumps(receiver))}::jsonb);" for i in (4, 5)]
    race(creates, 1, error='P0001')
    truth("(SELECT count(*)=1 FROM package_payment_orders WHERE promo_code='ISOLATED_LAST_CAPACITY' "
          "AND status='PENDING' AND discount_satang=1000 AND amount_satang=89000 "
          "AND points_earned=44 AND (promo_snapshot->>'usageLimit')::integer=1) AND "
          "(SELECT count(*)=1 FROM benefit_promo_reservations)")
    print('PASS persisted promo last-capacity reservation race (one order, one quota rejection)')

    # Both legal serial orders: save first then redeem, or redeem first then stale save fails.
    for iteration in range(4):
        reward_id = int(checked("INSERT INTO rewards(title,point_cost,stock) "
                                "VALUES('Save race',1,1) RETURNING id"))
        expected = {'id': reward_id, 'title': 'Save race', 'description': None,
                    'imageUrl': None, 'pointCost': 1, 'stock': 1, 'isActive': True}
        save = action(rewards, 3, 'save', {**expected, 'title': 'Saved race', 'expected': expected})
        redeem = action(rewards, 2, 'redeem', {'rewardId': reward_id})
        balance = int(checked('SELECT points FROM members WHERE id=2'))
        race([save, redeem] if iteration % 2 == 0 else [redeem, save], (1, 2), error='P0001')
        truth(f'(SELECT stock=0 FROM rewards WHERE id={reward_id}) AND '
              f'(SELECT count(*)=1 AND min(points_spent)=1 FROM redemptions WHERE reward_id={reward_id}) AND '
              f'(SELECT points={balance}-1 FROM members WHERE id=2) AND '
              f'(SELECT count(*)=1 FROM reward_point_spend_ledger l JOIN redemptions r '
              f'ON r.id=l.redemption_id WHERE r.reward_id={reward_id})')
    print('PASS reward catalog save-vs-redemption races (4 overlaps; no stock resurrection or duplicate debit)')
    print('Fixtures remain ONLY in the explicitly confirmed isolated local DB. Full production schema acceptance remains separate.')


if __name__ == '__main__':
    main()
