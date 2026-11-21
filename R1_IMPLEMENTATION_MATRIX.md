# R1 Implementation Matrix — BLU FITNESS

วันที่ตรวจ baseline: 18 พ.ย. 2026 — **static source inspection / read-only assessment**

> สำหรับสถานะปัจจุบัน, ผล native PostgreSQL, โค้ดที่ยังขาด และรายการขึ้นระบบ/UAT ให้ดูหัวข้อ **สถานะล่าสุด R1–R8** ใน [TODO.md](TODO.md) ก่อน ตารางด้านล่างเก็บไว้เป็น baseline ไม่ใช่สถานะล่าสุด.

## 1. ขอบเขตและระดับหลักฐาน

- อ่าน `AGENTS.md`, `TODO.md` แผนล่าสุด 17 พ.ย. 2026 (R0–R10) และ `CLIENT_BRIEF_HANDOFF.md` ส่งต่อ 18 พ.ย. 2026 แล้ว ใช้คำยืนยันล่าสุดเหนือเอกสาร/checkbox เก่า
- ไล่ route → server → SQL ใน repository โดยเน้น R3–R7; **verified ในรายงานหมายถึงพบพฤติกรรมใน source ไม่ใช่ผ่าน runtime/UAT หรือยืนยันว่าติดตั้งใน DB แล้ว**
- ไม่เชื่อม DB แม้เพื่อ SELECT, ไม่อ่านข้อมูลฐาน/backup, ไม่เรียก network/provider/SMS/upload, ไม่ใช้ browser, ไม่รัน migration/deploy/import/seed และไม่แก้ implementation
- ไม่รัน tests, TypeScript, lint หรือ build ในรอบนี้ จึงไม่มีผลผ่านของคำสั่งเหล่านี้ รายงานผลเก่าและไฟล์ `.test.*` เป็นเพียงสิ่งอ้างอิงสำหรับรอบถัดไป
- เริ่มด้วย `git --no-optional-locks status --short`: มีงานเดิม `M TODO.md`, `?? CLIENT_BRIEF_HANDOFF.md`; ไม่แตะสองไฟล์นี้ ตรวจ `find src -name AGENTS.md` ไม่พบกฎย่อยใน `src`
- resolve `next/package.json` จาก package ติดตั้งจริงได้ Next 16.3.3 และอ่านต้น guide `dist/docs/01-app/03-api-reference/03-file-conventions/route.md` ผ่าน filesystem เท่านั้น งานนี้ไม่มีการเขียน Next code
- ใช้การอ่านไฟล์/ค้นข้อความในเครื่องเท่านั้น; `rg` ไม่มีใน shell จึงใช้ `grep` แทน ไม่ใช่ผลทดสอบล้มเหลวของระบบ
- **ไฟล์ที่อนุญาตเขียนในงานนี้มีเพียง `R1_IMPLEMENTATION_MATRIX.md`**; ไม่มี commit/branch/push

### สิ่งที่ยัง pending ทั้งหมดในเชิง runtime

สถานะ deployment, migration ที่ apply จริง, function definitions/ACL ที่ติดตั้งจริง, ข้อมูลและความคลาดเคลื่อนจริง, transaction isolation/race, auth integration, UI บนมือถือ/desktop, provider และผลคืนเงิน ไม่สามารถยืนยันได้ด้วย source inspection นี้

## 2. สรุป matrix R1–R10

| รอบ | Verified จาก source | Gap / Pending ตามบรีฟล่าสุด | หลักฐานหลัก |
|---|---|---|---|
| R1 | พบ real server/SQL แยกจาก localStorage mock; มี immutable payment snapshots, catalog version/audit และแหล่งที่มาคูปองบางส่วน | เอกสารนี้เป็นข้อเสนอ ยังไม่ใช่ implementation/checkpoint ผ่าน; schema/ACL จริงและ reconciliation ยังไม่ตรวจ | `src/lib/payment-server.ts`, `src/lib/package-catalog-server.ts`, `src/db/migrations/20261031_package_catalog.sql` |
| R2 | OWNER เปิดทุก admin path; ADMIN เฉพาะ kiosk/checkin/rewards/promo-codes/coupons; finance ตรวจ OWNER ทั้ง server และ SQL | ADMIN ยังเข้า dashboard/members/packages ไม่ได้; ต้องแยก payload เงินก่อนขยายสิทธิ์; person type แยก role/เจ้าหน้าที่แก้โปรไฟล์/reset password ยังต้องตรวจและพัฒนาให้ครบ | `src/lib/admin-permissions.ts`, `src/lib/admin-permissions-server.ts`, `src/lib/admin-members-server.ts`, `src/lib/real-finance-server.ts` |
| R3 | catalog update/ปิดใช้งานมี expectedVersion, requestKey, audit; สร้าง quote ใน SQL และ snapshot version 2 | 10 IDs/2 ช่วงเวลา/OWNER-only; ไม่มี create ใหม่จริง, time override รายสิทธิ์, time supplement; โมเดลสิทธิ์ยังรวมวัน | `src/app/api/admin/packages/route.ts`, `src/lib/package-catalog-server.ts`, `src/db/migrations/20261031_package_catalog.sql` |
| R4 | online purchase/finalize มี ledger และ customer cancel ก่อนส่งสลิปที่ตรวจเงื่อนไขแยก | ไม่พบ staff renewal/0 บาท/backdate/refund รายแพ็กเกจใน route chain ที่ตรวจ; ต้องมี reversal provenance ไม่แก้ยอดรวมลอย ๆ | `src/lib/payment-server.ts`, `src/app/admin/members/[memberCode]/MemberDetailClient.tsx`, `src/db/migrations/20261010_payment_promptpay.sql` |
| R5 | real finance OWNER-only; manual CRUD/version/request/audit/soft-delete; online income UNION จาก PAID | รายได้อิง paid_at ไม่ใช่ confirmed_at; หมวดไม่ครบ, ไม่มี import flow ใน handler นี้, ไม่รองรับ 0 บาท; chart ไม่เติมช่วง 0; export CSV ไม่ใช่ xlsx | `src/lib/real-finance-server.ts`, `src/db/migrations/20261024_real_finance.sql`, `src/app/admin/finance/FinanceClient.tsx` |
| R6 | create/deactivate/grant/cancel/consume จริง; promo assignment/reservation/discount SQL; คูปองจาก PAID ออกใน transaction | ประเภท/เพดานยอด/แพ็กเกจเป้าหมาย/ใบต่อคน/activation/expiry semantics ยังไม่ครบ; grant ไม่จำกัดผู้มีหลัก active; ADMIN ได้ข้อมูล promoOrders เงิน | `src/lib/real-benefits-admin-server.ts`, `src/db/migrations/20261024_real_benefits_admin.sql`, `src/db/migrations/20261025_package_payment_benefits.sql` |
| R7 | frontdesk และ kiosk จริง ตรวจสมาชิก/เวลาจาก SQL มี replay/bounce; history แบ่งหน้า; points=0 | ENTRY_ONLY ไม่มี OUT/pair/duration/visit snapshot/manual datetime/24h report; เลือก PAID ล่าสุดแทน entitlement ณ visit | `src/lib/real-checkin-server.ts`, `src/db/migrations/20261024_real_frontdesk.sql`, `src/db/migrations/20261024_kiosk.sql` |
| R8 | rewards route ต่อ real server/SQL; member detail และ wallet อ่าน DB จริง | reward save รับ URL; upload เดิมจำกัดโปรไฟล์ ไม่ใช่ reward; ประวัติสมาชิกหลายชุด LIMIT 100 ไม่มี paging ใน handler; filters/scanner เก่าใหม่ต้องตรวจเพิ่ม | `src/app/api/rewards/[action]/route.ts`, `src/lib/real-rewards-server.ts`, `src/app/api/upload/route.ts`, `src/lib/real-member-wallet-server.ts` |
| R9 | dashboard มี month filter และ SQL รวมจำนวน/ยอด; finance filter และ CSV จริง | total นับทุกบัญชี/new นับสมัคร, ใกล้หมดอายุ7วันไม่ใช่30; เงินอิง paid_at; กลุ่มสมาชิก/กราฟ/xlsx ทุกหน้าไม่ครบ; ห้ามเปิด dashboard payload นี้ให้ ADMIN ตรง ๆ | `src/lib/admin-members-server.ts:getAdminDashboard`, `src/app/admin/page.tsx`, `src/app/admin/finance/FinanceClient.tsx` |
| R10 | มี test files และ UAT/deployment scripts ให้ใช้ต่อ | **ไม่ได้รันทั้งหมดในรอบนี้**; ยังไม่ผ่าน acceptance, PostgreSQL multi-connection, browser, backup/restore/rollback หรือ production readiness | `src/lib/*.test.mjs`, `scripts/`, `TODO.md:119–127` |

## 3. R3 — route → server → SQL และ gaps

### 3.1 Catalog และ quote จริง

1. `/api/packages` → `src/app/api/packages/route.ts` → `publicPackages()` ใน `src/lib/package-catalog-server.ts` → SELECT `package_catalog_public`.
2. `/admin/packages` → `src/app/admin/packages/page.tsx` → `requireAdminPage()` → `PackageCatalogClient.tsx` → `/api/admin/packages` → `adminPackages()` → `package_catalog_action(list/update)`.
3. `/api/payments/orders` → `src/app/api/payments/orders/route.ts` → `createOrder()` ใน `src/lib/payment-server.ts` → `create_catalog_package_payment_order()` → `create_package_payment_order()` (benefits wrapper) → `create_package_payment_order_before_benefits()` → INSERT `package_payment_orders`.
4. `src/db/migrations/20261031_package_catalog_order_guard.sql` เพิ่ม BEFORE INSERT guard ตรวจ snapshot เทียบ catalog พร้อม SHARE lock; quote ไม่รับราคาจาก browser

**Verified:** catalog SQL มี version increment, stale check, append-only audit และกัน delete/truncate; order replay คืน order เดิมก่อนตรวจ catalog version/availability; snapshot มีราคา/วัน/ช่วง/คูปอง/bonus/catalogVersion/snapshotVersion. การแก้ catalog ไม่เขียน snapshot order เดิม

**Gaps:**
- `src/lib/package-catalog-server.ts:updateSchema`: id 1–10, timeSlot enum 2 ค่า, price >0 และ OWNER-only; ส่ง action `update` เท่านั้น
- `src/db/migrations/20261031_package_catalog.sql`: PK CHECK id 1–10, time_slot CHECK สองค่า; ไม่มี create action; version/audit ที่มีเป็นฐานใช้ต่อได้ ไม่ต้องสร้าง catalog ซ้ำ
- `src/app/admin/packages/PackageCatalogClient.tsx`: tabs/filter/select/validation ยึดสองช่วง; การเปิดรายการที่ปิดไม่เท่ากับสร้าง ID ใหม่
- `src/lib/package-catalog.ts` อิง type `MockPackage`; แม้เป็น type-only ไม่ใช่ mock runtime แต่ต้องปลดข้อจำกัด type/UI พร้อม server/SQL
- ไม่มี override ช่วงเวลาที่อ้างถึงสิทธิ์ที่ซื้อรายรายการใน chain นี้ และไม่มี time supplement activation
- ต้องตรวจ storefront/PaymentModal ทุกจุดก่อนเปลี่ยนรูปแบบ timeSlot; ตรวจพบ quote จริงไม่เรียก `quotePackage()` ที่อ่าน `mockPackages` ใน `src/lib/payment-policy.ts` จึงห้ามนับ mock quote เป็นเส้นทางเงินจริง

### 3.2 สิทธิ์หลัง PAID

`/api/payments/orders/[orderId]/verify` → `verifyOrder()` → claim/evidence → `finalize_package_payment()`; SQL พื้นฐานใน `20261009_real_package_payments.sql`, replacement ใน `20261010_payment_promptpay.sql`, auth patch ใน `20261024_kiosk.sql`, receiver guard patch ใน `20261031_payment_receiver_bank.sql`.

- finalizer lock member ก่อน order, claim transfer reference, เพิ่ม `members.points`, INSERT `package_payment_point_ledger`, ต่อ `members.expire_date` จากวันรวมเดิม และบันทึก `membership_expires_at`
- `paid_at` = เวลาโอนจาก evidence; `confirmed_at` = clock_timestamp เมื่อระบบยืนยัน; สองเวลานี้มีความหมายต่างกัน
- AFTER PAID trigger ใน `20261025_package_payment_benefits.sql` ออก FRIEND_PASS/EXTRA_DAYS ตาม immutable snapshot และ eligibility version; `20261031_package_catalog.sql` ขยายขอบ quota ตาม snapshotVersion โดยไม่ backfill order เก่า
- **ช่องว่าง provenance:** มี expiry ผลลัพธ์รวมแต่ไม่มี entitlement interval แต่ละรายการเป็น entity อิสระ; การต่อวัน/คืนสิทธิ์บาง order จึงห้ามใช้ `expire_date - durationDays` หรือเลือก PAID ล่าสุดเป็นคำตอบทั่วไป
- ต้องอ่าน deployment transformations ด้วย ไม่ถือ migration แรกเป็นนิยามสุดท้าย: `scripts/db-payments-incremental.mjs`, `scripts/db-payments-sql.mjs`, `scripts/db-kiosk-migrate.mjs`; รอบนี้อ่าน source เท่านั้น ไม่ execute scripts เหล่านี้

## 4. R4 — staff renewal / refund / customer cancel

### Verified chain

- `src/app/api/payments/orders/[orderId]/route.ts`: POST → `cancelOrder()`, GET → `getOrder()` ใน `src/lib/payment-server.ts`
- cancel ต้อง same-origin, UUID, `{confirmedNotTransferred:true}`, NORMAL session; transaction lock member/session → order; UPDATE เฉพาะ PENDING **ไม่มี attempt ทุกสถานะ** → REJECTED/CUSTOMER_CANCELLED; replay ได้เมื่อเคยยกเลิกแบบนี้และยังไม่มี attempt
- ห้ามใช้ customer cancel กับ PAID/รายการเคยส่งสลิป; ไม่ใช่ refund และไม่มีคำสั่งเรียก provider คืนเงินใน flow นี้
- `src/db/migrations/20261009_real_package_payments.sql:protect_package_order_snapshot` กัน snapshot update และการแก้ terminal PAID/REJECTED; point ledger เดิม delta >=0 และ order_id PK ไม่ใช่ reversal ledger
- `src/app/admin/members/[memberCode]/MemberDetailClient.tsx` ระบุเป็น read-only และไม่รองรับต่ออายุ/แจกคูปองจากหน้านี้

### Gaps / design constraints

- payment order บังคับ amount >0 และ PAID ต้องมี verified evidence/trans_ref จึง **ไม่ควรฝืนใช้เป็น staff sale 0 บาทหรือทำ fake slip**
- ไม่พบ refund ราย order/staff renewal handler ใน API inventory ที่ตรวจ; owner reject unresolved เป็นคนละกรณีกับยกเลิก PAID
- ต้องเชื่อม sale → income → entitlement → points → coupons ให้ระบุที่มาและย้อนผลเฉพาะรายการได้ พร้อมเวลารับเงินจริง/เหตุการณ์และเวลาบันทึก; ADMIN ปัจจุบันเท่านั้น OWNER ย้อนหลังได้
- ห้ามเปลี่ยนสถานะ PAID เพื่อทำ refund; เพิ่ม cancellation/reversal event แยกแล้วแสดงสถานะเชิงธุรกิจประกอบ PAID
- การใช้คะแนน/คูปองไปแล้วหรือมีสิทธิ์ต่อเนื่องเป็น R0 blocker เฉพาะ destructive reversal; reject/manual review ก่อน ไม่หักสิทธิ์อื่น/ทำคะแนนติดลบเอง
- anomaly ที่ handoff แจ้งว่าเคยถอนสิทธิ์นอก ledger: เป็น **ข้อมูลจากเอกสาร ไม่ใช่ DB verified**; ห้าม backfill/คืนยอด/ยกเลิกซ้ำอัตโนมัติ และไม่คัดลอกข้อมูลสมาชิกเฉพาะรายลงรายงานนี้

## 5. R5 — การเงินจริง

`/admin/finance` → `src/app/admin/finance/page.tsx` → `readRealFinance()` → `real_finance_action(read)`; API `/api/admin/finance/[action]` → `financeAction()` → function เดียวกันใน `src/db/migrations/20261024_real_finance.sql`.

**Verified:** OWNER ทั้ง TS/SQL, NORMAL/revoked/expiry/status checks ใน SQL; manual create/update/delete มี requestKey replay, version, audit, soft-delete; read UNION manual กับ PAID order โดยใช้ prefix `package:` ไม่ copy ยอดขายลง manual table

**Gaps:**
- online date ใช้ `(paid_at AT TIME ZONE 'Asia/Bangkok')::date` ไม่ใช่ confirmed_at; dashboard ก็ filter paid_at ต้องเปลี่ยน report policy ไม่ rewrite payment timestamps
- manual SQL/UI categories ยังมีเพียงรายได้อื่น/ประจำเดือน/อุปกรณ์/เงินเดือน/รายจ่ายอื่น; ไม่มี commission/depreciation/renewal/new/cancellation ครบตามบรีฟ
- TS amount >0 / SQL amount_satang >=1 ไม่มี 0 บาท; ไม่มี sale source/member linkage สำหรับ staff renewal ใน manual entries
- handler รองรับ read/create/update/delete เท่านั้น ไม่มี preview/import batch/idempotency รายแถว; ต้องเพิ่ม dedicated OWNER import flow ไม่วนเรียก create แบบไม่มี batch provenance
- `FinanceClient.tsx:groupChart` group เฉพาะข้อมูลที่มี ไม่สร้างวัน/เดือนยอด 0; export เป็น CSV (`exportCsv`, `.csv`) จริง ไม่ใช่ .xlsx
- read ส่ง records/audit ทั้งชุดและกรอง client; ต้องกำหนด server filter/pagination/export bounds เมื่อข้อมูลมาก โดย export ยังครบ filter ไม่ใช่เฉพาะ page
- refund ต้องเพิ่มรายการ reversal อ้าง sale เดิม แยกการคืนเงินนอกระบบกับ cancellation สิทธิ์ ไม่ double-count gross/net และไม่แก้ประวัติยอดขายเดิม

## 6. R6 — benefits / promo / wallet จริง

### Chains ที่ตรวจ

- `/api/admin/benefits/[action]` → `benefitsAdminAction()`/`benefitPayload()` ใน `src/lib/real-benefits-admin-server.ts` → `real_benefits_admin_action()` ใน `20261024_real_benefits_admin.sql`
- promo ตอนสร้าง order อยู่ใน SQL wrapper `create_package_payment_order()`: lock definition, ตรวจ assignment/ขั้นต่ำ/expiry, คำนวณ FIXED/PERCENT/cap แล้วส่ง quote ต่อ; reservation ผูก order/assignment
- quota รวมของ promo ตรวจใน creator เดิมด้วย advisory lock; PAID และ PENDING ที่ยังไม่ปลอดภัยนับเป็น reserved/used; PROCESSING/UNKNOWN/VERIFIED ไม่ถูกปล่อย quota เพียงเพราะหมด upload deadline
- `/api/member/coupons/redeem` → `redeemWelcomeEntry()` ใน `src/lib/benefits-server.ts`: atomic UPDATE WELCOME_REGISTRATION/FREE_ENTRY แล้ว INSERT checkins points=0 ใน transaction; **เป็น welcome entry ไม่ใช่ time supplement**
- `/api/member/wallet` → `getRealMemberWallet()` ใน `src/lib/real-member-wallet-server.ts` → SQL อ่าน purchases/checkins/coupons/payment+reward point ledger

### Gaps สำคัญ

- definition COUPON จำกัด FRIEND_PASS/EXTRA_DAYS; ยังไม่มี gift/free item/points/other/time window และหน่วย/เงื่อนไขครบ
- promo มี minSatang/maxDiscountSatang แต่ไม่มี maximum purchase amount และ allowed package IDs ใน payload/schema/function นี้
- assignments UNIQUE(definition_id,member_id) = หนึ่ง assignment ต่อคน; coupon quota คือจำนวนใช้ในแถวเดียว ไม่ใช่ N ใบต่อคนแยกจากครั้งต่อใบและจำนวนผู้รับรวม
- grant ตรวจเพียงสมาชิกมีจริง/ไม่ SUSPENDED ไม่ตรวจ active primary entitlement; ไม่รองรับ preview กลุ่มแพ็กเกจปัจจุบันพร้อมยืนยัน batch ตามบรีฟ
- definition มี expires_at บังคับ แต่ไม่มี activated_at/use duration/campaign expiry แยกชัด; ห้ามถือ expires_at เดียวว่ารองรับช่องว่าง/0=10นาทีแล้ว
- consume EXTRA_DAYS เพิ่ม `members.expire_date` รวมและบันทึกก่อน–หลังใน benefit_consumptions แต่ยังไม่ผูก effect กับ entitlement ที่ได้รับวันจริง
- **R2 leakage ที่ต้องจัดการก่อนขยายสิทธิ์:** action list ให้ ADMIN ได้ และ SQL ส่ง `promoOrders` ที่มี amount_satang/discount_satang รวมถึง audit/results; ไม่ใช่การเงินเฉพาะรายการที่กำลังทำ ต้องสร้าง role-specific projection/filter ที่ SQL/server ไม่ใช่ซ่อน UI
- list ตัด assignments/coupons/promoOrders ที่500 และ audit100; wallet histories100 ไม่มี cursor ใน handler; ยังไม่ครบ all-history/filter/export
- preserve package_benefits_version=NULL ของ legacy orders; ห้ามแจกย้อนหลังใหม่เพราะปรับ catalog/migration

## 7. R7 — front desk / kiosk / visit history จริง

1. `src/app/admin/checkin/page.tsx` → POST `/api/admin/checkin/{scan,members,history}` → `src/lib/real-checkin-server.ts:realCheckinAction()`.
2. scan → `real_frontdesk_checkin()` ใน `src/db/migrations/20261024_real_frontdesk.sql`; history/members ใช้ inline SQL พร้อม authorization EXISTS ใน statement.
3. `/api/kiosk/[action]` → `src/lib/kiosk-server.ts:kioskAction()` → `kiosk_checkin()` ใน `src/db/migrations/20261024_kiosk.sql`; แยก KIOSK session จาก NORMAL staff flow.

**Verified:** request replay ต่อ station/requestKey, กัน key เปลี่ยน code, member lock, 3-second bounce ต่อ station/member, Bangkok clock, status/expiry gate; INSERT checkins points_awarded=0; frontdesk history 50+1 แถว/หน้า และ member lookup code/name/phone

**Gaps:**
- ทั้งสอง SQL เลือก `package_snapshot.timeSlot` จาก PAID ล่าสุด ORDER BY paid_at แล้วตรวจ `members.expire_date` รวม; ไม่มี entitlement interval/override/supplement ณเวลาเข้า
- hardcode เปิด07:00–22:00 และสอง timeSlot; ปัจจุบันใช้ `>` ขอบ14:00/22:00 จึงยังยอมตรงเวลา endpoint ต้องกำหนด interval policy ก่อนแก้ ไม่อ้างว่าเป็น half-open อยู่แล้ว
- INSERT เก็บ member/scanner/device/notes แต่ไม่เก็บ entitlement FK/package/time snapshot; notes ไม่ใช่ structured provenance และไม่ควร parse มาอ้างประวัติที่แน่นอน
- ENTRY_ONLY ไม่มี OUT FK/pair/ออกก่อนเข้า/duration/manual service type/backdated owner override
- query history มี query/page ไม่มี from/to datetime และไม่มี hourly24 aggregation; member lookup โทรได้ แต่ scan รับ BLU เท่านั้นใน handler ที่ตรวจ ไม่ยืนยัน camera/CARD ว่าครบ
- WELCOME self-service ก็สร้าง checkins: ต้องแยก service source ก่อนนับ physical visits ไม่รวมทุก checkins เป็นประตูเข้าโดยไม่อธิบาย
- `src/lib/admin-service.ts`, `src/lib/front-desk.ts`, `src/lib/admin-finance.ts` มี localStorage/mock features; ไม่ใช่หลักฐานว่าหน้า checkin/finance จริงมี manual IN/OUT หรือรายงานเหล่านั้น

## 8. ข้อเสนอ additive provenance model (ยังไม่ implement)

ใช้ catalog/payment/coupons/ledgers เดิมเป็นฐาน เพิ่มเท่าที่จำเป็น ไม่สร้าง storefront/accounting engine อีกชุด ชื่อตารางต่อไปนี้เป็น **ชื่อเสนอ ไม่ใช่ตารางที่ยืนยันว่ามีแล้ว**

| ส่วนเสนอ | ข้อมูล/ข้อบังคับขั้นต่ำ | สิ่งที่ต้องรักษา |
|---|---|---|
| `staff_package_sales` | member, actor, requestKey+payload identity, amount_satang >=0, payment_method จริง, occurred_at/recorded_at, reason, immutable package snapshot/version | แยก online order ที่ต้องมี bank evidence; 0 บาทไม่สร้าง fake bank transaction; SQL ตรวจ OWNER เมื่อย้อนหลัง |
| `membership_entitlements` | member, source online_order/staff_sale/approved_legacy, source FK, starts_at/ends_at, granted_days, immutable time/package/benefit snapshot, provenance quality | UNIQUE online_order หรือ staff_sale; [start,end) ไม่ต่อวันจาก catalog ปัจจุบัน; aggregate expire_date เป็น compatibility projection ไม่ใช่ source of truth |
| `entitlement_events` | entitlement FK, event type override/cancel/bonus-day effect, before/after หรือ typed effect, effective_at/recorded_at, actor/reason/requestKey/version | append-only; time override ไม่แก้ราคา/ของแถม/วันเดิม; ยกเลิกเป็น event ไม่ rewrite PAID |
| coupon source links / `coupon_activations` | reuse coupons/definitions/assignments; typed source entitlement/sale FK, activated_at, expires_at, Bangkok local_date, primary_entitlement_id, window snapshot | ไม่ยัด time supplement เป็น EXTRA_DAYS; รักษา source strings เดิมแล้วเพิ่ม typed linkage เฉพาะที่พิสูจน์ได้ |
| `package_cancellations` + point reversals | sale/entitlement FK, original award FK, delta กลับรายการ, external refund amount/reference/recorded_at, actor/reason/idempotency | ไม่เปลี่ยน order.status=PAID; ไม่แก้ point award เดิม; UNIQUE original award + reversal scope ป้องกันถอนซ้ำ; ไม่ติดลบโดยพลการ |
| finance provenance extensions | source_kind/source_id, event/recorded time, reversal_of, import_batch/import_row identity | online รายได้อ่าน confirmed_at ตาม reporting policy; ไม่ copy PAID เข้ารายได้ซ้ำ; staff sale/import/manual/reversal แยกชัด |
| visit extension/link | checkin_id, entitlement_id/activation_id, package+effective window snapshot, source, entered_at/exited_at, out event FK, note/actor/effective/recorded time | reuse checkins เป็น IN เดิมได้; OUT ต้องอ้าง IN สมาชิกเดียวกัน UNIQUE ต่อ IN, out>=in; legacy exit NULL ไม่แต่งเวลาหรือ entitlement |
| import batches/rows | template_version, checksum/business identity, preview errors, row source IDs, actor, applied counts | OWNER-only; apply atomic หรือมีสถานะ per row ชัด; retry ไม่ลงบัญชีซ้ำ; rollback แบบ cancellation events |

### เวลาและ activation

- เสนอเก็บช่วงวันเป็น start_minute/end_minute CHECK `0 <= start < end <= 1440`; 24:00 ใช้1440 ไม่บีบเป็น00:00วันเดียวกัน; UI รับ HH:mm; timezone Asia/Bangkok; ไม่ข้ามคืน และต้องตกลงขอบเวลาร่วมกันทุก consumer
- online entitlement ใหม่ต้องใช้เวลาที่ finalizer รู้ก่อน/หลัง expiry ใน transaction เพื่อเก็บ interval จริง ไม่อนุมานจาก PAID ล่าสุดภายหลัง; การต่อเรียงช่วงเป็น policy ที่ต้องทวนก่อนใช้กับหลายแพ็กเกจต่างเวลา
- time supplement: มีหลัก active, กดภายใน window ของวันนี้, หัก1สิทธิ์ครั้งเดียว; expires_at=min(เวลาปิด window วันนี้, primary ends_at, campaign expiry หากกติกานั้นมีผล); ไม่ต่อวัน/เปลี่ยนหลัก
- replay active activation คืน record เดิม **ก่อนตรวจ remaining quota**; ต่อให้ใช้ requestKey ใหม่ขณะ activation เดิม active ก็ต้องไม่หักเพิ่ม; ใช้ lock/unique active scope ที่ออกแบบสำหรับ member+primary+สิทธิ์นั้น ไม่ใช้ partial index ที่ predicate พึ่ง now()
- campaign expiry/use duration ทั่วไปและ 0=10นาที ยังรอ R0; ห้ามขยายสมมติฐาน time supplement ไปตัดสินคูปองทุกประเภท

### Transaction / auth / integrity

- staff sale, income source, entitlement, points, coupon issuance และ audit ต้อง commit/rollback ด้วยกัน; online entitlement issuance เพิ่มใน PAID transaction โดยรักษา evidence checks/terminal replay เดิม
- กำหนด lock order ร่วมกันจาก call graph จริงก่อน implementation; ปัจจุบัน payment และ benefits/checkin บาง flow เริ่ม locks ต่างลำดับ จึงไม่อ้างว่าระบบมี global order ปลอด deadlockแล้ว
- auth/session recheck ภายใน SQL, fixed search_path, backend-only ACL; requestKey ผูก action+actor+canonical payload ปฏิเสธ key เดิม payload ใหม่; uniqueness ที่ source/effect กันคนละ key แล้วเกิดผลซ้ำ
- ใช้ integer satang, timestamptz และ server clock; SQL constraints/FKs/append-only audit กันการยิงตรง ไม่พึ่ง UI validation
- ADMIN response ต้องไม่ serialize aggregate money/ประวัติเงินทุกคน; OWNER-only backdate/cancel/import; override เวลา ADMIN/OWNER ตาม scope พร้อมเหตุผล

## 9. Migration / compatibility / rollback plan (เสนอเท่านั้น)

1. **ก่อนแตะฐาน:** ขออนุมัติแยก ตรวจ installed function definitions/constraints/ACL/migration hashes, inventory writers, backup พร้อม restore verification ใน isolated environment; รอบนี้ยังไม่ทำทั้งหมด
2. เพิ่ม migration ไฟล์ใหม่แบบ expand-only พร้อม schema_version/feature gate; ไม่แก้ migration ที่ apply แล้ว ไม่ drop snapshot guard ไม่ rewrite PAID/PENDING quotes/evidence/point awards/legacy eligibility
3. ขยาย catalog ID/ช่วงเวลาและ create action แบบ versioned พร้อม UI/API/SQL/quote/insert guard/checkin consumers ที่รองรับ; คง legacy snapshot parsers สองช่วงเดิม ห้ามสร้าง order รูปแบบใหม่ก่อนทุก consumer พร้อม
4. เพิ่ม entitlement/source/audit/reversal/visit structures และ guarded issuance hook ใน PAID transaction; baseline guard ต้องตรวจ trigger/function เดิมก่อน replace ใด ๆ ไม่เอา raw migration เก่าทับ auth/receiver/currency fixes
5. **Legacy mapping ไม่ใช่ auto-backfill ทั้งหมด:** package_snapshot, confirmed_at, membership_expires_at, durationDays เป็น evidence บางส่วนเท่านั้น; มี bonus/manual adjustment/anomaly ทำให้ interval ย้อนหลังไม่แน่นอน ต้อง classify verified/ambiguous/legacy-unresolved และเก็บ reconstruction version/evidence reference ไม่แต่งวันเริ่มหรือ audit ของเหตุการณ์ที่ไม่ได้บันทึกจริง
6. ช่วงเปลี่ยนผ่านใช้ shadow reconciliation แบบไม่ให้สิทธิ์ซ้ำ; dual-write เฉพาะธุรกรรมใหม่ใน transaction เดียว ไม่ให้สองระบบเพิ่ม points/expiry/coupons แยกกัน; legacy fallback มี scope/เหตุผลชัดและไม่ทำ ambiguous row กลายเป็น active grant อัตโนมัติ
7. ตัด read path ไป provenance เมื่อ reconcile ผ่าน fixtures และ migration rehearsal; จำกัด destructive refund เฉพาะ source ที่พิสูจน์ครบ นอกนั้น pending OWNER review ไม่ลบสิทธิ์เดา ๆ
8. report confirmed_at เป็น policy/version ใหม่ โดยคง paid_at เดิมและแยก historical reporting impacts; ห้ามเติม finance copy row ให้ PAID แล้ว UNION ซ้ำ
9. **Rollback ก่อนเปิด writers ใหม่:** ปิด feature/revert app ได้หากไม่มี new-format data; retain additive tables/audit. ตรวจ pending order ใหม่/เก่าก่อนคืน consumers เวอร์ชันเดิม
10. **Rollback หลังมีธุรกรรมใหม่:** ไม่ drop tables/reverse PAID/ลบ grants/restore ทับฐานจริงทันที; pause affected writers, ใช้ compatibility reader ที่ยังอ่าน new-format entitlements/cancellations ได้ แล้ว forward-fix หรือ compensating events ที่อนุมัติ การกลับไป checkin PAID ล่าสุดเดิมอาจคืนสิทธิ์ที่ยกเลิกแล้ว จึงไม่ใช่ safe rollback
11. import rollback ใช้ batch-linked cancellation/reversal ตรวจไม่มี downstream use; กรณีใช้แล้ว/คะแนนไม่พอ/แพ็กเกจต่อเนื่อง block ตาม R0; เก็บ audit ตลอด

## 10. แผนทดสอบและ acceptance — **Pending / ยังไม่รัน**

| ชุด | Cases / invariant ที่ต้องพิสูจน์ | จุดอ้างอิงสำหรับเริ่มต่อ |
|---|---|---|
| Catalog/quote | >10 IDs, arbitrary single window, create/update/deactivate, stale version, client price tamper, new snapshot, old PENDING/PAID byte-equivalent, replay หลังปิดแพ็กเกจ | `src/lib/package-catalog-server.test.mjs`, `src/lib/package-catalog-sql.test.mjs`, `src/lib/package-catalog-order-guard.test.mjs` |
| Payment regression | receiver/amount/currency/duplicate/auth, cancel ก่อน attempt, race cancel-vs-claim/finalize, PROCESSING/UNKNOWN/VERIFIED ไม่คืน quota, replay ไม่เพิ่มสิทธิ์/แต้ม/คูปองซ้ำ | `src/lib/payment-server.test.mjs`, `src/lib/payment-policy.test.mjs`, `scripts/payment-sql-tests.mjs` |
| Entitlement/refund | sale0บาทไม่มี slip/provider, ADMIN no-backdate/OWNER backdate, cancel source เดียวไม่ลบอื่น, consumed coupon/insufficient points/next entitlement ถูก block, immutable PAID และ compensating ledger reconcile | ต้องเพิ่ม fixtures/tests สำหรับโมเดลใหม่; `src/lib/package-payment-benefits.test.mjs` ใช้เป็น regression เดิม |
| Activation | ไม่มีหลัก/หมดอายุ/นอกwindow/วันไทยข้ามวัน, 00:00/24:00, quotaสุดท้าย, keyเดิม/ใหม่ retry, clickพร้อมกันต่างconnection, cancel/expiryหลักชนactivate/checkin | `src/lib/benefits-coupons.test.mjs`, `src/lib/real-benefits-admin-server.test.mjs` และ isolated PostgreSQL suite ใหม่ |
| Finance/import | confirmed_at vs paid_at ข้ามเดือนปี, sums/table/chart/exportตรง, missing periods=0, staff0บาท, duplicate order/import, preview invalid rows, rollback batch, soft cancel และ permissions | `src/lib/real-finance-server.test.mjs`; เพิ่ม import/xlsx/report fixtures |
| IN/OUT | หลายรอบ/ซ้ำ/OUTไม่มีIN/สมาชิกผิด/ออกก่อนเข้า, selected entitlement+window snapshotคงเดิมหลังcatalogเปลี่ยน, manual OWNER audit, legacy OUT=NULL, no checkin points | `src/lib/real-checkin-server.test.mjs`, `src/lib/kiosk-server.test.mjs`, `scripts/kiosk-sql-tests.mjs` |
| Auth/PII | MEMBER/ADMIN/OWNER direct URL/API/export, revoked/suspended/KIOSK vs NORMAL, ADMINไม่มี aggregate/promo monetary history, ข้อมูลสมาชิกไม่รั่ว | `src/lib/admin-permissions.test.mjs`, `src/lib/admin-members-server.test.mjs` และ integration tests ใหม่ |
| R8/R9 | pagination >100/>500, filterทุกแถว, xlsxจริง/formula injection/limits, reward upload type-size-auth, reward codeเก่าใหม่/ส่งมอบซ้ำ, buyer-based statisticsตามR0 | `src/lib/real-member-wallet-server.test.mjs`, `src/lib/real-rewards-server.test.mjs`; source existence ไม่ใช่ผลผ่าน |
| Migration/rollback | isolated snapshotก่อน–หลัง, row counts/checksums PAID/evidence/ledgerไม่เปลี่ยน, grantsตรงหนึ่งครั้ง, restore rehearsal, old/new app compatibility และ cancelled entitlementไม่ฟื้นหลังrollback | `scripts/db-tools.test.mjs`, `scripts/db-payments.test.mjs`; ห้ามรัน deployment scripts กับฐานจริงโดยพลการ |

ก่อนรันต้องอ่าน test harness/side effects และใช้ isolated fixtures/environment ที่ไม่โหลด production credentials/provider; SQL race ต้อง PostgreSQL หลาย connections ไม่ใช้ WASM หรือ source-regex tests อย่างเดียวอ้างพร้อม production จากนั้นค่อย targeted tests → TypeScript/lint → broader regression → browser UAT ตาม approval แต่ละขั้น

## 11. Blockers / ลำดับถัดไป

1. ทวนแบบ additive และเงื่อนไข PAID-preservation กับผู้ใช้ก่อนลง implementation; เอกสารนี้ไม่เปลี่ยน checkbox TODO เป็นผ่าน
2. R2 payload partition ก่อนเปิด ADMIN dashboard/members/packages; ปิดช่อง list benefits ส่งยอดเงินที่เกินงานรายการนั้น
3. R3 catalog/time/provenance เป็นฐานให้ R4 cancellation, R6 supplement และ R7 visit snapshot; แยกทำ checkpoint ไม่รวบ migration ทุกระบบในครั้งเดียว
4. R0 ยังต้องตอบ: นิยามกลับเกิน3เดือน/90วันหรือเดือนปฏิทิน/คนหรือครั้ง/พ้นสภาพและวันอ้างอิงใกล้หมดอายุ; reversal ของสิทธิ์ใช้แล้ว/แต้มไม่พอ/แพ็กเกจต่อเนื่อง; coupon expiryชนactivationและbonusคะแนน; วงกลมเดิม/ขอบ14:00
5. รายการไม่ถูก block เดินต่อได้ แต่ **ไม่มีอนุมัติในรายงานนี้สำหรับแก้โค้ดอื่น, แตะ DB/network/provider, migration, refund จริง หรือ deploy**

**ข้อสรุป:** ฐานเงินจริง/benefits/checkin เป็น real routes แล้ว ไม่ใช่ mock ทั้งระบบ แต่ R3–R7 ยังมี model gap ด้าน provenance, เวลาสิทธิ์รายรายการ, staff/refund และ IN/OUT ที่กระทบกันโดยตรง ต้องแก้ด้วย additive source-linked records และ compatibility plan ไม่แก้ยอดรวม/PAID snapshots เพื่อทำให้ดูตรงบรีฟ
