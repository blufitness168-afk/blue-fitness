"""Paid staff cancellation on a fresh SCRAM loopback PostgreSQL cluster."""
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
import json
import re
from time import monotonic, sleep

runner = import_module('r4-staff-free-display-postgres-test')
base = runner.base
MIGRATION = '20261123_R4_staff_paid_cancellation'
EVENT = 'r4_staff_private.paid_transfer_cancellations'


def exercise(root_query):
    fixture = (base.ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    seed = (base.ROOT / 'scripts/r4-staff-free-postgres-test.sql').read_text(encoding='utf-8')
    wallet = (base.ROOT / 'src/lib/real-member-wallet-server.ts').read_text(encoding='utf-8')
    admission = (base.ROOT / 'scripts/r4-staff-free-admission-postgres-test.sql').read_text(encoding='utf-8')
    for r5 in (False, True):
        db = 'postgres' if not r5 else 'blu_modules_test_r4_paid_cancellation_r5'
        if r5:
            root_query('CREATE DATABASE ' + db)

        def query(sql, check=True):
            return root_query(sql, check=check, database=db)

        def scalar(sql):
            return query(sql).stdout.strip()

        def deny(sql, code):
            result = query(sql, False)
            assert result.returncode and code in result.stderr, result.stderr

        def apply(*names):
            for name in names:
                query((base.MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8'))

        def cancel(mid=3, token='token-2', key='req', reason="'Synthetic external refund'", confirmed='true', code=None):
            target = code or "'BLU-'||member_id"
            return (f"SELECT r4_staff_private.cancel_member_paid_transfer('{token}',{target},{key},sale_id,{reason},{confirmed}) "
                    f"FROM targets WHERE member_id={mid};")

        def race(first, second):
            with ThreadPoolExecutor(max_workers=2) as pool:
                a = pool.submit(query, "BEGIN; SET LOCAL application_name='r4-cancel-first'; " + first + 'SELECT pg_sleep(2); COMMIT;', False)
                deadline = monotonic() + 5
                while scalar("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='r4-cancel-first' AND wait_event='PgSleep')") != 't':
                    assert not a.done() and monotonic() < deadline
                    sleep(.02)
                b = pool.submit(query, "SET application_name='r4-cancel-second'; " + second, False)
                while scalar("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='r4-cancel-second' AND wait_event_type='Lock')") != 't':
                    assert not b.done() and monotonic() < deadline
                    sleep(.02)
                return a.result(), b.result()

        scalar(re.search(r'await db\.exec\(`([\s\S]*?)`\);', fixture)[1])
        scalar('ALTER TABLE members ADD COLUMN avatar_changed boolean DEFAULT false;')
        apply(*base.BASE, '20261024_real_rewards')
        scalar('ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;')
        apply(*base.CATALOG, '20261118_R2_member_cards', '20261118_R2_staff_avatar', *base.R3, '20261118_R4_online_provenance')
        if r5:
            apply('20261118_R5_finance')
        scalar(seed.split('SELECT test_settle(3)', 1)[0] + 'SELECT test_settle(i) FROM generate_series(3,9) i;')
        apply('20261119_R4_staff_free_foundation', '20261119_R4_staff_free_admission',
              '20261119_R4_staff_free_finance', '20261119_R4_staff_free_writer', runner.DISPLAY,
              '20261120_R4_staff_free_z_cancellation', '20261121_R4_staff_free_purchase_guard', '20261122_R4_staff_paid_transfer')
        scalar("""SELECT r4_staff_private.record_paid_transfer('token-1',gen_random_uuid(),'BLU-'||i,
               r4_staff_private.preview_paid_transfer('token-1','BLU-'||i),'Synthetic sale',true)
               FROM generate_series(3,9) i;
             CREATE TABLE targets AS SELECT sale_id,member_id,gen_random_uuid() req FROM r4_staff_private.paid_history;
             INSERT INTO rewards(title,point_cost,stock,is_active) VALUES('Synthetic',1,8,true);""")
        original = '''SELECT jsonb_build_array((SELECT jsonb_agg(s ORDER BY sale_id) FROM r4_staff_private.free_sales s),
          (SELECT jsonb_agg(o ORDER BY id) FROM package_payment_orders o WHERE status='PAID'),
          (SELECT jsonb_agg(l ORDER BY order_id) FROM package_payment_point_ledger l),
          (SELECT jsonb_agg(r ORDER BY trans_ref) FROM payment_transfer_refs r),
          (SELECT jsonb_agg(c ORDER BY id) FROM coupons c));'''
        pin = scalar(original)
        apply(MIGRATION)
        assert scalar(original) == pin
        assert scalar(f"SELECT NOT has_table_privilege('public','{EVENT}','INSERT');") == 't'
        for token in ('token-1','token-3','kiosk','missing'):
            deny(cancel(token=token), '42501')
        deny(cancel(code="'BLU-4'"), '55000')
        deny(cancel(confirmed='false'), '22023')
        deny(cancel(reason="'  '"), '22023')
        deny('BEGIN ISOLATION LEVEL REPEATABLE READ; ' + cancel(), '0A000')
        assert len(json.loads(scalar("SELECT r4_staff_private.list_paid_transfer_cancellations('token-2','BLU-3');"))) == 1
        deny('SELECT test_buy(3,1);', 'P4F01')
        scalar('BEGIN; ' + cancel() + ' ROLLBACK;')
        assert scalar(f'SELECT count(*) FROM {EVENT};') == '0'
        deny('SELECT test_buy(3,1);', 'P4F01')
        deny('BEGIN; UPDATE members SET points=0 WHERE id=5; ' + cancel(5), '55000')
        deny("BEGIN; ALTER TABLE package_payment_orders DISABLE TRIGGER a_r4_staff_free_online_purchase_guard; SELECT test_buy(5,1); "
             "ALTER TABLE package_payment_orders ENABLE TRIGGER a_r4_staff_free_online_purchase_guard; " + cancel(5), '55000')
        deny("BEGIN; ALTER TABLE public.members DISABLE TRIGGER r4_paid_predecessor_expiry; UPDATE members SET expire_date=expire_date+interval '1 day' WHERE id=5; "
             "ALTER TABLE public.members ENABLE TRIGGER r4_paid_predecessor_expiry; " + cancel(5), '55000')
        deny("BEGIN; ALTER TABLE package_payment_orders DISABLE TRIGGER a_r4_staff_free_online_purchase_guard; "
             "ALTER TABLE public.members DISABLE TRIGGER r4_paid_predecessor_expiry; SELECT test_settle(5); "
             "ALTER TABLE package_payment_orders ENABLE TRIGGER a_r4_staff_free_online_purchase_guard; "
             "ALTER TABLE public.members ENABLE TRIGGER r4_paid_predecessor_expiry; " + cancel(5), '55000')
        deny("BEGIN; UPDATE auth_sessions SET expires_at=now()+interval '7 days' WHERE token_hash='token-2'; "
             "DO $$ BEGIN EXECUTE replace(pg_get_functiondef(" 
             "'r4_staff_private.cancel_member_paid_transfer(text,text,uuid,uuid,text,boolean)'::regprocedure),"
             "'t:=clock_timestamp();','t:=f.starts_at;'); END $$; " + cancel(5), '55000')
        # Spend wins the member lock. Even restoring the aggregate within the
        # fixture transaction must not make the award eligible again.
        spend = "SELECT real_rewards_action('token-4','redeem',gen_random_uuid(),'{\"rewardId\":1}'); UPDATE members SET points=points+1 WHERE id=4;"
        a,b = race(spend,cancel(4))
        assert not a.returncode and b.returncode and '55000' in b.stderr, (a.stderr,b.stderr)
        a,b = race(cancel(),cancel())
        assert not a.returncode and not b.returncode and a.stdout.strip() == b.stdout.strip(), (a.stderr,b.stderr)
        receipt = json.loads(a.stdout)
        assert receipt['refundSatang']==9000 and receipt['pointsReversed']==4
        assert json.loads(scalar(cancel(reason="'  Synthetic external refund  '"))) == receipt
        deny(cancel(reason="'Different reason'"), '22023')
        deny(cancel(key='gen_random_uuid()'), '55000')
        deny(f'UPDATE {EVENT} SET reason=reason;', '55000')
        assert scalar(original) == pin
        assert scalar("SELECT r4_staff_private.display_terms('token-3',NULL);") == '[]'
        assert scalar("SELECT r4_staff_private.list_paid_transfer_cancellations('token-2','BLU-3');") == '[]'
        scalar(admission[admission.index('DO $$\nDECLARE d text;'):admission.index('CREATE FUNCTION test_fail_r4_visit')])
        for token, station in [('kiosk','desk'),('token-1','cancelled-frontdesk')]:
            scan = json.loads(scalar(f"SELECT test_r4_scan('{token}','{station}',gen_random_uuid(),'BLU-3',test_r4_at(3,'10:00'));"))
            assert scan['reason']=='NO_ENTITLEMENT', scan
        wallet_sql = import_module('r4-staff-paid-postgres-test').r4_wallet_sql(wallet, 3)
        history = json.loads(scalar(wallet_sql))
        sale = receipt['saleId']
        assert next(i for i in history['purchases'] if i['id']=='staff-transfer:'+sale)['cancelledAt']
        ledger = {i['id']: i['delta'] for i in history['pointLedger']}
        assert (ledger['staff-transfer:'+sale], ledger['staff-transfer-reversal:'+sale]) == (4,-4)
        assert history['points'] == int(scalar(f"SELECT point_balance_after FROM {EVENT} WHERE sale_id='{sale}';"))
        report = json.loads(scalar("SELECT real_finance_action('token-2','read',NULL,'{}');"))
        items = {i['id']: i for i in report['records']}
        assert items['staff-transfer:'+sale]['type'] == 'INCOME' and items['staff-transfer:'+sale]['amount'] == 90
        refund = items['staff-transfer-refund:'+sale]
        assert (refund['type'],refund['amount'],refund['category']) == ('EXPENSE',90,'ยกเลิกการสมัคร'), refund
        deny("SELECT real_finance_action('token-1','read',NULL,'{}');", '42501')
        # Guard resumes for this member, including the actual new settlement.
        scalar('SELECT test_settle(3);')
        assert json.loads(scalar(cancel())) == receipt
        a,b = race(cancel(6),cancel(6,key='gen_random_uuid()'))
        assert not a.returncode and b.returncode and '55000' in b.stderr, (a.stderr,b.stderr)
        a,b = race(cancel(7),'SELECT test_buy(7,1);')
        assert not a.returncode and not b.returncode, (a.stderr,b.stderr)
        assert scalar(f'SELECT count(*) FROM {EVENT};') == '3'
        print(f'PASS {"R5" if r5 else "October"}: eligibility, atomic rollback, member-lock races, replay, original history, wallet/finance, admission and purchase release', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()
