"""Native PostgreSQL lock/snapshot UAT; no env files, URLs, providers or system services.
Default probes only. --run starts/stops a fresh loopback-only portable cluster.
Requires the package documented in scripts/real-modules-local-postgres.md under
.local-db/portable-postgres-uat/package/native. Uses libpq, not stock psql.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import ctypes as C
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / '.local-db/portable-postgres-uat'
TABLES = [f'fixture_{i:02}' for i in range(32)]
LOCK = 'LOCK TABLE ' + ','.join('public.' + t for t in TABLES) + ' IN SHARE ROW EXCLUSIVE MODE'
ADVISORY = "SELECT pg_advisory_xact_lock(hashtextextended('blue-fitness:catalog-order-guard',0))"
BEGIN = "BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s';"


class SqlError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__('SQLSTATE=' + code)


class Connection:
    def __init__(self, lib, port, app):
        self.lib = lib
        self.ptr = lib.PQconnectdb(f'host=127.0.0.1 port={port} dbname=postgres user=postgres connect_timeout=5 sslmode=disable application_name={app}'.encode())
        if not self.ptr or lib.PQstatus(self.ptr) != 0:
            self.close()
            raise RuntimeError('Local connection failed')
        self.pid = int(self.query('SELECT pg_backend_pid()')[0][0])

    def query(self, sql):
        result = self.lib.PQexec(self.ptr, sql.encode())
        if not result:
            raise RuntimeError('No PostgreSQL result')
        try:
            if self.lib.PQresultStatus(result) not in (1, 2):
                code = self.lib.PQresultErrorField(result, ord('C'))
                raise SqlError(code.decode() if code else 'unknown')
            return [[self.lib.PQgetvalue(result, r, c).decode() for c in range(self.lib.PQnfields(result))]
                    for r in range(self.lib.PQntuples(result))]
        finally:
            self.lib.PQclear(result)

    def close(self):
        if getattr(self, 'ptr', None):
            self.lib.PQfinish(self.ptr)
            self.ptr = None


def load_lib(native):
    # Retain the handle for dependent DLL discovery throughout the run.
    dll_dir = os.add_dll_directory(str(native / 'bin')) if os.name == 'nt' else None
    lib = C.CDLL(str(native / 'bin/libpq.dll'))
    signatures = {
        'PQconnectdb': (C.c_void_p, [C.c_char_p]),
        'PQstatus': (C.c_int, [C.c_void_p]),
        'PQexec': (C.c_void_p, [C.c_void_p, C.c_char_p]),
        'PQresultStatus': (C.c_int, [C.c_void_p]),
        'PQresultErrorField': (C.c_char_p, [C.c_void_p, C.c_int]),
        'PQntuples': (C.c_int, [C.c_void_p]),
        'PQnfields': (C.c_int, [C.c_void_p]),
        'PQgetvalue': (C.c_char_p, [C.c_void_p, C.c_int, C.c_int]),
        'PQclear': (None, [C.c_void_p]),
        'PQfinish': (None, [C.c_void_p]),
    }
    for name, (restype, args) in signatures.items():
        getattr(lib, name).restype = restype
        getattr(lib, name).argtypes = args
    return lib, dll_dir


def port_closed(port):
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(('127.0.0.1', port)) != 0


def wait_blocked(observer, blocked, blocker):
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        rows = observer.query(f"SELECT wait_event_type, {blocker}=ANY(pg_blocking_pids(pid)) FROM pg_stat_activity WHERE pid={blocked}")
        if rows == [['Lock', 't']]:
            return {'blocked_pid': blocked, 'blocker_pid': blocker, 'wait_event_type': 'Lock'}
        time.sleep(0.025)
    raise AssertionError('Did not observe expected backend lock dependency')


def guard(backup):
    statements = []
    for table, rows in backup.items():
        literal = rows.replace("'", "''")
        statements.append(f"DO $guard$ BEGIN IF (SELECT coalesce(jsonb_agg(r ORDER BY r::text),'[]'::jsonb) FROM (SELECT jsonb_build_object('id',t.id,'note',t.note) AS r FROM public.{table} t) original_rows) IS DISTINCT FROM (SELECT coalesce(jsonb_agg(r ORDER BY r::text),'[]'::jsonb) FROM jsonb_array_elements('{literal}'::jsonb) r) THEN RAISE EXCEPTION 'Data drift or mutation'; END IF; END $guard$")
    return statements


def run_tests(lib, port, evidence):
    connections = []
    def connect(name):
        c = Connection(lib, port, name)
        connections.append(c)
        return c
    try:
        observer, writer, deploy, new_writer = [connect(n) for n in ['observer', 'old_writer', 'deployment', 'new_writer']]
        assert len({c.pid for c in connections}) == 4
        assert observer.query("SELECT inet_server_addr()::text, current_database(), (SELECT count(*) FROM pg_tables WHERE schemaname='public')") == [['127.0.0.1/32', 'postgres', '0']]
        evidence['server_version'] = observer.query('SELECT version()')[0][0]
        evidence['backend_pids'] = [c.pid for c in connections]
        for table in TABLES:
            observer.query(f"CREATE TABLE public.{table}(id integer PRIMARY KEY,note text NOT NULL)")
        def snapshot():
            return {t: observer.query(f"SELECT coalesce(jsonb_agg(r ORDER BY r::text),'[]'::jsonb)::text FROM (SELECT jsonb_build_object('id',t.id,'note',t.note) AS r FROM public.{t} t) original_rows")[0][0] for t in TABLES}
        old_backup = snapshot()
        writer.query('BEGIN')
        writer.query("INSERT INTO fixture_00 VALUES(1,'committed while deployment waits')")
        deploy.query(BEGIN)
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(deploy.query, LOCK)
            evidence['old_writer_blocks_deploy'] = wait_blocked(observer, deploy.pid, writer.pid)
            assert not pending.done()
            writer.query('COMMIT')
            pending.result(timeout=7)
        # No SELECT is submitted on deployment before acquiring every table lock.
        deploy.query(ADVISORY)
        assert deploy.query('SHOW transaction_isolation') == [['read committed']]
        assert deploy.query('SELECT count(*) FROM fixture_00') == [['1']]
        deploy.query('CREATE TABLE deployment_marker(id integer)')
        try:
            for statement in guard(old_backup):
                deploy.query(statement)
        except SqlError as error:
            assert error.code == 'P0001'
            evidence['stale_backup_guard_sqlstate'] = error.code
        else:
            raise AssertionError('Stale backup unexpectedly passed')
        try:
            deploy.query('SELECT 1')
        except SqlError as error:
            assert error.code == '25P02'
            evidence['transaction_aborted_sqlstate'] = error.code
        else:
            raise AssertionError('Guard did not abort transaction')
        deploy.query('ROLLBACK')
        assert observer.query("SELECT to_regclass('public.deployment_marker') IS NULL") == [['t']]
        assert observer.query('SELECT count(*) FROM fixture_00') == [['1']]
        evidence['stale_backup_abort_and_ddl_rollback'] = True
        print('PASS writer commits while deployment waits; fresh post-lock snapshot rejects old backup; DDL rolls back', flush=True)

        current_backup = snapshot()
        deploy.query(BEGIN)
        deploy.query(LOCK)
        deploy.query(ADVISORY)
        assert deploy.query(f"SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND mode='ShareRowExclusiveLock' AND granted AND relation IN (SELECT oid FROM pg_class WHERE relname IN ({','.join(repr(t) for t in TABLES)}))") == [['32']]
        for statement in guard(current_backup):
            deploy.query(statement)
        deploy.query('CREATE TABLE deployment_marker(id integer)')
        for statement in guard(current_backup):
            deploy.query(statement)
        new_writer.query("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'")
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(new_writer.query, "INSERT INTO fixture_31 VALUES(2,'blocked until release')")
            evidence['deployment_blocks_new_writer'] = wait_blocked(observer, new_writer.pid, deploy.pid)
            assert not pending.done()
            deploy.query('COMMIT')
            pending.result(timeout=7)
        new_writer.query('COMMIT')
        assert observer.query("SELECT to_regclass('public.deployment_marker') IS NOT NULL, (SELECT count(*) FROM fixture_31)") == [['t', '1']]
        evidence['unchanged_pre_post_guards_passed'] = 64
        evidence['locked_tables'] = 32
        evidence['new_writer_committed_after_release'] = True
        print('PASS unchanged backup passes all 64 pre/post guards; 32 locks block new writer until COMMIT', flush=True)
    finally:
        for c in connections:
            c.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true')
    args = parser.parse_args()
    native = TOOL / 'package/native'
    if not args.run:
        print(json.dumps({'mode': 'probe-only', 'native_available': (native / 'bin/pg_ctl.exe').exists(), 'database_connections': 0}))
        return
    subprocess.run(['git', 'check-ignore', '--quiet', '.local-db/probe'], cwd=ROOT, check=True, timeout=10)
    assert (native / 'bin/initdb.exe').is_file(), 'Portable PostgreSQL tooling missing'
    directory = TOOL / ('catalog_lock_' + uuid.uuid4().hex[:10])
    directory.mkdir()
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith('PG') and k.upper() != 'DATABASE_URL'}
    env['LC_ALL'] = 'C'
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    evidence = {'port': port, 'endpoint': '127.0.0.1', 'transport': 'native libpq (not stock psql)',
                'transaction_order': [BEGIN, LOCK, ADVISORY, 'pre guards', 'scratch DDL', 'post guards', 'COMMIT'],
                'live_connections': False, 'status': 'FAIL'}
    data = directory / 'data'
    def command(exe, *values):
        with (directory / (exe + '.' + str(time.time_ns()) + '.log')).open('w', encoding='utf-8') as log:
            result = subprocess.run([str(native / 'bin' / exe), *map(str, values)], env=env, cwd=directory,
                                    stdin=subprocess.DEVNULL, stdout=log, stderr=log, timeout=40,
                                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)
        assert result.returncode == 0, exe + ' failed; see ignored logs'
        return result.returncode
    started = False
    try:
        command('initdb.exe', '-D', data, '-U', 'postgres', '--auth-local=reject', '--auth-host=trust', '--no-locale', '--encoding=UTF8')
        with (data / 'postgresql.conf').open('a', encoding='utf-8') as config:
            config.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nmax_connections=12\n")
        # File-backed pg_ctl logging avoids inherited-pipe startup hangs on Windows.
        started = True  # Cleanup also covers partial startup failures.
        command('pg_ctl.exe', '-D', data, '-l', directory / 'server.log', '-w', '-t', '20', 'start')
        lib, dll_dir = load_lib(native)
        run_tests(lib, port, evidence)
        evidence['status'] = 'PASS'
    finally:
        try:
            if started:
                evidence['stop_exit_code'] = command('pg_ctl.exe', '-D', data, '-m', 'immediate', '-w', '-t', '20', 'stop')
        finally:
            evidence['port_closed_after'] = port_closed(port)
            if not evidence['port_closed_after']:
                evidence['status'] = 'FAIL'
            (directory / 'result.json').write_text(json.dumps(evidence, indent=2), encoding='utf-8')
            print(json.dumps({'evidence': str(directory.relative_to(ROOT)), **evidence}), flush=True)
        assert evidence['port_closed_after'], 'Server port remains open'


if __name__ == '__main__':
    main()
