# R2 — optional contact email (prepare-only)

## Scope and decisions

- Real data only: `member_contact_details(member_id PK/FK, email nullable, version)`; no changes to `members`, existing member SELECTs, mock `admin-members.ts`, auth, profile/password flows, histories, financial/entitlement data or TODO.
- Separate server helper `src/lib/member-contact-email-server.ts`, GET/PATCH `/api/admin/members/[memberCode]/contact-email`, separate staff form, and additive detail-page wiring. Page loads contact through the same guarded read helper as GET, not through an HTTP self-request.
- Contact ONLY. No login/recovery, email sending/provider, verification, ownership assertion, person-type taxonomy, automatic classification or identity matching. Phone-based auth remains unchanged.
- ADMIN → MEMBER; OWNER → MEMBER/ADMIN; OWNER targets are not enabled. Persisted NORMAL, live, non-revoked session and unsuspended current staff actor are checked in SQL for reads/writes/replays. Target suspension does not itself prevent correcting contact data, consistent with the existing profile slice; the separate password form's stricter target rules are unchanged.
- Email is optional: API trims, rejects non-ASCII, lowercases ASCII and maps empty to null; max 254 characters after trim and Zod email validation. SQL defensively accepts only canonical ASCII/null with equivalent email-shape checks. SQL callers must send canonical values, not raw mixed-case/space-padded email.
- User confirmed shared contact emails are allowed: two or more members may store the same canonical email or null independently. No unique email constraint or replacement email index (there are no email searches). `member_id` PK and audit `UNIQUE(actor_id,request_key)` remain. Generic SQL 23505 returns a non-email-specific conflict without exposing records. No merge, transfer, lookup-by-email, account linking or proof of ownership; roles remain MEMBER/ADMIN/OWNER only.
- Strict PATCH body: `requestKey` UUID, `email` string/null, `expectedVersion` integer 0–2147483646, `reason` 1–240 trimmed characters. Unknown fields rejected by API and SQL. GET disallows query/body; unsupported methods return 405 (Next handler dispatch plus helper check). Same-origin/cross-site checks use existing real HTTP guard; role/actor headers are ignored.

## Atomicity, privacy and limitations

- New actual SQL: `src/db/migrations/20261118_R2_member_contact_email.sql`. New rows are not backfilled; guarded read of absent contact returns `{email:null,version:0}`. Missing migration/database/invalid result is unavailable, never empty success; page shows unavailable with no editable contact form. Existing page features remain usable.
- SQL locks actor/target members in ID order, then rechecks locked session/current roles; read uses the same guard. Actor lock serializes actor-scoped UUIDs; target lock serializes updates including first insert. Shared emails do not couple different targets' contact rows, versions or audits.
- Expected monotonic integer version prevents lost updates and A→B→A snapshot confusion. Each accepted new request increments version, including no-op/null writes. Same actor+UUID+canonical payload replays success without audit/update duplication; different payload conflicts. Replays reauthorize, and do not revert newer contact values.
- Contact mutation and append-only before/after email+version+actor+role+reason+timestamp+UUID+payload-hash audit occur in one transaction; audit failure rolls back contact and key. UPDATE/DELETE/TRUNCATE audit triggers reject modification. No raw session token is passed to SQL; only SHA-256 digest. No database error/PII/audit records are returned or logged. UI retains retry body only in component memory, no browser storage, and retries the exact same UUID/body. Reload to start a new edit.
- Audit intentionally contains contact PII and reasons; protect database/backups, retention and operational access. No audit-read API/UI added. DB owner can bypass trigger protections; append-only is not external tamper-proof storage.
- Functions are SECURITY INVOKER with fixed search path; PUBLIC access to new tables/sequence/functions revoked. Same trusted backend DB principal as existing modules is assumed. Before rollout verify that browser/untrusted DB roles cannot call functions or access tables directly. No guessed role grants or runtime schema creation.
- Member→session lock order follows password slice, but existing profile/other functions have other lock orders. Do not claim global deadlock freedom. Transactions abort fail-closed; production multi-connection/session-revocation race rehearsal remains required.

## Rollout / rollback (not executed)

The original contact migration remains **untracked, prepare-only and never applied**; its pending definition is edited directly to remove email uniqueness. No additional migration system or applied-schema change is introduced.

1. Obtain explicit approval, backup and restore verification; inspect existing actual members/auth schema and trusted application principal/ACLs. New migration requires existing members and hardened NORMAL/KIOSK auth_sessions, not other new R2 migrations.
2. Apply **only the new migration** under reviewed migration procedure; never edit/reapply old migrations or use db:push for this change. No new dependencies/env/provider credentials needed.
3. Verify roles and shared-email/null/version/replay/error cases; deploy application after migration. Migration absence fails closed for contact only. Existing profile/password migrations retain their own rollout requirements.
4. To disable, roll back only contact application wiring/helper/API/UI to prior application version. Retain tables/audit and all contact data. Do not drop/truncate audit or revert unrelated auth/profile/password work; any destructive schema rollback needs separate approval and export/retention review.

## Validation run (18 Nov 2026)

```sh
node --test --test-concurrency=1 src/lib/member-contact-email.test.mjs src/lib/member-contact-email-server.test.mjs
node --test --test-concurrency=1 src/lib/member-contact-email.test.mjs src/lib/member-contact-email-server.test.mjs src/lib/admin-member-profile.test.mjs src/lib/admin-member-profile-server.test.mjs src/lib/admin-member-password.test.mjs src/lib/admin-member-password-server.test.mjs src/lib/admin-members-server.test.mjs src/lib/admin-permissions.test.mjs
pnpm exec tsc --noEmit --incremental false
pnpm exec eslint --max-warnings 0 src/lib/member-contact-email-server.ts src/lib/member-contact-email.test.mjs src/lib/member-contact-email-server.test.mjs 'src/app/api/admin/members/[memberCode]/contact-email/route.ts' 'src/app/admin/members/[memberCode]/AdminMemberContactEmailForm.tsx' 'src/app/admin/members/[memberCode]/page.tsx'
pnpm lint
```

- Re-run after shared-email uniqueness removal: SQL executes only in isolated in-memory PGlite; no external DB/network/provider access. UI form has no duplicate-email claim, so no UI edit was needed. SQL 23505 API regression asserts no misleading duplicate-email message or leaked details.
- Regression runner: **73 passed / 0 failed / 0 skipped**; contact-only runner **16 passed** (includes nested subtests, not 16 independent requirements). TypeScript and scoped ESLint passed.
- Actual new SQL executed with existing installed PGlite via root `.local-db/payment-sql-tests`; no installs, env loading, network or real DB. Tests cover live/revoked/expired/KIOSK/suspended/demoted roles, target matrix, strict/invalid/canonical email, shared canonical emails with independent updates/null/version/audit and replay after newer writes, cross-target replay conflict, stale/replay/conflict, immutable audit, forced audit rollback and unchanged existing member/session/financial data. Combined test applies actual payment/finance/R3–R7/profile/password SQL with paid order/finance fixture and asserts no existing table changes after contact write/replay. Existing fixture schemas are isolated synthetic data, not production bootstrap/ACL/race proof.
- API tests run actual TypeScript helper and real HTTP-origin guard with stub auth/transport, not real network auth. UI is source-contract coverage, not browser UAT.
- Full lint fails at existing `src/app/member/AccountClient.tsx:78` (`react-hooks/set-state-in-effect`); unchanged/out of scope.
- Initial expanded test runs timed out (120 s): new combined fixture lacked OTP/password-ticket tables included in snapshot comparisons. Added those tables only to the isolated fixture; focused and serial combined reruns then completed successfully (~10 s for regression).
- No production DB access/migration, dependency addition, provider/network calls, commit, deploy or TODO update. Multi-connection PostgreSQL/browser/production acceptance still pending.
