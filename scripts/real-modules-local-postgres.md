# Actual native PostgreSQL concurrency UAT

## Latest result: PASS

Run started UTC **2026-10-24T12:16:07.178619Z**.
Native **PostgreSQL 18.4 / Windows x64**, fresh initdb cluster and empty isolated DB.
**UAT exit 0; stop exit 0; port closed after shutdown: true.**

Actual PASS output:

```text
PASS actual eight migrations compile against isolated minimal base contract
PASS rewards last-stock, same-key debit replay, cross-staff delivery races
PASS benefits cross-staff duplicate grant and single bonus extension races
PASS finance duplicate create, cross-owner stale update and delete races
PASS frontdesk same-key replay consumes welcome and creates checkin once
PASS payment identical claim, global transfer uniqueness, paid replay and package coupon issuance races
PASS persisted promo last-capacity reservation race (one order, one quota rejection)
PASS reward catalog save-vs-redemption races (4 overlaps; no stock resurrection or duplicate debit)
```

Frontdesk admission ran within actual Bangkok opening hours; it was **not skipped**.
Every race verifies distinct `pg_backend_pid()` values, uses a thread barrier and holds
transactions with `pg_sleep(0.2)`. These are actual independent native PostgreSQL backends,
not WASM/PGlite or mocked concurrency. Scheduler ordering is not forced; the four
save/redeem overlaps do not prove that both possible serialization orders were observed.

## Test-only corrections and extensions

Changed `scripts/real-modules-concurrency-uat.py`, not production code or migrations:

- Evidence fixture now matches `20261010_payment_promptpay.sql` and the positive proof
  in `src/db/migrations/payment-integration.test.sql`: REGISTERED_ACCOUNT_V2,
  EASYSLIP_V2_REGISTERED_ACCOUNT, per-attempt orderId, bank identity, expected/name/normalizedName.
  The integration SQL was inspected for its contract, not separately executed in this run.
- Minimal base now defines the same `member_status` enum as `src/db/schema.ts`; finalization
  actually casts to that type. Previously the invalid evidence prevented reaching this path.
- Existing authentication, empty/local DB guard, SQLSTATE loser checks, backend independence,
  transfer uniqueness, paid replay, ledger/coupon and all other original assertions retained.
- Persisted promo: create real benefit definition with usage limit 1, grant it to two actors,
  race authoritative order creation. One succeeds, one raises P0001; exactly one pending
  promo order and one benefit_promo_reservations row persist. Deliberately supplied quote
  usageLimit 999 is rebuilt to 1, discount to 1000, amount to 89000 and points to 44.
- Catalog save vs redemption: four new one-stock rewards, alternate SQL submission order,
  compare full expected editable snapshot through the actual save function. Accept either
  save-then-redeem (both succeed) or redeem-then-stale-save (save rejected P0001).
  Every iteration requires stock 0, exactly one redemption/ledger debit and one-point deduction.
- Race failures now include only sanitized error/status information and success count.

The earlier payment blocker was a stale fixture, not proof of a production uniqueness bug.
An intermediate extended run also correctly refused a promo without persisted definition/
assignment; the final test now creates/grants through the actual benefits action contract.
No validation function, trigger or security assertion was bypassed or relaxed.

## Exact invocation and evidence

Runner:

```text
python -u .local-db/portable-postgres-uat/run.py
```

Underlying final UAT command:

```text
python scripts/real-modules-concurrency-uat.py --run-disposable --host 127.0.0.1 --port 55959 --database blu_modules_test_5fc28650c297 --user postgres --confirm-disposable-empty
```

Evidence directory (ignored): `.local-db/portable-postgres-uat/run_562de015f4/`

- `result.json`: exact endpoint/command, exit_code 0, stop_exit_code 0, port_closed_after true.
- `uat.stdout.txt`: all eight PASS lines above.
- `uat.stderr.txt`: empty.
- `server.log`: native backend activity and database system shut down.
- `data/`: disposable fixtures retained on disk; server stopped.

A socket bind selected/verified an unused ephemeral port before startup; PostgreSQL then
successfully bound **127.0.0.1 only**. The original server-side empty/local identity guard
passed before schema DDL. Fresh cluster/database were used for each retry.
Local host trust authentication applies only to this disposable cluster; socket auth rejected.
Statement timeout 15s, lock timeout 5s, per-client process timeout 25s, UAT timeout 180s,
server start/stop deadlines are bounded. Server startup uses file-backed handles to avoid
Windows inherited-pipe hangs. Cleanup runs in finally.

## Adapter caveat / download

Registry package: `@embedded-postgres/windows-x64@18.4.0-beta.17`.
Native server reports 18.4; package version has a beta label.
Archive: 40.6 MB, unpacked 109.3 MB; npm SHA-1
`a2b4f70e310805d0c18df8101e94c55337406726`.
Downloaded via `npm pack --ignore-scripts --registry=https://registry.npmjs.org` inside
`.local-db/portable-postgres-uat`, without root dependency or lockfile changes.

Package has postgres/initdb/pg_ctl/libpq but **no stock psql.exe**.
Local `psql.exe` is a Python distlib launcher for `psql.py`, a limited libpq CLI adapter
using PQsendQuery/PQgetResult and SQLSTATE errors. It opens separate native connections
and emits the tuple-output subset required by this harness, not general psql compatibility.
**This is native database concurrency validation through the adapter, not stock-psql validation.**

No `.env` files, Neon/provider/SMS endpoints, real funds, paid cloud, Docker or system
services were used. Inherited PG*/DATABASE_URL keys are stripped from child environments.
Only new ignored local tooling/data, the authorized Python UAT and this report were changed.

## Remaining gaps (not claimed PASS)

- Minimal contract schema, not full production-schema/deployment acceptance.
- Stock psql execution and separately running the integration SQL security-negative suite.
- Different-lease UUID claims; revoke/suspend during in-flight operations.
- Opposite-direction actor/member deadlocks; bonus consumption vs payment renewal.
- Grant/cancel/consume contention and last FRIEND_PASS quota contention.
- Cross-station frontdesk double scans and frontdesk-vs-kiosk contention.
- Full concurrent failure-injection rollback, stress/load testing and deterministic proof
  of each legal ordering in save-vs-redemption.

The old `real-modules-concurrency-uat.md` predates these executions; this report records
current actual results, including the two newly covered race families.
