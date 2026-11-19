# R3 per-member daily time override — prepared only

`20261119_r3_member_time_override.sql` follows R3 catalog and catalog/checkin. It does not depend on, edit, or roll out the bonus migration. It adds an append-only event journal, staff read/write RPCs and reviewed replacements of the two existing checkin functions. No member, expiry, order, snapshot, ledger, coupon, catalog, or visit history is backfilled or rewritten. No new PUBLIC privileges. Run only under a separately reviewed migration/ACL plan; the SQL uses invoker rights like existing R3. The app principal must already have the required native access (rehearse exact ownership and effective ACLs, not just RPC EXECUTE).

## Authority and behavior

- Only live NORMAL `ADMIN`/`OWNER` sessions may view or set/clear an override for a `MEMBER`. A reason is required. Disqualify inactive/expired members, unproven payment/ledger provenance, more than one PAID order (including expired/older orders), mismatched expiry, stacking, malformed snapshots and terms that cannot be verified. A PENDING order is not an entitlement. This is intentionally narrower than existing admission; ineligible members retain existing checkin behavior.
- On admission, the latest override applies only to the same proven PAID order ID, confirmation/expiry interval and exact PAID snapshot. It **replaces** the main daily slot; clearing restores the snapshot slot. Bangkok local time is opening-inclusive/closing-exclusive, with `24:00` valid only as a closing boundary. Actual membership expiry still gates entry. Separate R6 rights and the legacy welcome path are unchanged. Renewal, including an order confirmed while this override exists, cannot inherit the override.
- Use the GET result's order ID and version for PATCH. The member lock serializes with renewal, coupon mutation and checkin. Reusing the same actor-scoped UUID and identical payload replays the original version, even after another change. Different payload for the same UUID or stale entitlement/version returns 409. The journal records the order binding, actor/role, prior and requested slots, reason and timestamp. No operational audit read endpoint is introduced.
- The existing CARD/BLU routes, station authentication, bounce, response shapes and saved request replays are unchanged. No manual/backdated, expiry, price, point, or benefit override is provided.

## Optional later migrations

- The migration stops on an unreviewed installed R3/R6 checkin body; it never builds DDL from historical function text. R3-only and R6-already-installed stacks are supported. The exact R6 anchor is retained so existing R6 can also be applied later. If R6 exists, its own grant/activation rules continue to control the independent supplement window.
- If R7 is already present, the migration attaches a `BEFORE INSERT` trigger to enrich only **new** R7 snapshots. `mainTimeSlot` and `package` remain the PAID originals; `overrideTimeSlot` records the replacement and `usedTimeSlot` reflects the actual admitting window. Exits and replay are unchanged.
- If adding R7 later, run `SELECT public.r3_override_attach_r7();` immediately after installing R7, **before enabling checkin traffic**. The helper is migration-principal-only under the default ACL and refuses unreviewed R7. Verify that `r3_override_r7_snapshot` is enabled on `public.r7_visits`. Until attached, a fresh frontdesk scan with an active override fails closed rather than writing an incorrect snapshot; kiosk and replay do not rely on this trigger. No change to the existing R6/R7 files or rollout runner is included.
- If backing out, retain the journal; prefer an authorized forward change disabling override use and preserving the installed R6/R7 admission definitions. Do not reapply old migrations over the current stack or remove the event journal as rollback.

## App handoff

`GET/PATCH /api/admin/members/[memberCode]/time-override` is separate from profile, payments, and admission. The parent member page was intentionally not edited. To mount the fragment in a separately approved change, gate on staff and member role, load `getMemberTimeOverride(memberCode)` from `src/lib/member-time-override-server.ts` on the server, and pass `{ memberCode, state }` to `AdminMemberTimeOverrideForm.tsx`. Handle an absent migration as unavailable; a successful read with `entitlement: null` means the member cannot be edited. Retry of an uncertain write reuses the exact body and key. No browser or physical scanner acceptance is claimed.

## Isolated checks

```sh
pnpm exec node --test src/lib/member-time-override-server.test.mjs
python scripts/r3-member-time-override-postgres-test.py --bin-dir .local-db/portable-postgres-uat/package/native/bin --psql .local-db/portable-postgres-uat/psql.exe
```

The native runner creates a new SCRAM loopback cluster and synthetic settlements; it never loads application env files, copies production data, or calls a provider. It covers R3 alone, R6 already present, R7 already present, R6/R7 added later, and R6 already present with R7 added later. It is not a production restore, a production-principal ACL rehearsal, or rollout authorization.
