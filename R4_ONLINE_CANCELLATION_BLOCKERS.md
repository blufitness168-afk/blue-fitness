# R4 — ยกเลิกแพ็กเกจออนไลน์ PAID: ยังไม่เปิดใช้งาน

ยึด `TODO.md` R0/R4: OWNER บันทึกการคืนเงินเต็มจำนวนที่ทำ **นอกระบบ** และถอนเฉพาะสิทธิ์จากรายการนั้น โดยเก็บ `PAID` และประวัติธุรกรรมเดิม ถ้าใช้แต้ม/คูปองแล้ว แต้มไม่พอ มีเทอมต่อเนื่อง หรือที่มาไม่ชัด ให้หยุดเพื่อให้ OWNER ตรวจ ไม่ใช่ให้ override เงื่อนไขได้

## ทำไมไม่เพิ่ม migration ในรอบนี้

- **หลักฐานเทอมยังไม่พอสำหรับย้อนสถานะเดิม:** `20261118_R4_online_provenance.sql` เก็บ snapshot, วันยืนยัน, expiry รวมหลังจ่าย และ point ledger ต้นทาง ไม่ได้เก็บ expiry/status ก่อนจ่าย หรือความสัมพันธ์กับเทอมเดิม การที่ `r3_override_current_order` ผ่าน (`expiry = confirmed_at + duration` และมี PAID เดี่ยว) ไม่ได้บอกว่าก่อนจ่ายไม่มี expiry หรือมี expiry ที่หมดไปแล้ว จึงไม่ควรคืนค่าเดิมด้วยการลบวันหรือเดา ไม่มี backfill สำหรับ PAID เก่า
- **การเพิ่ม cancellation row อย่างเดียวไม่ถอนสิทธิ์:** kiosk/front desk ในสาย R3 + R4 staff-free ยังใช้ PAID snapshot คู่กับ `members.expire_date` สำหรับ online admission; R6/R7 มีทางอ่านเพิ่มเติมเมื่อใช้ stack นั้น SQL ใหม่อาจปรับตัวอ่าน SQL ได้ แต่ไม่ครอบคลุมตัวอ่านโดยตรงในแอปที่ห้ามแก้รอบนี้
- **แก้ aggregate อย่างเดียวไม่ทำให้ผลอ่านสอดคล้อง:** `src/lib/payment-server.ts` (`paymentAccount`) อ่านออเดอร์โดยตรงและใช้ PAID ล่าสุดเป็น `package` แยกจากประวัติ; `src/components/RealPaymentAccount.tsx` แสดงชื่อนั้นและช่วงเวลาแม้สถานะสมาชิกหมดอายุ อีกทั้ง `src/lib/real-member-wallet-server.ts` อ่าน ledger โดยตรงและรวมเฉพาะ award/spend เดิม จึงจะเห็นยอดลดโดยไม่มีรายการชดเชยอธิบาย การซ่อนหรือตีสถานะ PAID ใหม่ที่ต้นทางเพื่อหลบตัวอ่านขัดกับการเก็บประวัติ ไม่ควรใช้ zero-point SKU เป็นทางเลี่ยง เพราะตัวอ่านแพ็กเกจยังไม่แยกการยกเลิก
- **แต้มและการเงินต้องเห็นรายการชดเชยจริง:** payment ledger ระบุแหล่งที่มาของแต้มที่ได้ แต่ reward spend ใช้ยอดรวมและไม่ระบุว่าใช้แต้มจากออเดอร์ใด ยอดปัจจุบันพอไม่ใช่หลักฐานว่าไม่ได้ใช้แต้มรายการนั้น รายรับ online เดิมใน `real_finance_action` ต้องยังอยู่ และรายงาน/ส่งออกต้องเห็น refund แยกเพียงครั้งเดียว ไม่ใช่บันทึก refund ไว้ในตารางที่ไม่มีผู้อ่าน หรือใช้ช่องทางยกเลิก PENDING/ปิดผลตรวจสลิปแทน

## ขอบเขตขั้นต่ำเมื่ออนุญาตให้แก้ตัวอ่านและ OWNER workflow

1. จับหลักฐานเทอมและ aggregate ก่อน/หลังจาก settlement ภายใน transaction เดียวสำหรับรายการใหม่เท่านั้น หรืออ้างเทอมที่พิสูจน์ได้อยู่แล้ว ให้รายการที่พิสูจน์ไม่ได้เป็น manual review ตรวจเทอมถัดไป/ที่จองไว้, pending settlement, usage ของคูปอง/แต้ม และความสอดคล้องของยอด/ledger ภายใต้ member lock เดียวกับ writers ที่เกี่ยวข้อง หากประวัติการใช้แต้มไม่รู้แหล่ง ให้ปฏิเสธเมื่ออาจใช้แต้มจากรายการนี้ แม้ยอดรวมจะพอ
2. ให้ OWNER session แบบ NORMAL ที่ยังใช้ได้บันทึกหลักฐานยืนยันการคืนเต็มตามยอดจริงที่ชำระแล้ว (ไม่เรียก provider) สร้าง audit/offset เงิน แต้ม และการถอนเทอมหรือคูปองที่พิสูจน์ที่มาแบบ atomic ไม่แก้ PAID snapshot, original award, verification หรือ transfer ref จับคู่ request key กับ actor และ canonical payload และบังคับหนึ่ง cancellation/หนึ่งชุดผลต่อ order แม้แข่งกันคนละ key
3. ให้ทางอ่านสิทธิ์จริงและหน้าบัญชีแยก current entitlement จาก purchase history; wallet รวม point compensation และ finance/Excel รวม refund แยกจากรายรับเดิม ตรวจ settlement replay, การซื้อใหม่หลังยกเลิก, check-in/benefit use พร้อมกัน, rollback, ACL/retry และตัวอ่านทุก stack ที่จะรองรับ ก่อนเปิด writer

## ทดสอบจริง (เฉพาะฐานสังเคราะห์)

- `scripts/r4-online-cancellation-blockers-postgres-test.py`: PostgreSQL 18.4 บน scratch loopback cluster ผ่าน สองสถานะก่อนจ่ายต่างกันแต่ผ่าน proof เดี่ยวแบบเดียวกัน; test-only cancellation marker ยังให้ `PAID_ENTRY` ผ่าน front desk จริง; การ clamp aggregate แบบสาธิตหยุด scan ใหม่ใน fixture แต่ query แบบ payment account ยังเลือก snapshot เดิมและ PAID ทั้งแถวไม่เปลี่ยน การสาธิต rollback ทั้งหมด และไม่ได้ทดสอบว่า clamp เป็นวิธีถอนที่ถูกต้อง
- `scripts/r4-staff-free-cancellation-postgres-test.py`: regression native ผ่านทั้ง October/R5 รวม lock contention, replay, rollback, admission/display/finance, การปฏิเสธเมื่อใช้หรือมีรายการถัดไป และ purchase guard ของ **staff-free** ไม่ใช่ผลผ่านของ online cancellation
- รันด้วย `python -B scripts/<ชื่อไฟล์ข้างต้น> --bin-dir .local-db/portable-postgres-uat/package/native/bin --psql .local-db/portable-postgres-uat/psql.exe` ไม่โหลด env แอป/ไม่ใช้ production, Git หรือ provider อ่าน `AGENTS.md` และ Route Handlers/`route.js` docs จาก Next 16.3.3 ที่ resolve จริงแล้ว

ไม่มี migration, writer, grant, ปุ่ม, การเปลี่ยน TODO, การแก้ app หรือการเปลี่ยนงานยกเลิกก่อนส่งสลิปในรอบนี้
