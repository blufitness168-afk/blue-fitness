# R4 — Staff free continuation foundation (19 พ.ย. 2026)

**ยังไม่เปิดใช้ production.** บันทึกด้านล่างเป็น checkpoint ของ foundation เดิม; ความคืบหน้าล่าสุดอยู่ในหัวข้อถัดไป

## Follow-up: writer + check-in + รายงาน (ฐานแยก)

- ลำดับ SQL: `20261119_R4_staff_free_foundation.sql` → `20261119_R4_staff_free_admission.sql` → `20261119_R4_staff_free_finance.sql` → `20261119_R4_staff_free_writer.sql` หลัง R3 และหลัง finance reader รุ่นที่จะใช้งาน หากลง R5 ภายหลังต้องทวน reader; writer ปฏิเสธเมื่อ reader ที่จำเป็นไม่พร้อมหรือมี R6/R7 ที่ยังไม่รองรับ
- `/api/admin/members/[memberCode]/staff-free` และฟอร์มใช้ writer จริง ไม่ใช่ prototype. `ENABLE_STAFF_FREE` เป็น server-side flag ปิดโดยปริยาย. ใช้ offer จากฐาน, ยืนยันเทอมเดิมพร้อมเหตุผล, และส่ง UUID/body เดิมซ้ำเมื่อผลไม่ชัด. ผลตอบกลับมีเฉพาะใบรับรายการ 0 บาท ไม่ใช่ประวัติการเงิน
- Native PostgreSQL 18.4 รันทั้ง October/R5 ด้วย writer จริง: rollback, คำขอซ้ำพร้อมกันคนละ connection, key conflict, duplicate term rejection, OWNER-only finance และเช็กอิน/Excel จากรายการเดียวกันผ่าน. Regression หน้า member/finance/xlsx 16/16; TypeScript, scoped ESLint และ build ผ่าน
- **ไม่ใช่ production acceptance:** ต้องยืนยันสิทธิ์ฐานและซ้อมด้วยสำเนา production, ทวนการแสดงวันหมดอายุในหน้าสมาชิกและผลซื้อออนไลน์ระหว่างมีเทอมฟรีก่อนเปิดจริง. ขอบเขตปัจจุบันคือ PAID เดี่ยว SKU เดิมที่ไม่มีของแถมเท่านั้น ไม่ครอบคลุมรับเงิน ลงย้อนหลัง ยกเลิก/คืนเงิน หรือสิทธิ์เสริม ยังไม่ได้ apply, เปิด flag หรือ deploy

ยึด TODO R0/R4 และคำยืนยันล่าสุดใน `CLIENT_BRIEF_HANDOFF.md` แทนข้อความเรื่อง R0 ยังไม่ตอบใน `R4_PROVENANCE_HANDOFF.md` เดิม รอบนี้ทำเฉพาะการต่อปัจจุบัน 0 บาท; ไม่ทำ OWNER backdate, จ่ายจริง, refund หรือถอนสิทธิ์ ข้อกำหนด R0 สำหรับกรณีที่ต้องหยุดให้ OWNER ตรวจยังคงเดิม ไม่ได้เพิ่มฟังก์ชันยกเลิก ไม่มีการแก้ Next.js/UI/API

## ที่เพิ่ม

- `src/db/migrations/20261119_R4_staff_free_foundation.sql`: private schema, ตาราง `free_sales` append-only, view ภายใน `finance_source` ไม่มี writer, grant ให้แอป, backfill หรือ hook บนตารางเดิม หนึ่งแถวคือรายการขายเจ้าหน้าที่ 0 สตางค์ (`STAFF_FREE`), ที่มาของช่วงสิทธิ์ที่เสนอ และ audit ของผู้ทำรายการ เหตุผล request key และเวลาจาก DB view ใช้ `staff-free:<sale_id>` และวันที่กรุงเทพฯ จาก `occurred_at` โดยอ่านยอดจริง 0 ไม่ใช้ราคาหน้าร้านในรายรับ ไม่มี PAID/slip/bank order และไม่มี manual income ซ้ำ
- `scripts/r4-staff-free-writer-test-only.sql`: **ต้นแบบสำหรับ scratch DB เท่านั้น ไม่ใช่ migration** ทวนสถานะ/role ของ ADMIN หรือ OWNER และ session `NORMAL` ที่ยังใช้ได้ทุกครั้งรวม replay ผูก UUID กับ actor และ input ที่ normalize แล้ว ล็อก request/สมาชิก เก็บ snapshot catalog ปัจจุบันตาม version และคืนเฉพาะ candidate ID, ยอดรายการ 0 และ `enabled:false` ไม่มีราคา catalog หรือประวัติการเงินในผลลัพธ์
- ต้นแบบรับเฉพาะสมาชิกที่ `r3_override_current_order` พิสูจน์ว่าเป็น PAID เดี่ยวที่ยังมีผล, ไม่มี PENDING, ต่อ SKU เดิมที่เปิดอยู่ และ catalog ไม่มีโบนัสแต้ม/วันหรือคูปองเพิ่ม หนึ่ง continuation ต่อ predecessor; ช่วงที่เสนอเริ่มตรง expiry ของออเดอร์อ้างอิงและจบหลังจำนวนวันใน snapshot (วันละ 24 ชั่วโมง) ข้อจำกัดเหล่านี้เป็นขอบเขตทดสอบแบบอนุรักษนิยม ไม่ใช่กติกาลูกค้าเพิ่ม ต้นแบบไม่แก้วันหมดอายุ สถานะ แต้ม คูปอง ประวัติ หรือยอดเดิม

## ผลที่รันจริง

```sh
python scripts/r4-staff-free-postgres-test.py --bin-dir .local-db/portable-postgres-uat/package/native/bin --psql .local-db/portable-postgres-uat/psql.exe
node --test src/lib/entitlement-online-provenance.test.mjs src/lib/real-finance-r5.test.mjs src/lib/real-checkin-r7.test.mjs src/lib/brief-combined-migrations.test.mjs
pnpm exec tsc --noEmit --incremental false
```

- Native PostgreSQL 18.4 ผ่านทั้ง 3 กลุ่ม: migration ไม่มี writer/backfill/grant, auth/eligibility/idempotency/audit/rollback/finance source, และหลาย connection (key เดิมคืน receipt เดิม; สอง actor แข่งกันขายให้ predecessor เดียวสำเร็จหนึ่งรายการ) ใช้ scratch loopback cluster และข้อมูลสังเคราะห์ ทดสอบกับ migrations payment/catalog/โบนัส/override, online provenance และ R5 reader บน fixture; เปรียบเทียบข้อมูลเดิมและผลรายงาน OWNER ก่อน–หลัง รวมถึงยืนยัน ADMIN อ่านรายงานไม่ได้ ไม่ใช่การทดสอบ production ACL หรือ restore
- Existing isolated regressions ผ่าน 10/10 ไม่ข้าม และ TypeScript ผ่าน ไม่ได้รัน browser UAT
- ไม่เชื่อมฐานจริง ไม่ apply/deploy ไม่ใช้ Git ไม่เรียกผู้ให้บริการ และไม่แก้ TODO, migrations เดิม, R3 override/supplement หรือ finance/payment clients

## เงื่อนไขก่อนเปิด

1. ยังไม่ได้ใช้ term นี้เป็นสิทธิ์เข้าใช้จริง: kiosk และ front desk ยังอ่าน `members.expire_date` และ PAID เดิม ต้องให้ทุกทางเข้าที่เกี่ยวข้องอ่าน/บันทึก source ของ term จริง พร้อมกติกาเมื่อชนซื้อออนไลน์, expiry, override และ supplement ทดสอบขอบเวลาและ concurrency กับ settlement ไม่อนุมานหรือเติมประวัติที่พิสูจน์ไม่ได้
2. Private `finance_source` ไม่ได้ถูกรายงานอ่าน ต้องรวมรายการ 0 บาทในรายงาน/ส่งออก OWNER โดยไม่ตัดศูนย์ทิ้งหรือ double-count และพิสูจน์ว่า ADMIN คืนข้อมูลได้เฉพาะรายการที่ทำ ไม่ให้สิทธิ์อ่านตาราง/view โดยตรง
3. จนกว่าทั้งสองเส้นทางผ่าน end-to-end และตรวจ ACL จริง **ห้ามติดตั้งตัวเขียนต้นแบบ เพิ่ม app grant เปิด endpoint หรือแสดง success ใน UI** ในงานรอบนี้ไม่มี production state ให้ rollback
