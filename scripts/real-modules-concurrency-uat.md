# Real modules concurrency UAT — 2026-10-24

## Latest follow-up — actual native PostgreSQL PASS

The infrastructure blocker below was subsequently resolved using ignored portable native PostgreSQL 18.4 plus a limited libpq CLI adapter (not stock psql). All eight race groups passed on distinct real backend connections, exit0, including persisted promo last-capacity and reward catalog-save vs redemption (4 overlaps). Server was stopped and port closure verified. See `scripts/real-modules-local-postgres.md` and `.local-db/portable-postgres-uat/run_562de015f4/`. This supersedes the NOT RUN verdict for those specific cases only; minimal-schema/load/pooling/contention cases not in the runner remain unverified. No Neon/provider/funds used.

## Historical verdict before portable infrastructure

**Real multi-connection PostgreSQL acceptance: BLOCKED / NOT RUN.**
No production DB or provider was contacted. No Neon writes, SMS, payment-provider requests, real funds or real-DB PAID fixtures. Only the new `scripts/real-modules-concurrency-uat.*` files were created. Existing production/test files were not edited.

## Infrastructure evidence

- Python 3.13.1 available.
- `command -v` / `where.exe`: no `psql`, `postgres`, `initdb` or `pg_ctl` found on PATH.
- Standard `C:/Program Files/PostgreSQL`, `C:/tools`, `C:/pgsql` locations absent; no claim of exhaustive disk discovery.
- Docker CLI installed, but `docker info` using `desktop-linux` failed: `dockerDesktopLinuxEngine` named pipe does not exist.
- `docker --context default info` also failed: `docker_engine` named pipe does not exist (message additionally mentions elevated privileges).
- Python `psycopg` and `psycopg2`, root Node `pg` and `embedded-postgres` unavailable.
- Existing `.local-db/payment-sql-tests` PGlite available. It is single-connection WASM, **not** a PostgreSQL service or concurrency proof.
- Did not start Docker Desktop, install a server, alter system services, inspect secret env files or reuse live connection settings.

## New runner

`real-modules-concurrency-uat.py`:

- Default probe only; zero DB connections.
- Execution requires explicit confirmation and `blu_modules_test_<suffix>` database name.
- Explicit loopback host only; strips inherited PG connection/service/options overrides and DATABASE_URL; does not load .env.
- Checks server-reported loopback address, exact DB name and no user relations before DDL.
- Creates a minimal existing-table contract, applies eight actual unmodified payment/PromptPay/kiosk/rewards/benefits/finance/frontdesk/package-benefits migrations.
- Each competing transaction uses a separate `psql` subprocess; asserts distinct `pg_backend_pid()` values, synchronized worker barrier and short transaction hold.
- Bounded connect (5s), lock (5s), statement (15s), subprocess (25s), barrier (10s). No raw connection errors/secrets printed.
- Prepared cases: rewards last stock, same-key redemption, cross-staff delivery; benefits duplicate grant and one-time bonus consumption; finance same-key create and cross-owner stale update/delete; frontdesk same-key welcome admission replay during actual open hours; payment same-image claim replay, global duplicate transfer settlement, PAID replay and exactly-once package coupon issuance.
- Synthetic verified evidence exists only after isolated DB guard, through actual claim/finalize SQL. No provider calls. Leaves disposable fixtures for inspection, does not drop existing DBs.

Example after an operator provisions an empty local PostgreSQL DB and `psql` (password via standard local libpq password file; never command arguments):

```sh
python scripts/real-modules-concurrency-uat.py --run-disposable --host 127.0.0.1 --port 5432 --database blu_modules_test_uat --user postgres --confirm-disposable-empty
```

Use an external overall deadline as well (e.g. terminal timeout 180000 ms). Destroy/recreate the disposable database after inspection. Do not point a localhost tunnel at a live database: loopback checks cannot prove infrastructure ownership.

`real-modules-concurrency-uat.mjs` validates the Python runner's exact base and eight-file migration chain using isolated PGlite. It deliberately makes no concurrency claim.

## Executed validation

1. `node --test --test-timeout=90000 src/lib/real-rewards-server.test.mjs src/lib/real-benefits-admin-server.test.mjs src/lib/real-finance-server.test.mjs src/lib/real-checkin-server.test.mjs src/lib/real-member-wallet-server.test.mjs src/lib/package-payment-benefits.test.mjs src/lib/payment-policy.test.mjs src/lib/payment-provider-diagnostics.test.mjs src/lib/payment-server.test.mjs scripts/db-payments.test.mjs scripts/db-tools.test.mjs`
   - **65 passed; 0 failed; 0 skipped**, ~8.5s. Outer deadline 120s.
   - Includes mocked API/auth/validation/retry tests and isolated SQL invariants. Mocked simultaneous uploads do not prove DB locks.
2. `node scripts/payment-sql-tests.mjs --run-memory`
   - PASS: actual payment migrations, rollback SQL fixture, owner recovery lease/audit invariants. Single-connection WASM.
3. `node scripts/kiosk-sql-tests.mjs`
   - PASS: welcome entitlement, replay/bounce, zero points, denied sessions/expired rights, isolated paid fixture, payment NORMAL-mode upgrades. Single-connection WASM; deterministic test-only clock and some stub functions in its first fixture.
4. `node scripts/real-modules-concurrency-uat.mjs`
   - PASS: all eight **unmodified** migrations compile together on runner's minimal base; seven expected entry points present. Single-connection WASM.
5. Python AST syntax check: PASS.
6. `python scripts/real-modules-concurrency-uat.py`: probe confirms `psql_available=false`, real concurrency NOT RUN, connections 0.
7. `python scripts/real-modules-concurrency-uat.py --run-disposable --database blu_modules_test_uat --confirm-disposable-empty`
   - Expected safety stop, **exit 2**: `BLOCKED: psql unavailable; no DB connection attempted.` This is not a passing concurrency test.
8. `python scripts/payment-postgres-tests.py`: prepare-only, zero DB connections. Inspected its implementation: requires pre-migrated empty scratch DB and libpq service, runs separate psql transactions for promo/lease/transRef/replay; does not install new real-module migrations itself. Not executed against any DB.

## Exact remaining gaps

- **All prepared real PostgreSQL races remain unexecuted**, so Python runner runtime correctness and actual MVCC/lock/deadlock behavior are not certified by syntax or WASM compilation.
- Existing SQL tests use minimal base contracts, not a complete production schema with every actual enum, FK, grant, historical row and deployment role. New runner shares this limitation, despite applying actual incremental migrations unchanged.
- Prepared runner does not yet cover persisted-promo last-capacity races, two different lease UUID claims, revoke/suspend during in-flight write, reward catalog-save vs redemption, opposite-direction staff/member lock deadlocks, bonus consume vs payment renewal, grant/cancel/consume contention, last FRIEND_PASS quota contention, cross-station frontdesk double scans, frontdesk vs kiosk contention, or full failure-injection rollback under concurrency. Sequential/mocked tests covering related invariants do not close these concurrency gaps.
- Frontdesk prepared admission/replay case skips outside actual Bangkok 07:00–22:00; runner does not rewrite production SQL time. Denial-path replay alone would not prove single welcome consumption.
- Parallel workload repetition/load, SERIALIZABLE retry behavior, pooling behavior, runtime-role privileges and migrations against production-equivalent schema remain separate acceptance work.
- No browser, live-safe rollback, deployment, provider diagnostics against actual provider or external hardware UAT performed here; main agent owns those tasks.

**Failures observed:** no failing application assertion in executed suites. Infrastructure failure and expected runner exit 2 prevent real-concurrency acceptance. Do not mark this as fully accepted or as 65 real DB race tests.
