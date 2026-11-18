# R10 — combined prepared migrations checkpoint

18 พ.ย. 2026 — offline ONLY / prepare-only / ไม่ใช่ production acceptance

## Write scope

เพิ่มเฉพาะ `src/lib/brief-combined-migrations.test.mjs` และเอกสารนี้ ไม่แก้ production, migrations, TODO หรืองานเดิม ไม่มี install/network/env loading/DB จริง/provider/commit/deploy

อ่าน AGENTS, TODO ส่วนสถานะ/R0–R10, CLIENT_BRIEF_HANDOFF, R1 matrix, R4 handoff, migration README, R3/R6/R7 runbooks, catalog deployment doc, SQL R3–R7 และ tests/fixtures ที่เกี่ยวข้อง รวม Next testing guides จาก package ที่ติดตั้ง

## Harness / ลำดับจริง

- ใช้ PGlite ที่ติดตั้งแล้ว: resolve root ก่อน fallback `.local-db/payment-sql-tests/package.json`; สร้าง `new PGlite()` แบบ in-memory ไม่มี data directory ถ้าขาด dependency ให้ fail ไม่ skip/download
- reuse schema SQL จาก `package-payment-benefits.test.mjs` โดยอ่าน text ไม่ import ให้ suite อื่นรันแฝง
- actual legacy chain: `20261009_real_package_payments` → `20261010_payment_promptpay` → `20261024_kiosk` → `20261024_real_benefits_admin` → `20261024_real_rewards` → `20261024_real_frontdesk` → `20261024_real_finance` → `20261025_package_payment_benefits`
- deployment-security fixture ตาม existing R3/R6/R7 tests: revoke PUBLIC execute/pin search_path ของ public functions **เป็น fixture ไม่ใช่การรัน live deployment runner หรือ auth migration ทั้งระบบ**
- actual October chain: receiver_bank → currency_recheck → package_catalog → package_catalog_order_guard
- ซื้อ legacy PAID ผ่าน catalog/claim/finalizer จริงก่อน R3–R7 พร้อม legacy checkin
- apply SQL files โดยไม่ rewrite/strip guards: R3 catalog → R3 checkin → R4 provenance → R5 finance → R6 supplement → R7 visits

Auth/password-welcome migrations ไม่อยู่ใน harness นี้: base schema จำลองส่วน prerequisite ที่ tests เดิมใช้ จึงไม่อ้าง complete auth/bootstrap rehearsal หรือ production-installed ACL validation

## สิ่งที่ combined test พิสูจน์

1. Legacy members/orders/point ledger/coupons คงเดิมหลัง migrations; ไม่มี R4 backfill; replay finalizer เก่าไม่มี effects เพิ่ม
2. ซื้อใหม่หลังติดตั้งทุก migration ผ่าน actual catalog + finalizer เป็น PAID, ledger ตรง observation ทั้ง identity/delta/balance/confirmed_at/snapshot; terminal replay ไม่เพิ่ม effects
3. ห้ามแก้ paid snapshot และ observation update/delete/truncate; catalog edit ไม่เปลี่ยน paid snapshot ไม่ disable triggers หรือ rewrite historical snapshot เพื่อทำเคสผ่าน
4. R5 income หนึ่งรายการต่อ PAID order ไม่มีรายได้ซ้ำจาก provenance/supplement/visit; amount ตรง order และวันเท่ากับ confirmed_at ใน Bangkok; synthetic paid_at ก่อน confirmed_at หนึ่งนาที ไม่รับหลักฐานเก่าหลายปี
5. ขาย off-peak slot จริงก่อน settle แล้วแก้ catalog เป็น all-day: checkin ยัง OFF_PEAK จาก paid snapshot; staff grant/member activate จริงจึงเข้า R7 ได้ พร้อม snapshot main/off-peak + used/all-day + coupon identity
6. Grant/activate/IN/OUT sequential UUID replay ไม่ใช้สิทธิ์ซ้ำ; grant key เปลี่ยน payload ถูก reject; repeated IN ไม่เปิดซ้อน/OUT ไม่ลอย; exit>=entry; visit snapshot immutable; legacy checkin ไม่ถูกแต่ง exit
7. R6 strict guards: member grant ไม่ได้, extra price/client activation time ถูก reject, no-main/aggregate expiry mismatch/second lifetime PAID ถูก reject; purchase ใหม่ทำให้ active supplement fail closed
8. Supplement audit/request และ visit requests append-only; coupon used_count=1, activation หนึ่งรายการ; grant/visit ไม่เปลี่ยน members/points/orders/ledger หรือ package-issued coupons
9. Inject BEFORE INSERT failure ที่ R4 observation แล้ว finalize ใหม่: rollback members/ledger/coupons/PAID/observation ทั้งชุด ยังคง pending order/verified attempt จาก statement ก่อน finalize ตามจริง ไม่อ้าง rollback ข้าม statements

## Validation ที่รันจริง

```sh
node --test src/lib/brief-combined-migrations.test.mjs src/lib/entitlement-online-provenance.test.mjs src/lib/real-finance-r5.test.mjs src/lib/time-supplement.test.mjs src/lib/real-checkin-r7.test.mjs src/lib/package-catalog-r3.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/lib/brief-combined-migrations.test.mjs
```

- Final regression: **14 passed / 0 failed / 0 skipped**, รวม combined test ใหม่หนึ่ง test ที่มี ordered assertions; ไม่ใช่ 14 independent combined scenarios
- TypeScript ผ่าน (`--incremental false` ไม่เขียน tsbuildinfo); scoped ESLint ผ่าน
- ช่วงพัฒนา harness เคย fail เพราะ synthetic paidAt เก่าเกิน payment evidence guard; เปลี่ยน fixture เป็นเวลาปัจจุบันลบหนึ่งนาที ไม่ผ่อน guard ส่วน expected SQL error ใน explicit transaction ต้องเป็น assertion สุดท้ายก่อน rollback เพื่อไม่อ่านต่อบน aborted transaction แก้เฉพาะ test
- ไม่พบ production bug ใน cases ที่รัน ไม่มีการ skip/xfail เพื่อกลบปัญหา หากเจอภายหลังให้เก็บ failing case/report exact SQL issue และหยุด affected path ไม่ bypass migration/trigger

## ข้อจำกัด / ยังไม่อนุญาต rollout

PGlite หนึ่ง engine; replay เป็น serial เท่านั้น ไม่ claim concurrency, lock scheduling, race/deadlock หรือหลาย PostgreSQL connections แม้ tests เดิมมี Promise.all ก็ไม่ใช่หลักฐาน concurrency จริง

Combined finance runtime case ตรวจวันจาก confirmed_at จริง แต่ paid_at/confirmed_at อาจวันเดียวกัน; deterministic ข้ามวัน/ปีอยู่ใน R5 regression แยกซึ่งใช้ payment-table fixture ไม่ใช่ actual settlement ข้ามวันใน combined chain

ยังไม่ตรวจ named non-owner backend ACL, production schema/history/hash, auth bootstrap จริง, browser/hardware, provider, restore หรือ deployed PostgreSQL compatibility; ใช้ synthetic evidence เฉพาะ in-memory ไม่มี provider verification จริง

R4 ยังเป็น shadow observation ไม่ใช่ entitlement authority; R6 ยัง standalone-main เท่านั้น; R7 ยัง admin pairing ไม่ใช่ kiosk mixed-channel pairing ไม่ปิด R0/staff renewal/0บาท/refund/import/manual override หรือ checkpoint ทั้งบรีฟ ต้องขออนุมัติงาน DB/backup/restore/deploy แยกเสมอ
