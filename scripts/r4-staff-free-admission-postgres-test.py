"""R4 admission on a fresh native SCRAM loopback cluster; no app env or external DB."""
import argparse
import difflib
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import tempfile

from importlib import import_module

foundation = import_module('r4-staff-free-postgres-test')
ROOT = foundation.ROOT
MIGRATIONS = foundation.MIGRATIONS
ADMISSION = '20261119_R4_staff_free_admission'


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
        # Send bytes so Windows does not rewrite stored function-body newlines.
        result = subprocess.run([str(x) for x in cmd], env={**env, **(extra or {})},
                                input=sql.encode('utf-8') if sql is not None else None,
                                capture_output=True, timeout=45)
        result.stdout = result.stdout.decode('utf-8').replace('\r\n', '\n')
        result.stderr = result.stderr.decode('utf-8', errors='replace')
        if check:
            result.check_returncode()
        return result

    fixture_source = (ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    fixture = re.search(r'await db\.exec\(`([\s\S]*?)`\);', fixture_source)[1]
    old_seed = (ROOT / 'scripts/r4-staff-free-postgres-test.sql').read_text(encoding='utf-8')
    seed = old_seed.split('CREATE FUNCTION test_legacy_state()', 1)[0]
    before, after = (ROOT / 'scripts/r4-staff-free-admission-postgres-test.sql').read_text(encoding='utf-8').split('-- APPLY ADMISSION HERE')
    old_checks = ('public.kiosk_checkin(text,text,uuid,text)', 'public.real_frontdesk_checkin(text,text,uuid,text)')
    with tempfile.TemporaryDirectory(prefix='blu-r4-admit-') as tmp:
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
        db = 'blu_modules_test_r4_admit_' + secrets.token_hex(8)

        def query(sql, database=db, check=True):
            return run([client, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-w', '-h', '127.0.0.1',
                        '-p', port, '-U', 'postgres', '-d', database], sql, {'PGPASSWORD': password}, check)

        def migration(name):
            return (MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8')

        def apply(*names):
            for name in names:
                query(migration(name))

        def defs():
            # pg_get_functiondef adds line breaks around the body; pin the exact
            # prosrc as well so restoration preserves the migration fingerprint.
            return [query(f"SELECT split_part(pg_get_functiondef(oid),'AS $function$',1) "
                          "|| 'AS $r4_restore$' || prosrc || '$r4_restore$;' FROM pg_proc "
                          f"WHERE oid='{sig}'::regprocedure").stdout.strip() for sig in old_checks]

        try:
            with (work / 'ctl.log').open('wb') as output:
                subprocess.run([str(x) for x in [*ctl, '-l', log, 'start']], env=env, stdin=subprocess.DEVNULL,
                               stdout=output, stderr=output, timeout=25, check=True)
            query('CREATE DATABASE ' + db, 'postgres')
            print(query('SELECT version()').stdout.strip(), flush=True)
            query(fixture)
            query('ALTER TABLE members ADD COLUMN avatar_changed boolean DEFAULT false;')
            apply(*foundation.BASE)
            query('ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;')
            apply(*foundation.CATALOG, '20261118_R2_member_cards', '20261118_R2_staff_avatar')
            # Reuse real finalizer fixtures, but settle one order before R3 stamps slots.
            seed_setup, seed_orders = seed.split('SELECT test_settle(3)', 1)
            query(seed_setup + 'SELECT test_settle(6,2);')
            apply(*foundation.R3, '20261119_R4_staff_free_foundation')
            query('SELECT test_settle(3)' + seed_orders.replace('test_settle(8)', 'test_settle(8,6)'))
            query((ROOT / 'scripts/r4-staff-free-writer-test-only.sql').read_text(encoding='utf-8'))
            query(before)
            original = defs()
            # A source change to the second function and the migration's partial
            # replacement of the first must roll back in the same transaction.
            drift = query('BEGIN;\n' + original[1].replace("reason:='NO_ENTITLEMENT';", "reason := 'NO_ENTITLEMENT';")
                          + '\n' + migration(ADMISSION).replace('BEGIN;\n', '', 1), check=False)
            assert drift.returncode and 'Unreviewed R3 admission source' in log.read_text(encoding='utf-8', errors='replace'), drift
            assert defs() == original
            assert query("SELECT to_regprocedure('r4_staff_private.admission_term(integer,timestamptz,uuid)') IS NULL, "
                         "to_regclass('r4_staff_private.free_sales_member_start_idx') IS NULL").stdout.strip() == 't|t'
            query('CREATE TABLE r7_visits(id int)')
            blocked = query(migration(ADMISSION), check=False)
            assert blocked.returncode and 'requires the R3-only admission stack' in log.read_text(encoding='utf-8', errors='replace'), blocked
            query('DROP TABLE r7_visits')
            apply(ADMISSION)
            r6 = query(migration('20261118_R6_time_supplement'), check=False)
            assert r6.returncode and 'Unexpected R6 checkin source' in log.read_text(encoding='utf-8', errors='replace'), r6
            assert query("SELECT to_regprocedure('public.time_supplement_allows(integer,timestamptz)') IS NULL").stdout.strip() == 't'
            query(after)
            print('PASS: guarded migration/rollback, boundary and source attribution, CARD/BLU, override, replay, conflicts and no benefits changes', flush=True)

            # Hold a real later online settlement open under the member row lock.
            # A simultaneous admission must observe the committed successor and
            # deny by its narrow slot, rather than admitting via the staff slot.
            with ThreadPoolExecutor(max_workers=1) as pool:
                writer = pool.submit(query, 'BEGIN; SELECT test_settle(8); '
                                     "SELECT pg_advisory_xact_lock(824008); SELECT pg_sleep(3); COMMIT;")
                for _ in range(100):
                    ready = query('SELECT NOT pg_try_advisory_xact_lock(824008)').stdout.strip()
                    if ready == 't':
                        break
                else:
                    raise AssertionError('Later settlement did not take the test barrier')
                scan = query("SELECT test_r4_scan('token-1','race',gen_random_uuid(),'BLU-8',"
                             "test_r4_at(8,'15:00'))->>'reason'").stdout.strip()
                writer.result()
            assert scan == 'OFF_PEAK', scan
            assert query("WITH scan AS (SELECT test_r4_scan('token-1','later-online',gen_random_uuid(),"
                         "'BLU-8',test_r4_at(8,'10:00')) r) SELECT r->>'reason' FROM scan").stdout.strip() == 'PAID_ENTRY'
            assert query("SELECT notes FROM checkins WHERE scanner_device_id='later-online'").stdout.strip() == 'FRONTDESK ENTRY_ONLY PAID_ENTRY'
            print('PASS: concurrent assisted scan observes committed online settlement', flush=True)
            query('BEGIN;\n' + '\n'.join(original) + '\nCOMMIT;')
            restored = defs()
            assert restored == original, '\n'.join(d for a, b in zip(original, restored)
                                                        for d in difflib.unified_diff(a.splitlines(), b.splitlines()))
            # Pin the time again to compare restored R3 behavior inside the candidate interval.
            query('\n'.join(d.replace('t:=clock_timestamp();',
                                      "t:=current_setting('test.r4_scan_at')::timestamptz;") for d in original))
            assert query("SELECT test_r4_scan('token-1','restored',gen_random_uuid(),'BLU-4',"
                         "test_r4_at(4,'10:00'))->>'reason'").stdout.strip() == 'NO_ENTITLEMENT'
            assert query('SELECT count(*) FROM r4_staff_private.finance_source WHERE member_id=3').stdout.strip() == '1'
            print('PASS: restore captured R3 definitions, retain sale/finance evidence')
        except subprocess.CalledProcessError as exc:
            if log.exists():
                for line in log.read_text(encoding='utf-8', errors='replace').splitlines():
                    if any(label in line for label in ('ERROR:', 'CONTEXT:', 'DETAIL:')):
                        print(line)
            raise SystemExit(exc.stderr or exc.stdout or str(exc)) from None
        finally:
            if (data / 'postmaster.pid').exists():
                run([*ctl, '-m', 'fast', 'stop'])


if __name__ == '__main__':
    main()
