"""R2 regression on a fresh loopback-only portable PostgreSQL cluster; no external DSN."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import socket
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / '.local-db/portable-postgres-uat'
DRIVER = runpy.run_path(str(ROOT / 'scripts/catalog-deploy-lock-uat.py'))
SqlError = DRIVER['SqlError']
SERIAL = 'BEGIN ISOLATION LEVEL SERIALIZABLE'
RESET_HASH = 'scrypt$32768$8$1$' + 'a' * 32 + '$' + 'b' * 128
COMPLETE_HASH = RESET_HASH.replace('b', 'c')


def literal(value):
    if value is None:
        return 'NULL'
    return "'" + str(value).replace("'", "''") + "'"


def statements():
    source = (ROOT / 'src/lib/auth/server.ts').read_text(encoding='utf-8')
    login = source.split('export async function loginPassword(', 1)[1].split('export async function completePassword(', 1)[0]
    completion = source.split('export async function completePassword(', 1)[1].split('export async function completeRegistration(', 1)[0]
    assert login.count('isolationLevel: "Serializable"') == completion.count('isolationLevel: "Serializable"') == 1
    login_sql = re.findall(r'sql`([^`]*)`', login)
    completion_sql = re.findall(r'sql`([^`]*)`', completion)
    _, _, login_lock, login_issue = login_sql
    ticket_claim, completion_lock, completion_finish = completion_sql
    return login_lock, login_issue, ticket_claim, completion_lock, completion_finish


def run(lib, port, data):
    login_lock, login_issue, ticket_claim, completion_lock, completion_finish = statements()
    fixture_source = (ROOT / 'src/lib/admin-member-password.test.mjs').read_text(encoding='utf-8')
    fixture = fixture_source.split('await db.exec(`', 1)[1].split('`);', 1)[0]
    migration = ROOT / 'src/db/migrations/20261118_R2_admin_member_password.sql'
    waits = []
    with ExitStack() as stack:
        def connect(name):
            c = DRIVER['Connection'](lib, port, name)
            stack.callback(c.close)
            path, address = c.query("SELECT current_setting('data_directory'), host(inet_server_addr())")[0]
            assert Path(path).resolve() == data.resolve() and address == '127.0.0.1'
            c.query("SET lock_timeout='8s'; SET statement_timeout='12s'")
            return c

        observer, reset, auth = map(connect, ['r2_observer', 'r2_reset', 'r2_auth'])
        assert len({observer.pid, reset.pid, auth.pid}) == 3
        assert observer.query("SELECT count(*) FROM pg_tables WHERE schemaname='public'") == [['0']]
        print('Native PostgreSQL', observer.query('SHOW server_version')[0][0], flush=True)
        observer.query(fixture)
        observer.query(migration.read_text(encoding='utf-8'))

        def during_wait(name, waiter, holder, statement, release, expected_error=None, in_transaction=False):
            # The waiter owns its connection until PQexec finishes; observe from a third backend.
            with ThreadPoolExecutor(max_workers=1) as pool:
                query = pool.submit(waiter.query, statement)
                waits.append(DRIVER['wait_blocked'](observer, waiter.pid, holder.pid))
                assert not query.done(), name
                release()
                try:
                    result = query.result(timeout=13)
                except SqlError as error:
                    assert expected_error == error.code, (name, error.code)
                    if in_transaction:
                        waiter.query('ROLLBACK')
                    return error.code
                assert expected_error is None, name
                return result

        def action(member, key, digest=None):
            payload = json.dumps(dict(memberCode=f'PW-{member}', reason='Synthetic correction', bodyMac='a' * 64))
            args = ','.join(map(literal, ('s2', key, payload, digest)))
            return f'SELECT admin_member_password_action({args})'

        def claim(member):
            key = uuid.uuid4()
            assert reset.query(action(member, key)) == [['claimed']]
            return action(member, key, RESET_HASH)

        def render(template, member, **extra):
            params = {'member.id as number': member, 'hashToken(token)': f'login-{member}',
                      'expiresAt': '2099-01-01T00:00:00Z', 'member.password_hash as string': 'OLD_CREDENTIAL',
                      'purpose': 'PASSWORD_RESET', 'digest': COMPLETE_HASH, **extra}
            return re.sub(r'\$\{([^}]+)\}', lambda match: literal(params[match[1]]), template)

        def credential(member):
            return observer.query(f'SELECT password_hash FROM members WHERE id={int(member)}')[0][0]

        def sessions(member):
            return observer.query(f'SELECT token_hash, mode, revoked_at IS NOT NULL FROM auth_sessions '
                                  f'WHERE member_id={int(member)} ORDER BY token_hash')

        def ticket(member):
            digest = hashlib.sha256(f'synthetic-ticket-{member}'.encode()).hexdigest()
            observer.query('INSERT INTO auth_password_tickets(phone,purpose,password_hash_at_issue,token_hash) '
                           f"VALUES ('synthetic-{member}','PASSWORD_RESET','OLD_CREDENTIAL','{digest}')")
            bindings = {'hashToken(ticket)': digest}
            statement = render(ticket_claim, member, **bindings)
            claimed = auth.query(statement)
            assert len(claimed) == 1
            bindings['claimed[0].id as number'] = int(claimed[0][0])
            return statement, render(completion_lock, member, **bindings), render(completion_finish, member, **bindings)

        finalize = claim(3)
        auth.query(SERIAL)
        assert auth.query(render(login_lock, 3)) == [['3']]
        def issue_and_commit():
            assert len(auth.query(render(login_issue, 3))) == 1
            auth.query('COMMIT')
        assert during_wait('login first', reset, auth, finalize, issue_and_commit) == [['done']]
        assert credential(3) == RESET_HASH
        assert sessions(3) == [['login-3', 'NORMAL', 't'], ['s3', 'NORMAL', 't'], ['target-kiosk', 'KIOSK', 't']]
        print('PASS login first: explicit member lock blocks reset before session INSERT; reset revokes new NORMAL and old NORMAL/KIOSK', flush=True)

        finalize = claim(5)
        reset.query('BEGIN')
        assert reset.query(finalize) == [['done']]
        auth.query(SERIAL)
        assert during_wait('reset before login', auth, reset, render(login_lock, 5),
                           lambda: reset.query('COMMIT'), '40001', in_transaction=True) == '40001'
        auth.query(SERIAL)
        assert auth.query(render(login_lock, 5)) == [['5']]
        assert auth.query(render(login_issue, 5)) == []  # previously verified old hash, fresh snapshot
        auth.query('COMMIT')
        assert credential(5) == RESET_HASH and sessions(5) == [['s5', 'NORMAL', 't']]
        print('PASS reset before login: waiting issuance fails with 40001; fresh issuance with old hash inserts zero sessions', flush=True)

        replay, lock, finish = ticket(6)
        finalize = claim(6)
        reset.query('BEGIN')
        assert reset.query(finalize) == [['done']]
        auth.query(SERIAL)
        assert during_wait('reset before completion', auth, reset, lock,
                           lambda: reset.query('COMMIT'), '40001', in_transaction=True) == '40001'
        auth.query(SERIAL)
        assert auth.query(lock) == [['6']]
        assert auth.query(finish) == []  # no overwrite even with a fresh snapshot
        auth.query('COMMIT')
        assert auth.query(replay) == []
        assert observer.query("SELECT consumed_at IS NOT NULL FROM auth_password_tickets WHERE phone='synthetic-6'") == [['t']]
        assert credential(6) == RESET_HASH and sessions(6) == [['s6', 'NORMAL', 't']]
        print('PASS reset before completion: preclaimed ticket waits then fails with 40001; fresh finalization and replay affect zero rows', flush=True)

        replay, lock, finish = ticket(7)
        finalize = claim(7)
        auth.query(SERIAL)
        assert auth.query(lock) == [['7']]
        def complete_and_commit():
            assert auth.query(finish) == [['7']]
            auth.query('COMMIT')
        assert during_wait('completion first', reset, auth, finalize, complete_and_commit, 'P0001') == 'P0001'
        assert credential(7) == COMPLETE_HASH and sessions(7) == [['s7', 'NORMAL', 't']]
        assert auth.query(replay) == []
        assert observer.query('SELECT member_id FROM admin_member_password_audit ORDER BY member_id') == [['3'], ['5'], ['6']]
        assert sessions(2) == [['s2', 'NORMAL', 'f']]
        print('PASS completion first: explicit member lock blocks staff finalize before ticket consumption; P0001 leaves completed credential intact', flush=True)
    assert len(waits) == 4
    print('4 passed, 0 failed, 0 skipped; 4 observed PostgreSQL lock waits', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true', required=True)
    parser.parse_args()
    # Scrub inherited libpq settings in this process, not just its child processes.
    for key in tuple(os.environ):
        if key.upper().startswith('PG') or key.upper() == 'DATABASE_URL':
            del os.environ[key]
    native = TOOL / 'package/native'
    assert (native / 'bin/initdb.exe').is_file(), 'Existing portable PostgreSQL tooling required'
    with tempfile.TemporaryDirectory(prefix='r2_password_', dir=TOOL) as tmp:
        directory = Path(tmp)
        data = directory / 'data'
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        def command(exe, *args):
            subprocess.run([str(native / 'bin' / exe), *map(str, args)], cwd=directory,
                           stdin=subprocess.DEVNULL, check=True, timeout=40,
                           creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
        command('initdb.exe', '-D', data, '-U', 'postgres', '--auth-local=reject', '--auth-host=trust', '--no-locale', '--encoding=UTF8')
        with (data / 'postgresql.conf').open('a', encoding='utf-8') as config:
            config.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nmax_connections=8\n")
        lib, dll_dir = DRIVER['load_lib'](native)
        try:
            command('pg_ctl.exe', '-D', data, '-l', directory / 'server.log', '-w', '-t', '20', 'start')
            run(lib, port, data)
        finally:
            if (data / 'postmaster.pid').exists():
                command('pg_ctl.exe', '-D', data, '-m', 'fast', '-w', '-t', '20', 'stop')
            assert DRIVER['port_closed'](port), 'Disposable PostgreSQL port remains open'
            if dll_dir is not None:
                dll_dir.close()
        print('Disposable cluster stopped; loopback port closed', flush=True)


if __name__ == '__main__':
    main()
