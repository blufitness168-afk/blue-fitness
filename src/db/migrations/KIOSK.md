# Kiosk USB • review / deploy / hardware UAT

สถานะ 2026-10-24: **reviewและapplyบนNeonแล้ว** พร้อมbackup `.local-db/backup-2026-10-24T07-03-23.548Z`; QR UATจริง BLU-5WELCOME/BLU-6EXPIREDสร้างแล้ว PNG+SVGใน `.local-db/kiosk-qr/` ทั้งคู่ยังไม่ถูกhardware/automationconsume

- Browser/API TEMPแยก:58checksผ่าน/1harnessmismatchที่/testเป็นdeny-bannerแทนredirect ยังป้องกันจริง; runtimeerrors0 และcleanupข้อมูลTEMPครบ
- Parentตรวจtests169/169,TypeScript,fulllintผ่าน; USBจริงผ่านเฉพาะการส่ง Enter และปฏิเสธ BLU-6 ตามบันทึกด้านล่าง ยังรอทดสอบ WELCOME/bounce/exit อย่าapplymigrationซ้ำหรือresetคูปองเพื่อทำให้ผ่าน

## Contract

- cookie เดิม `blu_session`; เพิ่ม `auth_sessions.mode` (`NORMAL` default / `KIOSK`) และ `device_id`.
- เข้า kiosk: แปลงเฉพาะ session ปัจจุบัน อายุไม่เกิน 12 ชั่วโมง ไม่เปลี่ยน role/password และไม่ revoke session อื่น token เดิมที่เคยคัดลอกก็กลายเป็น KIOSK ด้วย
- `getCurrentSession()` เป็นตัวอ่านข้อมูลฝั่ง server; `getCurrentMember()` คืน null ถ้าไม่ใช่ NORMAL. `requireKioskSession()` อ่าน session แยก ตรวจ role ADMIN/OWNER, ไม่ SUSPENDED, อายุ, revoke และสถานีทุกครั้ง
- API: POST `/api/kiosk/enter`, `/status`, `/scan`, `/exit`; JSON same-origin. scan ใช้ `{code:"BLU-123",requestKey:"UUID-v4"}`. ไม่รับ device จาก client
- `KIOSK_STATION_ID` ตั้งค่า server ต่อสถานี; default `LOCAL_FRONT_DESK`. เปลี่ยน config แล้ว kiosk เก่าจะใช้ไม่ได้
- ออก: รหัสผ่านบัญชีที่เปิดสถานี ผ่าน `loginPassword` throttle เดิม สร้าง NORMAL token ใหม่และ revoke kiosk ตัวเดิม ไม่บันทึกรหัสผ่านลง storage
- normal login ยังทำได้ด้วยรหัสผ่านบัญชีอื่น; public signup / OTP setup/reset ไม่ให้สิทธิ์ normal โดยอาศัย kiosk session
- DB function เช็ก staff session ซ้ำ มี session lock, request advisory lock และ member row lock จึงไม่อาศัย time bucket; request UUID เดิมคืนผลเดิม ใช้ UUID เดิมกับคนอื่นถูกปฏิเสธ
- same member/station ใน 3 วินาทีจากรายการสำเร็จล่าสุด = BOUNCE, ไม่ consume coupon หรือเพิ่ม visit; ต่างคนรับทันที. เข้าเท่านั้น ไม่มี checkout/คะแนน
- ACTIVE + expire_date อนาคต + snapshot timeSlot จาก paid order ล่าสุดเท่านั้น; legacy expiry ที่ไม่มีหลักฐานแพ็กเกจ fail closed. off-peak 07–14, all-day 07–22 ใช้เวลา DB Asia/Bangkok
- ถ้าไม่มี paid membership ที่ active ใช้ welcome FREE_ENTRY ที่ AVAILABLE/quota1/used0/ไม่หมดอายุและไม่เกิน 30 วันได้ แม้สถานะ PENDING/EXPIRED แต่ SUSPENDED ใช้ไม่ได้. คูปองกับ visit อยู่ transaction เดียว
- เปลี่ยน payment function predicates ที่มี token_hash=p_session ให้ต้อง mode NORMAL เพื่อกัน direct DB function session bypass; self-service coupon predicate บังคับ NORMAL ด้วย
- แสดงแค่ชื่อ/รูป ไม่ส่ง phone/PID/points ใน scan result. ล้างผลจอ 8 วินาที; expiry/role revocation ปิดการใช้งาน ไม่ grant normal อัตโนมัติ

## Deploy หลัง review

1. อ่าน `20261024_kiosk.sql` และ auth changes ก่อน deploy application: app ใหม่ต้องมี column mode จึงทำงานได้
2. `node scripts/db-kiosk-migrate.mjs` แสดง SHA และคำสั่ง apply (prepare-only ไม่ต่อ DB)
3. reviewer ใช้คำสั่ง `--apply --reviewed-sha <SHA ที่ตรวจแล้ว>` ที่ script แสดง: รันทดสอบ isolated SQL, backup+verify, เก็บ functions-before, lock+snapshot drift guards และ apply transaction เดียว. ไม่ใช้ `db:push`
4. ตั้ง `KIOSK_STATION_ID` ให้คงที่ แล้ว restart/deploy application
5. หลัง review จึงรัน `node scripts/kiosk-fixtures.mjs --apply`: backup+verify แล้วสร้างสมาชิก UAT ใหม่สองคน ไม่มี password/SMS/PAID order/คะแนน ไม่แก้ OWNER เดิม
6. artifacts จริงหลัง apply: `.local-db/kiosk-qr/WELCOME.svg`, `EXPIRED.svg`, และ manifest `.local-db/kiosk-fixtures.json`; เตรียมอย่างเดียวได้ด้วย `node scripts/kiosk-fixtures.mjs --preflight`

## ตั้งค่าเครื่อง CHIYPOS 4600S (ยืนยันเครื่องจริง 2026-10-24)

- รุ่นบนฉลาก: **CHIYPOS 4600S / REV:A**, USB Keyboard Wedge
- ใช้คู่มือกระดาษที่มากับเครื่อง หัวข้อ **5. Function configuration**: สแกนบาร์โค้ด **Add CR suffix** 1 ครั้ง เพื่อส่ง Enter ท้ายรหัส
- ไม่ต้องสแกน Factory Defaults, USB COM หรือ Add CR suffix and LF suffix
- ภาษาแป้นพิมพ์ Windows ต้องเป็น **ENG**; ภาษาไทยทำให้รหัส BLU ถูกพิมพ์เป็นอักษรไทย
- ก่อนตั้งค่า รหัสค้างในช่องและสแกนต่อแล้วข้อความติดกัน ต้องกด Enter เอง
- หลังตั้งค่า ผู้ใช้ยืนยันสแกน QR **BLU-6 (EXPIRED)** โดยไม่กด Enter เองสำเร็จ ระบบส่งคำขอและปฏิเสธอัตโนมัติ เป็นผลจากอุปกรณ์จริง ไม่ใช่ Playwright
- **BLU-5 (WELCOME) ผ่านการสแกนเครื่องจริง**: ภาพผู้ใช้แสดงชื่อ `UAT_KIOSK_20261024_WELCOME` พร้อมผลเขียว “เข้าใช้บริการได้ • ใช้คูปองฟรี 1 ครั้งแล้ว” และช่องสแกนว่าง
- สแกน BLU-5 ซ้ำในขั้นทดสอบหลังรอเกิน 3 วินาที: ภาพผู้ใช้แสดงผลแดง “ไม่มีสิทธิ์ใช้งานที่ยังใช้ได้ กรุณาติดต่อพนักงาน” และช่องสแกนว่าง ตรงตามสิทธิ์ฟรีใช้ครั้งเดียว (ไม่มี timestamp จากภาพยืนยันช่วงเวลาที่แน่นอน)
- ตรวจ Neon หลัง hardware แบบ read-only แล้ว: BLU-5 visit1/coupon USED used1จากquota1/points0/visit_points0; BLU-6 visit0/used0/points0; kiosk_requests คนละ2รายการ ไม่มี duplicate visit ไม่มีแก้ข้อมูล
- ผู้ใช้ยืนยันออก Kiosk ด้วยรหัสถูกสำเร็จและแสดงหน้า admin; รหัสผิดผ่าน fixture browser/API แล้วแต่ยังไม่มีผู้ใช้ยืนยัน manual
- ยังไม่ยืนยัน hardware bounce ภายใน 3 วินาที จึงยังไม่สรุป hardware UAT ทั้งชุดผ่าน
- อ้างอิงภาพคู่มือและภาพบาร์โค้ด Add CR suffix ที่ผู้ใช้ส่งในแชต; ยังไม่ได้เก็บไฟล์ภาพลง repository ห้ามสร้างหรือเดาบาร์โค้ดตั้งค่าทดแทน

## Hardware flow

- ADMIN/OWNER ล็อกอินบัญชีตัวเอง → เมนู **เปิดสถานี Kiosk USB** (`/admin/kiosk`) → เปิด kiosk
- USB scanner เป็น Keyboard Wedge พร้อม suffix **Enter**; ไม่ใช้ auto-submit ตามความยาว 10 ตัว. input ต้องมี focus. หากพิมพ์เอง ให้ Enter เช่นกัน
- WELCOME QR ครั้งแรกในเวลาทำการผ่าน; ภายใน 3 วินาทีไม่เพิ่ม visit; เกิน 3 วินาทีปฏิเสธเพราะคูปองใช้แล้ว. EXPIRED QR ปฏิเสธ. ไม่มี reset คูปองอัตโนมัติ ต้องให้ operator ตรวจ audit ก่อนสร้าง UAT ชุดใหม่
- ต่างคนสแกนได้ทันทีเมื่อ request ก่อนหน้าสิ้นสุด ไม่ติด global cooldown; ระหว่าง request ป้องกันการซ้อน
- Network timeout: กด **ลองคำขอเดิม** ใช้ UUID เดิม ห้ามสร้าง scan ใหม่เพื่อเดาผล
- ปุ่มพนักงานออก kiosk → PasswordInput → รหัสผ่านบัญชีเดิม; รหัสผิด/ถูก throttle ต้องยังเป็น kiosk
- ทดสอบ direct URL/API ด้วย cookie kiosk: admin pages, member/payment-account, create/read/verify payments, upload, roles, diagnostics และ self-service coupon ต้องถูกปฏิเสธ ไม่ใช่แค่ซ่อนเมนู
- ลอง role MEMBER/SUSPENDED/revoked/expired ระหว่างเปิดหน้าจอ: scan ถูกปฏิเสธทันที; health refresh ภายใน 30 วินาที
- Fullscreen เป็น browser-only ไม่ป้องกัน OS escape; kiosk OS policy/physical security เป็นงานตั้งค่าเครื่องแยก

## Validation

- `node --test src/lib/kiosk-server.test.mjs src/lib/auth/*.test.mjs src/lib/admin-permissions.test.mjs src/lib/benefits-coupons.test.mjs src/db/schema.test.mjs`
- `node scripts/kiosk-sql-tests.mjs`: disposable PostgreSQL WASM, deterministic clock เฉพาะ test, ไม่ต่อฐานจริง/SMS/payment provider. ครอบคลุม SQL compile, session/role/station, replay, bounce, one-use welcome, real-rights fail closed, hours และ zero points
- `pnpm exec tsc --noEmit`; targeted ESLint
- ข้อจำกัด: WASM connection เดียวไม่พิสูจน์ multi-connection blocking. ยังต้องทดสอบ concurrency บน disposable PostgreSQL จริง + browser/hardware หลัง reviewer apply migration. อย่าอ้างว่า hardware UAT ผ่านก่อนทำจริง
- เก็บ kiosk_requests ตาม retention ที่ตกลงก่อนใช้งานระยะยาว: เป็น audit มีชื่อ/รูป snapshot ห้ามลบเร็วกว่า retry window ที่รับรอง มิฉะนั้น request key เก่าอาจถูกใช้ใหม่ได้
