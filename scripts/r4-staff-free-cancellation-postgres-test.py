"""R4 cancellation on a fresh native PostgreSQL SCRAM loopback cluster."""
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
import json
import re
from time import monotonic, sleep

runner = import_module('r4-staff-free-display-postgres-test')
base = runner.base
CANCEL = 'r4_staff_private.cancel_free_sale(text,uuid,uuid,text)'
MIGRATION = '20261120_R4_staff_free_z_cancellation'
EVENT = 'r4_staff_private.free_sale_cancellations'
GUARD_MIGRATION = '20261121_R4_staff_free_purchase_guard'
GUARD = 'a_r4_staff_free_online_purchase_guard'
ORDERS = 'public.package_payment_orders'
ALTER_GUARD = f'ALTER TABLE {ORDERS}'
DROP_GUARD = f'DROP TRIGGER {GUARD} ON {ORDERS}; '
DISABLE_GUARD = f'{ALTER_GUARD} DISABLE TRIGGER {GUARD}; '
ENABLE_GUARD = f'{ALTER_GUARD} ENABLE TRIGGER {GUARD}; '
GUARD_FN = 'r4_staff_private.guard_online_purchase()'
PREVIEW = "SELECT r4_staff_private.preview_free_sale('token-1','BLU-3');"
RECORD = ("SELECT r4_staff_private.record_free_sale('token-1',key,'BLU-'||member_id,offer,'Synthetic sale') "
          "FROM test_free_request WHERE member_id=3;")
FINANCE = "SELECT real_finance_action('token-2','read',NULL,'{}');"


def exercise(query):
    def migration(name):
        return (base.MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8')

    def apply(*names):
        for name in names:
            query(migration(name))

    def scalar(sql):
        result = query(sql, check=False)
        assert not result.returncode, result.stderr
        return result.stdout.strip()

    def deny(sql, state):
        result = query(sql, check=False)
        assert result.returncode and state in result.stderr, result.stderr

    def call(mid=3, token='token-2', key='key', why="'Synthetic cancellation'"):
        return (f"SELECT r4_staff_private.cancel_free_sale('{token}',{key},sale_id,{why}) "
                f"FROM test_cancel_target WHERE member_id={mid};")

    def projection(mid):
        return json.loads(scalar(f"SELECT r4_staff_private.display_terms('token-{mid}',NULL);"))

    def wait_for(where):
        deadline = monotonic() + 7
        while monotonic() < deadline:
            if scalar(f'SELECT EXISTS (SELECT FROM pg_stat_activity WHERE {where});') == 't':
                return
            sleep(.02)
        raise AssertionError('Expected native wait: ' + where)

    def race(first, second):
        # A session-level gate lets the test observe actual lock contention
        # before allowing the blocking transaction to commit.
        gate = ('BEGIN; SELECT pg_advisory_xact_lock(810412); '
                "SET LOCAL application_name='r4-test-gate'; SELECT pg_sleep(5); COMMIT;")
        with ThreadPoolExecutor(max_workers=3) as pool:
            gate_work = pool.submit(query, gate, False)
            wait_for("application_name='r4-test-gate' AND wait_event='PgSleep'")
            writer = pool.submit(query, "BEGIN; SET LOCAL application_name='r4-first'; " + first +
                                 'SELECT pg_advisory_xact_lock(810412); COMMIT;', False)
            wait_for("application_name='r4-first' AND wait_event='advisory'")
            waiter = pool.submit(query, "SET application_name='r4-second'; " + second, False)
            wait_for("application_name='r4-second' AND wait_event_type='Lock'")
            scalar("SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE application_name='r4-test-gate';")
            gate_work.result()
            a, b = writer.result(), waiter.result()
        assert not a.returncode, a.stderr
        return a, b

    source = (base.ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    seed = (base.ROOT / 'scripts/r4-staff-free-postgres-test.sql').read_text(encoding='utf-8')
    fixture = re.search(r'await db\.exec\(`([\s\S]*?)`\);', source)[1]
    legacy_snapshot = seed[seed.index('CREATE FUNCTION test_legacy_state()'):seed.index('CREATE TABLE test_pin')]
    legacy_snapshot = legacy_snapshot.split(',\n (SELECT array_agg', 1)[0] + ');\n$$;'
    for r5 in (False, True):
        # The runner switches to a second synthetic database for the R5 baseline.
        if r5:
            original_query = query
            original_query('CREATE DATABASE blu_modules_test_r4_cancellation_r5;')
            query = lambda sql, check=True: original_query(sql, check=check, database='blu_modules_test_r4_cancellation_r5')
        scalar(fixture)
        scalar('ALTER TABLE members ADD COLUMN avatar_changed boolean DEFAULT false;')
        apply(*base.BASE)
        scalar('ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;')
        apply(*base.CATALOG, '20261118_R2_member_cards', '20261118_R2_staff_avatar', *base.R3,
              '20261118_R4_online_provenance')
        if r5:
            apply('20261118_R5_finance')
        scalar(seed.split('SELECT test_settle(3)', 1)[0] + legacy_snapshot +
               'SELECT test_settle(3),test_settle(4),test_settle(5),test_settle(6),test_settle(7);')
        apply('20261119_R4_staff_free_foundation', '20261119_R4_staff_free_admission',
              '20261119_R4_staff_free_finance', '20261119_R4_staff_free_writer')
        deny(migration(MIGRATION), 'P0001')  # Display absent; no partial install.
        assert scalar(f"SELECT to_regclass('{EVENT}') IS NULL;") == 't'
        apply(runner.DISPLAY)
        deny(migration(GUARD_MIGRATION), '0A000')  # Cancellation absent; no partial install.
        assert scalar(f"SELECT to_regprocedure('{GUARD_FN}') IS NULL;") == 't'
        pre_install = scalar('SELECT test_legacy_state();')
        pre_install_finance = scalar(FINANCE)
        apply(MIGRATION)
        deny(PREVIEW, '0A000')
        deny("SELECT r4_staff_private.record_free_sale('token-1',gen_random_uuid(),'BLU-3','{}','Synthetic sale');", '0A000')
        assert scalar('SELECT count(*) FROM r4_staff_private.free_sales;') == '0'
        apply(GUARD_MIGRATION)
        assert scalar('SELECT test_legacy_state();') == pre_install
        assert scalar(FINANCE) == pre_install_finance

        scalar('''CREATE TABLE test_free_request AS SELECT i AS member_id,gen_random_uuid() AS key,
               r4_staff_private.preview_free_sale('token-1','BLU-'||i) AS offer FROM generate_series(3,7) i;''')
        trigger_sql = f'CREATE TRIGGER {GUARD} {{}} ON {ORDERS} {{}} EXECUTE FUNCTION {{}}; '
        drift_cases = (
            DROP_GUARD, DISABLE_GUARD, f'{ALTER_GUARD} ENABLE REPLICA TRIGGER {GUARD}; ',
            "SET LOCAL session_replication_role='replica'; ",
            DROP_GUARD + trigger_sql.format('AFTER INSERT', 'FOR EACH ROW', GUARD_FN),
            DROP_GUARD + trigger_sql.format('BEFORE INSERT', 'FOR EACH STATEMENT', GUARD_FN),
            DROP_GUARD + trigger_sql.format('BEFORE UPDATE', 'FOR EACH ROW', GUARD_FN),
            DROP_GUARD + trigger_sql.format('BEFORE INSERT', 'FOR EACH ROW WHEN (false)', GUARD_FN),
            DROP_GUARD + trigger_sql.format('BEFORE INSERT', 'FOR EACH ROW', GUARD_FN[:-1] + "'unexpected')"),
            DROP_GUARD + 'CREATE FUNCTION test_fake_guard() RETURNS trigger LANGUAGE plpgsql '
            'AS $$ BEGIN RETURN NEW; END $$; ' + trigger_sql.format('BEFORE INSERT', 'FOR EACH ROW', 'test_fake_guard()'),
            f'CREATE OR REPLACE FUNCTION {GUARD_FN} RETURNS trigger LANGUAGE plpgsql '
            'VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN RETURN NEW; END $$; ',
        )
        for drift in drift_cases:
            deny('BEGIN; ' + drift + PREVIEW, '0A000')
            deny('BEGIN; ' + drift + RECORD, '0A000')
        # A guard disabled by concurrent DDL must also be detected after the lock wait.
        _, b = race(DISABLE_GUARD, RECORD)
        assert b.returncode and '0A000' in b.stderr, b.stderr
        scalar(ENABLE_GUARD)
        assert scalar('SELECT count(*) FROM r4_staff_private.free_sales;') == '0'
        receipt = scalar(RECORD)
        assert scalar(f'BEGIN; {ALTER_GUARD} ENABLE ALWAYS TRIGGER {GUARD}; ' + RECORD + 'ROLLBACK;') == receipt
        deny('BEGIN; ' + DISABLE_GUARD + RECORD, '0A000')  # Replay cannot bypass the gate.
        scalar('''SELECT r4_staff_private.record_free_sale('token-1',key,'BLU-'||member_id,offer,'Synthetic sale')
               FROM test_free_request WHERE member_id<>3;
          CREATE TABLE test_cancel_target AS SELECT member_id,sale_id,gen_random_uuid() AS key
               FROM r4_staff_private.free_sales;
          INSERT INTO auth_sessions(member_id,token_hash,expires_at,revoked_at)
               VALUES(2,'owner-revoked',now()+interval '1 day',now()),(2,'owner-expired',now()-interval '1 day',NULL);''')
        read_roles = 'cancel_backend' if not r5 else 'cancel_backend_r5'
        outsider = 'cancel_outsider' if not r5 else 'cancel_outsider_r5'
        scalar(f'CREATE ROLE {read_roles} NOLOGIN; CREATE ROLE {outsider} NOLOGIN;')
        legacy = scalar('SELECT test_legacy_state();')
        sales = scalar('SELECT jsonb_agg(f ORDER BY sale_id) FROM r4_staff_private.free_sales f;')
        before = json.loads(scalar(FINANCE))
        assert projection(3)[0]['status'] == 'SCHEDULED'
        assert scalar(f"SELECT has_function_privilege('{outsider}','{CANCEL}','EXECUTE'), "
                      f"has_table_privilege('{outsider}','{EVENT}','SELECT,INSERT');") == 'f|f'
        deny('BEGIN ISOLATION LEVEL REPEATABLE READ; ' + call(), '0A000')
        for token in ('token-1','token-3','missing','kiosk','owner-revoked','owner-expired'):
            deny(call(token=token), '42501')
        deny(call(why="'   '"), '22023')
        deny("SELECT r4_staff_private.cancel_free_sale('token-2',gen_random_uuid(),id,'Not a staff sale') "
             "FROM package_payment_orders WHERE member_id=3;", '55000')
        scalar('BEGIN; ' + call() + 'ROLLBACK;')
        assert projection(3)[0]['status'] == 'SCHEDULED'
        assert scalar(f'SELECT count(*) FROM {EVENT};') == '0'
        deny(f'''BEGIN;
                  UPDATE auth_sessions SET expires_at=expires_at+interval '1 year' WHERE token_hash='token-2';
                  DO $$ BEGIN
          EXECUTE replace(pg_get_functiondef('r4_staff_private.cancel_free_sale_impl(text,uuid,uuid,text,text)'::regprocedure), 't:=clock_timestamp();',
            'SELECT starts_at INTO t FROM r4_staff_private.free_sales WHERE sale_id=p_sale;');
          END $$; {call()}''', '55000')
        # Minimal trusted test execution; outsiders and staff sessions still cannot cancel.
        scalar(f'''GRANT USAGE ON SCHEMA r4_staff_private TO {read_roles};
          GRANT EXECUTE ON FUNCTION {CANCEL}, r4_staff_private.assert_writer_stack(), r4_staff_private.staff_session(text),
                         r4_staff_private.cancel_free_sale_impl(text,uuid,uuid,text,text),
                         r4_staff_private.cancellation_owner_session(text),
                         r4_staff_private.free_sale_cancellation_eligible(r4_staff_private.free_sales,public.members,timestamptz),
               r4_staff_private.admission_term(integer,timestamptz,uuid),
               public.r3_override_current_order(integer,timestamptz), public.package_catalog_daily_slot_valid(text)
               TO {read_roles};
          GRANT SELECT ON test_cancel_target, r4_staff_private.free_sales, r4_staff_private.finance_source,
               {EVENT}, package_payment_orders, package_payment_point_ledger, payment_transfer_refs, checkins TO {read_roles};
          GRANT INSERT ON {EVENT} TO {read_roles};
          GRANT SELECT,UPDATE ON members,auth_sessions TO {read_roles};''')
        a, b = race(f'SET LOCAL ROLE {read_roles}; ' + call(), f'SET ROLE {read_roles}; ' + call())
        assert not b.returncode and a.stdout.strip() == b.stdout.strip(), b.stderr
        receipt = json.loads(b.stdout)
        assert receipt['status'] == 'CANCELLED' and receipt['amountSatang'] == 0
        assert json.loads(scalar(call(why="E'  Synthetic cancellation\\n'"))) == receipt
        deny(call(why="'Different'"), '22023')
        deny(call(key='gen_random_uuid()'), '55000')
        assert scalar(f'SELECT c.actor_id,c.reason,c.cancelled_at<s.starts_at FROM {EVENT} c '
                      'JOIN r4_staff_private.free_sales s USING (sale_id);') == '2|Synthetic cancellation|t'
        assert scalar('SELECT test_legacy_state();') == legacy
        assert scalar('SELECT jsonb_agg(f ORDER BY sale_id) FROM r4_staff_private.free_sales f;') == sales
        assert projection(3) == [] and projection(4)[0]['status'] == 'SCHEDULED'
        after = json.loads(scalar(FINANCE))
        row = next(r for r in after['records'] if r['source'] == 'STAFF_FREE_CANCELLATION')
        assert row['id'] == 'staff-free-cancellation:' + receipt['saleId']
        assert row['amount'] == 0 and row['category'] == 'ยกเลิกการสมัคร'
        assert 'ไม่คืนเงิน · staff-free:' + receipt['saleId'] in row['note']
        assert row['date'] == scalar(f"SELECT (cancelled_at AT TIME ZONE 'Asia/Bangkok')::date FROM {EVENT};")
        assert {**after, 'records': [r for r in after['records'] if r != row]} == before
        deny(FINANCE.replace('token-2','token-1'), '42501')
        for mutation in (f'UPDATE {EVENT} SET reason=reason;', f'DELETE FROM {EVENT};', f'TRUNCATE {EVENT};'):
            deny(mutation, '55000')

        # Advance only the admission clock; both deployed entrypoints retain real logic.
        sql = (base.ROOT / 'scripts/r4-staff-free-admission-postgres-test.sql').read_text(encoding='utf-8')
        scalar(sql[sql.index('DO $$\nDECLARE d text;'):sql.index('CREATE FUNCTION test_fail_r4_visit')])
        for token, station in (('kiosk','desk'),('token-1','cancel-desk')):
            result = json.loads(scalar(f"SELECT test_r4_scan('{token}','{station}',gen_random_uuid(),"
                                       "'BLU-3',test_r4_at(3,'10:00'));"))
            assert result['reason'] == 'NO_ENTITLEMENT', result
        still_active = json.loads(scalar("SELECT test_r4_scan('kiosk','desk',gen_random_uuid(),'BLU-4',test_r4_at(4,'10:00'));"))
        assert still_active['reason'] == 'PAID_ENTRY', still_active
        deny(call(4), '55000')  # Previously recorded use, regardless of current wall clock.
        # Inject later legacy orders with the guard disabled only inside the fixture transaction.
        _, b = race(DISABLE_GUARD + 'SELECT test_buy(5,1);' + ENABLE_GUARD, call(5))
        assert b.returncode and '55000' in b.stderr, b.stderr
        scalar("UPDATE package_payment_orders SET status='REJECTED', rejection_reason='CUSTOMER_CANCELLED' WHERE member_id=5 AND status='PENDING';")
        deny(call(5), '55000')  # Later terminal order, not just pending.
        scalar('BEGIN; ' + DISABLE_GUARD + 'SELECT test_settle(6);' + ENABLE_GUARD + 'COMMIT;')
        deny(call(6), '55000')  # Later PAID.
        _, b = race("UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE token_hash='token-2';", call(7))
        assert b.returncode and '42501' in b.stderr, b.stderr
        deny(call(), '42501')  # Replay does not bypass the gate.
        assert scalar(f'SELECT count(*) FROM {EVENT};') == '1'
        orders_before = scalar('SELECT count(*) FROM package_payment_orders;')
        deny('SELECT test_buy(4,1);', 'P4F01')  # Staff term not yet started.
        assert scalar('SELECT count(*) FROM package_payment_orders;') == orders_before
        a, b = race('SELECT id FROM members WHERE id=4 FOR UPDATE;', 'SELECT test_buy(4,1);')
        assert b.returncode and 'P4F01' in b.stderr, b.stderr
        assert scalar('SELECT count(*) FROM package_payment_orders;') == orders_before
        scalar('BEGIN; SELECT test_buy(3,1); SELECT test_buy(8,1); ROLLBACK;')  # Cancelled term and no staff term.
        print(f'PASS: {"R5" if r5 else "October"} purchase guard blocks before order creation; cancelled and ordinary cases unaffected', flush=True)
        print(f'PASS: {"R5" if r5 else "October"} guards, ACL/auth, rollback, append-only event, finance, '
              'display/admission, actual same-key/order/session lock waits, later/used denial and legacy preservation', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()
