"""R5 import on a fresh disposable PostgreSQL cluster; no application credentials."""
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
import json
import re
from time import monotonic, sleep
from uuid import uuid4

runner = import_module('r4-staff-free-display-postgres-test')
base = runner.base
LIFECYCLE = '20261204_R5_finance_lifecycle'
READER = 'public.real_finance_action(text,text,uuid,jsonb)'


def check_lifecycle(query, scalar, deny, apply, auth_read):
    def read():
        return json.loads(scalar(auth_read))

    # Actual R4 finalizer produces both the before and effects evidence. Legacy BLU-3 was
    # paid before R4 evidence was installed; its second payment alone cannot prove expiry.
    query('SELECT test_settle(4,6); SELECT test_settle(4,6); SELECT test_settle(3,6); SELECT test_settle(5,6);')
    orders = scalar("SELECT string_agg(id::text,'|' ORDER BY confirmed_at) FROM package_payment_orders WHERE member_id=4").split('|')
    first, renewal = (f'package:{id}' for id in orders)
    pre = read()
    identity = f"SELECT oid,proowner,proacl,proconfig,prosecdef FROM pg_proc WHERE oid='{READER}'::regprocedure"
    acl = scalar(identity)
    migration = (base.MIGRATIONS / (LIFECYCLE + '.sql')).read_text(encoding='utf-8')
    deny(f"BEGIN; GRANT EXECUTE ON FUNCTION {READER} TO PUBLIC;" + migration.split('BEGIN;', 1)[1], '0A000')
    apply(LIFECYCLE)
    assert scalar(identity) == acl
    classified = [{**r, 'category': 'ต่อสมาชิก'} if r['id'] == renewal else r for r in pre['records']]
    assert read() == {**pre, 'records': classified}
    deny(auth_read.replace('token-2', 'token-1'), '42501')

    # Move only fixture timestamps in rolled-back transactions to exercise the precise
    # boundary without a fake production clock. Normal immutable evidence remains intact.
    for gap, expected in (('90 days', 'ต่อสมาชิก'), ('90 days 1 microsecond', 'สมัครใหม่')):
        sql = f'''BEGIN;
          SET LOCAL session_replication_role='replica';
          CREATE TEMP TABLE pin ON COMMIT DROP AS
           SELECT confirmed_at-interval '{gap}' AS expiry FROM package_payment_orders WHERE id='{orders[1]}';
          UPDATE package_payment_orders SET membership_expires_at=pin.expiry, confirmed_at=pin.expiry-interval '1 day'
           FROM pin WHERE id='{orders[0]}';
          UPDATE r4_online_private.settlement_effects SET expiry_after=pin.expiry, confirmed_at=pin.expiry-interval '1 day'
           FROM pin WHERE order_id='{orders[0]}';
          UPDATE r4_online_private.settlement_before SET expiry_before=pin.expiry FROM pin WHERE order_id='{orders[1]}';
          SET LOCAL session_replication_role='origin';
          SELECT r->>'category' FROM jsonb_array_elements(real_finance_action('token-2','read',NULL,'{{}}')->'records') r
          WHERE r->>'id'='{renewal}'; ROLLBACK;'''
        assert scalar(sql) == expected
    assert next(r for r in read()['records'] if r['id'] == first)['category'] == 'แพ็กเกจ'
    query('INSERT INTO r4_online_private.reader_cutover VALUES (1);')
    receipt = json.loads(scalar("SELECT r4_online_private.cancel_online_order('token-2',id,gen_random_uuid(),amount_satang,'Synthetic refund',true) FROM package_payment_orders WHERE member_id=5"))
    records = read()['records']
    refund, = [r for r in records if r['id'] == f"online-refund:{receipt['orderId']}"]
    assert (refund['category'], refund['type'], round(refund['amount'] * 100)) == ('ยกเลิกการสมัคร', 'EXPENSE', receipt['refundSatang'])
    assert [r for r in records if r['source'] != 'ONLINE_REFUND'] == classified
    print('PASS R5 lifecycle: install guard, unchanged rows/amounts, real settlement evidence, 90-day boundary, legacy fallback and linked refund', flush=True)



def exercise(root_query):
    source = (base.ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    fixture = re.search(r'await db\.exec\(`([\s\S]*?)`\);', source)[1]
    seed = (base.ROOT / 'scripts/r4-staff-free-postgres-test.sql').read_text(encoding='utf-8').split('SELECT test_settle(3)', 1)[0]
    for flavor in ('october', 'r5_standalone', 'r5_with_r4'):
        db = 'blu_modules_test_r5_import_' + flavor
        root_query('CREATE DATABASE ' + db)

        def query(sql, check=True):
            return root_query(sql, check=check, database=db)

        def apply(*names):
            for name in names:
                query((base.MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8'))

        def scalar(sql):
            return query(sql).stdout.strip()

        def deny(sql, code):
            result = query(sql, check=False)
            assert result.returncode and code in result.stderr, (sql, result.stdout, result.stderr)

        def call(*rows, key=None, action='commit', token='token-2'):
            payload = json.dumps([{'line': i, **row} for i, row in enumerate(rows, 2)], ensure_ascii=False)
            return f"SELECT r5_finance_import('{token}','{action}','{key or uuid4()}',$rows${payload}$rows$,{str(action == 'commit').lower()});"

        auth_read = "SELECT real_finance_action('token-2','read',NULL,'{}');"
        row = dict(ref='ARCHIVE-1', date='2001-12-31', type='EXPENSE', category='อุปกรณ์', amountSatang=14001, note='Synthetic equipment')
        row2 = {**row, 'ref': 'ARCHIVE-2', 'amountSatang': 1200}
        query(fixture)
        query('ALTER TABLE members ADD COLUMN avatar_changed boolean DEFAULT false;')
        apply(*base.BASE, '20261024_real_rewards')
        query('ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;')
        apply(*base.CATALOG, '20261118_R2_member_cards', '20261118_R2_staff_avatar', *base.R3)
        if flavor == 'r5_with_r4':
            apply('20261118_R4_online_provenance')
        if flavor != 'october':
            apply('20261118_R5_finance')
        apply('20261126_R5_finance_import')
        query(seed + 'SELECT test_settle(3);')
        before = json.loads(scalar(auth_read))
        assert json.loads(scalar(call(row, row2, action='preview'))) == {'issues': []}
        assert scalar('SELECT count(*) FROM finance_entries') == '0'
        role = 'r5_import_untrusted_' + flavor
        query('CREATE ROLE ' + role + ' NOLOGIN;')
        deny('SET ROLE ' + role + '; ' + call(row), '42501')
        deny('SET ROLE ' + role + '; SELECT * FROM r5_finance_private.import_batches;', '42501')
        for token in ('token-1', 'token-3', 'kiosk', 'missing'):
            deny(call(row, token=token), '42501')
        result = json.loads(scalar(call(row, {**row2, 'category': 'ต่อสมาชิก'})))
        assert result == {'issues': [{'line': 3, 'code': 'category'}]}
        assert scalar('SELECT count(*) FROM finance_entries') == '0'
        extra = {**row, 'category': 'ค่าเสื่อม'}
        expected = [] if flavor != 'october' else [{'line': 2, 'code': 'category_unavailable'}]
        assert json.loads(scalar(call(extra, action='preview'))) == {'issues': expected}


        if flavor == 'r5_with_r4':
            apply('20261119_R4_staff_free_foundation', '20261119_R4_staff_free_admission', '20261119_R4_staff_free_finance',
                  '20261119_R4_staff_free_writer', runner.DISPLAY, '20261120_R4_staff_free_z_cancellation',
                  '20261121_R4_staff_free_purchase_guard', '20261122_R4_staff_paid_transfer', '20261123_R4_staff_paid_cancellation',
                  '20261124_R4_online_settlement_evidence', '20261125_R4_online_cancellation')
        else:
            assert scalar("SELECT to_regnamespace('r4_staff_private') IS NULL AND to_regnamespace('r4_online_private') IS NULL") == 't'
        assert json.loads(scalar(auth_read)) == before
        if flavor == 'r5_with_r4':
            check_lifecycle(query, scalar, deny, apply, auth_read)
            before = json.loads(scalar(auth_read))
        else:
            deny((base.MIGRATIONS / (LIFECYCLE + '.sql')).read_text(encoding='utf-8'), '0A000')
        key = uuid4()
        commit = call(row, row2, key=key)
        query('BEGIN; ' + commit + ' ROLLBACK;')
        assert scalar('SELECT count(*) FROM r5_finance_private.import_batches') == '0'
        query("CREATE FUNCTION test_fail_import_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.after_value->>'amount_satang'='1200' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_fail_import_audit BEFORE INSERT ON finance_audit FOR EACH ROW EXECUTE FUNCTION test_fail_import_audit();")
        deny(commit, 'P0001')
        assert scalar('SELECT (SELECT count(*) FROM finance_entries),(SELECT count(*) FROM finance_audit),(SELECT count(*) FROM r5_finance_private.import_batches),(SELECT count(*) FROM r5_finance_private.import_rows)') == '0|0|0|0'
        query('DROP TRIGGER test_fail_import_audit ON finance_audit;')
        with ThreadPoolExecutor(max_workers=2) as pool:
            hold = pool.submit(query, "SET application_name='r5-import-hold'; BEGIN; " + commit + ' SELECT pg_sleep(2); COMMIT;')
            deadline = monotonic() + 8
            while scalar("SELECT count(*) FROM pg_stat_activity WHERE application_name='r5-import-hold' AND wait_event='PgSleep'") != '1':
                if hold.done() or monotonic() >= deadline:
                    raise AssertionError(hold.result(timeout=5).stdout)
                sleep(.05)
            deny(commit, '55P03')
            saved = json.loads(next(line for line in hold.result().stdout.splitlines() if line.startswith('{')))
        assert saved == json.loads(scalar(commit))
        assert saved['receipt']['expenseSatang'] == 15201
        deny(call(row2, key=key), '22023')
        assert json.loads(scalar(call(row)))['issues'][0]['code'] == 'duplicate_reference'
        assert json.loads(scalar(call({**row, 'ref': 'NEW-REF'})))['issues'][0]['code'] == 'manual_match'
        assert scalar('SELECT count(*) FROM r5_finance_private.import_rows r JOIN finance_audit a ON a.id=r.audit_id AND a.entry_id=r.entry_id') == '2'
        after = json.loads(scalar(auth_read))
        assert sorted(r['amount'] for r in after['records'] if r['source'] == 'MANUAL') == [12, 140.01]
        assert [r for r in after['records'] if r['source'] != 'MANUAL'] == before['records']
        print(f'PASS {flavor}: finance import with the selected migration chain, owner guard, audit rollback, contention/retry, duplicates and ledger totals', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()
