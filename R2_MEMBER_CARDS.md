# R2 physical member cards — prepared, NOT rolled out

2026-11-18. Card slice only. No production mutation or production migration application, paid/provider calls, orders/evidence fabrication, commit or push. One explicitly authorized production read-only signature probe was performed (see below). Actual migrations were applied only to fresh disposable local native databases. This does not close the R2 production checkpoint.

## Contract / scope

- New `member_cards`: one persistent row per member; nullable unique canonical `card_code`, monotonic integer version. No backfill from mock data. Unbind retains the row/version, preventing A → unbound → A stale overwrites. Every accepted new request, including a same-value request, increments version and audits once.
- Exactly the confirmed roles MEMBER, ADMIN, OWNER. ADMIN reads/changes MEMBER; OWNER reads/changes MEMBER or ADMIN. OWNER targets, including self, denied. Same target policy for read and write, independently checked in SQL. Suspended **target** can have its binding corrected, matching profile policy; suspended **actor** denied.
- Replace/unbind affects only the route-selected member. A card already bound elsewhere returns a generic conflict; never reveal that owner or silently move their card. To transfer deliberately, staff must separately select/unbind the original member, then select/bind the new member, with independent reasons/audits.
- Grammar preserves numeric physical identifiers: `CARD-` + 1–95 ASCII digits (100-character USB input limit). Case-insensitive input, trim surrounding whitespace/USB CR/LF, uppercase stored prefix, leading zeros preserved. No bare numbers, UID hex, URLs, JSON envelopes or new card alphabet. Existing mock member-card schema uses numeric `CARD-…`; no mock role taxonomy is imported.
- PATCH `/api/admin/members/[memberCode]/card`: strict `{requestKey, reason, expectedVersion, cardCode}`. `cardCode:null` explicitly unbinds; empty string is invalid. UUID, reason 1–240 characters, version 0–2147483646, JSON <=4096 bytes, same-origin, live staff cookies. Payload target is taken only from route.
- GET same endpoint returns `{card:{cardCode,version}}`; no row means null/version 0. Missing migration, invalid result, denied target or failed read never becomes an editable empty success. No audit reader or whole-member serialization. Errors map to generic 400/401/403/409/503; unique collision never exposes identifiers/SQL. No logging of transport errors or parameters.

## Actual admission path (not an entitlement)

Real source inspection found no real `member_cards` table/lookup. `real-checkin-server.ts` and `kiosk-server.ts` accepted only BLU codes; CARD examples were mock lookups. The real kiosk keyboard form already trims/case-normalizes and submits USB Enter input without rejecting CARD client-side.

Now:

- BLU or CARD frontdesk → new `member_scan_admit(..., direction IN/OUT)` → CARD lookup if needed → select installed admission signature **before mutation**.
- If `r7_visit_action(text,text,uuid,text,text)` exists: delegate unchanged, including its OUT behavior. If absent: IN delegates unchanged `real_frontdesk_checkin(text,text,uuid,text)`; OUT raises a tagged unsupported error **before any insert**.
- BLU kiosk → existing `kiosk_checkin` unchanged.
- CARD kiosk → CARD-only `member_card_admit(..., NULL)` → shared `member_scan_admit` → existing `kiosk_checkin`.

There is **no exception-driven fallback**. An existing function that fails (even with undefined-function SQLSTATE 42883) is not treated as absent, retried through legacy or converted to success. Missing/incompatible October prerequisites block the new migration; optional R7 return type is checked if present. No R3/R6/R7 install is required for R2.

Resolution, delegated admission and outer request record are one SQL transaction. A transaction advisory registry lock serializes CARD resolution against bind/replace/unbind, including absent rows. It is intentionally coarse for a small frontdesk registry; monitor contention before scaling, rather than weakening consistency. Frontdesk BLU and CARD scans now share that lock/replay namespace so switching identifier forms cannot bypass a conflicting request key. Existing kiosk BLU admission remains unchanged.

The wrapper independently requires persisted live NORMAL staff for frontdesk, or live KIOSK staff with the exact server-owned station for kiosk, and rechecks expiry before returning. It does not turn CARD ownership into eligibility: current suspension, expiry, time-slot, welcome coupon, supplement, replay, bounce and visit behavior remain in the existing admission functions. No entitlement/payment/status/points changes, no new free-entry branch. Unknown/unbound cards return NOT_FOUND without admission.

Outer scan requests are keyed by actor/station/channel/UUID with canonical input code/direction payload (BLU or CARD) and the original result. A retry after replacement/unbind returns that original result, never resolves a reassigned card to a second member. Changed payload/key conflicts. Auth is checked even on replay. Results retain only the existing admission response shape (which may include member display name/photo), not sessions or payment evidence.

**OUT and mixed-channel limitation deliberately not redesigned:** on October-only, OUT is explicitly unavailable and creates no request/audit/visit; on an already-installed R7, frontdesk delegates OUT including its existing expired/suspended-member behavior. Kiosk remains ENTRY_ONLY. Existing mixed-channel legacy IN can still occur while an R7 visit is open. No inferred historical OUT, no kiosk OUT, no claim that this slice fixes mixed open visits.

## Atomicity / security

- `member_card_target` share-locks the live NORMAL session, locks actor/target members in ID order, and checks current roles/status. Reads use the same target guard as writes. Session expiry checked again before return.
- Binding changes serialize through the registry lock and current member locks. Actor locks serialize UUID reuse across targets. Compare expected monotonic version under lock, reject collisions, mutate only selected binding, append audit in the same transaction. Audit failure rolls everything back.
- Audit: actor/current role, target, UUID, SHA-256 canonical JSONB payload hash, explicit reason, before/after code and versions, timestamp. No passwords, phone, session digest/token, slip/provider payload or full member row. UPDATE/DELETE/TRUNCATE blocked for audit and scan request tables. Database owners remain trusted and can bypass/drop guards; this is not malicious-DBA protection.
- All six new functions are SECURITY INVOKER (default), fixed `search_path=pg_catalog,public`; application relations/functions explicitly public-qualified. PUBLIC privileges revoked from new tables, identity sequence and functions. No guessed grants or browser role access. The reviewed trusted backend principal must own the new objects or receive narrowly reviewed invoker privileges at parent rollout.
- Existing cross-feature lock protocols are not redesigned. Deadlock/serialization/unknown failures fail closed and surface as unavailable; retry only the identical frozen request or inspect latest state. No global deadlock-free claim.

## Files and parent integration

New files:

- `src/db/migrations/20261118_R2_member_cards.sql`
- `src/lib/member-card-server.ts`, `member-card-server.test.mjs`, `member-card-sql.test.mjs`
- `src/app/api/admin/members/[memberCode]/card/route.ts`
- `src/app/admin/members/[memberCode]/AdminMemberCardForm.tsx`
- `src/app/admin/members/[memberCode]/MemberCardSection.tsx`

Existing source files changed by this slice: `src/lib/real-checkin-server.ts`, `src/lib/kiosk-server.ts`, their unit tests, and the narrowly scoped `src/app/admin/checkin/page.tsx` compatibility changes explicitly requested in the follow-up. Frontdesk now accepts CARD input, labels/disables legacy OUT, and releases a pending request only for the server's precise pre-write unsupported marker; unknown errors keep the original key. History probes table/function presence before choosing its read-only query; October history never references absent R7 relations and returns real checkins with null exit/snapshot/duration, not fabricated visits. Existing dirty dashboard/admin-members/admin-permissions work was left intact. No detail page parent, TODO, old migration, auth/password or package/payment implementation edits.

Parent can later render `<MemberCardSection memberCode={detail.memberCode} />` within its existing authorized detail flow; that fragment performs the real guarded read and renders unavailable on failure. It is **not wired now**, per task boundary. Form freezes serialized body/UUID after submission (including unknown outcome), prevents parallel submission, offers exact retry and explicit reload, and stores no body in browser persistence. New member selection should mount with the corresponding member key; section supplies a member/version key to its form.

## Migration/runtime compatibility and rollout

**Do not apply as part of this work.** Parent coordinates migration + runtime + UI integration after recovery/rehearsal/UAT review.

- Additive migration; creates three tables, six functions, constraints/indexes/identity sequence/triggers. No old function replacement, schema rewrite, member backfill or historical entitlement rewrite.
- Baseline requires existing members and NORMAL/KIOSK auth_sessions. CARD kiosk delegates the deployed kiosk function. Frontdesk supports the deployed October entry-only function without R3/R6/R7. It uses R7 only when that exact signature is already installed; existing errors never cause downgrade. Parent rollout applies **R2 only**, and must not install future-phase migrations just to enable cards. No profile/contact/password migration dependency.
- Uses built-in PostgreSQL `sha256(bytea)` and the existing PL/pgSQL/JSONB/advisory-lock capabilities; no extension or dependency installed. Native compilation/runtime verified on installed PostgreSQL **18.4** in two independent profiles: October-only + R2, and October + actual latest repository R3/R6/R7 + R2. Production signatures were inspected read-only, not production function bodies or runtime mutations.
- Old application remains compatible with additive unused card objects. New application without the migration keeps existing BLU paths but CARD/API reads/writes fail unavailable rather than fall back to mock/empty binding. Apply schema before enabling CARD routes/parent UI; review actual principal grants and deployed admission definitions.
- Stop feature availability first for rollback. Retain binding/version, audit and scan replay history; do not drop audit, restore old bindings in bulk, rewrite old migrations or infer entitlement changes. Correct a binding using a new authorized audited action.

## Validation and safe snapshots

Executed offline:

```sh
node --test src/lib/member-card-server.test.mjs src/lib/member-card-sql.test.mjs src/lib/real-checkin-server.test.mjs src/lib/kiosk-server.test.mjs src/lib/checkin.test.mjs src/lib/front-desk.test.mjs
pnpm exec tsc --noEmit --incremental false
pnpm exec eslint --max-warnings 0 src/lib/member-card-server.ts src/lib/member-card-server.test.mjs src/lib/member-card-sql.test.mjs src/lib/real-checkin-server.ts src/lib/real-checkin-server.test.mjs src/lib/kiosk-server.ts src/lib/kiosk-server.test.mjs 'src/app/api/admin/members/[memberCode]/card/route.ts' 'src/app/admin/members/[memberCode]/AdminMemberCardForm.tsx' 'src/app/admin/members/[memberCode]/MemberCardSection.tsx' src/app/admin/checkin/page.tsx
git --no-pager diff --check
```

Compatibility follow-up combined rerun: **69 passed, 0 failed, 0 skipped** (includes 22 native runner/subtest results across the October-only and R7 profiles). TypeScript passed; scoped ESLint passed with zero warnings; tracked diff whitespace check passed. The native suite no longer skips when tooling is absent: it fails with an explicit missing-tool assertion. API tests execute actual helper/validation with stub auth/transport; admission server tests verify canonical CARD dispatch and unchanged BLU dispatch, not database eligibility. UI tests inspect source contracts, not browser/USB hardware interactions. Legacy mock regressions are secondary, never production evidence.

### Corrected tooling discovery / native runtime evidence

The earlier empty `.local-db` statement and skipped result were **incorrect tooling discovery**, not an absent native installation. File tools hide ignored contents. Terminal `fs.existsSync` confirmed `.local-db/portable-postgres-uat/package/native/bin` and `.local-db/payment-sql-tests`. There is no stock psql executable, but the existing `.local-db/portable-postgres-uat/psql.py` is a native libpq client. Inspected `scripts/r2-production-rollout.mjs` and the avatar native harness; reused that adapter without importing/executing the production runner.

The suite now uses installed initdb/pg_ctl + Python/libpq against a **real PostgreSQL 18.4 server**, not a mock or PGlite. It creates a fresh disposable loopback-only cluster, clears inherited libpq redirection configuration, bounds processes and stops/removes its own cluster in finally. Windows pg_ctl start logs are file-backed to prevent inherited pipe handles hanging the test process. No download/install, env-file loading, database URL input, protected backup/customer reads, production connection or financial evidence fabrication.

The base fixture is synthetic and reduced (not a full recovered production database), with the actual MEMBER/ADMIN/OWNER enum and unique session token constraint. Both profiles execute actual repository October payment/kiosk/frontdesk/finance/catalog migrations, then R2 card. Only the separate optional-R7 profile installs latest R3 catalog/checkin, R6 supplement and R7 visits before R2. The October-only profile explicitly asserts R7 remains absent after R2 installation. The October invoker ACL/search_path hardening is explicitly reproduced **before** the real receiver-bank guard, matching the existing combined harness/deployed baseline contract; no migration guard was weakened. In the optional-R7 profile, transactional negative source-drift probes execute the actual R3-checkin/R6/R7 guards and confirm rejection/rollback before clean installation. Both profiles additionally reject the card migration when its October frontdesk prerequisite is transactionally removed, then successfully install after rollback.

Verified native behavior:

- Persisted live NORMAL auth for read/write; MEMBER/KIOSK/revoked/expired/null-expiry/suspended/demoted actor denial; ADMIN→MEMBER and OWNER→ADMIN write/read policy; OWNER target denial. Kiosk admission checks exact mode and station.
- Strict canonical SQL fields, unique collision without moving another member, unbind/version ABA rejection, UUID replay/conflict, immutable audit, injected audit failure and explicit transaction rollback.
- Real CARD→member resolution invokes the actual admission definitions. No-entitlement and suspended members are denied. **Observed successful `FREE_ENTRY` on both frontdesk and kiosk in both profiles**, using synthetic welcome coupons, with zero fabricated orders/PAID/evidence/provider calls. R7-profile paired OUT works; October-profile BLU/CARD OUT rejects with SQLSTATE 0A000 and no state change. Kiosk creates no R7 visit.
- Parallel native connections produce one winner for competing same-card binds; identical binding UUID creates one audit; identical frontdesk/kiosk scan UUID creates at most one checkin and returns the same result.
- Injected outer scan-request insert failures roll back coupon consumption, checkins, visits, legacy/card/R7 requests and bounce state on **both** channels. Exact retry can then succeed.
- Explicit unbind then separate bind to a different selected member leaves old UUID replay pinned to the original response without new visits/checkins; a fresh scan resolves the new member and is denied without entitlement. Changed scan payload conflicts.
- Existing admission function definitions remain byte-identical across card installation. Transactionally injected errors in the selected existing function propagate without fallback, including SQLSTATE 42883. The real `realCheckinAction` implementation executes BLU/CARD scans and history against actual native SQL in both profiles (auth/cookie/transport adapters are synthetic; SQL authorization and queries are real).
- Browser role has no table/function access; all six new functions remain invoker with fixed search_path.

Safe snapshots compare exact PostgreSQL-generated JSON text, ordered by each table's real primary key, for members/sessions/orders/point-ledger/finance/**catalog prices** before and after. Seeded member points are nonzero to detect accidental reset/increment. Catalog has actual seeded rows; orders/ledger/finance remain empty because this slice does not fabricate financial fixtures. Snapshot row ordering was corrected after a native run exposed physical heap order changing during temporary fixture status updates; no values were excluded or normalized away. Native baseline setup also exposed the missing October hardening prerequisite; the harness now reproduces it rather than disabling the source guard. These were earlier test-harness fixes. The subsequent LIVE R2 compatibility follow-up deliberately adds the common pre-mutation dispatcher, optional R7 selection, tagged legacy OUT rejection, baseline migration guard, legacy history read and narrow frontdesk UI handling; it does not implement or install R7.

### Production read-only signature probe

Authorized probe on 2026-11-18 used `.env.local` privately through dotenv + Neon, one `readOnly:true` Repeatable Read transaction, selecting only `to_regprocedure` existence booleans. No admission function was invoked and no credentials/host/customer data were printed:

| Exact public signature | Present |
| --- | --- |
| `kiosk_checkin(text,text,uuid,text)` | yes |
| `real_frontdesk_checkin(text,text,uuid,text)` | yes |
| `r7_visit_action(text,text,uuid,text,text)` | **no** |
| `member_card_admit(text,text,uuid,text,text)` | no |
| `member_scan_admit(text,text,uuid,text,text)` | no |

This confirms October-compatible R2 dispatch is required; it does not authorize or require applying R3–R7. New application scans require the R2 schema first; keep the old build active until the separately coordinated parent R2 migration/deployment gate is complete. Existing admission definitions are never replaced by this migration.

All newly persisted test rows are synthetic-only. No production snapshot, secret, customer row or protected backup was read/printed. The native suite's successful path remains subject to the real Bangkok welcome-entry window; outside it verifies CLOSED rather than faking the clock or manufacturing a PAID entitlement. This run observed both successful entries; no paid-entry/expiry/time-supplement success acceptance is claimed.

Remaining gate: deployed-principal ACL/current production drift and recovery rehearsal, cross-feature contention beyond the tested card races, parent integration, browser role UAT and real USB CARD scans through expired/off-slot/valid paid memberships and supplements without fabricated financial evidence. Local native acceptance is **not** production UAT or rollout authorization; production schema remains untouched.
