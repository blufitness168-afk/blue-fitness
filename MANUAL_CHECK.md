# Manual check ก่อนเปิดใช้งานจริง

## Acceptance จริง: PromptPay 100 บาท และ paid replay (2026-10-10)

- ตรวจ Neon ยืนยัน order `fa7ebd15-3951-4eed-914d-0c70f841458d` = PAID, amount 100 บาท, transRef `Acb0e9d77c0604926` ตรงสลิปที่ผู้ใช้ส่ง
- Paid เวลาไทย 10/10/2569 18:47:14, confirmed 19:41:09; สิทธิ์รายวันหมดอายุ 11/10/2569 19:41:09 แต้มสมาชิกจริง 5, point ledger 1 แถว, transfer registry 1 แถว
- เรียก `finalize_package_payment` ของรายการที่ PAID อยู่แล้วซ้ำ 2 ครั้งใน Neon Serializable transaction ผ่าน session ที่ยัง active โดยไม่เปิดเผย digest: คืน PAID ทั้งคู่ วันหมดอายุ/แต้มไม่เปลี่ยน ledger และ registry ยังแถวเดียว ไม่สร้างการซื้อเพิ่ม
- รอบตรวจนี้ไม่ส่งรูปให้ provider ซ้ำ ไม่โอนเงิน ไม่เพิ่มวัน/แต้มเอง ไม่ลบสมาชิก; เป็น DB-finalizer replay acceptance ไม่ใช่ browser upload replay
- Policy/API regression และ isolated PostgreSQL migration/fixtures ผ่าน ครอบคลุมยอดผิด ผู้รับผิด สลิปเก่า การใช้ transRef ซ้ำ และ audited PromptPay recovery; cases negative/concurrency เหล่านี้ยังเป็น offline/isolated acceptance ไม่อ้างว่าทดสอบ browser/Neon concurrent ครบ

## ทดสอบผู้รับ EasySlip v2 เพิ่มเติม

- ผู้ใช้อนุญาตให้ใช้โควตาตรวจจริงได้แล้ว; diagnostics ล่าสุดจากผู้ใช้ยืนยัน keyAccepted/branchActive/receiverLinkedToBranch = true หลังเพิ่มบัญชีกสิกรด้วยตัวเลือกตรวจเลขบัญชีและชื่อ
- `/test` เพิ่มตัวเลือก v2: ส่ง image + matchAccount=true + checkDuplicate=true ไป `/v2/verify/bank` แสดง matchedAccount, ผู้รับจาก rawSlip, transRef/ยอด/เวลา และเครดิต/โควตาก่อน–หลังจาก `/v2/info`
- ต้องแนบไฟล์สลิปผ่านหน้าเว็บก่อนเรียก verify จริง; ไม่มีการเรียกตรวจเสียโควตาระหว่างพัฒนา ไม่มีการอนุมัติซื้อ/เพิ่มสิทธิ์/เปิดรับโอนจาก diagnostic result
- ทดสอบสลิปเข้าบัญชีทดลองและสลิปโอนให้บัญชีอื่นเป็น positive/negative cases; matchedRegisteredReceiver เป็นผลเทียบบัญชีที่ API คืนกับ config ไม่ใช่การรับรองกลไกตรวจของ provider
- TypeScript/scoped lint ผ่าน และ tests test-service-actions + provider-diagnostics 10/10 ผ่าน

## EasySlip ชำระแพ็กเกจ — รอบพัฒนาล่าสุด (2026-10-10)

- ทำ order/QR/ตรวจสลิป/ต่ออายุ/แต้มด้วย server API และ DB transaction; ไม่อนุมัติจาก browser mock
- บัญชีช่วงทดลอง: PromptPay `0973355322`, กสิกร `004`, บัญชี `0528938965`, นาย ณัฐนที รุ่งทองใบสุรีย์ ตามที่ผู้ใช้ยืนยัน ไม่ใช่บัญชีรับเงิน production ของร้าน
- ป้องกันยอดแก้จาก client, transRef ซ้ำข้าม legacy, request replay, provider timeout; evidence และ audit immutable; คำสั่งซื้อโอนภายใน 15 นาที แนบสลิปได้เพิ่ม 30 นาทีโดยยังตรวจเวลาโอนเดิม
- **เปิดชำระช่วงทดลอง local แล้ว** ด้วย EasySlip v2 registered-account strategy ตามที่ผู้ใช้อนุมัติหลังทดสอบ positive/negative จริง; ตรวจ matched bank/account/name เต็มกับ snapshot และไม่รับ masked digits ที่ขัดกัน ใช้ matching ของ provider/dashboard ไม่อ้างเป็น cryptographic proof
- OWNER มี diagnostics และ v2 slip test ใน `/test`; ตรวจ `/v2/info` ด้วย payment branch key จริงตอบ HTTP 200, branchActive=true, usedQuota2 remainingQuota998 โดยไม่ตรวจสลิปเสียโควตารอบพัฒนา
- Apply payment migration บน Neon สำเร็จครบ 5 ตาราง/9 functions พร้อม atomic snapshot guards, fixed search_path และ revoke PUBLIC execute; ข้อมูลเดิม 13 ตารางไม่เปลี่ยน Backup `.local-db/backup-2026-10-10T11-39-17.293Z` รายละเอียด `scripts/db-payments-deployment.md`
- Validation: payment offline tests 30/30, TypeScript, scoped ESLint และ `pnpm build` ผ่าน; migration+SQL transactional fixture ผ่าน PostgreSQL WASM in-memory พร้อม rollback (minimal baseline ไม่ใช่ full Neon schema/concurrency)
- ไม่มีการส่ง SMS, ตรวจสลิปเสียโควตา, โอนเงิน, ตั้งรหัสสมาชิกเดิม หรือแก้ยอดสมาชิกบน Neon รอบนี้
- ขั้น acceptance ที่เหลือ: restart local server เพื่อโหลด env ใหม่; สร้าง order จริงก่อน โอนยอดตรงภายใน15นาที แล้วแนบสลิปผ่านหน้าซื้อ (ไม่ใช่ /test) ตรวจ PAID/expiry/แต้ม/ประวัติจาก DB และ replay ไม่เพิ่มสิทธิ์ซ้ำ; ยังไม่ผ่านเงินจริง end-to-end หรือ concurrency หลาย connections
- `.env.local` ตั้ง payment key จาก branch key ที่ทดสอบแล้ว, strategy EASYSLIP_V2_REGISTERED_ACCOUNT และ enable=true โดยไม่เปิดเผยค่า key ไม่ได้ตั้งค่า Vercel ให้

> ตอนนี้ยังไม่พร้อม production: Register และ OTP ต่อ Neon แล้ว; มีสมาชิกทดลอง 1 ราย (`BLU-1`) ที่ตั้งบทบาทเป็น OWNER ใน Neon แล้ว; ยังไม่ได้ทดสอบสิทธิ์ครบทุก flow; Account/ธุรกรรมส่วนใหญ่ยังเป็น mock/localStorage, SMS ยังรอ Sender Name; เปิดรับเงินเฉพาะ local ทดลองผ่าน real payment flow แล้ว ยังไม่ผ่าน acceptance/ไม่เปิด production ห้ามใช้ข้อมูล mock เป็นหลักฐานการชำระเงินหรือสิทธิ์เข้าใช้

## สถานะบริการล่าสุด (2026-10-09)

- EasySlip: ผู้ใช้ทดสอบตรวจสลิปจริงผ่าน `/test` สำเร็จ (HTTP 200), ยอดสลิป 25 บาท; usedQuota 0 → 1 และ remainingQuota 1000 → 999, currentCredit 0 → 0
- บัญชี EasySlip ปัจจุบัน: `blufitness168@gmail.com`; รหัสผ่านเก็บเฉพาะ Vault `PROJECTS/FREELANCE/BLUE_FITNESS/ENV_CONFIG.md` ไม่เก็บใน Git
- ผลนี้ยืนยันการตรวจข้อมูลสลิปและใช้โควตาเท่านั้น ยังไม่ยืนยันผู้รับเงินของร้านหรือการซื้อ; ต้องตรวจผู้รับ ยอด เวลา รายการซ้ำ และบันทึกชำระแบบ transaction ก่อนใช้งานจริง
- SMS (2026-10-09): ผู้ใช้กำลังดำเนินการ Sender Name และรอ ThaiBulkSMS อนุมัติ; อ่านเครดิตได้ (standard 10, corporate 2596) แต่การส่งทดสอบยังตอบ HTTP 400 และเครดิตไม่เปลี่ยน ยังไม่มีรายละเอียด error ยืนยันสาเหตุจากผู้ให้บริการ
- พักการทดสอบส่ง SMS/OTP จริงจนกว่า Sender Name อนุมัติ จากนั้นยืนยันชื่อผู้ส่งและคีย์บัญชีลูกค้าใน local/Vercel และทดสอบรับข้อความกับ OTP ครบวงจร; การอัปเดตครั้งนี้แก้เอกสารเท่านั้น

## อัปเดตล็อกอิน / คูปอง / สิทธิ์ (2026-10-09)

- Implemented: ล็อกอินเบอร์ + รหัสผ่าน scrypt; ปิด LOGIN OTP เดิม; OTP ใช้สำหรับสมัคร/ตั้งรหัสครั้งแรก/ลืมรหัส พร้อม ticket ใช้ครั้งเดียวและยกเลิก session เมื่อตั้งรหัส
- ป้องกันเบอร์ซ้ำด้วย unique constraint และตอบ conflict; สมัครใหม่สร้างสมาชิก/session/คูปอง FREE_ENTRY 1 ครั้ง อายุ 30 วันแบบ atomic ไม่แจกย้อนหลัง
- แก้หน่วยคูปองตามประเภทและเพิ่มชื่อเล่นในหน้าสมาชิก admin; ข้อมูล admin/mock บางส่วนยังใช้ localStorage
- พนักงาน ADMIN เข้าได้เฉพาะ checkin/ประวัติบริการ, rewards, promo-codes, coupons พร้อม server guards; OWNER เข้า admin ได้ทั้งหมด
- คูปองต้อนรับแสดงและใช้สิทธิ์ผ่าน DB จริง; ปัจจุบันสมาชิกยืนยันใช้เองเพื่อบันทึก check-in ยังไม่เชื่อมเครื่องสแกน/ประตูหรือประวัติ admin mock
- รัน migration ทั้ง password_welcome และ auth_review_hardening บน Neon สำเร็จแล้ว (2026-10-09) หลังผู้ใช้หยุด writers และยืนยัน; สำรองก่อน apply และ commit enum แยกตาม `src/db/migrations/README.md`
- สมาชิกเดิมยังไม่มี password ต้องตั้งครั้งแรกผ่าน OTP จึงยังติดการรออนุมัติ Sender Name; ไม่ตั้งรหัสเริ่มต้นให้สมาชิก
- Validation: TypeScript และ focused offline tests ผ่าน; DB integration จริงผ่าน 11 กรณีและล้าง fixtures แล้ว ยังไม่ทดสอบ SMS/OTP หรือ HTTP/browser ครบวงจร

## ผล apply และ DB integration ล่าสุด (2026-10-09)

- ผู้ใช้ยืนยันหยุด dev server และ local/remote writers แล้ว จึงรัน `node scripts/db-migrate.mjs --apply --all-writers-paused` สำเร็จครบ 3 phases
- Fresh backup: `.local-db/backup-2026-10-09T15-18-24.816Z/`; migration report: `.local-db/migration-2026-10-09T15-18-24.172Z.json`
- รัน `node scripts/db-integration.mjs --run-fixtures --all-writers-paused` สำเร็จ 11 กรณี: welcome rollback/atomic/defaults, เบอร์ซ้ำ, welcome ไม่ซ้ำ, รหัสผิด/ถูก, session ownership, coupon expiry, redeem ครั้งเดียว + checkin, session revoked/expired
- Integration report: `.local-db/integration-2026-10-09T15-18-35.788Z.json`; cleanup completed และตรวจ fixtures members/limits/coupons/sessions/checkins ไม่มีเหลือ
- เก็บสมาชิกเดิมไว้ ไม่ตั้งรหัสแทน ไม่ล้างผู้ใช้ทั้งหมด และไม่ส่ง SMS/ข้าม OTP; เปิด dev server ด้วยโค้ดใหม่ได้แล้ว สมาชิกเดิมตั้งรหัสครั้งแรกยังรอ SMS

## ประวัติเตรียม deployment ก่อน apply (2026-10-09)

รายการ BLOCKED/ยังไม่ได้รันด้านล่างเป็นประวัติก่อน apply; ผลล่าสุดดูหัวข้อด้านบน

- ตรวจ `.env.local` เฉพาะสถานะ configuration และเชื่อม Neon เพื่ออ่าน metadata; ไม่แสดง connection string, credentials หรือข้อมูลสมาชิก
- ตรวจ SQL ทั้งสองและ schema จริงแบบ read-only: ยังไม่มี `members.password_hash`, `coupons.source`, `auth_password_tickets`, `auth_login_limits` หรือ hardening columns; มี `members_phone_unique` แล้ว
- **BLOCKED:** พบ `pnpm run dev` / `next dev` ของ `C:\PROJECT\blue-fitness` ยังทำงานอยู่ (ตรวจพบ PID 9520, 7024, 17748; PID อาจเปลี่ยนได้) ไม่สามารถยืนยันว่า instances เก่า/remote หยุดทั้งหมด จึงไม่รัน migration แม้ได้รับอนุญาต และไม่ปิด process ของผู้ใช้
- รอบนี้ไม่มีการเขียน DB, เปลี่ยนรหัส/สิทธิ์สมาชิก, สร้าง fixtures, เรียก SMS หรือ bypass OTP; การ pause เป็น blocker เฉพาะ remote writes ไม่ใช่ read-only backup/tooling
- สร้าง read-only backup แล้ว: `.local-db/backup-2026-10-09T14-57-48.984Z/` มี `snapshot.json`, `restore-empty.sql`, `manifest.json`; snapshot ก่อนหน้านี้อยู่ที่ `.local-db/backup-2026-10-09T14-55-21.605Z/` เช่นกัน ทั้งคู่เป็นข้อมูล sensitive ห้ามแชร์หรือเข้า Git
- เพิ่ม `/.local-db/` ใน `.gitignore` **ก่อน** เขียน backup และยืนยัน `git check-ignore` แล้ว; Windows ACL ปิด inheritance ที่ directory และให้ Full Control เฉพาะ current Windows user + SYSTEM (ตรวจ ACL ของ snapshot แล้ว) ไฟล์เป็น plaintext ไม่ใช่ encrypted backup
- ตาราง/schema/data ถูกอ่านใน `REPEATABLE READ READ ONLY` transaction เดียว: members 1, coupons 0, auth_otp_challenges 4, auth_signup_tickets 1, auth_sessions 3, checkins 0; auth_password_tickets/auth_login_limits ยังไม่มี จึงไม่มีข้อมูลของสองตารางนี้ใน backup
- ตรวจ SHA256, JSON parse, column coverage, row counts และ PostgreSQL `json_populate_recordset` แบบ SELECT-only ผ่านแล้ว; **ยังไม่ได้ทดลอง execute restore** และไม่มี psql/pg_dump ใน environment นี้
- Backup นี้เป็น affected-table snapshot ไม่ใช่ full DB/PITR; มี table DDL, constraints, indexes, enum และ serial sequence metadata พร้อม SQL สำหรับฐานว่างแยกเท่านั้น ไม่รวม external-table data, roles/grants, triggers/RLS/extension definitions; sequence state ไม่ใช่ MVCC จึง restore ให้ไม่น้อยกว่า captured value/max(id) ไม่อ้างว่า sequences เป็น point-in-time เดียวกัน
- Offline focused tests (schema, admin-permissions, auth/password/policy/registration/routes/server, benefits-coupons) ผ่าน **34/34**; `pnpm exec tsc --noEmit` ผ่าน
- Offline tests ทั้ง 14 ไฟล์: **82 ผ่าน / 21 ล้ม / 103 ทั้งหมด**; failures ทั้ง 21 อยู่ใน `src/lib/benefits.test.mjs` (mock membership/CRUD/grant/redeem/promo/storage); ไม่แก้ core ที่อยู่นอก scope และไม่ถือว่า mock tests เป็นหลักฐาน DB integration
- ขั้นถัดไป: ผู้ใช้หยุด dev server และยืนยัน pause ของ **ทุก local/remote DB writer** ที่ใช้ Neon เดียวกันก่อน; runner ตรวจ schema ซ้ำ → สร้าง/verify fresh backup → ตรวจ snapshot drift ภายใต้ table locks → commit enum additions แยก → apply password_welcome ส่วนที่เหลือใน transaction → apply hardening → ตรวจ hardened schema; lock timeout 5s / statement timeout 60s ไม่ปิด process ให้ผู้ใช้
- หลัง migration จึงทดสอบ DB ด้วย isolated fixtures ที่มี marker/IDs เฉพาะและ genuine scrypt (ไม่ใช้บัญชีจริง), rollback หากทำได้/ล้างเฉพาะแถวของ fixtures: login ถูก/ผิด, เบอร์ซ้ำ, welcome atomic/once, redeem once/expiry/session ownership; staff guards ตรวจ offline แล้ว แต่ real HTTP/DB integration ยังไม่ได้ยืนยัน
- Restart application ด้วย hardened code หลัง migration ทั้งสองสำเร็จเท่านั้น; password recovery challenges/tickets เก่าถูก invalidate ตาม SQL ต้องขอ OTP ใหม่ สมาชิกเดิมยังต้องตั้งรหัสผ่านผ่าน OTP จริงเมื่อ SMS พร้อม

## Local DB safety tooling

รันจาก project root ด้วย Node ที่รองรับ `import.meta.dirname` (ใช้ Node runtime ปัจจุบันของโปรเจกต์); โหลด `.env.local`/`.env` โดยไม่แสดง secrets ไม่เพิ่ม dependency และไม่แก้ auth/coupon core

```sh
# SAFE: อ่าน schema และ preview ทั้งสอง migrations เท่านั้น (default เหมือน --dry-run)
node scripts/db-migrate.mjs
node scripts/db-migrate.mjs --dry-run

# SAFE: สร้าง protected/ignored snapshot ใหม่จาก read-only transaction
node scripts/db-backup.mjs
node scripts/db-verify-backup.mjs .local-db/backup-2026-10-09T14-57-48.984Z

# SAFE default: preview เมื่อ schema พร้อม; schema ปัจจุบัน refuse ด้วย exit 2 โดยไม่เขียน
node scripts/db-integration.mjs

# Offline tooling regression tests
node --test scripts/db-tools.test.mjs
```

คำสั่งต่อไปนี้รันสำเร็จแล้วในรอบล่าสุด หลังยืนยันหยุด writers ทั้งหมด; ห้ามรัน migration ซ้ำโดยไม่ตรวจสถานะ:

```sh
node scripts/db-migrate.mjs --apply --all-writers-paused
# หลัง migration สำเร็จ ยังไม่เปิด traffic ระหว่าง fixture validation
node scripts/db-integration.mjs --run-fixtures --all-writers-paused
```

- `db-migrate.mjs`: preflight ผ่าน (baseline/phone unique ถูกต้อง, hardenedSchema=false), phases 3/6/5 statements ตาม SQL จริง; apply ตรวจ local Next processes บน Windows และ require explicit assertion ของ remote pause (ตรวจพิสูจน์ remote pause เองไม่ได้) สร้าง fresh verified backup ทุกครั้ง ตรวจ hash ของ migration files ก่อนแต่ละ phase และ snapshot data drift ภายใต้ locks; refuse หาก hardened schema มีแล้ว เพื่อไม่ invalidate recovery credentials ซ้ำ
- บันทึก apply report ที่ `.local-db/migration-<timestamp>.json` พร้อม migration hashes, backup path, phasesCommitted และ outcome; หากล้ม phase ก่อนหน้าที่ commit แล้วไม่ถูก rollback อัตโนมัติ อย่าเปิด traffic/restore live DB โดยอัตโนมัติ
- `db-integration.mjs`: require hardened schema ก่อนเขียนเสมอ; default เป็น read-only และรอบนี้ exit 2 ตามคาด มี offline syntax validation แต่ **ยังไม่ได้รัน fixture tests**
- Fixture tests ใช้สมาชิก TEST-* / negative IDs / UUID marker เฉพาะ, genuine scrypt และฟังก์ชัน `loginPassword` / `redeemWelcomeEntry` จาก TS จริงผ่าน Neon; mock เฉพาะ framework cookie/import adapters ไม่ mock DB/crypto ไม่มี OTP/ticket ปลอม ไม่เรียก sendOtp/verifyOtp/completeRegistration และไม่ใช้บัญชีเดิม
- Scope: failed member+coupon transaction rollback, member+welcome creation defaults/atomicity, phone/source unique constraints, login ถูก/ผิด, redeem owner/expiry/replay, revoked/expired session และ single checkin audit; **ไม่ใช่หลักฐาน registration completion ผ่าน OTP หรือ HTTP/browser flow**; guards ของ staff ยังคงเป็น offline tests
- ใช้ exact ID + marker + phone guards cleanup ใน finally และตรวจแถวสมาชิก/limits/coupons/sessions/checkins หายแล้ว; integration report อยู่ `.local-db/integration-<timestamp>.json` มี IDs/marker สำหรับ recovery หาก process ถูก force-kill/network ขัดข้องจน cleanup ไม่สำเร็จ ต้องตรวจ/ล้างเฉพาะ fixture ที่ตรง report ก่อนเปิด traffic ห้าม delete แบบกว้าง; sessions/checkins serial sequences อาจเดินหน้าและไม่ reset เพื่อไม่แตะลำดับข้อมูลจริง
- Validation preparation รอบนี้: tooling tests **3/3**, focused offline tests **34/34**, syntax checks scripts ทั้ง 6 ไฟล์และ `pnpm exec tsc --noEmit` ผ่าน; รวม tooling + tests เดิม **85 ผ่าน / 21 ล้ม / 106 ทั้งหมด** (21 failures เดิมอยู่ใน `src/lib/benefits.test.mjs` ไม่แก้ใน scope นี้); `git diff --check` สำหรับเอกสาร/.gitignore ผ่าน มีเพียง LF→CRLF warning; อ่าน schema/verify snapshot เท่านั้น ไม่มี remote mutation ไม่มี SMS ไม่มี commit

## ก่อนทดลองระบบ Auth

- [x] ตรวจ schema `public` ใน Neon พบว่าง แล้วรัน `pnpm db:push` สร้างตาราง (ไม่มีการ seed หรือแตะบัญชีจริง); การ migrate ครั้งต่อไปต้องสำรองและ review diff ก่อนเสมอ
- [x] สร้างสมาชิกทดลองผ่าน flow สมัครและบันทึกใน Neon; endpoint OTP ไม่สร้างสมาชิกใหม่จากเบอร์ที่ไม่อยู่ในฐาน
- [x] ตั้ง `BLU-1` เป็น OWNER ใน Neon ตามคำขอ; API ปกติไม่สามารถตั้ง OWNER ได้
- [ ] ผู้ว่าจ้างยืนยันว่าเบอร์สมาชิก OWNER เป็นของเจ้าของกิจการจริง ก่อนใช้งานหน้า Finance/ระบบจริง
- [x] รับคีย์ ThaiBulkSMS ชุดใหม่จากผู้ใช้และบันทึกใน Vault `ID&PSS/SMS/Blue_Fitness_ThaiBulkSMS.md` แล้ว (ไม่เก็บ secret ใน Git)
- [ ] เปลี่ยนคีย์ใน `.env.local`/Vercel เมื่อพร้อมใช้บัญชีลูกค้า; รอบนี้บันทึกอย่างเดียว ยังไม่ได้เปลี่ยน runtime
- [ ] ตรวจ `SMS_API_KEY`, `SMS_API_SECRET`, `SMS_SENDER_NAME` และเครดิต/ชื่อผู้ส่งที่อนุมัติแล้วก่อนกดขอ OTP (การทดสอบจริงมีค่า SMS)

## สิทธิ์ผู้ใช้ 4 ระดับ (ทดสอบทั้งการคลิกเมนูและพิมพ์ URL ตรง)

- [ ] Guest ไม่เห็น Account/Admin; เปิด `/member`, `/member/rewards`, `/member/benefits`, `/admin` และ `/admin/finance` แล้วถูกส่งไป Login
- [ ] MEMBER ดู Account ของตนได้ แต่เข้า `/admin` และ `/admin/finance` ไม่ได้
- [ ] ADMIN มีเมนู Admin และทำงานพนักงานได้ แต่ไม่เห็น Finance ใน sidebar; เปิด `/admin/finance` ตรงแล้วถูกปฏิเสธ
- [ ] OWNER เห็น Admin และ Finance; ใช้ Owner ตั้ง MEMBER เป็น ADMIN และปลดกลับเป็น MEMBER; Admin ไม่สามารถเรียก API เปลี่ยน role; OWNER คนอื่นไม่ถูกลดสิทธิ์
- [ ] ทดสอบ API `/api/test-services` (GET/POST) และ `/api/upload` สำหรับ Guest/Member ไม่ให้เข้าถึง; `/api/admin/roles` ให้เฉพาะ Owner
- [ ] ตรวจแดชบอร์ดและ endpoint อื่น ๆ ว่าไม่มีตัวเลขการเงินหรือข้อมูลสมาชิกหลุดให้ระดับที่ไม่ควรเห็น

## OTP / Session

- [ ] เบอร์ไม่อยู่ใน DB หรือถูกระงับไม่สามารถล็อกอิน; ไม่เปิดเผยว่ามีเบอร์ในระบบหรือไม่
- [ ] ขอ OTP แล้วได้รับ SMS จริง; ใส่รหัสผิด/หมดอายุ/ใช้ซ้ำ/เกินจำนวนครั้งแล้วล็อกอินไม่ได้; ขอรหัสถี่เกินลิมิตไม่ได้
- [ ] ล็อกอินสำเร็จแล้วรีเฟรชหน้าได้; cookie เป็น `httpOnly`, `Secure` บน HTTPS และไม่เก็บ OTP ใน browser storage
- [ ] ออกจากระบบแล้วเปิด URL เดิมไม่ได้; ปรับ role/ระงับสมาชิกใน DB แล้วสิทธิ์ของ session เดิมเปลี่ยนตามทันที
- [ ] ทดสอบพร้อมกัน 2 อุปกรณ์ และขณะ Neon/SMS ขัดข้องต้องไม่ให้สิทธิ์โดย fallback ไป mock

## สิ่งที่ยังต้องพัฒนาก่อนส่งลูกค้า

- [x] Register สร้างสมาชิกใน Neon หลังยืนยัน OTP; upload รูปหลังสมัครผ่าน session และบังคับขนาด/ชนิดไฟล์
- [ ] ย้ายการแก้ไข Account และข้อมูล Account อื่นจาก localStorage เข้าฐานข้อมูลจริง
- [ ] ย้ายสิทธิ์/แพ็กเกจ/คะแนน/คูปอง/Check-in/Finance และตรวจชำระเงินไปฝั่งเซิร์ฟเวอร์; ห้ามยืนยันการซื้อจาก mock
- [ ] เชื่อมหน้า Owner สำหรับตั้ง Admin หรือจัดทำ runbook ให้ Owner เรียก API อย่างปลอดภัย; เพิ่ม audit log การเปลี่ยนสิทธิ์
- [ ] ทดสอบเครื่องสแกน USB 4600s และกล้องจริง, ป้องกันสแกนซ้ำระดับธุรกรรม, ตรวจ PromptPay/EasySlip/Cloudinary/LINE ตาม TODO
