"""Staff transfer integration on synthetic native PostgreSQL only."""
from importlib import import_module
from concurrent.futures import ThreadPoolExecutor
import json
import re
from time import monotonic, sleep

runner = import_module('r4-staff-free-display-postgres-test')
base = runner.base
PAID = '20261122_R4_staff_paid_transfer'


def r4_wallet_sql(source, member_id):
    # Expand the literal fragments used when ENABLE_STAFF_PAID_READS is true.
    source = re.sub(r'\$\{r4Reads \? sql`([^`]*)` : sql`[^`]*`\s*\}', r'\1', source)
    statement = re.search(r'await sql`([\s\S]*?)`', source)[1].replace('${member.id}', str(int(member_id)))
    assert '${' not in statement and 'r4_staff_private.paid_history' in statement
    return statement


def exercise(root_query):
    source = (base.ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    seed = (base.ROOT / 'scripts/r4-staff-free-postgres-test.sql').read_text(encoding='utf-8')
    for r5 in (False, True):
        db = 'postgres'
        if r5:
            db = 'blu_modules_test_r4_paid_r5'
            root_query('CREATE DATABASE blu_modules_test_r4_paid_r5;')

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

        scalar(re.search(r'await db\.exec\(`([\s\S]*?)`\);', source)[1])
        scalar('ALTER TABLE members ADD COLUMN avatar_changed boolean DEFAULT false, ADD COLUMN IF NOT EXISTS birth_day integer, ADD COLUMN IF NOT EXISTS birth_month integer;')
        apply(*base.BASE, '20261024_real_rewards')
        scalar('ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;')
        apply(*base.CATALOG, '20261118_R2_member_cards', '20261118_R2_staff_avatar', *base.R3,
              '20261118_R4_online_provenance')
        if r5:
            apply('20261118_R5_finance')
        scalar(seed.split('SELECT test_settle(3)', 1)[0] +
               'SELECT test_settle(3),test_settle(4),test_settle(5,2),test_settle(6),test_settle(7);')
        apply('20261119_R4_staff_free_foundation','20261119_R4_staff_free_admission',
              '20261119_R4_staff_free_finance','20261119_R4_staff_free_writer',runner.DISPLAY,
              '20261120_R4_staff_free_z_cancellation','20261121_R4_staff_free_purchase_guard', PAID)
        scalar('''CREATE TABLE test_paid AS SELECT i,gen_random_uuid() AS req,
         r4_staff_private.preview_paid_transfer('token-1','BLU-'||i) AS offer FROM generate_series(3,7) i;''')

        def call(mid=3, token='token-1', time='NULL', confirmed='true', offer='offer'):
            return (f"SELECT r4_staff_private.record_paid_transfer('{token}',req,'BLU-'||i,{offer},"
                    f"'Confirmed synthetic transfer',{confirmed},{time}) FROM test_paid WHERE i={mid};")

        past = '(SELECT confirmed_at FROM package_payment_orders WHERE member_id=4)'
        deny(call(token='token-3'), '42501')
        deny(call(4, time=past), '42501')
        deny(call(4, token='token-2', time="'infinity'"), '22023')
        deny(call(4, token='token-2', time="'2000-01-01'"), '55000')
        deny(call(confirmed='false'), '22023')
        deny('BEGIN; ALTER TABLE package_payment_orders DISABLE TRIGGER a_r4_staff_free_online_purchase_guard; '
             + call(), '0A000')
        deny(call(offer="offer||'{\"amountSatang\":1}'"), '55000')
        assert scalar('SELECT offer IS NULL FROM test_paid WHERE i=5;') == 't'
        assert scalar('SELECT count(*) FROM r4_staff_private.paid_history;') == '0'
        snapshot = '''SELECT jsonb_build_array(
          (SELECT jsonb_agg(o ORDER BY id) FROM package_payment_orders o),
          (SELECT jsonb_agg(l ORDER BY order_id) FROM package_payment_point_ledger l),
          (SELECT jsonb_agg(c ORDER BY id) FROM coupons c),
          (SELECT jsonb_agg(r ORDER BY trans_ref) FROM payment_transfer_refs r));'''
        old_orders = scalar(snapshot)
        balance = int(scalar('SELECT points FROM members WHERE id=3;'))
        scalar('BEGIN; ' + call() + ' ROLLBACK;')
        assert int(scalar('SELECT points FROM members WHERE id=3;')) == balance
        receipt = json.loads(scalar(call()))
        assert receipt['source']=='STAFF_TRANSFER' and receipt['amountSatang']==9000 and receipt['pointsEarned']==4
        assert json.loads(scalar(call())) == receipt
        deny(call(offer="offer||'{\"amountSatang\":1}'"), '22023')
        back = json.loads(scalar(call(4, token='token-2', time=past)))
        assert back['occurredAt'] < back['recordedAt'] < back['startsAt']
        assert scalar(snapshot) == old_orders
        assert scalar('SELECT delta,balance_after FROM r4_staff_private.paid_point_ledger WHERE member_id=3;') == f'4|{balance+4}'
        assert int(scalar('SELECT points FROM members WHERE id=3;')) == balance+4
        assert scalar('SELECT r4_staff_private.paid_active_expiry(member_id,starts_at)=ends_at FROM r4_staff_private.paid_history WHERE member_id=3;') == 't'
        projection = json.loads(scalar("SELECT r4_staff_private.display_terms('token-3',NULL);"))
        assert projection[0]['status']=='SCHEDULED' and projection[0]['source']=='STAFF_TRANSFER'
        finance = json.loads(scalar("SELECT real_finance_action('token-2','read',NULL,'{}');"))
        paid = {row['id']: row for row in finance['records'] if row['source']=='STAFF_TRANSFER'}
        assert len(paid)==2 and paid['staff-transfer:'+receipt['saleId']]['amount']==90
        assert paid['staff-transfer:'+back['saleId']]['date']==scalar("SELECT (occurred_at AT TIME ZONE 'Asia/Bangkok')::date FROM r4_staff_private.paid_history WHERE member_id=4;")
        deny("SELECT real_finance_action('token-1','read',NULL,'{}');",'42501')
        deny('SELECT test_buy(3,1);', 'P4F01')
        deny('UPDATE members SET expire_date=expire_date+interval \'1 day\' WHERE id=3;', '55000')
        deny("SELECT r4_staff_private.cancel_free_sale('token-2',gen_random_uuid(),sale_id,'No') FROM r4_staff_private.paid_history WHERE member_id=3;", '55000')
        assert scalar("SELECT r4_staff_private.preview_free_sale('token-1','BLU-3') IS NULL;") == 't'
        deny("SELECT r4_staff_private.record_free_sale('token-1',req,'BLU-'||i,offer-'amountSatang','Confirmed synthetic transfer') FROM test_paid WHERE i=3;", '22023')
        wallet_source = (base.ROOT / 'src/lib/real-member-wallet-server.ts').read_text(encoding='utf-8')
        wallet_sql = r4_wallet_sql(wallet_source, 3)
        wallet = json.loads(scalar(wallet_sql))
        assert wallet['points'] == balance+4 and wallet['coupons'] == []
        purchase = next(p for p in wallet['purchases'] if p['source']=='STAFF_TRANSFER')
        ledger = next(p for p in wallet['pointLedger'] if p['id']==purchase['id'])
        assert purchase['id']=='staff-transfer:'+receipt['saleId'] and purchase['amountSatang']==9000 and ledger['delta']==4
        active = json.loads(scalar(wallet_sql.replace('now()', '(SELECT starts_at FROM r4_staff_private.paid_history WHERE member_id=3)')))
        assert active['status']=='ACTIVE' and active['expiresAt']==purchase['membershipExpiresAt']
        admin_source = (base.ROOT / 'src/lib/admin-members-server.ts').read_text(encoding='utf-8')
        admin_source = re.sub(r'\$\{r4Reads \? fragment`([^`]*)` : fragment``\s*\}', r'\1', admin_source)
        admin_sql = re.findall(r'sql`(SELECT id, "packageName", "timeSlot",[^`]+\) history ORDER BY[^`]+)`', admin_source)
        assert len(admin_sql)==2
        for owner, statement in zip((True, False), admin_sql):
            statement = statement.replace('${member.id}', '3').replace('${(pages.orders - 1) * 100}', '0')
            row = json.loads(scalar(f"SELECT row_to_json(q) FROM ({statement}) q WHERE status='STAFF_TRANSFER';"))
            assert row['id']==purchase['id'] and row['membershipStartsAt']==purchase['startsAt']
            assert ('amountSatang' in row)==owner and ('paidAt' in row)==owner
        outsider = 'r4_paid_outsider_r5' if r5 else 'r4_paid_outsider'
        scalar(f'CREATE ROLE {outsider} NOLOGIN;')
        assert scalar(f"SELECT has_table_privilege('{outsider}','r4_staff_private.paid_history','SELECT');") == 'f'

        # Observe the second connection waiting on the already-written request before commit.
        def race(first, second):
            with ThreadPoolExecutor(max_workers=2) as pool:
                a = pool.submit(query, "BEGIN; SET LOCAL application_name='r4-paid-hold'; " + first + 'SELECT pg_sleep(3); COMMIT;', False)
                deadline = monotonic()+5
                while scalar("SELECT EXISTS (SELECT FROM pg_stat_activity WHERE application_name='r4-paid-hold' AND wait_event='PgSleep');") != 't':
                    assert not a.done() and monotonic()<deadline
                    sleep(.02)
                b = pool.submit(query, "SET application_name='r4-paid-wait'; " + second, False)
                while scalar("SELECT EXISTS (SELECT FROM pg_stat_activity WHERE application_name='r4-paid-wait' AND wait_event_type='Lock');") != 't':
                    assert not b.done() and monotonic()<deadline
                    sleep(.02)
                return a.result(), b.result()

        a, b = race(call(6),call(6))
        assert not a.returncode and not b.returncode and a.stdout.strip()==b.stdout.strip(), (a.stderr,b.stderr)
        a, b = race(call(7),'SELECT test_buy(7,1);')
        assert not a.returncode and b.returncode and 'P4F01' in b.stderr, (a.stderr,b.stderr)
        assert scalar('SELECT count(*) FROM r4_staff_private.paid_point_ledger;')=='4'

        admission = (base.ROOT / 'scripts/r4-staff-free-admission-postgres-test.sql').read_text(encoding='utf-8')
        scalar(admission[admission.index('DO $$\nDECLARE d text;'):admission.index('CREATE FUNCTION test_fail_r4_visit')])
        for token, station, mid in [('kiosk','desk',3),('token-1','staff-desk',4)]:
            scan = json.loads(scalar(f"SELECT test_r4_scan('{token}','{station}',gen_random_uuid(),'BLU-{mid}',test_r4_at({mid},'10:00'));"))
            assert scan['reason']=='PAID_ENTRY', scan
            expected = receipt if mid==3 else back
            note = scalar(f"SELECT notes FROM checkins WHERE id={int(scan['checkinId'])};")
            assert note.endswith('STAFF_TRANSFER_ENTRY term=STAFF_TRANSFER:'+expected['saleId']), note
        assert json.loads(scalar("SELECT test_r4_scan('token-1','off-peak',gen_random_uuid(),'BLU-3',test_r4_at(3,'14:00'));"))['reason']=='OFF_PEAK'
        assert scalar(snapshot) == old_orders
        print(f'PASS {"R5" if r5 else "October"}: auth/backdate, native lock waits and replay, rollback, purchase/expiry guards, real wallet/admin SQL, kiosk/frontdesk provenance, owner finance and untouched online/coupons', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()
