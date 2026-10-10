"""Prepared multi-connection PostgreSQL acceptance tests, never production migration.
Default is prepare-only. Requires an empty isolated database named blu_payment_test_*
and a libpq service entry (no credentials in arguments/output). Leaves scratch fixtures;
recreate the disposable database afterwards. No EasySlip/SMS/network HTTP calls.
"""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import threading
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-disposable', action='store_true')
    parser.add_argument('--service')
    parser.add_argument('--confirm-disposable-empty', action='store_true')
    args = parser.parse_args()
    if not args.run_disposable:
        print('PREPARE ONLY: no database connection, schema change or provider request.')
        return
    if not args.service or not args.confirm_disposable_empty:
        parser.error('Running requires --service and --confirm-disposable-empty')
    env = dict(os.environ, PGSERVICE=args.service, PGAPPNAME='blu_payment_disposable_tests')
    # Never silently fall back to an inherited production connection override.
    for key in ('PGDATABASE', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD'):
        env.pop(key, None)

    def run(sql):
        return subprocess.run(['psql', '-X', '-qAt', '--set=ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True, env=env, timeout=60, check=False)

    def checked(sql):
        result = run(sql)
        if result.returncode:
            raise RuntimeError('PostgreSQL fixture assertion failed (no credentials or raw SQL errors printed)')
        return result.stdout.strip()

    def race(statements):
        barrier = threading.Barrier(len(statements))
        def worker(statement):
            barrier.wait(timeout=10)
            return run('BEGIN; SET LOCAL lock_timeout=\'10s\'; ' + statement + '; SELECT pg_sleep(0.2); COMMIT;')
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(statements)) as pool:
            return list(pool.map(worker, statements))

    guarded = checked("SELECT current_database() LIKE 'blu_payment_test_%' AND NOT EXISTS(SELECT 1 FROM members) AND NOT EXISTS(SELECT 1 FROM auth_sessions) AND NOT EXISTS(SELECT 1 FROM package_payment_orders) AND NOT EXISTS(SELECT 1 FROM package_payment_resolution_audit) AND NOT EXISTS(SELECT 1 FROM payment_transfer_refs);")
    if guarded != 't':
        raise RuntimeError('Refused: database is not a named empty disposable payment database')
    root = Path(__file__).resolve().parents[1]
    checked((root / 'src/db/migrations/payment-integration.test.sql').read_text(encoding='utf-8'))
    # Migration must already exist in this scratch DB; this runner NEVER applies it.
    ids = checked("INSERT INTO members(phone,full_name,member_code,status,points,expire_date) VALUES ('0991000001','PAYMENT_RACE_FIXTURE','BLU-RACE-1','ACTIVE',7,now()+interval '10 days'),('0991000002','PAYMENT_RACE_FIXTURE','BLU-RACE-2','ACTIVE',7,now()+interval '10 days') RETURNING id;").splitlines()
    if len(ids) != 2 or not all(i.isdigit() for i in ids):
        raise RuntimeError('Unexpected scratch fixture IDs')
    tokens = ['a' * 64, 'b' * 64]
    for member, token in zip(ids, tokens):
        checked(f"INSERT INTO auth_sessions(member_id,token_hash,expires_at) VALUES({member},'{token}',now()+interval '1 day');")
    receiver = json.dumps({'promptpay': '0973355322', 'bankCode': '004', 'bankAccount': '0528938965', 'name': 'OFFLINE RACE TEST'})
    quote = {'package': {'id': 2, 'name': 'RACE TEST', 'durationDays': 30}, 'subtotalSatang': 90000, 'discountSatang': 0, 'amountSatang': 90000, 'pointsEarned': 45, 'promo': {'code': 'RACE_ONE_QUOTA', 'usageLimit': 1, 'usedCount': 0, 'expiresAt': '2099-01-01T00:00:00Z'}}
    orders = [str(uuid.uuid4()), str(uuid.uuid4())]
    creates = [f"SELECT id FROM create_package_payment_order('{orders[i]}',{ids[i]},'{tokens[i]}','{uuid.uuid4()}','{json.dumps(quote)}'::jsonb,'{receiver}'::jsonb)" for i in range(2)]
    results = race(creates)
    successes = [i for i, result in enumerate(results) if result.returncode == 0]
    if len(successes) != 1:
        raise RuntimeError('Concurrent promo reservation did not allow exactly one order')
    winner = successes[0]
    leases = [str(uuid.uuid4()), str(uuid.uuid4())]
    claims = [f"SELECT lease_token FROM claim_package_payment_attempt('{orders[winner]}',{ids[winner]},'{tokens[winner]}','{lease}','{'1' * 64}',false)" for lease in leases]
    claim_results = race(claims)
    claim_values = [r.stdout.strip() for r in claim_results]
    if any(r.returncode for r in claim_results) or claim_values[0] != claim_values[1]:
        raise RuntimeError('Concurrent identical image claims did not share one lease')
    loser = 1 - winner
    quote['promo'] = None
    checked(f"SELECT id FROM create_package_payment_order('{orders[loser]}',{ids[loser]},'{tokens[loser]}','{uuid.uuid4()}','{json.dumps(quote)}'::jsonb,'{receiver}'::jsonb);")
    checked(f"SELECT id FROM claim_package_payment_attempt('{orders[loser]}',{ids[loser]},'{tokens[loser]}','{uuid.uuid4()}','{'2' * 64}',false);")
    checked("UPDATE package_payment_attempts SET state='VERIFIED',evidence=jsonb_build_object('transRef','RACE-SAME-TRANSFER','paidAt',clock_timestamp(),'amountSatang',90000,'bankCode','004','receiverEvidence','FULL_BANK_ACCOUNT','receiverIdentity',jsonb_build_object('bankAccount','0528938965','promptpay',NULL));")
    attempts = [checked(f"SELECT id FROM package_payment_attempts WHERE order_id='{order}';") for order in orders]
    settlements = [f"SELECT status FROM finalize_package_payment('{orders[i]}',{ids[i]},'{tokens[i]}','{attempts[i]}')" for i in range(2)]
    settled = race(settlements)
    if any(r.returncode for r in settled) or sorted(r.stdout.strip() for r in settled) != ['PAID', 'REJECTED']:
        raise RuntimeError('Concurrent global transRef settlement did not produce one PAID and one terminal REJECTED')
    paid = next(i for i, result in enumerate(settled) if result.stdout.strip() == 'PAID')
    if any(r.returncode for r in race([settlements[paid], settlements[paid]])):
        raise RuntimeError('Concurrent paid replay failed')
    summary = checked("SELECT (SELECT count(*) FROM package_payment_point_ledger)=1 AND (SELECT count(*) FROM payment_transfer_refs WHERE trans_ref='RACE-SAME-TRANSFER')=1 AND (SELECT sum(points) FROM members)=59 AND (SELECT count(*) FROM package_payment_resolution_audit WHERE reason_code='DUPLICATE_TRANS_REF')=1;")
    if summary != 't':
        raise RuntimeError('Duplicate benefits or missing terminal audit after concurrent settlement')
    print('Disposable SQL fixtures and real multi-connection promo/claim/transRef/replay assertions PASSED. Recreate the scratch DB; fixtures remain.')


if __name__ == '__main__':
    main()
