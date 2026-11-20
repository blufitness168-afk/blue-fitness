"""Native R4 tests on a fresh SCRAM loopback cluster; never reads app env files."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import tempfile
from threading import Barrier

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / 'src/db/migrations'
BASE = ('20261009_real_package_payments', '20261010_payment_promptpay', '20261024_kiosk',
        '20261024_real_benefits_admin', '20261024_real_frontdesk', '20261025_package_payment_benefits',
        '20261024_real_finance')
CATALOG = ('20261031_payment_receiver_bank', '20261031_payment_currency_recheck',
           '20261031_package_catalog', '20261031_package_catalog_order_guard')
R3 = ('20261118_r3_package_catalog', '20261118_r3_package_catalog_checkin',
      '20261119_r3_package_bonus_points', '20261119_r3_member_time_override')


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
        return subprocess.run([str(x) for x in cmd], env={**env, **(extra or {})}, input=sql,
                              encoding='utf-8', capture_output=True, timeout=45, check=check)

    source = (ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    fixture, = re.search(r'await db\.exec\(`([\s\S]*?)`\);', source).groups()
    tests = (ROOT / 'scripts/r4-staff-free-postgres-test.sql').read_text(encoding='utf-8')
    seed, verify_gate, verify_candidate = re.split(r'^-- INSTALL [A-Z]+ HERE$', tests, flags=re.M)
    with tempfile.TemporaryDirectory(prefix='blu-r4-staff-') as tmp:
        work = Path(tmp)
        data, log = work / 'data', work / 'server.log'
        pw_file, password = work / 'password', secrets.token_hex(32)
        pw_file.write_text(password + '\n', encoding='ascii')
        ctl = [bin_dir / ('pg_ctl' + exe), '-D', data, '-w', '-t', '15']
        run([bin_dir / ('initdb' + exe), '-D', data, '-U', 'postgres', '--auth-local=reject',
             '--auth-host=scram-sha-256', '--encoding=UTF8', '--locale=C', '--pwfile', pw_file])
        pw_file.unlink()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        with (data / 'postgresql.conf').open('a', encoding='ascii') as conf:
            conf.write(f"\nlisten_addresses = '127.0.0.1'\nport = {port}\nunix_socket_directories = ''\nstatement_timeout = '20s'\n")

        database = 'blu_modules_test_r4_' + secrets.token_hex(8)

        def query(sql, db=database, check=True):
            return run([client, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-w',
                        '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', db], sql, {'PGPASSWORD': password}, check)

        def apply(names):
            for name in names:
                query((MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8'))

        def race(*calls):
            barrier = Barrier(len(calls), timeout=5)

            def invoke(call):
                barrier.wait()
                return query(call, check=False)

            with ThreadPoolExecutor(max_workers=len(calls)) as pool:
                return list(pool.map(invoke, calls))

        try:
            with (work / 'ctl.log').open('wb') as output:
                subprocess.run([str(x) for x in [*ctl, '-l', log, 'start']], env=env, stdin=subprocess.DEVNULL,
                               stdout=output, stderr=output, timeout=25, check=True)
            query('CREATE DATABASE ' + database, 'postgres')
            print(query('SELECT version()').stdout.strip(), flush=True)
            query(fixture)
            apply(BASE)
            query('ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;')
            apply((*CATALOG, *R3, '20261118_R4_online_provenance', '20261118_R5_finance'))
            query(seed)
            apply(('20261119_R4_staff_free_foundation',))
            query(verify_gate)
            print('PASS: additive schema, private ACL, no writer, no backfill or legacy changes', flush=True)
            query((ROOT / 'scripts/r4-staff-free-writer-test-only.sql').read_text(encoding='utf-8'))
            query(verify_candidate)
            print('PASS: staff/session authorization, idempotency, eligibility, immutable audit, rollback, finance projection', flush=True)
            same = "SELECT test_candidate('token-1','50000000-0000-4000-8000-000000000001',7);"
            a, b = race('BEGIN; ' + same + ' SELECT pg_sleep(1); COMMIT;', same)
            assert a.returncode == b.returncode == 0 and a.stdout.strip() == b.stdout.strip(), (a, b)
            a, b = race("BEGIN; SELECT test_candidate('token-1',gen_random_uuid(),8); SELECT pg_sleep(1); COMMIT;",
                        "SELECT test_candidate('token-2',gen_random_uuid(),8);")
            assert sorted(r.returncode == 0 for r in (a, b)) == [False, True], (a, b)
            assert re.search(r'\b55000\b', (a if a.returncode else b).stderr), (a, b)
            final = query('''SELECT count(*) = 2 AND count(DISTINCT source_id) = 2 AND sum(amount_satang) = 0
                FROM r4_staff_private.finance_source WHERE member_id IN (7,8);
                SELECT business = test_legacy_state() FROM test_pin;''').stdout.splitlines()
            assert final == ['t', 't'], final
            print('PASS: concurrent identical replay and competing actors; one sale/source per predecessor, legacy state unchanged')
        except subprocess.CalledProcessError as exc:
            raise SystemExit(exc.stderr or exc.stdout or str(exc)) from None
        finally:
            if (data / 'postmaster.pid').exists():
                run([*ctl, '-m', 'fast', 'stop'])


if __name__ == '__main__':
    main()
