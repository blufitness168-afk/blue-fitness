"""R4 finance on native scratch PostgreSQL, using October and R5 finance migrations."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import tempfile

foundation = import_module('r4-staff-free-postgres-test')
ROOT = foundation.ROOT
MIGRATION = '20261119_R4_staff_free_finance'
OWNER = "SELECT public.real_finance_action('token-2','read',NULL,'{}');"
SIGNATURE = 'public.real_finance_action(text,text,uuid,jsonb)'


def read(rel):
    return (ROOT / rel).read_text(encoding='utf-8')


def migration(name):
    return read(f'src/db/migrations/{name}.sql')


def exercise(query, r5, log):
    def apply(*names):
        for name in names:
            query(migration(name))

    def deny(sql, state, message=None):
        offset = log.stat().st_size
        result = query(sql, check=False)
        detail = log.read_bytes()[offset:].decode('utf-8', errors='replace')
        assert result.returncode and state in result.stderr, detail or result.stderr
        assert message is None or message in detail, detail

    fixture = re.search(r'await db\.exec\(`([\s\S]*?)`\);', read('src/lib/package-payment-benefits.test.mjs'))[1]
    seed = read('scripts/r4-staff-free-postgres-test.sql').split('SELECT test_settle(3)', 1)[0]
    query(fixture)
    query('ALTER TABLE members ADD COLUMN avatar_changed boolean DEFAULT false;')
    apply(*foundation.BASE)
    query('ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;')
    apply(*foundation.CATALOG, '20261118_R2_member_cards', '20261118_R2_staff_avatar', *foundation.R3)
    if r5:
        apply('20261118_R5_finance')
    query(seed + 'SELECT test_settle(3), test_settle(4); SELECT test_buy(9,1);')

    query('''SELECT real_finance_action('token-2','create',gen_random_uuid(),
      '{"date":"2026-01-01","type":"EXPENSE","category":"อุปกรณ์","amountSatang":1234,"note":"Synthetic"}');''')
    before = json.loads(query(OWNER).stdout)
    paid = next(r for r in before['records'] if r['memberCode'] == 'BLU-4')
    date_column = 'confirmed_at' if r5 else 'paid_at'
    assert paid['date'] == query(f"SELECT ({date_column} AT TIME ZONE 'Asia/Bangkok')::date FROM package_payment_orders WHERE member_id=4;").stdout.strip()
    assert len(before['records']) == 3 and len(before['audit']) == 1
    assert ('unconfirmedPaidCount' in before) == r5

    apply('20261119_R4_staff_free_foundation')
    deny(migration(MIGRATION), 'P0001', 'requires the foundation view and staff admission')
    apply('20261119_R4_staff_free_admission')
    query(f'''CREATE ROLE finance_trusted NOLOGIN;
      CREATE ROLE finance_untrusted NOLOGIN;
      GRANT EXECUTE ON FUNCTION {SIGNATURE} TO finance_trusted;
      GRANT SELECT, UPDATE ON members, auth_sessions TO finance_trusted;
      GRANT SELECT ON finance_entries, finance_audit, package_payment_orders TO finance_trusted;''')
    identity = f"SELECT oid,proowner,proacl,prosecdef,proconfig FROM pg_proc WHERE oid='{SIGNATURE}'::regprocedure;"
    acl = query(identity).stdout
    definition = query(f"SELECT pg_get_functiondef('{SIGNATURE}'::regprocedure);").stdout
    original_body = query(f"SELECT prosrc FROM pg_proc WHERE oid='{SIGNATURE}'::regprocedure;").stdout[:-1]
    # pg_get_functiondef adds line breaks around prosrc. Restore exact source for the guard.
    restore = definition.split('AS $function$', 1)[0] + 'AS $restore$' + original_body + '$restore$;'
    raw = f"SELECT prosrc FROM pg_proc WHERE oid='{SIGNATURE}'::regprocedure;"
    deny('BEGIN;\n' + restore.replace("IF p_action='read'", "IF p_action = 'read'") + '\n'
         + migration(MIGRATION).replace('BEGIN;\n', '', 1), 'P0001', 'Unreviewed finance function')
    assert query(raw).stdout[:-1] == original_body
    apply(MIGRATION)  # No fixture writer installed at migration time.
    assert query(identity).stdout == acl
    assert json.loads(query(OWNER).stdout) == before
    deny(migration(MIGRATION), 'P0001', 'Unreviewed finance function')
    assert query("SELECT has_schema_privilege('finance_untrusted','r4_staff_private','USAGE'), "
                 "has_table_privilege('finance_trusted','r4_staff_private.finance_source','SELECT'), "
                 f"has_function_privilege('finance_untrusted','{SIGNATURE}','EXECUTE');").stdout.strip() == 'f|f|f'
    deny('SET ROLE finance_trusted; ' + OWNER, '42501')
    query('GRANT USAGE ON SCHEMA r4_staff_private TO finance_trusted; '
          'GRANT SELECT ON r4_staff_private.finance_source TO finance_trusted;')
    assert query("SELECT has_table_privilege('finance_trusted','r4_staff_private.free_sales','SELECT,INSERT,UPDATE,DELETE');").stdout.strip() == 'f'
    deny('SET ROLE finance_untrusted; SELECT * FROM r4_staff_private.finance_source;', '42501')

    apply('20261119_R4_staff_free_writer', '20261120_R4_staff_free_display',
          '20261120_R4_staff_free_z_cancellation', '20261121_R4_staff_free_purchase_guard')
    deny("SELECT r4_staff_private.preview_free_sale('token-3','BLU-3');", '42501')
    query('''CREATE TABLE test_candidate_request AS SELECT gen_random_uuid() AS key,
       r4_staff_private.preview_free_sale('token-1','BLU-3') AS offer;
      CREATE FUNCTION test_finance_candidate() RETURNS jsonb LANGUAGE sql AS $$
       SELECT r4_staff_private.record_free_sale('token-1',key,'BLU-3',offer,'PRIVATE_SYNTHETIC_REASON')
       FROM test_candidate_request;
      $$;''')
    query('BEGIN; SELECT test_finance_candidate(); ROLLBACK;')
    assert query('SELECT count(*) FROM r4_staff_private.free_sales;').stdout.strip() == '0'
    with ThreadPoolExecutor(max_workers=2) as pool:
        first, replay = list(pool.map(lambda sql: query(sql).stdout, [
            'BEGIN; SELECT test_finance_candidate(); SELECT pg_sleep(0.5); COMMIT;',
            'SELECT test_finance_candidate();',
        ]))
    receipt = next(line for line in first.splitlines() if line.startswith('{'))
    assert json.loads(receipt)['amountSatang'] == 0
    assert receipt == replay.strip() == query('SELECT test_finance_candidate();').stdout.strip()
    deny("SELECT r4_staff_private.record_free_sale('token-1',key,'BLU-3',offer,'changed') FROM test_candidate_request;", '22023')
    deny("SELECT r4_staff_private.record_free_sale('token-2',gen_random_uuid(),'BLU-3',offer,'duplicate') FROM test_candidate_request;", '55000')
    producer = json.loads(query('SELECT to_jsonb(f) FROM r4_staff_private.finance_source f;').stdout)
    snapshot = '''SELECT jsonb_build_array(
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY sale_id) FROM r4_staff_private.free_sales x),
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM package_payment_orders x),
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM finance_entries x),
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM finance_audit x),
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY actor_id,request_key) FROM finance_action_requests x));'''
    saved = query(snapshot).stdout
    after = json.loads(query('SET ROLE finance_trusted; ' + OWNER).stdout)
    assert json.loads(query(OWNER).stdout) == after
    rows = [row for row in after['records'] if row['source'] == 'STAFF_FREE']
    assert len(rows) == 1
    row = rows[0]
    assert row == dict(id=producer['source_id'], type='INCOME', source='STAFF_FREE',
                       date=producer['entry_date'], amount=0, createdAt=producer['recorded_at'], version=0,
                       category='ต่อสมาชิก', note='STAFF_FREE · ' + producer['source_id'],
                       memberCode='BLU-3', memberName='Synthetic'), row
    assert type(row['amount']) in (int, float)
    assert {**after, 'records': [r for r in after['records'] if r not in rows]} == before
    for kind in ('INCOME', 'EXPENSE'):
        assert sum(r['amount'] for r in before['records'] if r['type'] == kind) == sum(
            r['amount'] for r in after['records'] if r['type'] == kind)
    for token in ('token-1', 'token-3', 'kiosk', 'missing'):
        deny('SET ROLE finance_trusted; ' + OWNER.replace('token-2', token), '42501', 'Owner session required')
    for action in ('update', 'delete'):
        for raw_id, expected in ((row['id'], '22P02'), (producer['sale_id'], 'P0001')):
            deny(f"SELECT real_finance_action('token-2','{action}',gen_random_uuid(),"
                 f"jsonb_build_object('id','{raw_id}','version',1,'reason','Synthetic'));", expected)
    # Pin only the kiosk clock to a real staff term. Admission and replay must
    # not add a second ledger row or turn the check-in into paid income.
    query('''DO $$ BEGIN
      EXECUTE replace(pg_get_functiondef('public.kiosk_checkin(text,text,uuid,text)'::regprocedure),
        't:=clock_timestamp();', 't:=current_setting(''test.r4_finance_scan_at'')::timestamptz;');
    END $$;''')
    scan_at = """SELECT set_config('test.r4_finance_scan_at',
      (((starts_at AT TIME ZONE 'Asia/Bangkok')::date+1+time '09:00') AT TIME ZONE 'Asia/Bangkok')::text,false)
      FROM r4_staff_private.free_sales;"""
    scan = "SELECT member_scan_admit('kiosk','desk','61190000-0000-4000-8000-000000000021','BLU-3',NULL);"
    checked = query(scan_at + scan + scan).stdout.splitlines()
    assert checked[-1] == checked[-2] and json.loads(checked[-1])['reason'] == 'PAID_ENTRY', checked
    assert query("SELECT notes FROM checkins WHERE notes LIKE '%STAFF_FREE_ENTRY%';").stdout.strip() == (
        'KIOSK ENTRY_ONLY STAFF_FREE_ENTRY term=STAFF_FREE:' + producer['sale_id'])
    assert json.loads(query(OWNER).stdout) == after
    assert query(snapshot).stdout == saved
    query(restore)
    assert query(identity).stdout == acl and json.loads(query(OWNER).stdout) == before
    assert query(snapshot).stdout == saved
    print(f'PASS: {"R5" if r5 else "October"} native read, migration guards, ACL, owner/admin, replay, immutable sale, totals and restore', flush=True)
    return {'before': before, 'after': after}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bin-dir', required=True, type=Path)
    parser.add_argument('--psql', type=Path)
    args = parser.parse_args()
    exe = '.exe' if os.name == 'nt' else ''
    bin_dir = args.bin_dir.resolve()
    client = args.psql.resolve() if args.psql else bin_dir / ('psql' + exe)
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith('PG') and k.upper() != 'DATABASE_URL'}
    env.update(PGCLIENTENCODING='UTF8', PGCONNECT_TIMEOUT='5', PGSSLMODE='disable', PYTHONIOENCODING='utf-8')

    def run(cmd, sql=None, extra=None, check=True):
        # Preserve exact pg_proc body bytes across Windows stdin/stdout.
        result = subprocess.run([str(x) for x in cmd], env={**env, **(extra or {})},
                                input=None if sql is None else sql.encode('utf-8'),
                                capture_output=True, timeout=45)
        result.stdout = result.stdout.decode('utf-8').replace('\r\n', '\n')
        result.stderr = result.stderr.decode('utf-8', errors='replace')
        if check:
            result.check_returncode()
        return result

    with tempfile.TemporaryDirectory(prefix='blu-r4-finance-') as tmp:
        work = Path(tmp)
        data, log = work / 'data', work / 'server.log'
        password = secrets.token_hex(32)
        pw_file = work / 'password'
        pw_file.write_text(password + '\n', encoding='ascii')
        ctl = [bin_dir / ('pg_ctl' + exe), '-D', data, '-w', '-t', '15']
        run([bin_dir / ('initdb' + exe), '-D', data, '-U', 'postgres', '--auth-local=reject',
             '--auth-host=scram-sha-256', '--encoding=UTF8', '--locale=C', '--pwfile', pw_file])
        pw_file.unlink()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        with (data / 'postgresql.conf').open('a', encoding='ascii') as conf:
            conf.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nunix_socket_directories=''\nstatement_timeout='20s'\n")

        def query(sql, db='postgres', check=True):
            return run([client, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-w',
                        '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', db], sql, {'PGPASSWORD': password}, check)

        try:
            with (work / 'ctl.log').open('wb') as output:
                subprocess.run([str(x) for x in [*ctl, '-l', log, 'start']], env=env, stdin=subprocess.DEVNULL,
                               stdout=output, stderr=output, timeout=25, check=True)
            print(query('SELECT version()').stdout.strip(), flush=True)
            cases = []
            for variant in ('october', 'r5'):
                db = 'blu_modules_test_finance_' + variant
                query('CREATE DATABASE ' + db)
                cases.append(exercise(lambda sql, check=True: query(sql, db, check), variant == 'r5', log))
                query('DROP DATABASE ' + db)
                query('DROP ROLE finance_trusted, finance_untrusted;')
            result = run(['node', ROOT / 'scripts/r4-staff-free-finance-presentation.mjs'], json.dumps(cases))
            print(result.stdout.strip())
        except subprocess.CalledProcessError as exc:
            if log.exists() and str(client) == exc.cmd[0]:
                print('\n'.join(log.read_text(encoding='utf-8', errors='replace').splitlines()[-18:]))
            raise SystemExit(exc.stderr or exc.stdout or str(exc)) from None
        finally:
            if (data / 'postmaster.pid').exists():
                run([*ctl, '-m', 'fast', 'stop'])


if __name__ == '__main__':
    main()
