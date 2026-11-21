# R6 checkout coupons — prepare only

Append `20261203_R6_checkout_coupons.sql` after `20261201_R6_coupon_campaigns.sql` and the R3 catalog bonus / R4 online cancellation chain (`20261119_r3_package_bonus_points.sql`, `20261125_R4_online_cancellation.sql` and their prerequisites). The install updates compatible invoker function bodies and extends the R4 active-paid projection. No historical purchases, coupon uses, or ledger rows are rewritten. Do not rerun the older function/view definitions on top of this migration.

## Feature and operations

- Enable the server-only `R6_CHECKOUT_COUPONS_ENABLED=true` **after** the schema/ACL checks on an isolated deployment. The coupon checkout entry point does not fall back to a full-price order on schema mismatch. Ordinary checkout and existing promo codes do not require the flag. Once placed, an order can still settle or cancel under the existing payment controls even when the flag is off.
- ADMIN/OWNER can create a discount or points campaign from `/admin/coupons` once the flag and checkout migration are detected. The form uses `POST /api/admin/benefits/create-checkout-campaign` (normal ADMIN/OWNER session, same-origin JSON). Example shape (synthetic only):

```json
{
  "requestKey": "0dfb7145-6d61-4fe7-8c29-2ceccbbd9061",
  "campaignCode": "CHECKOUT5",
  "campaignKind": "DISCOUNT",
  "title": "5% package discount",
  "description": "Synthetic example",
  "checkoutUnit": "PERCENT",
  "checkoutValue": 5,
  "checkoutCap": 10000,
  "usesPerCoupon": 1,
  "perMember": 1,
  "total": 20,
  "activationDurationMinutes": null,
  "expiresAt": "2099-01-01T00:00:00+07:00"
}
```

- Fixed discount uses `SATANG` (`100` = ฿1). Percent is a whole number and floors to satang. Discount cap is satang; `POINTS` campaigns use unit `POINTS`, with value/cap in whole points. Use `null` for no cap. A zero or non-positive payable amount is rejected rather than converted to a free sale. No coupon balances, cash, payout, points spending, or retroactive award.
- Use the existing targeted preview/grant flow and wallet activation. The existing total leaves, leaves per member and uses per leaf remain independent. Deactivation stops new issues; issued leaves obey their own deadline. Eligibility is the existing R6 provable active package subset, not all renewal/staff term histories. One coupon or promo code per order, never both. Checkout lists up to 100 eligible leaves, newest first; it does not show package-specific promo scope or pre-price client-side.
- Coupon validity is checked and the value locked at order creation. The existing transfer/upload windows and verified amount apply; expiry after reservation does not reprice an order. The existing money-based point formula uses the net paid amount; configured package and coupon bonuses add to that award in the same ledger row. `PAID` consumes once, writes wallet history and records the original order/value. Post-settlement cancellation of coupon orders stays blocked for manual review, with no automatic refund or changes to entitlements.
- A reservation is released only on explicit `CUSTOMER_CANCELLED` with zero slip attempts. Upload expiry, uncertainty, provider failure and OWNER-reconciled rejection do not release it in this slice. There is no automated recovery/reissue for those cases. A held reservation cannot be removed through staff coupon cancellation.

## Deployment checklist (not executed)

Grant `EXECUTE` to the existing trusted invoker runtime role only for `public.r6_create_checkout_coupon_order(uuid,integer,text,uuid,jsonb,jsonb)`, `public.r6_checkout_coupon_options(integer,text)`, and `public.r6_checkout_coupon_held(integer)`. New routines are revoked from `PUBLIC`. Verify existing runtime rights for catalog creators, member/session/assignment/definition/coupon locks, order and attempt reads, coupon updates, and insertion into `benefit_consumptions` including its sequence. Verify view/function grants under the actual runtime role, and smoke-test staff creation, grant, activation, checkout, no-transfer cancellation and verified settlement on an isolated stack before enabling. Prefer a forward fix if orders have been issued; do not drop the snapshot columns or restore legacy order functions over coupon history.

Windows native test (disposable SCRAM loopback PostgreSQL with synthetic members and slip evidence):

```sh
python -B scripts/r6-checkout-coupons-postgres-test.py --bin-dir .local-db/portable-postgres-uat/package/native/bin --psql .local-db/portable-postgres-uat/psql.exe
```

Browser/provider/physical scanner acceptance and the combined R347 stack were not tested by this slice.
