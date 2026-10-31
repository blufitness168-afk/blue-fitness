# ชำระแพ็กเกจจริง — deployment / security runbook

## ล่าสุด 2026-10-31 — กู้สลิปที่ติดบั๊ก currency764

- `payment-policy.ts` รับTHB/'764'/764แล้วโดยตรวจamountเหมือนเดิม ไม่ลดreceiveridentity/เวลา/duplicatepolicy
- Apply `20261031_payment_currency_recheck.sql` ด้วย `scripts/db-payment-currency-recheck.mjs` หลังreceiverbankfixแล้ว; อ่านtargetจาก.env.localที่ผู้ใช้ใช้เป็นproductionconfig, backup `.local-db/backup-2026-10-31T12-19-18.712Z`, data30tablesและfunctionsเดิมไม่เปลี่ยน
- Ownerเปิดmodalพบpendingเดิม→เลือกไฟล์สลิปเดิม→กดปุ่ม **OWNER: ตรวจสลิปเดิมอีกครั้งหลังแก้สกุลเงิน (1 ครั้ง)**→ยืนยันใช้โควตา1ครั้ง ปุ่มเรียกprepareauditและverifyreconcileตามลำดับ ต้องdeploywebcodeล่าสุดก่อน
- แค่installfunctionไม่เปิดattemptและไม่ตรวจprovider; ห้ามreopenด้วยUPDATEตรงหรือsetPAID ผู้ใช้อนุญาตquotaเพิ่มแล้วแต่ต้องใช้sessionและfileจริงในbrowser ไม่ใช้JSONจากแชตเป็นหลักฐานsettlement
- งบOWNER_RECHECKใช้ร่วมฟังก์ชันเก่า หนึ่งครั้ง/order รองรับไฟล์hashเดิมหลังuploaddeadlineถ้าความพยายามแรกอยู่ในเวลา, จำนวนprovidercallsสูงสุด2 การprepareล้มต้องไม่เรียกverify ตรวจซ้ำล้มอีกให้reconcileกับผู้รับ ไม่โอนเพิ่ม
- Tests239/239,Chromeintercept6/6,TypeScript/lint/buildผ่าน ยังไม่อ้างว่าเคสสลิปจริงPAIDจนproviderresponseจริงผ่านfinalizer

## ล่าสุด 2026-10-31 — รองรับธนาคารกรุงเทพ

- แก้ hardcode BANK_ACCOUNT004 ใน finalizer ด้วย `20261031_payment_receiver_bank.sql` โดยเปลี่ยนเพียงguardให้ตรวจรูปแบบbankcodeของimmutable receiver snapshot; การเทียบevidencebank/identitybank/fullaccount/name/order/amountยังอยู่ครบ ไม่อนุมัติจากเลขmaskหรือชื่ออย่างเดียว
- ลงฐานที่ `.env.production` ชี้อยู่แล้วผ่าน `scripts/db-receiver-bank-migrate.mjs` หลังreview+backup `.local-db/backup-2026-10-31T09-20-54.249Z`; snapshotก่อน/หลัง30ตารางเหมือนเดิม ACL/NORMAL/search_pathไม่เปลี่ยน
- Tests234/234,TypeScript,lintผ่าน; isolatedBBL BANK_ACCOUNT/PromptPay/KBank+replay/negative+safe-rerunผ่าน ไม่เรียกprovider/SMS/โอนเงินหรือสร้างPAIDบนฐานจริง
- **ยังปิดรับเงินจริง** จนdeploywebcodeล่าสุดและทดสอบQR/สลิปจริงของบัญชีร้าน; ห้ามrerunmigrationเก่าหรือเปิดenableเพื่อซ่อนblocker รายการเก่าคงreceiver snapshotเดิม ไม่มีbackfill
- สถานะmock/catalog/ผู้รับเก่าในส่วนถัดไปเป็นประวัติ ดูสถานะปัจจุบันในFINAL_TEST.md

## สถานะและขอบเขต (ประวัติ)

- โค้ดผ่าน offline/isolated SQL acceptance และ **apply payment migration บน Neon สำเร็จแล้ว 2026-10-10** ด้วย guarded deployment; 13 existing tables ไม่เปลี่ยน รายละเอียด `scripts/db-payments-deployment.md`
- default ยังคงปิดจนตั้ง config; **local ช่วงทดลองเปิดแล้ว** ด้วย `PAYMENT_TRANSFERS_ENABLED=true` และ `PAYMENT_PROVIDER_STRATEGY=EASYSLIP_V2_REGISTERED_ACCOUNT` หลัง schema พร้อม ไม่ต้องใช้ `PAYMENT_RECEIVER_CONTRACT` v1; restart server โหลด env ใหม่ก่อนทดลอง ไม่ได้ตั้ง enable บน Vercel
- real payment ใช้ key เฉพาะ `EASYSLIP_PAYMENT_V2_API_KEY` ไม่ fallback ไป key v1/diagnostics; read-only diagnostics ใช้ `EASYSLIP_V2_API_KEY` (เดิม fallback `EASYSLIP_API_KEY` ได้ แต่ไม่ใช้ payment key) และไม่เปิด readiness/อนุมัติเงิน
- ผู้ใช้รายงาน paid positive/negative v2 matching สำเร็จแล้ว (ถูกบัญชี matched; ผิดบัญชี matchedAccount=null) และอนุมัติ strategy นี้ แต่ยังไม่ถือว่า end-to-end order/DB settlement ผ่าน acceptance
- รอบพัฒนานี้ไม่เรียก EasySlip ตรวจสลิปจริง, ไม่ส่ง SMS, ไม่เปลี่ยนสมาชิก/แต้ม/ยอดทดสอบเดิม
- Auth เดิมและสิทธิ์ STAFF/ADMIN/OWNER ไม่เปลี่ยน ไม่มี API อ่านรายรับรวมให้พนักงานเพิ่มขึ้น payment routes ทำรายการ/อ่านได้เฉพาะสมาชิก session ของตนเอง (Admin/Owner ก็เฉพาะบัญชีตนเอง)
- Finance/หน้าร้าน/การต่ออายุด้วย Admin เดิมยัง mock; ห้ามนับรายรับ real orders จาก localStorage หรือใช้ mock check-in ยืนยันสิทธิ์เข้าใช้จริง

## แหล่ง catalog / โปร / สิทธิ์

`src/lib/payment-policy.ts` ใช้ `mockPackages` และ `mockPromoCodes` ใน `src/lib/mock-data.ts` **ฝั่งเซิร์ฟเวอร์** เพื่อให้ ID/ราคา/ช่วงเวลา/ระยะเวลาตรง storefront ปัจจุบัน ไม่ใช้ `src/db/seed.ts` ซึ่งเป็นราคาเก่า และไม่ seed/แก้ DB packages เดิม หน้าเว็บยังแชร์ catalog เดียวกัน แต่ข้อมูลจาก client เป็นเพียง packageId, promoCode, requestKey; amount/discount/วัน/แต้ม/receiver ที่ client ส่งมาเพิ่มเติมจะถูกปฏิเสธ

- Snapshot แพ็กเกจ/ราคา/ส่วนลด/receiver/โปรและ created/expiry คงที่ใน DB; trigger ห้ามแก้ snapshot และ paid order
- โอนได้ภายใน **15 นาที**; ส่งรูปครั้งแรกได้ถึง `uploadDeadline` เพิ่มอีก **30 นาที** แต่เวลารายการโอนต้องไม่เกิน expiry เดิม; ยอดเป็น integer satang > 0 ไม่มีทางอนุมัติฟรีจากส่วนลดเป็นศูนย์
- โปรรองรับ catalog codes ปัจจุบัน (`BLU100`, `FITNESS10`, `VIP500`, `BLU50`) ตาม min spend, fixed/percent, max discount, active, expiry
- `usedCount` เดิมใน catalog เป็น conservative opening usage ของ quota: จำนวนสิทธิ์ที่ระบบใหม่ใช้ได้ = `usageLimit - usedCount` ไม่อ้างว่าเป็นจำนวน paid จริงใน DB และไม่เปลี่ยน fixture เดิม
- DB จองโควตาเมื่อสร้าง order ด้วย advisory lock ต่อ promo; paid orders + pending ยังไม่หมด upload grace + unresolved attempts ถูกนับ ภายหลังหมดอายุและไม่มี unresolved attempt จึงคืน reservation ไม่มีการใช้ promo ซ้ำจาก paid retry
- สิทธิ์/โค้ด Admin แจกใน localStorage ไม่ใช่ server-authoritative จึงไม่ใช้ลดเงินจริง; ถ้าจะเปิดใช้ต้องย้าย definition/grant/consumption ไป DB ก่อน
- คะแนนตาม `BUSINESS.md` §3.9: `floor(netSatang / 2000)` เพิ่ม `members.points` และ `package_payment_point_ledger` ใน transaction เดียวกับ paid/expiry (รวมกรณีได้ 0 แต้ม) ไม่ให้แต้มจาก check-in
- ปัจจุบัน storefront catalog friendCoupons/bonusDays = 0 ทั้งหมด จึง **ไม่เติมคูปองหรือวันแถมจาก legacy seed/ข้อกำหนดที่ขัดกับ catalog** ไม่มีการแก้ `isFirstRegistration` หรืองาน welcome coupons
- ร้านแลกแต้มและ ledger mock เดิมยังแยกกัน แต้มจริงไม่เขียนกลับ browser และยังแลกผ่าน mock shop ไม่ได้

## ผู้รับทดสอบที่ได้รับอนุญาต

ค่าที่ใช้ใน `.env.local` ตั้งแล้ว โดยเก็บ payment key ฝั่ง server จาก branch key ที่ตรวจผ่าน ไม่พิมพ์ key; example ด้านล่างใช้ enable=false เป็น default ปลอดภัย ส่วน local test enable=true:

```dotenv
PAYMENT_PROMPTPAY_MOBILE="0973355322"
PAYMENT_RECEIVER_NAME="นาย ณัฐนที รุ่งทองใบสุรีย์"
PAYMENT_RECEIVER_BANK_CODE="004"
PAYMENT_RECEIVER_BANK_ACCOUNT="0528938965"
EASYSLIP_PAYMENT_V2_API_KEY=
PAYMENT_PROVIDER_STRATEGY=EASYSLIP_V2_REGISTERED_ACCOUNT
PAYMENT_TRANSFERS_ENABLED=false
```

Local file เก็บ key เดิมไว้ไม่พิมพ์ออก log; example ไม่มี secret values อย่า commit `.env.local` ห้ามใช้ `NEXT_PUBLIC_` กับ credentials ผู้รับนี้เป็นบัญชีทดสอบชั่วคราว ต้องเปลี่ยนเป็นบัญชีร้านและทำ acceptance ก่อน production เปลี่ยน config มีผลต่อ order ใหม่เท่านั้น order เก่ายังใช้ receiver snapshot เดิม

## EasySlip receiver strategy (fail closed)

เอกสารที่ตรวจ:

- https://document.easyslip.com/en/v1/verify/bank/image
- https://document.easyslip.com/en/v1/verify/bank/payload (SlipData schema)
- https://document.easyslip.com/en/reference/bank-codes (`004` = KBANK)
- https://document.easyslip.com/en/v2/ (registered account matching เป็น v2 ไม่ใช่ v1)

ใช้ **POST `https://api.easyslip.com/v2/verify/bank`** พร้อม server Bearer `EASYSLIP_PAYMENT_V2_API_KEY`, FormData `image`, `matchAccount=true`, `matchAmount=<order THB exact 2 decimals>`, `checkDuplicate=true`, `remark=<order ID>`; fetch สร้าง multipart boundary เอง ไม่ใช้ URL/base64 จาก client ไม่เรียก balance API ทุกครั้ง และไม่มี fallback v1/paid request แอบซ้ำ

อ้างอิง request/response: https://document.easyslip.com/en/v2/verify/bank/image

1. HTTP สำเร็จ + `success=true` + `rawSlip.transRef` มีรูปแบบ/ความยาวถูกต้อง; response remark ต้องมีและตรง order ID (cached ผลของ order อื่น/ไม่ผูก order ไม่ใช้อนุมัติ)
2. `rawSlip.countryCode=TH`; currency ที่ระบุใน raw amount/local หรือผลตรวจต้องว่าง/THB เท่านั้น; `rawSlip.amount.amount`, `amountInSlip`, `amountInOrder` แปลง satang ตรง order ทุกสตางค์ และ `isAmountMatched=true`
3. ISO timestamp พร้อม timezone: ตั้งแต่ `createdAt - 60 วินาที` ถึง `expiresAt` **ไม่มี transfer grace หลัง expiry** และไม่เกินเวลาปัจจุบัน + 60 วินาที
4. `matchedAccount` ไม่ null; `bank.code=004`, `bankNumber` เป็นเลขเต็มตรง snapshot (ลบเฉพาะช่องว่าง/ขีด); `nameTh`/`name` ตรง snapshot หลัง NFKC/title/whitespace/case normalization ไม่ใช้ fuzzy matching ฝั่งแอป
5. raw receiver bank ต้อง `004`, type `BANKAC`; เลข masked ต้องยาวเท่าเลขเต็มและทุก digit ที่มองเห็นต้องตรงตำแหน่ง เช่น `XXXXX3896X` ผ่านแต่ `XXXXX6134X` ไม่ผ่าน **เลข masked/suffix ไม่ใช่หลักฐานหลัก**; raw English name เช่น `MR NATNATEE R` อาจถูกตัด จึงไม่บังคับเท่าชื่อเต็ม
6. evidence เป็น `REGISTERED_ACCOUNT_V2` พร้อม provider strategy, orderId และ full matched identity; SQL ตรวจซ้ำกับ immutable snapshot ก่อนต่ออายุ/แต้ม ไม่มี mock/manual PAID

**Trust boundary:** ต้องลงทะเบียนบัญชีตรง config ใน branch ของ payment key และเลือก dashboard **“เลขบัญชีและชื่อบัญชีธนาคาร”** `matchAccount` พึ่ง provider/dashboard matching (รวมเกณฑ์ความคล้ายชื่อของ provider) ไม่ใช่ bank-independent cryptographic proof แอปยอมรับ strategy ที่ผู้ใช้อนุมัติจาก positive/negative tests และตรวจ registered identity เต็มอีกชั้น ไม่ต้องรอ contract v1 ที่เข้าถึงไม่ได้

`isDuplicate=true` ไม่ใช่หลักฐานว่า order นี้จ่ายแล้วหรือผิดเอง หากยังมีข้อมูลครบให้ SQL global transRef uniqueness ตัดสิน; ถ้า provider ไม่ส่ง proof ครบ/คืน HTTP error ให้คง UNKNOWN หรือปฏิเสธตามผลตรวจ ห้ามเติมสิทธิ์จาก duplicate flag อย่างเดียว หลัง timeout ผู้ใช้ retry รูปเดิมได้ตาม cooldown/limit แต่ provider อาจตอบ duplicate โดยไม่มี proof: ต้อง reconciliation โดย OWNER ไม่โอนซ้ำ

## การตรวจรูปและ quota / concurrency / reconciliation

- Body จำกัด bytes จริง (รวม chunked) ≤ 4 MB + 64 KB multipart; อ่านสูงสุด 10 วินาที; 1 file, allowed fields เท่านั้น
- File > 0 ถึง 4 MB, MIME และ magic signature ต้องตรง JPEG/PNG/GIF/WebP ไม่รับ SVG ไม่เก็บรูปใน DB/Cloudinary ใช้ SHA-256 เพื่อกันส่งรูปเดิมซ้ำ
- ส่งรูปให้ provider โดยเปลี่ยน filename เป็น `slip.<type>` ไม่ส่งชื่อไฟล์ส่วนตัว; redirect=error, fetch timeout 12 วินาที, response จำกัด 64 KB/12 วินาที ไม่มี secret/raw-slip/sender/provider error dump logs
- DB order row lock + unique partial index: มี PROCESSING/UNKNOWN/VERIFIED ได้หนึ่ง attempt ต่อ order; สร้างได้ไม่เกิน 5 orders/ชั่วโมง/สมาชิก, ≤ 3 รูป/order และ cooldown 30 วินาที
- คำขอรูปเดิมปกติไม่เรียก provider ซ้ำ PROCESSING/UNKNOWN คืน pending; REJECTED คืนปฏิเสธ; VERIFIED ใช้ evidence ที่บันทึกไว้ finalize โดยไม่ใช้ quota เพิ่ม
- Timeout/HTTP provider error/response เสียหาย = UNKNOWN/pending ไม่ตีความเป็น paid และไม่ retry อัตโนมัติ
- ถ้าผู้ใช้ยืนยัน `reconcile=true`: **เฉพาะรูปเดิม**, PROCESSING/UNKNOWN ที่ผ่าน 2 นาที, สูงสุด 2 provider calls ต่อ attempt (เริ่มต้น + retry เพิ่ม 1) อาจใช้ quota เพิ่ม มี UI confirm ก่อนส่ง; lease token ป้องกัน response ของ worker เก่าทับ worker ใหม่
- ส่งรูปครั้งแรก/รูปใหม่ได้จนหมด upload grace; retry UNKNOWN รูปเดิมเพิ่ม provider call ได้เฉพาะก่อน uploadDeadline และตาม cooldown/limit; transfer timestamp ต้องอยู่ในหน้าต่างโอน 15 นาทีเดิม VERIFIED สามารถ finalize หลัง grace โดยใช้ evidence เดิมไม่เสียโควตาเพิ่ม
- หาก worker ตายหลัง claim หรือบันทึก evidence ล้มเหลว จะคง pending: โหลดสถานะ/ตรวจรูปเดิมซ้ำตามเงื่อนไข ห้ามโอนซ้ำ ไม่มี auto-unlock จากเวลาเพียงอย่างเดียว
- transRef ซ้ำ/บัญชีถูกระงับตอน finalize: ปิด REJECTED ทั้ง order/attempt พร้อม immutable audit โดยไม่เพิ่มสิทธิ์
- UNKNOWN/PROCESSING ค้างหลัง grace: OWNER อ่าน `/api/admin/payments/unresolved` และใช้ POST `/api/admin/payments/[orderId]/reject` ได้เฉพาะเมื่อมีหลักฐาน reconcile จาก BANK/PROVIDER ที่อนุมัติแล้ว ระบุเหตุผลและ case reference; ไม่มี manual PAID/refund API และพนักงานใช้ไม่ได้
- ความสำเร็จ provider อาจยังใช้ quota แม้ DB ไม่บันทึก ไม่รับประกัน exactly-once external billing; รับประกัน paid retry ไม่เพิ่มสิทธิ์ซ้ำผ่าน DB constraints/transaction

## Atomic settlement / global transfer uniqueness

`finalize_package_payment` lock member → order → evidence, ตรวจ session ไม่ revoked/expired และ member ไม่ suspended อีกครั้ง จากนั้นทำใน SQL function/transaction เดียว:

1. claim transRef ใน `payment_transfer_refs` primary key
2. ต่ออายุ: ถ้า ACTIVE และ expiry เก่า > เวลายืนยันสำเร็จ ให้บวกจาก expiry เก่า; ไม่ใช่ ACTIVE/หมดอายุให้เริ่มเวลายืนยันสำเร็จ บวก durationDays แบบ 24 ชั่วโมง ไม่ย้อนหลังไปยังเวลาสลิป
3. เพิ่มแต้มจริง + ledger ที่ order_id unique
4. บันทึก order PAID, paid_at, membership_expires_at, trans_ref และ verification_snapshot (audit หลักฐานตรวจที่ผ่านแล้ว) พร้อมกัน

ทุกขั้น rollback ด้วยกัน Paid order retry คืนผลเดิมไม่เติมวัน/แต้มซ้ำ เปลี่ยน evidence/receiver snapshot ไม่ได้ทาง member API

Transfer registry รวม legacy `payments.easyslip_trans_ref` ด้วย Migration จะ **ล้มเหลวและ rollback ถ้ามี reference เดิมซ้ำ** ไม่ลบหรือแก้ประวัติให้เอง เพิ่ม unique index ของ legacy และ trigger จอง registry สำหรับ legacy writer ที่มาใหม่ จึงกันสลิปซ้ำข้ามระบบด้วย ไม่เขียน real storefront order ลง legacy payments เพราะ package FK อ้าง ID ของราคาเก่าและทำให้รายรับผิด

## Deploy migration (parent/operator เป็นผู้ apply)

1. เตรียม disposable/test DB จาก schema ปัจจุบัน; apply payment SQL และทดสอบ SQL fixture ด้านล่างก่อน production
2. ยืนยันหยุด **ทุก writers** ใหม่: dev/start instances, workers/jobs, cron, admin tools, db studio, seed, manual DB sessions และ deploy instances ทุกเวอร์ชัน การเคย pause ไม่ใช่หลักฐานว่ายังหยุดอยู่
3. สำรอง DB แบบ read-only และ verify backup ตาม `scripts/db-backup.mjs`/`scripts/db-verify-backup.mjs`; อย่าส่ง connection string/backup เข้า logs หรือ git
4. ตรวจ duplicates แบบ read-only ใน SQL editor:
   ```sql
   SELECT easyslip_trans_ref, count(*) FROM payments
   WHERE easyslip_trans_ref IS NOT NULL GROUP BY easyslip_trans_ref HAVING count(*) > 1;
   ```
   ถ้าพบให้หยุดและ reconcile กับผู้มีอำนาจ ห้าม deduplicate เงินอัตโนมัติ
5. Apply **ทั้งไฟล์** `20261009_real_package_payments.sql` ใน SQL editor ที่เชื่อมฐานเป้าหมาย โดย transaction BEGIN/COMMIT ที่มีให้ ไม่แยกด้วย semicolon splitter เพราะมี PL/pgSQL bodies ไม่ใช้ auth migration script เดิม/`db:push` แทน
6. Migration นี้ไม่ idempotent rerun: ตรวจ table/function/index ก่อน apply; หากล้มเหลวต้อง rollback ก่อนตรวจสาเหตุ ไม่มี delete/reset/member update ระดับ top-level
7. ตรวจ tables `payment_transfer_refs`, `package_payment_orders`, `package_payment_attempts`, `package_payment_point_ledger`; functions create/claim/finalize; triggers snapshot/legacy และ unique indexes ก่อน deploy code
8. ตั้ง server env พร้อม receiver ที่ถูกต้อง; restart เฉพาะเมื่อ operator อนุญาต ไม่มี runtime service restart ในรอบนี้
9. ทดสอบ guest/สมาชิกคนอื่น/suspended/session revoked, promo capacity, concurrent claims/settlement, duplicate refs ข้าม legacy, active/expired renewal บน test DB
10. การทดสอบรูปจริง/ค่า quota ต้องได้รับอนุญาตแยกต่างหาก ไม่รวม offline validation และห้ามใช้รูปมี PII กับ provider โดยไม่ยินยอม

**Migration safety:** functions SECURITY INVOKER ไม่ยกระดับสิทธิ์ connection; DB credentials เป็น server-only ห้ามเปิด client SQL access Grants/RLS ของ infrastructure ต้องตรวจตาม deployment จริง SQL functions/triggers/partial checks เป็น authoritative migration ไม่ควรให้ Drizzle push ลบโดยไม่ตรวจ diff

## Tests / validation

```sh
node --test src/lib/payment-policy.test.mjs src/lib/payment-server.test.mjs
pnpm exec tsc --noEmit
pnpm lint
```

Policy/API tests ใช้ mocked SQL/provider เท่านั้น ทดสอบ price injection/zero promo, exact satang, receiver name/masked spoof, THB/date/signature, concurrent provider claims, timeout pending, evidence retry, paid replay และ body size Static SQL assertions **ไม่ใช่การทดสอบ PostgreSQL locks/transaction จริง**

`payment-integration.test.sql` สำหรับ disposable PostgreSQL เท่านั้น หลัง apply migration; fixture เป็น transaction + rollback ไม่เรียกเครือข่าย EasySlip/SMS ไม่ใช้กับ DB ที่มีสมาชิกจริง การทดสอบ concurrency ข้าม connections ยังต้องทำ acceptance เพิ่ม ไม่มี PostgreSQL ที่พร้อมรัน offline ในเครื่องรอบนี้ (Docker daemon ไม่ทำงาน) จึงไม่ได้ execute SQL fixture/production migration

### ผล validation รอบ implementation

- Payment policy/API/diagnostics offline tests: **30/30 ผ่าน**
- Migration และ SQL fixture ผ่าน PostgreSQL WASM แบบ in-memory (PGlite 0.5.8) พร้อม rollback; ใช้ minimal existing-table contract ไม่ใช่ production schema หรือการยืนยัน locks ข้าม connections
- `pnpm exec tsc --noEmit`: ผ่าน
- ESLint เฉพาะไฟล์ที่เปลี่ยน/เพิ่ม: ผ่าน
- Full offline suite (`src/lib`, auth, schema, db-tools): **104/125 ผ่าน**; 21 failures อยู่ใน `benefits.test.mjs`/`benefits-coupons.test.mjs` เดิมที่ไม่ได้แก้ (mock store validation/สิทธิ์/จำนวน writes) รันสองไฟล์นี้แยกได้ผล fail 21 เช่นกัน
- `pnpm lint`: ยังไม่ผ่านจาก 9 errors/7 warnings เดิมใน `src/app/api/test-services/route.ts`, `src/app/test/page.tsx`, `src/context/LanguageContext.tsx` ไม่แก้เรื่องนอก scope
- `git diff --check`: ผ่าน (มีเพียงคำเตือน Git เรื่อง LF/CRLF)
- ไม่มีการทดสอบเงินจริง/paid EasySlip, SMS, apply schema บน Neon หรือแก้ยอดสมาชิกเดิม

## SQL validation แบบแยกจากฐานจริง

PGlite ติดตั้งเฉพาะใน `.local-db/payment-sql-tests` ซึ่ง ignored ไม่เพิ่ม dependency/lockfile ของแอป:

```sh
# หาก environment นี้ยังไม่ได้ติดตั้ง สร้าง directory ก่อน แล้วติดตั้ง package สำหรับ tests เท่านั้น
pnpm --dir .local-db/payment-sql-tests add @electric-sql/pglite@0.5.8
node scripts/payment-sql-tests.mjs --run-memory
```

ผลตรวจครอบคลุม migration syntax/PLpgSQL, immutable order/evidence/audit, active/expired renewal, atomic points และ paid replay, upload grace/promo reservation, duplicate terminal audit, suspension, OWNER-only reconciliation; ไม่มี connection string หรือ provider calls

Multi-connection acceptance ที่เตรียมไว้: `scripts/payment-postgres-tests.py` ต้องใช้ disposable PostgreSQL ชื่อ `blu_payment_test_*` ที่มี migration แล้วและ libpq service; default ไม่เชื่อม DB อย่ารันกับ Neon ที่มีสมาชิกจริง

## Incremental PromptPay repair 2026-10-10
Apply `20261010_payment_promptpay.sql` after the applied base migration; do not edit/reapply the base hash. Fixed public,pg_temp search paths and PUBLIC EXECUTE revocation are retained. Server DB role must own functions or have explicit grants.

BANK_ACCOUNT validation is unchanged. PROMPTPAY requires full normalized mobile plus exact normalized matched name against the snapshot, and a same-length consistent raw MSISDN mask. A mask is never identity proof. Missing raw bank is allowed; contradictory bank/account rejected. Identity matchingType/providerBankCode distinguish PROMPTPAY evidence from top-level expected configured bankCode.

Cached echoes (remark, amount match fields, countryCode, duplicate flag) may be absent. Remark is not authentication, including stale diagnostic remarks. Explicit supplied inconsistent amount fields, false matching flag or foreign currency/country reject. Exact raw amount, valid in-window timestamp, server-owned orderId evidence and global transfer uniqueness always remain mandatory.

Recovery: authenticated same-origin OWNER of their own PENDING order loads status in payment modal, requests OWNER recheck, then explicitly reuploads the exact original image. Endpoint POST /api/admin/payments/[orderId]/recheck accepts {confirmed:true,reason:"PROMPTPAY_REGISTRATION_FIX"}. Only generic PROVIDER_VALIDATION_FAILED without evidence, original attempt before upload deadline and provider_calls=1 qualifies. One immutable OWNER_RECHECK audit transactionally permits UNKNOWN; image/counter/lease identities are not reset. Reconcile claims a new lease with call 2 even after grace, only on that audited original attempt. No third call, arbitrary terminal reopening, manual PAID or benefits from preparation.

Actual order fa7ebd15-3951-4eed-914d-0c70f841458d is untouched. Recovery remains pending deployment and explicit original-image upload by its OWNER; no live provider call, production mutation or member credit during repair.
