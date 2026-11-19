"""Native PostgreSQL regression. Creates its own SCRAM loopback cluster; no existing DB or provider.
Windows portable example:
  python scripts/r3-package-bonus-postgres-test.py --bin-dir .local-db/portable-postgres-uat/package/native/bin --psql .local-db/portable-postgres-uat/psql.exe
"""
import argparse
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / 'src/db/migrations'
BASELINE = (
    '20261009_real_package_payments', '20261010_payment_promptpay', '20261024_kiosk',
    '20261024_real_benefits_admin', '20261024_real_rewards', '20261024_real_frontdesk',
    '20261025_package_payment_benefits',
)
CATALOG = (
    '20261031_payment_receiver_bank', '20261031_payment_currency_recheck',
    '20261031_package_catalog', '20261031_package_catalog_order_guard',
    '20261118_r3_package_catalog', '20261118_r3_package_catalog_checkin', '20261118_R4_online_provenance',
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bin-dir', required=True, type=Path)
    parser.add_argument('--psql', type=Path, help='Optional path to a psql-compatible client')
    args = parser.parse_args()
    bin_dir = args.bin_dir.resolve()
    exe = '.exe' if os.name == 'nt' else ''
    client = args.psql.resolve() if args.psql else bin_dir / ('psql' + exe)
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith('PG') and key.upper() != 'DATABASE_URL'}
    env.update(PGCLIENTENCODING='UTF8', PGCONNECT_TIMEOUT='5', PGSSLMODE='disable')

    def run(command, sql=None, extra=None):
        return subprocess.run([str(x) for x in command], input=sql, env={**env, **(extra or {})},
                              encoding='utf-8', errors='replace', capture_output=True, timeout=45, check=True)

    with tempfile.TemporaryDirectory(prefix='blu-r3-bonus-') as tmp:
        work = Path(tmp)
        data, log, password_file = work / 'data', work / 'server.log', work / 'password'
        password = secrets.token_hex(32)
        password_file.write_text(password + '\n', encoding='ascii')
        ctl = (bin_dir / ('pg_ctl' + exe), '-D', data, '-w', '-t', '15')
        run((bin_dir / ('initdb' + exe), '-D', data, '-U', 'postgres', '--auth-local=reject',
             '--auth-host=scram-sha-256', '--encoding=UTF8', '--locale=C', '--pwfile', password_file))
        password_file.unlink()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        with (data / 'postgresql.conf').open('a', encoding='ascii') as conf:
            conf.write(f"\nlisten_addresses = '127.0.0.1'\nport = {port}\nunix_socket_directories = ''\nstatement_timeout = '20s'\n")
        database = 'blu_modules_test_' + secrets.token_hex(8)

        def query(sql, db=database):
            return run((client, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-w', '-h', '127.0.0.1',
                        '-p', port, '-U', 'postgres', '-d', db), sql, {'PGPASSWORD': password}).stdout.strip()

        def apply(names):
            for name in names:
                query((MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8'))

        try:
            # On Windows the detached server can keep pg_ctl's capture pipe open.
            with (work / 'pg_ctl.log').open('wb') as output:
                subprocess.run([str(x) for x in (*ctl, '-l', log, 'start')], env=env, stdin=subprocess.DEVNULL,
                               stdout=output, stderr=output, timeout=25, check=True)
            query('CREATE DATABASE ' + database, 'postgres')
            print(query('SELECT version()'), flush=True)
            fixture_source = (ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
            fixture = re.search(r'await db\.exec\(`([\s\S]*?)`\);', fixture_source)
            assert fixture, 'Shared synthetic base schema fixture missing'
            query(fixture[1])
            apply(BASELINE)
            # Existing deployment hardening expected by the receiver-bank migration.
            query("""ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;""")
            apply(CATALOG)
            before, after = (ROOT / 'scripts/r3-package-bonus-postgres-test.sql').read_text(encoding='utf-8').split('\n-- APPLY BONUS MIGRATION HERE\n')
            query(before)
            apply(('20261119_r3_package_bonus_points',))
            query(after)
            print('PASS: native purchase, PROMO, zero bonus, unchanged legacy snapshots, validation, and settlement replay')
        except subprocess.CalledProcessError as exc:
            if log.exists():
                # The scratch server log contains only synthetic data.
                print('\n'.join(log.read_text(encoding='utf-8', errors='replace').splitlines()[-24:]))
            raise SystemExit(exc.stderr or exc.stdout or str(exc)) from None
        finally:
            if (data / 'postmaster.pid').exists():
                run((*ctl, '-m', 'fast', 'stop'))


if __name__ == '__main__':
    main()
