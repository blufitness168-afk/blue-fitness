"""Read-only R4 display on a fresh native SCRAM loopback cluster (synthetic only)."""
import argparse
from importlib import import_module
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import tempfile

base = import_module('r4-staff-free-postgres-test')
DISPLAY = '20261120_R4_staff_free_display'
SIGNATURE = 'r4_staff_private.display_terms(text,text)'


def exercise(query):
    def apply(*names):
        for name in names:
            query((base.MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8'))

    def deny(sql, code='42501'):
        result = query(sql, check=False)
        assert result.returncode and code in result.stderr, result.stderr

    def read(token='token-3', target='NULL', prefix=''):
        return json.loads(query(prefix + f"SELECT r4_staff_private.display_terms('{token}',{target});").stdout)

    source = (base.ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    seed = (base.ROOT / 'scripts/r4-staff-free-postgres-test.sql').read_text(encoding='utf-8')
    query(re.search(r'await db\.exec\(`([\s\S]*?)`\);', source)[1])
    query('ALTER TABLE members ADD COLUMN avatar_changed boolean DEFAULT false;')
    apply(*base.BASE)
    query('ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;')
    apply(*base.CATALOG, '20261118_R2_member_cards', '20261118_R2_staff_avatar', *base.R3)
    query(seed.split('SELECT test_settle(3)', 1)[0] + 'SELECT test_settle(3), test_settle(4);')
    apply('20261119_R4_staff_free_foundation')
    deny((base.MIGRATIONS / (DISPLAY + '.sql')).read_text(encoding='utf-8'), 'P0001')
    apply('20261119_R4_staff_free_admission')
    deny("SELECT r4_staff_private.display_terms('token-3',NULL);", '42883')
    apply(DISPLAY)
    assert read() == []
    apply('20261119_R4_staff_free_finance', '20261119_R4_staff_free_writer',
          '20261120_R4_staff_free_z_cancellation', '20261121_R4_staff_free_purchase_guard')
    for member in (3, 4):
        query(f"SELECT r4_staff_private.record_free_sale('token-1',gen_random_uuid(),'BLU-{member}',"
              f"r4_staff_private.preview_free_sale('token-1','BLU-{member}'),'SYNTHETIC PRIVATE REASON');")

    query('CREATE ROLE display_backend NOLOGIN; CREATE ROLE display_untrusted NOLOGIN;')
    assert query(f"SELECT has_function_privilege('display_untrusted','{SIGNATURE}','EXECUTE'), "
                 "has_schema_privilege('display_untrusted','r4_staff_private','USAGE');").stdout.strip() == 'f|f'
    deny("SET ROLE display_untrusted; SELECT r4_staff_private.display_terms('token-3',NULL);")
    query(f'''GRANT USAGE ON SCHEMA r4_staff_private TO display_backend;
      GRANT EXECUTE ON FUNCTION {SIGNATURE}, r4_staff_private.admission_term(integer,timestamptz,uuid),
        public.r3_override_current_order(integer,timestamptz), public.package_catalog_daily_slot_valid(text) TO display_backend;
      GRANT SELECT ON r4_staff_private.free_sales, r4_staff_private.free_sale_cancellations,
        members, auth_sessions, package_payment_orders, package_payment_point_ledger, payment_transfer_refs TO display_backend;''')
    prefix = 'BEGIN READ ONLY; SET LOCAL ROLE display_backend; '
    projection = read(prefix=prefix)
    assert len(projection) == 1 and projection[0]['status'] == 'SCHEDULED', projection
    assert set(projection[0]) == {'status', 'packageName', 'startsAt', 'endsAt', 'dailySlot'}
    assert read('token-1', "'BLU-3'", prefix) == read('token-2', "'BLU-3'", prefix) == projection
    assert read('token-4', prefix=prefix) != projection
    assert read('token-5', prefix=prefix) == read('token-1', "'BLU-2'", prefix) == []
    for token in ('missing', 'expired', 'revoked', 'kiosk', 'token-1'):
        deny(prefix + f"SELECT r4_staff_private.display_terms('{token}',NULL);")
    for token, target in [('token-3', 'BLU-4'), ('token-3', 'BLU-3'), ('kiosk', 'BLU-3')]:
        deny(prefix + f"SELECT r4_staff_private.display_terms('{token}','{target}');")
    query("UPDATE members SET status='SUSPENDED' WHERE id=4;")
    deny(prefix + "SELECT r4_staff_private.display_terms('token-4',NULL);")
    query("UPDATE members SET status='ACTIVE' WHERE id=4;")
    print('PASS: migration guard, no default grants, NORMAL session and target isolation, narrow scheduled projection', flush=True)

    # Pin only the display clock for interval boundaries; proof is unchanged.
    query(f'''DO $$ BEGIN EXECUTE replace(pg_get_functiondef('{SIGNATURE}'::regprocedure),
      'statement_timestamp()', 'current_setting(''test.r4_display_at'')::timestamptz'); END $$;
      UPDATE auth_sessions SET expires_at=expires_at+interval '10 years' WHERE token_hash LIKE 'token-%';''')
    def at(when, mid=3):
        clock = query(f'SELECT ({when})::text FROM r4_staff_private.free_sales WHERE member_id={mid};').stdout.strip()
        return read(f'token-{mid}', prefix=prefix + f"SET LOCAL test.r4_display_at = '{clock}'; ")

    snapshot = '''SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM members m),
      (SELECT jsonb_agg(to_jsonb(f) ORDER BY sale_id) FROM r4_staff_private.free_sales f),
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM package_payment_orders o),
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM checkins c));'''
    before = query(snapshot).stdout
    assert at("starts_at - interval '1 microsecond'") == projection
    assert at('starts_at')[0]['status'] == 'ACTIVE'
    assert at("(((starts_at AT TIME ZONE 'Asia/Bangkok')::date+1+time '02:00') AT TIME ZONE 'Asia/Bangkok')")[0]['status'] == 'ACTIVE'
    assert at('ends_at') == []
    assert query(snapshot).stdout == before
    query("BEGIN; UPDATE members SET expire_date=expire_date+interval '1 day' WHERE id=3; COMMIT;")
    assert at('starts_at')[0]['status'] == 'BLOCKED'
    query('UPDATE members m SET expire_date=s.starts_at FROM r4_staff_private.free_sales s WHERE s.member_id=m.id AND m.id=3;')
    # Inject anomalous legacy orders to test the reader's fallback, not the purchase path.
    query('BEGIN; ALTER TABLE package_payment_orders DISABLE TRIGGER a_r4_staff_free_online_purchase_guard; '
          'SELECT test_buy(3,1); SELECT test_settle(4); '
          'ALTER TABLE package_payment_orders ENABLE TRIGGER a_r4_staff_free_online_purchase_guard; COMMIT;')
    assert at('starts_at')[0]['status'] == 'BLOCKED'
    assert at('starts_at', 4)[0]['status'] == 'SUPERSEDED'
    print('PASS: real admission proof in read-only transactions, boundaries, off-slot neutrality, drift/PENDING, later online supersession and unchanged records', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bin-dir', required=True, type=Path)
    parser.add_argument('--psql', type=Path)
    args = parser.parse_args()
    suffix = '.exe' if os.name == 'nt' else ''
    bin_dir = args.bin_dir.resolve()
    client = args.psql.resolve() if args.psql else bin_dir / ('psql' + suffix)
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith('PG') and k.upper() != 'DATABASE_URL'}
    env.update(PGCLIENTENCODING='UTF8', PGCONNECT_TIMEOUT='5', PGSSLMODE='disable', PYTHONIOENCODING='utf-8')

    def run(cmd, sql=None, check=True, **kwargs):
        result = subprocess.run([str(x) for x in cmd], input=None if sql is None else sql.encode('utf-8'),
                                capture_output=True, timeout=45, **kwargs)
        result.stdout = result.stdout.decode('utf-8')
        result.stderr = result.stderr.decode('utf-8', errors='replace')
        if check:
            result.check_returncode()
        return result

    with tempfile.TemporaryDirectory(prefix='blu-r4-display-') as tmp:
        work = Path(tmp)
        data, log, pw = work / 'data', work / 'server.log', work / 'password'
        password = secrets.token_hex(32)
        pw.write_text(password + '\n', encoding='ascii')
        ctl = [bin_dir / ('pg_ctl' + suffix), '-D', data, '-w', '-t', '15']
        run([bin_dir / ('initdb' + suffix), '-D', data, '-U', 'postgres', '--auth-local=reject',
             '--auth-host=scram-sha-256', '--encoding=UTF8', '--locale=C', '--pwfile', pw], env=env)
        pw.unlink()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        with (data / 'postgresql.conf').open('a', encoding='ascii') as conf:
            conf.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nunix_socket_directories=''\nstatement_timeout='20s'\n")

        def query(sql, check=True, database='postgres'):
            return run([client, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-w',
                        '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', database], sql, check,
                       env={**env, 'PGPASSWORD': password})

        try:
            with (work / 'ctl.log').open('wb') as output:
                subprocess.run([str(x) for x in [*ctl, '-l', log, 'start']], env=env, stdin=subprocess.DEVNULL,
                               stdout=output, stderr=output, timeout=25, check=True)
            print(query('SELECT version()').stdout.strip(), flush=True)
            exercise(query)
        except subprocess.CalledProcessError as exc:
            if log.exists():
                print('\n'.join(log.read_text(encoding='utf-8', errors='replace').splitlines()[-18:]))
            raise SystemExit(exc.stderr or exc.stdout or str(exc)) from None
        finally:
            if (data / 'postmaster.pid').exists():
                run([*ctl, '-m', 'fast', 'stop'], env=env)


if __name__ == '__main__':
    main()
