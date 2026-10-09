# Password authentication / welcome coupon migration

Migration นี้เป็น incremental SQL สำหรับฐานข้อมูลที่มี schema เดิม (`members`, `coupons`, `auth_otp_challenges`, `auth_signup_tickets`, `auth_sessions`) อยู่แล้ว ไม่ใช่ baseline หรือ migration journal ของ drizzle-kit

ยังไม่ได้รันบนฐานข้อมูลใด และไม่ควรใช้ `db:push` แทนโดยไม่ตรวจ schema diff

## ขั้นตอน deploy

1. สำรองข้อมูลและตรวจว่ามี unique constraint ของ `members.phone` ตาม schema เดิม
2. รันส่วน `ALTER TYPE` สามคำสั่งแรกของ `20261009_password_welcome.sql` แล้ว commit
3. รันคำสั่งที่เหลือใน transaction เดียว แล้ว commit
4. หยุด application instances รุ่นเก่า แล้วรัน `20261009_auth_review_hardening.sql` ต่อจาก migration แรก ก่อน deploy application รุ่นใหม่ (ถ้ารัน migration แรกแล้ว ให้รันเฉพาะ hardening ต่อได้)
5. ทดสอบสมัครใหม่บน test DB: ได้สมาชิก + session + `FREE_ENTRY` source `WELCOME_REGISTRATION` quota 1 หมดอายุ 30 วันใน statement เดียว เบอร์ซ้ำต้องไม่สร้างสมาชิก/คูปองใหม่
6. ทดสอบ password login, quota 5 ครั้ง/15 นาที, OTP setup/reset ticket ใช้ได้ครั้งเดียว และ reset แล้ว session เก่าใช้ไม่ได้

สมาชิกเดิมไม่มีการแจกคูปองย้อนหลัง และ `password_hash` เริ่มต้นเป็น NULL ให้ใช้ “ตั้งรหัสผ่านครั้งแรก” ผ่าน OTP ก่อนล็อกอิน ส่วน session ที่มีอยู่ยังใช้รูปแบบเดิมจนกว่าจะหมดอายุหรือถูก revoke เมื่อตั้ง/เปลี่ยนรหัสผ่าน

OTP `LOGIN` เดิมถูก invalidate และ endpoint ขอ LOGIN OTP คืน 410; verify OTP ไม่ออก session อีกต่อไป มีเพียง registration และ password setup/reset tickets ตาม purpose เท่านั้น

## สัญญาคูปองสำหรับทีม API/UI

Export `coupons` จาก `src/db/schema.ts` ฟิลด์เดิมทั้งหมดคงอยู่ เพิ่ม:

- `type` รองรับ `FREE_ENTRY` ร่วมกับชนิดเดิม
- `source: text | null`
- unique index `coupons_member_source_unique` บน `(member_id, source)` (NULL หลายรายการได้)
- welcome: `source = WELCOME_REGISTRATION`, `totalQuota = 1`, `usedCount = 0`, `bonusDaysValue = 0`, `status = AVAILABLE`, `expireDate = now() + 30 days`

ไม่มีการเรียก SMS จริงระหว่าง validation; flow runtime ยังใช้ SMS adapter เดิมและต้องมี environment keys ที่กำหนดไว้

## Auth review hardening

`20261009_auth_review_hardening.sql` เพิ่ม issuance credential snapshot ให้ OTP challenges และ `hash_started_at` ให้ signup/password tickets โดย invalidate password challenges/tickets เดิมทั้งหมด เพราะไม่สามารถพิสูจน์ snapshot ตอนออก OTP ย้อนหลังได้ ผู้ใช้ที่ค้างขั้นตอน recovery ต้องขอ OTP ใหม่

การ verify และ completion ใช้ serializable transactions พร้อมเช็ก snapshot ที่ออก OTP เทียบกับรหัสผ่านปัจจุบัน การ completion จะ invalidate challenges และ tickets recovery ที่เหลือ พร้อม revoke sessions ใน transaction เดียว หาก transaction แข่งกันจนเกิด serialization conflict จะไม่คืน ticket/ผลสำเร็จ

ก่อน scrypt ต้อง claim ticket ที่ยังไม่ถูกใช้และไม่หมดอายุแบบ atomic (password ticket ต้องตรง purpose และ credential snapshot; signup ต้องยังไม่มีบัญชีเบอร์นั้น) หนึ่ง ticket เริ่ม hash ได้เพียงครั้งเดียว ไม่มีการทำ hash จาก ticket ปลอม/expired/replayed และ final consume ยังตรวจ expiry/credential ซ้ำ หลังเริ่ม hash แล้ว หากงานล้มเหลว/ระบบเต็ม/เกิด serialization conflict ต้องขอ OTP ใหม่ ไม่ปลด claim เพื่อเปิด CPU replay

scrypt ทั้ง hash และ verify จำกัด 2 jobs พร้อมกันต่อ JS runtime ใช้ shared runtime state และปฏิเสธงานเกินทันทีด้วย HTTP 429 ไม่มี queue สะสม ตัว limit นี้ไม่ใช่ quota รวมทุก server instance; password login ยังมี persistent per-phone limit เดิม
