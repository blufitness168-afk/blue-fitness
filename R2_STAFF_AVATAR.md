# R2 staff-managed avatar — prepare only

## Scope and wiring contract

New files only. No edits to parent detail page, TODO, existing migrations, auth, profile/password, dashboard or member-card files. Existing uncommitted work is left intact. Latest category policy remains MEMBER / ADMIN / OWNER only.

- `src/app/admin/members/[memberCode]/StaffAvatarSection.tsx`: `StaffAvatarSection({ memberCode }: { memberCode: string }): Promise<React.JSX.Element>` — guarded server fragment; parent may import/render it later. Read failures render unavailable, never an editable version-zero fallback.
- `src/app/admin/members/[memberCode]/StaffAvatarForm.tsx`: `StaffAvatarForm({ memberCode, initial }: { memberCode: string; initial: StaffAvatarSnapshot })` — client fragment; freezes the complete FormData + UUID across retries. Reload explicitly abandons in-memory retry. No browser persistence.
- `src/lib/staff-avatar-server.ts`: `getStaffAvatar(memberCode: string): Promise<StaffAvatarSnapshot>` and `staffAvatarRequest(request: Request, memberCode: string)`.
- Snapshot: `{ avatarUrl: string | null; version: number; source: 'LEGACY' | 'STAFF_UPLOAD' }`.
- New route `/api/admin/members/[memberCode]/avatar`: GET guarded snapshot; POST multipart with exactly one each of `file`, `requestKey` UUID, `expectedVersion` decimal integer, and nonblank `reason` (max 240 chars). Requires same-origin Origin header. No arbitrary URL/public ID/source/target/actor fields accepted. Server-component reads should call the read helper directly.

## Transaction / provider boundaries

1. Normal, live staff session required. Both read and claim SQL lock persisted session and actor/target rows. ADMIN → MEMBER; OWNER → MEMBER/ADMIN. OWNER targets and staff self-targets denied. Suspended actor denied; suspended target remains editable, without granting admission.
2. Reuse existing bounded multipart reader and JPG/PNG/WebP signature/MIME policy, max 5 MiB. Member self-upload endpoint and its upload-once restriction are unchanged.
3. Claim commits before provider call. `(actor_id, request_key)` pins target, version, reason, MIME and SHA-256 of bytes. Deterministic public ID `blue-fitness/staff-avatars/{targetId}/{actorId}/{requestKey}`. Upload is non-overwriting. Concurrent duplicates get 409; 90-second DB lease permits recovery, not an unbounded new asset on each retry.
4. On retry after lease expiry, query the exact asset first using Cloudinary resource API. Only explicit 404 permits another non-overwriting upload of the same ID. Other lookup errors fail closed. Validate provider public ID, canonical HTTPS URL, image format/version and stored hash context. Invalid metadata is not relabeled or accepted. Caller cannot attach an arbitrary URL or an older upload-only asset.
5. Final SQL independently reauthorizes and CAS-checks current avatar version. Updating avatar_url, avatar_changed=true, updated_at, version, append-only audit and completed request happens in one transaction. Audit records actor role, target, reason, hash, public ID, before/after URLs and versions. Completed replay still requires current authorization and matching original payload; it never overwrites a later photo.
6. No asset deletion at all. Unknown provider/DB outcomes return generic errors and preserve retry data. A provider success followed by stale version or lost permission can leave an unattached managed asset; manual reconciliation is needed. No automatic GC because an unknown outcome must not delete a committed/current photo. No secrets/provider errors/SQL are logged or returned.

## Migration / operational constraints

`src/db/migrations/20261118_R2_staff_avatar.sql` is NEW and PREPARE ONLY. It requires existing members (avatar_url, avatar_changed, updated_at) and auth_sessions (NORMAL mode). No migration was applied to production. Review/backup/apply and any restricted backend role grants are separate authorized operations. SQL is invoker-only, fixed search_path; PUBLIC table/function privileges revoked. It assumes a trusted backend DB role; it is not designed to protect against compromised database-owner credentials.

New avatar_version column defaults to zero for legacy data. A trigger on member updates owns version progression and invalidates CAS after any actual avatar_url/avatar_changed change, including the existing self-upload path. Unrelated member updates do not bump the avatar version. Legacy URLs are preserved without any claim of managed provenance. Source is derived from a matching immutable audit entry at the current version, not client metadata or URL shape. No ORM schema edits were made; do not run destructive schema push that could remove this SQL-managed column/tables/trigger.

Runtime reads CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET already used by this project. Merely importing/rendering the section never calls the provider. A user submitting the form explicitly initiates a real Cloudinary upload, and a retry may perform resource lookup; these can consume external quota. Form text discloses that data transfer/quota. No provider service was called during implementation/tests, including ping. Positive offline stubs are supplemental control-flow tests only, NOT evidence of real upload, credentials, delivery, billing or end-to-end browser success.

## Validation — 2026-11-18

`node --test --test-concurrency=1 src/lib/staff-avatar-server.test.mjs src/lib/staff-avatar-sql.test.mjs src/lib/profile-image-policy.test.mjs`: **18 passed, 0 failed, 0 skipped**.

Native suite really starts fresh isolated PostgreSQL 18.4 from `.local-db/portable-postgres-uat/package/native/bin`, executes this migration and SQL using the existing Python ctypes/libpq adapter (`psql.py`, NOT stock psql), and stops/removes its cluster. No DATABASE_URL/env file/customer data used. Tests cover live role/session changes, matrix including OWNER→ADMIN and suspended target, strict SQL input, claim duplicate/hash conflict/recovery, final auth, arbitrary URL denial, audit rollback/append-only, completed replay, legacy version/source invalidation, CAS winner across parallel real connections, and backend ACL. Unavailable native prerequisites fail rather than silently skip.

Initial native attempt timed out because Windows pg_ctl inherited pipes; corrected runner to file-backed startup logging and native libpq adapter, stopped that isolated cluster, then reran successfully. This is not a production operation.

Production handler auth/invalid multipart/size/signature/mass-assignment rejection tests make zero provider calls; successful provider behavior is offline stub only. Existing self-upload policy regressions also pass. No real upload or browser form UAT claimed. No commit/push/deploy/production mutation performed.

Final static checks: scoped pnpm exec eslint on the six new TS/TSX/test files passed; pnpm exec tsc --noEmit --incremental false passed; git diff --check passed. An earlier combined static-check command timed out at 120 seconds; separate reruns succeeded.
