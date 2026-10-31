# Catalog deployment lock UAT — native PostgreSQL

## Result: PASS (2026-10-31)

Owned changes: only new `scripts/catalog-deploy-lock-uat.py` and this report.
No runner/migration edits. No production schema, env files, live URLs, providers,
payment/PAID fixtures, Docker or system services used.

```text
python -u scripts/catalog-deploy-lock-uat.py --run
PASS writer commits while deployment waits; fresh post-lock snapshot rejects old backup; DDL rolls back
PASS unchanged backup passes all 64 pre/post guards; 32 locks block new writer until COMMIT
```

Final evidence (ignored):
`.local-db/portable-postgres-uat/catalog_lock_2d949e62b2/result.json`
Also contains `server.log`, initdb/start/stop logs and the stopped disposable cluster.

- Native PostgreSQL 18.4, Windows x64; 127.0.0.1:56723 only.
- Fresh initdb cluster; empty `postgres` database identity checked before fixture DDL.
- Four separate native libpq connections; backend PIDs:
  observer 95060, old writer 95184, deployment 96092, new writer 83368.
- `stop_exit_code: 0`, `port_closed_after: true`.

## Transaction order exercised

Separate SQL calls on one deployment connection, mirroring statement boundaries:

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
LOCK TABLE public.fixture_00, /* every fixture through fixture_31 */ public.fixture_31
  IN SHARE ROW EXCLUSIVE MODE;
SELECT pg_advisory_xact_lock(hashtextextended('blue-fitness:catalog-order-guard',0));
-- Each row guard is a separate DO statement, then scratch transactional DDL,
-- then separate post guards, then COMMIT (or ROLLBACK on guard failure).
```

The actual script enumerates all 32 tables, with no omitted middle tables.
There is no deployment SELECT between BEGIN/SET and acquiring the table locks.
A post-lock SHOW verifies `read committed`. Test-only assertions run after the
advisory lock. Each guard uses the runner's JSONB aggregation/alias/comparison
shape, adapted to synthetic `(id integer, note text)` rows.

## Deterministic race evidence

1. Capture old backup; writer inserts one uncommitted row in fixture_00.
2. Deployment submits LOCK. Observer verifies `wait_event_type = Lock` and
   `pg_blocking_pids(96092)` contains 95184; deployment future is still pending.
3. Writer commits while deployment is blocked. LOCK then returns.
4. Deployment acquires advisory lock; post-lock SELECT sees the new row.
5. Create scratch DDL marker, then compare rows with old backup. Guard raises
   `P0001`; subsequent SELECT raises `25P02`, proving transaction aborted.
6. ROLLBACK removes DDL marker; writer's committed row remains.
7. Capture current backup. New deployment takes the same ordered locks;
   pg_locks confirms 32 granted ShareRowExclusiveLock table locks.
8. All 32 pre guards and 32 post guards pass around scratch DDL.
9. New writer inserts into fixture_31. Observer verifies actual lock dependency
   83368 -> 96092 and pending future. Deployment COMMIT releases the locks;
   writer finishes and commits. Both DDL marker and writer row are visible.

No sleeps are used as proof of blocking: polling actual backend lock dependency
has a four-second deadline. SQL lock timeout is five seconds; statement timeout
15 seconds; native process deadlines are bounded. Connections close in finally;
server stop and result/port evidence also run in finally.

## Tooling adaptation and first attempt

The documented ignored portable tooling was absent, and neither postgres nor
psql was in PATH. Downloaded the same documented package with npm pack
`--ignore-scripts --registry=https://registry.npmjs.org` under ignored .local-db:
`@embedded-postgres/windows-x64@18.4.0-beta.17`, SHA-1
`a2b4f70e310805d0c18df8101e94c55337406726` (40.6 MB archive).
No project dependency/lockfile change. This package includes libpq but no stock
psql; the new script calls native libpq using Python ctypes, no added Python deps.
Inherited PG* and DATABASE_URL environment variables are removed from server
children; client endpoints/options are explicit and never taken from env files.

First launcher attempt used captured pipes and timed out before running tests
(Windows inherited-handle issue). Port 52227 was subsequently confirmed closed;
cleanup pg_ctl returned 1 after the server had already terminated. That attempt
is not a test PASS. The corrected launcher uses file-backed stdout/stderr,
DEVNULL stdin and a separate Windows process group. Both subsequent runs passed;
the final script revision produced the evidence above.

## Gaps / not claimed

- Native libpq validation, **not stock-psql CLI validation**.
- Tests the planned ReadCommitted SQL lock/order semantics, not the main runner,
  Neon HTTP transaction transport or its eventual edited implementation.
- Minimal 32-table scratch schema, not production-schema/catalog/auth/finalizer
  acceptance; no catalog migration was applied by this UAT.
- Row guards are copied in shape, not imported/generated from the runner;
  future runner changes require parity review.
- No metadata/backup file-integrity acceptance, cross-deployer advisory-lock
  contention, Serializable negative control, broad stress/deadlock testing,
  sequence-state guarantees or remote production claims.
- Socket-selected ephemeral port has a small bind/start race; successful startup
  and loopback database identity are verified, not assumed.
