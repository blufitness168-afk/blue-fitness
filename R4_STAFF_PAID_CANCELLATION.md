# R4 — ยกเลิกเทอมต่ออายุแบบโอนที่ยังไม่เริ่ม

ทำเฉพาะ `STAFF_TRANSFER` ที่จับคู่กับเทอมเดิมได้และยังไม่เริ่ม ณ เวลาเขียนรายการ ไม่รวม `STAFF_FREE`, การยกเลิกก่อนส่งสลิป หรือ `PAID` ออนไลน์ ตัวเขียนขายเดิมไม่เปลี่ยน

- OWNER ใช้เซสชัน NORMAL ที่ยังใช้งานได้ ยืนยันว่า **คืนเงินเต็มจำนวนนอกระบบแล้ว** และระบุเหตุผล 1–240 ตัวอักษร ไม่ต้องมีเลขอ้างอิง ระบบไม่โอนเงินและไม่เรียก provider จำนวนเงินอ่านจากรายการขายที่ล็อกไว้ ไม่รับจาก client
- ถอนเฉพาะคะแนนต้นทางจาก sale เดียว สมาชิกต้องมียอดตรงกับยอดหลัง award และไม่พบการแลก/ใช้แต้มตั้งแต่บันทึกขาย แม้ยอดจะถูกเติมกลับแล้วก็ปฏิเสธ เทอมประเภทนี้ไม่ออกคูปอง หากเจอการใช้เทอม หลักฐานเปลี่ยน มีรายการถัดไป หรือมีรายการรอชำระ จะหยุดให้ OWNER ตรวจ
- ใช้ member lock เดียวกับการออกสิทธิ์ การซื้อออนไลน์ การเช็กอิน และการใช้แต้ม รายการต้นฉบับและ award ไม่เปลี่ยน; append-only audit ผูก `sale_id`, actor, เหตุผลและเวลา สร้างรายจ่ายคืนเงินแยกจากรายรับเดิมและ point reversal แยกจาก point award รายการซ้ำส่งผลเพียงครั้งเดียว
- เทอมที่ยกเลิกไม่ใช้ให้สิทธิ์, ไม่แสดงเป็นเทอมที่รอใช้ และไม่บล็อกซื้อออนไลน์/แก้ expiry อีก ส่วนการขายโดยเจ้าหน้าที่ซ้ำต่อ predecessor เดิมยังถูกห้ามตาม uniqueness เดิม

## API สำหรับ UI ที่ผู้ดูแลหน้าแอดมินจะเชื่อม

`GET /api/admin/members/{memberCode}/staff-transfer/cancellation` → `{ candidates: [{ saleId, packageName, startsAt, endsAt, amountSatang, pointsToReverse }] }` เป็นข้อมูล ณ ตอนอ่าน ไม่ใช่การจองสิทธิ์ยกเลิก

`POST` ที่ path เดียวกัน: `{ requestKey, saleId, reason, confirmedFullExternalRefund: true }` → `{ receipt: { saleId, source: "STAFF_TRANSFER_REFUND", status: "CANCELLED", cancelledAt, refundSatang, pointsReversed } }` ใช้ key และ body เดิมเมื่อผลไม่ชัด; **ห้ามย้ำให้คืนเงินอีกรอบ** หาก `409` ให้ส่งตรวจ ไม่สร้างรายการชดเชยเอง

## ติดตั้งภายหลังการตรวจ ACL

ลง `20261123_R4_staff_paid_cancellation.sql` หลัง `20261122_R4_staff_paid_transfer.sql` และ finance reader รุ่นจริง (October หรือ R5 ที่เตรียมไว้) ก่อนเปิด `ENABLE_STAFF_PAID_CANCELLATION=true` ค่าเริ่มต้นปิด ไม่เปิด grant ให้ PUBLIC. สำหรับ non-owner backend role ต้องตรวจสิทธิ์ `SELECT` ตาราง audit ใหม่สำหรับ SQL guard/admission/display, `INSERT` เฉพาะ backend ที่เรียก writer, `EXECUTE` ฟังก์ชันใหม่/ที่เรียกต่อ และ `SELECT` ของ reward/check-in/ledger ที่ eligibility ใช้ ทวน invoker grants ที่มีอยู่บน members/auth และ reference views; ไม่ให้ browser/client role อ่านตารางหรือเรียก RPC โดยตรง ปิด flag ได้โดยไม่ลบ records หรือถอน guard ที่ป้องกันการให้สิทธิ์ซ้ำ

ทดสอบ native PostgreSQL 18.4 ด้วย `scripts/r4-staff-paid-cancellation-postgres-test.py` บน October/R5: auth, boundary, spend/pending/later/drift, rollback/replay, lock waits, purchase release, kiosk/front desk, wallet และ OWNER finance. Export ใช้ finance reader เดียวกัน ไม่ได้ทดสอบ browser หรือ production ACL. Online cancellation ยังไม่เปิด: ไม่มีการ reconstruct ประวัติหรือเพิ่ม prospective writer ที่ตัวอ่านยังไม่รองรับครบ ดู `R4_ONLINE_CANCELLATION_BLOCKERS.md`.
