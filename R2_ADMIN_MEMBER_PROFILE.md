# R2 — staff member profile correction (prepare-only)

18 Nov 2026. One bounded R2 slice, not completion of R2 or production acceptance.

## Scope / authorization

- Editable: full name, nickname, gender, birth day/month (no year), emergency contact/name/phone/relation.
- Same registration text limits, gender choices and leap-year-2000 calendar validation; emergency phone optional empty or `0` followed by 8–9 digits (existing member-profile rule).
- ADMIN → MEMBER only. OWNER → MEMBER/ADMIN only. Nobody edits an OWNER through this feature, including self. No role mutation or new role privileges.
- No email/person_type schema, password, avatar, card, member phone/OTP, expiry, status, points, payments or finance changes.
- Existing role-aware money projections, detail/history tables, pagination and OWNER-only role controls remain unchanged. Only the detail page adds an explicit allowlisted snapshot and separate form. The detail description now points to the separate form and states its narrower editable scope.

## Files / contract

- `src/lib/admin-member-profile-server.ts`: staff guard, strict nested schema, bounded 8 KiB JSON body, same-origin guard, cookie hashing, safe status/error responses.
- `src/app/api/admin/members/[memberCode]/profile/route.ts`: PATCH, awaited route params.
- `src/app/admin/members/[memberCode]/AdminMemberProfileForm.tsx`: reason, UUID, retry frozen serialized body, refresh after success. Explicit full reload to inspect latest state/start a new request; no automatic retry on unknown DB outcome.
- `src/app/admin/members/[memberCode]/page.tsx`: passes only editable snapshot fields to the new form, gated by actor/target role.
- New SQL: `src/db/migrations/20261118_R2_admin_member_profile.sql`.

PATCH body: `{requestKey, reason, expected, profile}`. The target memberCode comes only from the route. Unknown keys at root/profile/expected are rejected, not ignored. `expected` preserves exact raw nullable legacy profile values; `profile` is normalized through registration field schemas, with valid day/month required. Empty optional strings are saved as empty strings, not silently converted back to null.

Response: `{ok:true}` only, or a generic error with HTTP 400/401/403/409/503. No audit reader, raw SQL errors, DB result serialization or session identifiers are exposed.

## SQL safety

`admin_member_profile_update(text,uuid,jsonb)` is SECURITY INVOKER with a fixed search_path, matching existing trusted server DB-principal conventions. It independently checks all field allowlists/types/limits/date/phone rules.

- Share-lock the matching persisted session; require NORMAL/live/unrevoked.
- Lock actor/target member rows in ID order, then re-read current actor status/role and target role. Actor must be unsuspended ADMIN/OWNER. Session expiry is checked again before returning, including replay.
- Actor row serializes this actor's request keys, including reuse against another target.
- Compare current eight-field profile JSON against exact expected snapshot under the target lock. Reject stale data with 409; unrelated points/expiry updates do not create false profile conflicts.
- Update only eight allowed profile fields plus updated_at, then insert append-only audit in the same transaction. Audit failure/transaction rollback undoes the profile update and request record.
- Audit includes actor ID/current role, target ID, reason, UUID, canonical PostgreSQL JSONB SHA-256 payload hash, before/after profile, timestamp. No password/hash, member phone, session/token digest, provider/slip/payment data or whole-member serialization.
- Unique `(actor_id,request_key)`: same canonical payload returns success without updating profile/audit again, even if the original expected snapshot is now old. Different payload with that actor/key conflicts. Auth and target authorization still apply to replay.
- UPDATE/DELETE/TRUNCATE audit triggers reject mutation. PUBLIC table/sequence/function privileges revoked. DB owners can still bypass triggers: this is not protection against a malicious DB administrator.

Snapshot comparison is value-based, not a monotonic revision: A→B→A is equal to an old A snapshot. This matches this slice's requested stale-profile comparison, not a history-version guarantee. JSON key ordering does not change a request hash; normalized payload values do. The form retains the identical serialized body/UUID after a failed/unknown response.

## Prepare-only rollout / rollback

Not applied. Requires the existing `members` profile columns/`profile_gender` enum, `auth_sessions` and NORMAL/KIOSK session migration already provisioned. No dependency on the R3–R7 features; isolated integration also verifies coexistence with their actual SQL chain. Uses built-in PostgreSQL SHA-256; no pgcrypto extension/dependency added.

Before any separately authorized rollout: backup, verify actual schema and deployed migration inventory, rehearse on a disposable PostgreSQL database, review trusted server principal ownership/privileges. Do not grant PUBLIC/browser roles access. This migration intentionally does not invent or broaden application DB roles/grants. The existing server principal must have invoker permissions on members/auth_sessions and the newly owned audit objects/function, or have narrowly reviewed grants from the migration owner.

Rollback application/API availability first; retain audit table/records. Do not drop/truncate audit, rewrite old migrations, revert profiles in bulk or automatically restore before snapshots: that could overwrite later legitimate edits. Any data correction needs a separately authorized audited action.

## Validation (offline)

Commands run:

```sh
node --test src/lib/admin-member-profile.test.mjs src/lib/admin-member-profile-server.test.mjs src/lib/admin-members-server.test.mjs src/lib/admin-permissions.test.mjs src/lib/auth/registration.test.mjs src/lib/member-profile-server.test.mjs
pnpm exec tsc --noEmit --incremental false
pnpm exec eslint --max-warnings 0 src/lib/admin-member-profile-server.ts src/lib/admin-member-profile.test.mjs src/lib/admin-member-profile-server.test.mjs 'src/app/api/admin/members/[memberCode]/profile/route.ts' 'src/app/admin/members/[memberCode]/AdminMemberProfileForm.tsx' 'src/app/admin/members/[memberCode]/page.tsx'
git --no-pager diff --check
```

- 47 tests passed, 0 failed/skipped (includes SQL suite wrapper; runner count, not independent requirement count).
- TypeScript passed. Scoped ESLint passed with zero warnings. Diff check passed; Git reported existing LF→CRLF notices only.
- Actual new SQL runs on installed isolated in-memory PGlite: denied/missing/member/revoked/expired/KIOSK/suspended/demoted sessions, role target matrix, unknown-field spoofing, no birth year/impossible dates, leap day, optional emergency phones/limits, null-aware stale comparison, UUID replay/conflicts, immutable audit/ACL, injected audit failure and explicit rollback.
- Additional isolated integration applies existing actual legacy/payment/finance/R3–R7 migrations, settles a synthetic payment via existing finalizer and creates a synthetic finance expense. Profile edit/replay leave raw orders, payment attempts, point ledger, coupons, entitlement observations, finance entries/requests/audit, supplement/visit/checkin/session tables unchanged. Other profiles and target role/status/phone/expiry/points/avatar unchanged. Financial screens may naturally display the corrected member name through existing joins; money and historical payment snapshots are not rewritten.
- API tests use real helper/registration validation with stub auth/transport; UI checks currently inspect source contracts, not browser interactions. SQL tests are serial PGlite, not evidence of PostgreSQL multi-connection race safety or browser UAT.

No dependency install, real DB/env loading, network/provider, migration application, commit/deploy or TODO edits performed. Existing user working-tree changes retained.
