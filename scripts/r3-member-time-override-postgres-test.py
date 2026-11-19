"""Native PostgreSQL on a newly initialized loopback cluster; never reads app env files."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / 'src/db/migrations'
BASE = ('20261009_real_package_payments', '20261010_payment_promptpay', '20261024_kiosk',
        '20261024_real_benefits_admin', '20261024_real_frontdesk', '20261025_package_payment_benefits')
R3 = ('20261031_payment_receiver_bank', '20261031_payment_currency_recheck', '20261031_package_catalog',
      '20261031_package_catalog_order_guard', '20261118_R2_member_cards', '20261118_r3_package_catalog',
      '20261118_r3_package_catalog_checkin')
R6, R7 = '20261118_R6_time_supplement', '20261118_R7_visits'
OVERRIDE = '20261119_r3_member_time_override'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bin-dir', required=True, type=Path)
    parser.add_argument('--psql', type=Path)
    args = parser.parse_args()
    exe = '.exe' if os.name == 'nt' else ''
    bin_dir = args.bin_dir.resolve()
    client = args.psql.resolve() if args.psql else bin_dir / ('psql' + exe)
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith('PG') and k.upper() != 'DATABASE_URL'}
    env.update(PGCLIENTENCODING='UTF8', PGCONNECT_TIMEOUT='5', PGSSLMODE='disable')

    def run(cmd, sql=None, extra=None, check=True):
        return subprocess.run([str(x) for x in cmd], env={**env, **(extra or {})}, input=sql,
                              encoding='utf-8', capture_output=True, timeout=40, check=check)

    fixture_source = (ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    fixture = re.search(r'await db\.exec\(`([\s\S]*?)`\);', fixture_source)[1]
    october, before, after = re.split(r'-- APPLY (?:R3|OVERRIDE) HERE',
                                     (ROOT / 'scripts/r3-member-time-override-postgres-test.sql').read_text(encoding='utf-8'))
    with tempfile.TemporaryDirectory(prefix='blu-r3-override-') as tmp:
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
            conf.write(f"\nlisten_addresses = '127.0.0.1'\nport = {port}\nunix_socket_directories = ''\nstatement_timeout = '15s'\n")

        def query(db, sql, check=True):
            return run([client, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-w', '-h', '127.0.0.1',
                        '-p', port, '-U', 'postgres', '-d', db], sql, {'PGPASSWORD': password}, check)

        def apply(db, names):
            for name in names:
                query(db, (MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8'))

        try:
            with (work / 'ctl.log').open('wb') as output:
                subprocess.run([str(x) for x in [*ctl, '-l', log, 'start']], env=env, stdin=subprocess.DEVNULL,
                               stdout=output, stderr=output, timeout=25, check=True)
            print(query('postgres', 'SELECT version()').stdout.strip(), flush=True)
            for stack, earlier, later in [('r3_only', (), ()), ('r6_first', (R6,), ()),
                                          ('r7_first', (R6, R7), ()), ('r7_after', (), (R6, R7)),
                                          ('r6_then_r7', (R6,), (R7,))]:
                db = 'blu_modules_test_' + stack
                query('postgres', 'CREATE DATABASE ' + db)
                query(db, fixture)
                apply(db, BASE)
                query(db, 'ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;')
                apply(db, R3[:-2])
                query(db, october)
                apply(db, (*R3[-2:], *earlier))
                query(db, before)
                apply(db, (OVERRIDE, *later))
                if later:
                    query(db, 'SELECT r3_override_attach_r7()')
                query(db, after)
                race = "SELECT r3_override_write('token-1',gen_random_uuid(),test_payload(4,0,'00:00-24:00'))"
                with ThreadPoolExecutor(max_workers=2) as pool:
                    results = list(pool.map(lambda _: query(db, race, False), range(2)))
                assert sorted(r.returncode == 0 for r in results) == [False, True], [(r.stdout, r.stderr) for r in results]
                assert any('40001' in r.stderr or 'Stale version' in r.stderr for r in results)
                assert query(db, 'SELECT count(*) FROM r3_member_time_override_events WHERE member_id=4').stdout.strip() == '1'
                assert query(db, "SELECT kiosk_checkin('kiosk','desk',gen_random_uuid(),'BLU-4')->>'reason'").stdout.strip() == 'PAID_ENTRY'
                print(f'PASS: {db} admission, audit, stale/replay, entitlement isolation, and concurrent writers', flush=True)
        except subprocess.CalledProcessError as exc:
            if log.exists():
                lines = log.read_text(encoding='utf-8', errors='replace').splitlines()
                print('\n'.join(line for line in lines if 'ERROR:' in line or 'CONTEXT:' in line))
            raise SystemExit(exc.stderr or exc.stdout or str(exc)) from None
        finally:
            if (data / 'postmaster.pid').exists():
                run([*ctl, '-m', 'fast', 'stop'])


if __name__ == '__main__':
    main()
