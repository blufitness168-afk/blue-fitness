# 📋 MASTER TODO: Blu Fitness (แผนบรีฟยืนยันล่าสุด 17/11/2026)

## รายการแก้ไขจากฟีดแบ็กลูกค้า — 23 พ.ย. 2026

> อ้างอิงข้อความและแคปหน้าจอจากลูกค้าวันที่ 23/11/2026: แยกเป็น 3 กลุ่มเพื่อแก้จุดที่ปลอดภัยทันทีและกันรายการที่กระทบ schema/R0 รอยืนยันก่อน

### กลุ่มที่ 1 — แก้ไขแล้วในรอบนี้ (UI/UX ปลอดภัย ไม่กระทบฐานข้อมูล)
- [x] หน้าคูปองสมาชิก (`WelcomeCoupons.tsx` + `AccountClient.tsx`): เพิ่มข้อความภาษาอังกฤษครบเมื่อสลับโหมด EN และลบคำอธิบายเก่าเรื่อง *"ประวัติเช็กอิน mock ของแอดมิน"*
- [x] ฟอร์มเปลี่ยนรูปสมาชิกโดยเจ้าหน้าที่ (`StaffAvatarForm.tsx`): แก้ช่อง input "เหตุผล" จาก `bg-slate-800` เป็นพื้นขาวตัวอักษรเข้ม พร้อมปรับปุ่มบันทึก `text-white` ให้อ่านชัดเจน
- [x] หน้ารายละเอียดสมาชิก (`admin-members-server.ts` + `MemberDetailClient.tsx`): ดึงและแสดงรูปโปรไฟล์สมาชิก (หรือป้าย *"ไม่มีรูป"*) ในส่วนหัวของหน้าโปรไฟล์สมาชิก
- [x] หน้าคลังรางวัล (`/admin/rewards`): แสดงภาพตัวอย่างทันทีเมื่อมีรูป และแสดงรูป thumbnail ของแต่ละรางวัลในรายการ
- [x] หน้าโค้ดส่วนลด (`BenefitsAdminClient.tsx` โหมด `PROMO`): ปรับช่องกรอก `มูลค่าส่วนลด`, `ยอดขั้นต่ำ`, `ยอดซื้อสูงสุดก่อนลด`, `ลดสูงสุด` จากหน่วย **สตางค์** เป็น **บาท** (แปลงเป็นสตางค์อัตโนมัติก่อนส่ง) และแสดงรายการเป็นหน่วยบาทเพื่อกันกรอกตัวเลขผิดหน่วย
- [x] หน้าชำระแพ็กเกจ (`payment-server.ts`) และกราฟ Dashboard (`AdminDashboardCharts.tsx`): แยกข้อความ error เมื่อใช้โค้ดส่วนลดไม่ได้ให้ชัดเจนขึ้น และจัดเส้นศูนย์ (`0`) ของกราฟเงินให้อยู่กึ่งกลางเมื่อมีค่ารับ–จ่ายทั้งบวกและลบ

### กลุ่มที่ 2 — งานตั้งค่า / ชี้แจงลูกค้า / ความปลอดภัย
- [ ] เปิด server env flags บน Vercel Production (รวม `R6_CHECKOUT_COUPONS_ENABLED="true"` เพื่อปลดล็อกคูปองประเภทส่วนลด/เพิ่มแต้มในหน้าสร้างคูปอง)
- [ ] ชี้แจงลูกค้าเรื่องแถว "รายรับแพ็กเกจ" ในหน้ารายรับ–รายจ่ายที่ขึ้น **"ล็อก"**: เป็นรายการอัตโนมัติจากระบบชำระเงินที่ตั้งใจล็อกตามหลักบัญชี ไม่ให้แก้ทับสลิป (ส่วนรายการ manual สามารถกดแก้ไขได้ปกติ)
- [x] ย้ายโฟลเดอร์ `public/issue/` ไปไว้ที่ `.local-db/issue/` (อยู่ใน `.gitignore` และไม่ถูกเสิร์ฟสาธารณะแล้ว)

### กลุ่มที่ 3 — ฟีเจอร์เพิ่ม / เปลี่ยนจากสเปกเดิม (รอตัดสินใจและยืนยันขอบเขตก่อนลงมือทำ)
- [ ] โค้ดส่วนลดเปอร์เซ็นต์แบบมีทศนิยม (เช่น `9.1%`): ปัจจุบัน DB/SQL (`benefit_definitions.discount_value`) เป็นจำนวนเต็มและยังต้องกำหนดกติกาการปัดเศษสตางค์
- [ ] Dashboard (`/admin`): เพิ่มตัวกรองแบบ **ช่วงวันที่** (เช่น `1 - 15 ม.ค.`) และ **ช่วงเดือน** (เช่น `ม.ค. - มี.ค.`) พร้อมอัปเดตตัวเลขการ์ดและกราฟให้ตรงตามช่วงที่เลือก
- [ ] หน้าโปรไฟล์สมาชิก (`/admin/members/[memberCode]`): คำขอให้ OWNER กำหนดวันหมดอายุเอง (เว้นว่าง = ไม่หมดอายุ) และเพิ่มสถานะ `สมาชิก / เทรนเนอร์ / พนักงาน / อื่นๆ` (ขัดกับข้อตกลง R0 เดิมที่ล็อก role แค่ MEMBER/ADMIN/OWNER และไม่แก้ `expire_date` ลอยๆ)

---

## แผนดำเนินงานบรีฟลูกค้าล่าสุด — 17 พ.ย. 2026

> เริ่มอ่าน `CLIENT_BRIEF_HANDOFF.md` ก่อน: รวมรายละเอียดบรีฟ คำตอบลูกค้า สมมติฐานข้อ 5 ขอบเขตที่ไม่รวม และข้อควรระวังข้อมูลเดิม สำหรับทำต่อข้ามแชต

> ส่วนนี้เป็นแผนหลักสำหรับรอบถัดไป ส่วนด้านล่างเป็นประวัติ ไม่ถือว่า checkbox เก่าเป็นหลักฐานว่าบรีฟใหม่เสร็จแล้ว ทำตามลำดับพร้อมผ่าน checkpoint แต่ละรอบ ไม่รวบแก้ทุกระบบแล้วค่อยตรวจท้ายงาน
> มี implementation บางส่วนแล้ว ดูบันทึกสถานะและหลักฐานด้านล่าง ไม่ใช่ production acceptance; migration ใหม่ทั้งหมดเป็น prepare-only ยังไม่ apply/deploy

### วิธีเดินงานทุกเฟสและรายการที่ต้องอาศัยผู้ใช้

- เมื่อผู้ใช้สั่งให้เริ่มหรือทำเฟสต่อ ให้ทำงานในเฟสนั้นต่อเนื่องจนจบส่วนที่ทำเองได้ รวมถึงทดสอบและบันทึกผล ไม่หยุดขออนุมัติทีละขั้นในขอบเขตที่อนุมัติแล้ว
- แยกงานที่ทำเองได้ออกจากงานที่ต้องมีคนหน้างาน ข้อมูล/สิทธิ์ที่ยังไม่มี หรือการอนุมัติเฉพาะเรื่อง ระบุเฟส สิ่งที่ต้องทำ และเหตุผลไว้ด้านล่าง พักเฉพาะงานนั้นแล้วเดินส่วนอื่นต่อ ห้ามใช้ mock หรือข้อมูลเทียมแทนหลักฐานตรวจรับ production
- จบเฟสแล้วสรุป **ทำเสร็จและตรวจแล้ว / ยังต้องทำต่อเอง / ต้องอาศัยผู้ใช้** พร้อมแนะนำว่าปิดเฟสหรือพักงานแล้วไปต่อได้หรือไม่ ไม่ติ๊กงานที่ยังไม่ได้ตรวจ และไม่เริ่มเฟสถัดไปเองก่อนสรุปกับผู้ใช้ เว้นแต่ได้รับคำสั่งให้ไปต่อแล้ว

| เฟส | งานที่ทำเองไม่ได้ภายใต้เงื่อนไขปัจจุบัน | สิ่งที่ต้องมี |
|---|---|---|
| R2 | ยืนยันสแกนบัตรผ่านเครื่อง USB จริง | คนหน้างานสแกนบัตรทดสอบด้วยเครื่องจริง; Web/API UAT ไม่แทนผลเครื่อง |
| R3 | ยืนยันซื้อแล้วได้โบนัสบน production | รายการชำระเงินจริงที่ได้รับอนุญาต ไม่โอนหรือสร้างสลิปเทียมแทน |
| R3 | ยืนยันบันทึก override บน production สำเร็จ | บัญชี UAT ที่มีแพ็กเกจหลักจริงและมีสิทธิ์อยู่; ใช้บัญชีที่มีอยู่ได้โดยไม่ต้องจ่ายเพิ่ม |

### สถานะล่าสุด R1–R8 — ใช้แทน checkpoint เก่าด้านล่าง

| เฟส | ทำแล้ว / หลักฐาน | ยังไม่ใช่งานทดสอบอย่างเดียว |
|---|---|---|
| R1–R2 | มี matrix และแผน migration; R2 software UAT ผ่านตามบันทึกเดิม | ตรวจ grants และสร้างแผน rollout ของชุดรวมก่อนใช้ production; USB จริงเป็น UAT หน้างาน |
| R3–R4 | R3 catalog/โบนัส/override ขึ้นแล้ว; ชุดรวมผูกสิทธิ์เสริมกับ staff sale และ online renewal ที่มีหลักฐานหลังถึงวันเริ่ม; R4 ต่ออายุฟรี/โอน ไม่มีเงินสด บล็อกซื้อออนไลน์ก่อนสร้างออเดอร์/QR เมื่อมีเทอม staff จองอยู่ และ OWNER บันทึกคืนเต็มนอกระบบตามเงื่อนไข | PAID เก่าทับซ้อน/ก่อนมีหลักฐานไม่เดาต้นทาง; เวลา override ยังจำกัดตามหลักฐาน R3 เดิม; ฐานที่ลง R6/R7 standalone แล้วไม่มีทางแปลงที่ตรวจรับ |
| R5 | OWNER CSV import, จัดหมวดซื้อออนไลน์ที่พิสูจน์อายุเทอมก่อนหน้าได้, เก็บรายรับเดิม/แยกค่าใช้จ่ายคืนเงิน; XLSX เดิมอ่าน ledger เดียวกัน | รายการเก่ากำกวมคงหมวดแพ็กเกจ; ตัวอ่านยังโหลด ledger/audit ทั้งชุด ไม่ได้เพิ่ม server-side pagination |
| R6 | คูปองทั่วไปและ checkout ส่วนลด/แต้มพร้อมเพดาน, โควตาและประวัติ; โปรโมโค้ดมีรายละเอียดและโควต้าผู้รับแยก; แจกทีละคนด้วยสิทธิ์ที่พิสูจน์ได้และยืนยันก่อนแจก | ไม่เดาสิทธิ์จากประวัติกำกวม/เทอมที่ยังไม่เริ่ม; Checkout เสนอได้สูงสุด 100 ใบ; ใบที่จองแล้วและการโอนไม่ชัดเจนไม่คืนสิทธิ์อัตโนมัติ |
| R7 | ใช้ visit เปิดเดียวกันทั้ง kiosk/frontdesk; OWNER บันทึก IN/OUT ย้อนหลังอ้าง online order หรือ staff sale ที่พิสูจน์ได้; ไม่มี OUT เทียมและไม่เพิ่มแต้ม | รอ rollout ตาม stack ที่รองรับและตรวจอุปกรณ์จริง |
| R8 | ตัวกรองสิทธิ์ปัจจุบันใช้แหล่งเดียวกับ R6; ส่งผู้รับเข้า flow คูปองให้ตรวจ/ยืนยัน, ลิงก์ต่ออายุ, เพิ่มค้นชื่อรางวัล, ประวัติเข้า/ออกและสรุปใกล้หมดอายุเดือนปัจจุบัน | สรุป/กราฟผู้ซื้อใหม่ ต่ออายุ พ้นสภาพยังไม่ครบ; ไม่เอาจำนวนสร้างบัญชีมาแทน; ตัวกรองแพ็กเกจในประวัติรางวัลยังอิงหลักฐานซื้อออนไลน์ ไม่ใช่สิทธิ์ ณ เวลาแลก |

**ตรวจในเครื่อง:** Node 522 ผ่าน / 0 ล้ม / 2 ข้าม; TypeScript, scoped ESLint, build และ diff check ผ่าน; PostgreSQL 18.4 ชุดรวม R4-first ผ่าน รวม finance lifecycle, coupon targeting/replay, admission/cancellation และ R7 manual. ชุด native แยกของ R4 staff transfer/cancellation, R5 import/lifecycle, R6 checkout/promo และ R7 manual staff ผ่านตามรายงานของชุดนั้น ๆ ไม่ใช่ production UAT.

**กองเดียวสำหรับขึ้นระบบและตรวจรับ:**
1. ซ้อม restore บนสำเนาฐานล่าสุดด้วย migration/runtime principal และ grants จริง ใช้ลำดับใน `src/db/migrations/20261202_R347_admission_compatibility.md`; ขอช่วงพัก writers/jobs ตาม `R4_PRODUCTION_READINESS.md`. ตรวจ readers ก่อน writer flags และ cancellation cutover. การซ้อม R4 เก่าไม่ครอบคลุมชุดนี้.
2. Browser UAT ด้วยบัญชีอนุมัติ: R3 override ต้องมีแพ็กเกจหลักจริง และผลโบนัสซื้อ production ต้องใช้ธุรกรรมที่ผู้มีสิทธิ์อนุมัติ; R4–R8 ตรวจ staff term/คืนเงิน/คูปอง/สิทธิ์/หน้าสมาชิก/รางวัล/มือถือ; R5 กระทบยอดจริงและเปิด XLSX จริง; ไม่ใช้ข้อมูลลูกค้าทดสอบหรือสลิปเทียม.
3. หน้างานทดสอบ USB/CARD และกล้อง R2/R6–R8; ตรวจอัปโหลดรางวัลกับ provider ที่อนุมัติ. ผล browser/API ไม่แทนผลจากเครื่องจริง.

รอบนี้ไม่ลง migration จริง ไม่ deploy/commit/push ไม่ทำธุรกรรม และไม่เริ่ม R9/R10.

### R2 Dashboard / บัตร / รูป — production checkpoint

- Browser OWNER บน production: BLU-3 ผูกบัตรชั่วคราว 200, replay 200 เพิ่ม version ครั้งเดียว, ปลดคืนและ GET ยืนยัน `null` version 2 โดยเก็บ audit; Dashboard OWNER 200; ฟอร์มรูปแสดง แต่ยังไม่อัปโหลดหรือสแกน USB จริง
- พบ GET รูป 403 เมื่อ browser ไม่ส่ง Origin; ปรับให้ GET ใช้ same-origin guard มาตรฐานและคงการตรวจ session/role ส่วน POST ยังต้องมี Origin. Tests เฉพาะส่วน 6/6 และ TypeScript ผ่าน; push `2b3c49a` แล้ว และ Browser OWNER ตรวจ GET รูปบน production ได้ 200 หลัง deploy
- Production UAT เพิ่ม: ใช้ Playwright เปิด session แยกและล็อกอินด้วยบัญชีทดสอบเดิมจากไฟล์ที่ป้องกันไว้ ไม่เปิดเผยรหัสผ่าน; BLU-4 ADMIN เข้า Dashboard โดยไม่พบยอดเงินหรือฟิลด์ยอดเงินใน HTML ที่ตรวจ, finance export 403, card GET 200; BLU-3 MEMBER ถูกส่งกลับ `/member`, finance export/card 403; ปิด session ทดสอบหลังเสร็จ
- ผู้ใช้อนุญาต Cloudinary หนึ่งรูป: ส่งรูป PNG สังเคราะห์ผ่านเบราว์เซอร์ OWNER ไปยัง BLU-3 สำเร็จ POST/GET 200, version เพิ่ม 1 และ source `STAFF_UPLOAD`; ไม่อัปโหลดรูปบุคคลจริง
- Reset concurrency ตรวจแล้วบน PostgreSQL 18.4 จริงแบบ isolated ด้วย `scripts/r2-password-postgres-test.py`: 4/4 ผ่าน ยืนยัน lock wait จริง 4 ครั้ง ครอบคลุม login/reset และ password completion/reset ทั้งสองลำดับ; auth/reset Node tests 41/41 และ TypeScript ผ่าน รายละเอียด `admin-member-password.md`
- **R2 software UAT ผ่าน:** ซ้อม restore/rollback บน PostgreSQL ก่อน apply schema reset บน production; ตรวจหลังลงว่าข้อมูลเดิม 41 ตารางไม่เปลี่ยนและ ACL ผ่าน เปิด `ENABLE_ADMIN_PASSWORD_RESET` เฉพาะ Production และ redeploy โค้ด auth ปัจจุบันผ่าน Vercel จากนั้นทดสอบด้วย Playwright: ADMIN BLU-4 เห็นฟอร์มและ reset BLU-3 ผ่าน API 200; MEMBER ถูกปฏิเสธ 403, session เดิมถูกเพิกถอน, login รหัสเดิม 401 และรหัสใหม่ 200, replay 200 ไม่เพิกถอน session ใหม่, UUID เดิมแต่เปลี่ยนเหตุผล 409; คืนรหัสเดิมให้บัญชี UAT และ login ยืนยัน 200. Read-only audit พบ 2 รายการ/2 UUID ตรงกับ reset และคืนรหัส ไม่มีการแก้รหัสลูกค้า
- สแกนด้วยเครื่อง USB จริงพักไว้ตามผู้ใช้สั่ง ไม่ถือว่าผ่าน hardware UAT และยังไม่เริ่ม R3

- เชื่อม Dashboard ADMIN (ไม่ query หรือส่งข้อมูลเงิน) และฟอร์มบัตร/รูปในหน้าสมาชิกแล้ว; build และชุดเทสรวมก่อน build ผ่าน (มี 1 skip ในชุดรวม; ไม่ใช้แทน production UAT)
- ซ้อม card/avatar กับ snapshot ที่ป้องกันสิทธิ์บน PostgreSQL จริง: คอลัมน์เดิมครบ 36 ตารางตรงหลัง restore/rollback/commit ในฐานซ้อม, catalog 19 ส่วน, inventory เดิม 2 รายการคงเดิม; runner 7/7 ผ่าน
- ผลล่าสุด: apply card/avatar บน production สำเร็จ ตรวจ read-only postflight ผ่าน ข้อมูลเดิม 36 ตารางไม่เปลี่ยน ตารางใหม่ 5 ตารางว่าง และ effective ACL ผ่าน; runner 7/7, TypeScript/build ผ่าน ไม่ลง password/R3+
- ประวัติรอบแรก: Production apply หยุดก่อนส่ง DDL (`not-attempted`): effective ACL ของ `neon_service` ยังไม่ผ่าน gate แม้ revoke PUBLIC แล้ว ต้องตรวจเทียบสิทธิ์เดิมราย operation และแยกสิทธิ์ที่สืบทอดกับสิทธิ์ใหม่ ห้ามข้าม guard หรือแก้ grant เอง ดู `R2_PRODUCTION_ROLLOUT.md`
- Push `168d513` ขึ้น `main` แล้ว; endpoint บัตรบน production ตอบ 401 เมื่อไม่ล็อกอิน. Browser tool timeout จึงยังไม่ผ่าน UAT แบบล็อกอิน; ไม่เรียก Cloudinary, password ยังปิด และไม่ข้าม R3

### Production UAT ผลจริงหลัง push `5d7f18e`

- commit/push `5d7f18e` บน main สำเร็จ; รอ endpointใหม่จาก404→401 ก่อน browser UAT จึงยืนยันมี deploymentใหม่จริง ไม่ใช้ working tree แทนเว็บ live
- OWNER browser session จริง: BLU-3 บันทึกอีเมลทดสอบ `.invalid` ผ่านฟอร์ม, แก้ nickname+วัน/เดือนเกิด29/2ผ่านฟอร์มและ refreshแสดงค่าที่บันทึก; BLU-4 บันทึกอีเมลเดียวกันผ่านฟอร์มสำเร็จ ไม่ส่งอีเมล/provider
- production API BLU-4: PATCH keyใหม่200, replay body/keyเดิม200, keyเดิมเปลี่ยนอีเมล409, versionเพิ่มเพียง1และอีเมลไม่เปลี่ยน. GET guarded200; anonymous probe401. Reset formไม่แสดง และ POST password503ตาม default-off
- independent production read-only SQL: BLU-3 email version1/audit1, profile audit1; BLU-4 email version2/audit2. ทั้งคู่ roleเดิม MEMBER/ADMIN, points0, expiryNULL, orders/coupons/checkins0. คงข้อมูล UAT/append-only audit ไว้ ไม่ล้างหรือทำคืนย้อนหลังแบบลบประวัติ
- Functional UATนี้เป็น OWNER acting on MEMBER/ADMIN test targets ไม่ใช่ ADMIN/MEMBER login role-matrix เต็มชุด; passwordยังไม่เปิด/ไม่apply. ไม่มีเงินจริง/SMS/provider call. R2ยังไม่ครบ avatar/card/dashboard/role/concurrency checks
- Regression final96passed, TypeScript/buildผ่าน. รายงาน schema/backup/native restoreที่ `R2_PRODUCTION_ROLLOUT.md`; full lint errorเดิมตามประวัติไม่ได้แก้นอกscope

### Production rollout ล่าสุด — ผู้ใช้อนุมัติ commit/push และ UAT จริงแล้ว

- ผู้ใช้อนุมัติแก้โค้ด→เทส/build→commit/push รอ deploy แล้ว UAT production ด้วย browser ใช้บัญชี UAT ในฐานจริง ไม่ใช้ mock แทน functional acceptance; ห้ามล้างฐาน/ทำเงินจริง/ส่งSMS/providerเสียเงินเอง
- พบบัญชีทดสอบชื่อ UAT_ROLE: BLU-3 MEMBER / BLU-4 ADMIN ไม่มี orders/coupons/checkins ณ preflight ใช้สองบัญชีนี้เป็นหลัก ห้ามแตะบัญชีลูกค้า
- **APPLIED จริง:** `20261118_R2_admin_member_profile.sql`, `20261118_R2_member_contact_email.sql` พร้อม metadata checksum. Backup protected ใน `.local-db` และ restore/rehearsal บน native PostgreSQL18 ผ่าน 32ตาราง/19catalog sections. Independent read-only audit ยืนยันข้อมูล32ตารางเดิมไม่เปลี่ยน ไม่มี privilege expansion; ตารางใหม่3ตารางยังว่างก่อน browser UAT. รายละเอียด `R2_PRODUCTION_ROLLOUT.md` ห้ามแก้ migrations2ไฟล์นี้ย้อนหลังอีก
- **Password NOT APPLIED / DEFAULT OFF:** เพิ่ม server-only gate `ENABLE_ADMIN_PASSWORD_RESET === "true"`; ถ้าไม่ตั้ง true ไม่ render form และ API503ก่อน auth/SQL/scrypt. ยังไม่เปิด env นี้จน auth instance เก่าถูก drain และ password migration/concurrency/logging gates พร้อม. รักษา auth locking fix สำหรับ deployment นี้
- TypeScript และ `pnpm run build` ผ่าน; pre-gate regression91ผ่าน (รวม rollout runner6tests). Gateชุดpassword/auth41ผ่าน. แก้ assertionเก่าของ `password-input.test.mjs` ให้ตรวจ history display/paginationปัจจุบัน ไม่คาดหน้า read-only legacy ที่ถูกแทนแล้ว; final rerun รวม contact/profile/password/auth/permissions/password-input/rollout runner **96/96 passed, 0skip**, TypeScript ผ่าน; ตรวจ staged diff พบ whitespace1จุดและแก้แล้ว. กำลัง commit/push รอ deploy แล้ว UAT production บันทึกผลเพิ่มด้านล่าง
- ประวัติบันทึกคำว่า prepare-only/ห้ามcommitเก่าด้านล่างเป็นสถานะก่อนอนุมัติ ไม่ใช่สถานะล่าสุด; มีเพียง profile/contact APPLIED ไม่ใช่ทุก migration R3–R7 หรือ password

### แนวทางล่าสุด — ใช้ฐานจริงและ Browser UAT

ผู้ใช้อนุญาตให้ทำงานกับฐานข้อมูลจริงและควบคุม browser UAT เอง ไม่ใช้ mock แทนระบบจริง. ข้อห้ามเชื่อมฐานจริงในบันทึกเก่าถูกแทนที่เฉพาะส่วนนี้; ไม่ใช่คำสั่งแก้ธุรกรรมลูกค้า/ส่งSMS/เรียกบริการเสียเงิน/commit/push/deploy. ก่อน migration ยังต้อง backup+verify restore และตรวจ dependency/ACL/compatibility ตาม checkpoint ไม่ถือว่า table ใหม่พร้อมโดยคาดเดา

**ผลตรวจจริงรอบเริ่ม UAT:** โหลด DATABASE_URL จาก `.env.local` โดยไม่แสดงค่าลับ ต่อสำเร็จ PostgreSQL18.7; metadata query ผ่าน transaction `readOnly:true` และ server ยืนยัน `transaction_read_only=on`. พบ members/auth_sessions แต่ยังไม่พบ member_contact_details/admin_member_profile_audit/admin_member_password_audit ในฐานที่ตรวจ. localhost3000/3001 ไม่ได้รัน; public app origin คือ `https://blue-fitness-plum.vercel.app`. Browser session ที่มีอยู่เข้าหน้า /admin ได้ และ GET สมาชิก/การเงิน/แพ็กเกจ/checkin/rewards/promo-codes/coupons ตอบ200 ไม่ redirect/ไม่พบข้อความ unavailable. เป็น OWNER read-only smoke ไม่ใช่ role matrix/functional write UAT และไม่ยืนยันว่าบิลด์ live ตรง working tree. ไม่บันทึกชื่อ/เบอร์/ยอดส่วนบุคคลลงหลักฐาน

**รอสำหรับ write UAT:** ระบุ member code ของบัญชีทดสอบที่อนุญาตแก้ไข หรืออนุญาตสร้างบัญชี UAT แยกก่อน ห้ามใช้บัญชีลูกค้าจริงทดสอบ reset/coupon/checkin/payment. ติดตั้ง migration ที่จำเป็นหลัง backup/restore/compatibility checks แล้วจึงทดสอบเขียนจาก browser โดยไม่ปลอม payment evidence หรือยิง provider เสียเงิน. รอบนี้ยังไม่มี mutation/migration/deploy/SMS/provider call

### คำยืนยันล่าสุดจากผู้ใช้ — ใช้แทนข้อขัดแย้งในบันทึกเก่า

**ผลปรับตามคำตอบรอบนี้:** ยกเลิก unique email index ใน migration อีเมลที่ยัง untracked/prepare-only ไม่ใช่ migration ที่ apply แล้ว พร้อมปรับ API error และ regression ให้สองสมาชิกใช้อีเมล canonical เดียวกันได้โดย version/audit/replay แยกกัน. รัน `node --test --test-concurrency=1 src/lib/member-contact-email.test.mjs src/lib/member-contact-email-server.test.mjs` ผ่าน **16/16, 0 skip**; TypeScript/scoped ESLint/diff check ผ่าน. Regression contact+profile/password ที่เกี่ยวข้องผ่าน73ตาม `R2_MEMBER_CONTACT_EMAIL.md`. ยังไม่แตะฐานจริงหรือ apply migration. กติกาโบนัส/คูปอง/สถิติ/หยุดยกเลิก บันทึกแล้วแต่ยังไม่อ้าง implementation ครบ

ผู้ใช้ตอบอนุมัติครบ6ข้อในแชต และย้ำให้ทำเฉพาะขอบเขตง่ายที่สุด:
- สิทธิ์มีเพียงคนทั่วไป MEMBER / แอดมิน ADMIN / เจ้าของ OWNER ไม่เพิ่มประเภทบุคคลแยกหรือหมวด TRAINER/STAFF/OTHER จาก mock; ข้อเสนอแยกประเภทในแผนเก่าถูกยกเลิก ไม่ต้องถามซ้ำ
- ยกเลิกแพ็กเกจ: ถ้าใช้คะแนน/คูปองไปแล้ว คะแนนไม่พอถอน หรือมีแพ็กเกจต่อเนื่อง ให้หยุดรายการไว้ให้ OWNER ตรวจ ไม่หักคะแนนติดลบ/ถอนสิทธิ์อื่น/ยกเลิกให้อัตโนมัติ การตรวจโดย OWNER ไม่ใช่อนุมัติ override แบบไร้ข้อจำกัด
- คะแนนแพ็กเกจเป็นโบนัสบวกเพิ่มจากสูตรคะแนนตามยอดเงินเดิม ไม่แทนสูตร ไม่แก้คะแนนหรือ PAID snapshots ย้อนหลัง
- คูปองทั่วไป: เว้นว่างไม่จำกัดเวลาหลังเปิดใช้, 0=10นาทีหลังเปิดใช้; ถ้าชนวันหมดอายุให้ยึดเงื่อนไขที่ถึงก่อน ไม่ใช่เว้นว่าง=10นาที
- รายงานสมาชิกนับคนไม่ซ้ำในแต่ละกลุ่มของช่วงรายงาน; 3เดือนใช้90วัน; พ้นสภาพเมื่อเลย30วันจากหมดอายุ แต่หมดอายุเข้าไม่ได้ทันที; กลับมาซื้อเกิน90วันนับกลุ่มใหม่ในรายงานโดยคงรหัส/ประวัติเดิม; ใกล้หมดอายุ30วันอ้างอิงวันที่เลือกดูรายงาน กลุ่มอาจทับซ้อนห้ามสื่อว่าแยกเด็ดขาด
- อีเมลเป็นข้อมูลติดต่อ ใช้ร่วมกันได้ ไม่ใช้ login/recovery ไม่ส่งหรือยืนยันอีเมล
- ใช้กราฟจำนวนครั้งเข้ารายชั่วโมงเท่านั้น ไม่ทำกราฟวงกลม 07–14/14–22 และไม่ต้องถามขอบ14:00ของกราฟวงกลมอีก ข้อมูลเก่าไม่มี OUT ยังแสดงระยะเวลาไม่ทราบ

นี่คือ **กติกาที่ได้รับอนุมัติแล้ว ไม่ใช่ implementation เสร็จ** คง checkpoint ด้านโค้ด/ทดสอบแยกจากการตอบคำถาม ไม่อนุญาต apply ฐานจริง/คืนเงินจริง/deploy/commit โดยอัตโนมัติ

### ขอบเขตที่ยืนยัน

- รวมภาพรวม/กราฟ, การเงิน, สมาชิก, เข้า–ออก, รางวัล, โค้ดส่วนลด, คูปอง, แพ็กเกจ และ Excel ตามรายการลูกค้า
- ไม่รวมระบบขายสินค้า/บริการอื่น ระบบจองห้อง สต็อก จัดส่ง หรือโอนคืนเงินอัตโนมัติ
- ADMIN/OWNER เพิ่ม แก้ไข ปิดใช้งานแพ็กเกจและสิทธิประโยชน์ตามรูปแบบที่ตกลง; ไม่ลบประวัติที่เคยขาย
- แพ็กเกจมีช่วงเวลาเดียวภายในวันเดียว ไม่ข้ามเที่ยงคืน; ระยะเวลานับจำนวนวัน
- การแก้ catalog ไม่เปลี่ยนราคา/สิทธิประโยชน์ของผู้ซื้อเดิม แต่ ADMIN/OWNER เปลี่ยนช่วงเวลาให้สิทธิ์ของสมาชิกเป็นรายกรณีได้ โดยคงสิทธิประโยชน์เดิมและเก็บ audit
- ลูกค้ายืนยันข้อ 5 ล่าสุดว่าเป็น “สิทธิ์เสริมใช้ช่วงเวลาอื่น” ต้องมีแพ็กเกจหลักก่อน สมาชิกกดใช้งานเองได้ ไม่ใช่การต่ออายุทบวันหรือการทิ้งวันแพ็กเกจเดิม
- หมดอายุเข้าใช้ไม่ได้ รหัสสมาชิกและประวัติยังอยู่ กลับมาซื้อภายใน 3 เดือนเป็นลูกค้าเก่า; ต่อใน 30 วันไม่ถือว่าพ้นสภาพ
- สมาชิกทั้งหมดอ้างอิงผู้เคยซื้อแพ็กเกจ ไม่ใช่ทุกบัญชีสมัคร; ใช้สิทธิ์ MEMBER/ADMIN/OWNER เดิม ไม่เพิ่มประเภทบุคคลแยก
- ADMIN เห็นยอดเฉพาะรายการที่ทำ แต่ห้ามเห็นยอดรวม/รายงานการเงิน ต้องกรองข้อมูลที่ server/API ไม่ใช่ซ่อน UI อย่างเดียว
- ข้อมูลย้อนหลัง OWNER เท่านั้น; ต่ออายุผ่านเจ้าหน้าที่ต้องบันทึกรายรับ รองรับราคา 0 บาทโดยไม่ปลอมธุรกรรมโอน/สลิป
- รายได้ซื้อออนไลน์อิงเวลายืนยันสำเร็จ; เงินเดือน/คอมมิชชัน/ค่าเสื่อมกรอกเอง; ยกเลิกรายการบัญชีแบบเก็บประวัติ
- OWNER คืนเงินเองนอกระบบและยกเลิกแพ็กเกจ ระบบต้องถอนสิทธิ์และคะแนนที่มาจากแพ็กเกจนั้น ไม่ใช่หักยอดหรือวันรวมแบบเดาสุ่ม
- สถิติใช้บริการนับครั้งเข้าแต่ละชั่วโมงตลอดวัน เก็บออกคู่เข้าเพื่อดูระยะเวลา ไม่ใช่ระบบคนอยู่ในยิมเรียลไทม์
- ผู้รับโปร/คูปองตามแพ็กเกจปัจจุบันที่ยังไม่หมดอายุ; ของขวัญ/แถมฟรีระบุชื่อเอง ไม่ใช่ระบบขายสินค้า/สต็อก
- ส่งออก .xlsx ทุกรายการตาม filter ไม่ใช่เฉพาะหน้าปัจจุบัน; นำเข้ารายรับ–รายจ่ายเก่าผ่านแม่แบบที่กำหนด
- เก็บรหัสผ่านแบบ hash เท่านั้น แอดมินตั้งใหม่ได้แต่ดูรหัสเดิมไม่ได้; ไม่เพิ่มปีเกิดเอง (ข้อตกลงเดิมเก็บวัน/เดือน)

### บันทึกสถานะล่าสุด — 18 พ.ย. 2026 (ตรวจซ้ำในรอบทำต่อ)

> รักษางานเดิม `TODO.md`/`CLIENT_BRIEF_HANDOFF.md`; ไม่มี commit/push/deploy, เชื่อมฐานจริง, apply migration จริง หรือเรียก provider เสียเงิน ทุกข้อที่ยังไม่ครบคง `[ ]` ไว้ ไม่ใช้ checkbox ประวัติเก่าแทนบรีฟใหม่

| รอบ | ทำแล้ว / หลักฐานจาก source และ isolated tests | ค้าง / Checkpoint |
|---|---|---|
| R1 | ตรวจ real route → server → SQL, แยก mock; อ่าน AGENTS และ Next guides จาก pnpm resolved path; มี `R1_IMPLEMENTATION_MATRIX.md` และแผน additive/rollback | matrix เดิมเป็น baseline ก่อน implementation ต้องอ่านร่วมกับตารางนี้; entitlement authority/ACL และ combined rollout ยังไม่ตรวจครบ จึงยังไม่ปิด checkpoint |
| R2 | benefits API ใช้ ADMIN response allowlist ตัด monetary order history/audit; ADMIN เข้า packages และสมาชิก list/detail read-only ได้; member SQL ทุก read ตรวจ session hash/NORMAL/live/revoked/status/role ซ้ำ; ADMIN ไม่ SELECT หรือ serialize ยอดเงิน/paid_at/slip/provider; OWNER คงยอดเดิมและ role mutation OWNER-only; เพิ่มฟอร์ม/API แก้ชื่อ/ชื่อเล่น/เพศ/วันเดือนเกิด/ผู้ติดต่อฉุกเฉินพร้อมเหตุผล, append-only audit, expected snapshot กันเขียนทับและ UUID replay | เพิ่ม staff password reset แบบ claim-before-scrypt, SQL reauthorize, rate limit, metadata audit, revoke target sessions/OTP/tickets และไม่เผยรหัสเดิม (prepared); dashboard ยัง OWNER-only; อีเมลติดต่อแยกจาก auth พร้อมฟอร์ม/API/version/audit/replay ทำแล้ว (prepared); ประเภทบุคคล/avatar/card และ PostgreSQL/browser role UAT เต็มชุดยังค้าง; SQL benefits ภายในยังคืนข้อมูลเดิม; profile/reset ต้อง apply migration ใหม่ก่อนใช้ |
| R3 | catalog create/update/deactivate OWNER/ADMIN, version/audit/replay; ปลด 10 IDs/2 slots ครบ UI/API/SQL/quote/storefront/checkin; ใช้ PAID snapshot ไม่เปลี่ยนผู้ซื้อเก่า | override ช่วงเวลารายสมาชิกยังค้าง; โบนัสคะแนนรอ R0; time supplement ยังจำกัดตาม R6; browser/concurrency ยังไม่ผ่าน checkpoint |
| R4 | additive online provenance เฉพาะ PAID ใหม่ ผูก point ledger ใน transaction เดิม ไม่ backfill/rewrite PAID เก่า; payment cancel regression ผ่าน | staff renewal/0บาท/backdate และถอนสิทธิ์รายแพ็กเกจยังไม่ทำ; provenance เป็น observation ไม่ใช่ authoritative entitlement interval; reversal ใช้แล้ว/แต้มไม่พอ/แพ็กเกจถัดไปรอ R0 |
| R5 | ออนไลน์ใช้ confirmed_at เวลาไทย; PAID ไม่มี confirmed_at แสดงจำนวนแทนเดาวัน; เพิ่มคอมมิชชัน/ค่าเสื่อม; กราฟเติมวัน/เดือนยอด0 ตาม filter เป็นยอดต่อช่วง | import template/preview/batch/audit ยังไม่ทำ; หมวดสมัครใหม่/ต่อสมาชิก/ยกเลิกยังไม่จัดประเภทปลอดภัย; server filters/pagination และ reconciliation 0บาท/refund ค้าง |
| R6 | คูปองเสริม CUSTOM one-shot, staff grant/member activate, server Bangkok window/expiry, atomic replay, checkin integration | รองรับเฉพาะผู้มี lifetime PAID รายการเดียวและ expiry พิสูจน์ตรง snapshot/สมาชิก; ผู้ต่ออายุ/ข้อมูลกำกวมถูกปฏิเสธ ไม่ใช่ R0 ครบทุกสมาชิก; campaign/gift/targeting/activation ทั่วไปยังค้าง; ห้ามถือข้อจำกัดนี้เป็นกติกาลูกค้า |
| R7 | admin IN/OUT จับคู่, ห้าม OUT ลอย/IN เปิดซ้อน, visit snapshot รวมสิทธิ์เสริม; datetime filter/pagination/24 hourly bins ทุกแถว; ข้อมูลเก่า exit=NULL | kiosk ยัง ENTRY_ONLY และ mixed-channel ยังอาจเกิด legacy IN ระหว่าง visit เปิด; camera/CARD/manual OWNER/backdate/override ค้าง; pie รอ R0; ยังไม่ปิด checkpoint |
| R8 | reward upload endpoint แยก ตรวจ auth/origin/MIME signature/5MB และ UI save จริง; owner member detail ประวัติซื้อ/เข้า/คูปองมี pagination แยกชุดละ100พร้อม lookahead ไม่ตัดทิ้งเงียบ | filters/scanner รางวัล/ประวัติสมาชิกตามบรีฟยังไม่ครบ; ยังใช้ OFFSET ซึ่งตำแหน่งเลื่อนได้เมื่อมีรายการใหม่; browser/mobile/provider จริงยังไม่ได้ทดสอบ |
| R9 | finance OWNER export เป็น OOXML .xlsx จริงจาก server ทุกแถวตาม filters/sort ไม่เฉพาะหน้า; inlineStr กันสูตร, whitelist PII, cap10000แถว/16MiB เกินแล้วปฏิเสธไม่ตัดเงียบ | export หน้าอื่นยังไม่ทำ; dashboard นิยามสมาชิก/กราฟบางส่วนรอ R0 และ ADMIN payload partition ยังไม่ทำ; ยังไม่เปิดไฟล์ใน Excel UI |
| R10 | rerun รวม 17 test files: **111 passed / 0 failed / 0 skipped**; TypeScript ผ่าน; `git diff --check` ผ่าน | full lint ไม่ผ่าน error เดิม `src/app/member/AccountClient.tsx:78` (`react-hooks/set-state-in-effect`); ยังไม่มี PostgreSQL หลายconnection/browser/hardware UAT/backup restore/full bootstrap migration rehearsal; combined R3–R7 isolated core ผ่านแล้วแต่ยังไม่ใช่ production acceptance; ห้ามปล่อยใช้งานจริง |

**คำสั่งที่รันจริงรอบตรวจรวม**

```sh
node --test src/lib/admin-members-server.test.mjs src/lib/admin-permissions.test.mjs src/lib/package-catalog-r3.test.mjs src/lib/package-catalog-ui.test.mjs src/lib/package-catalog-server.test.mjs src/lib/package-catalog-storefront.test.mjs src/lib/real-benefits-admin-server.test.mjs src/lib/entitlement-online-provenance.test.mjs src/lib/real-finance-r5.test.mjs src/lib/real-finance-server.test.mjs src/lib/time-supplement.test.mjs src/lib/time-supplement-server.test.mjs src/lib/real-checkin-r7.test.mjs src/lib/real-checkin-server.test.mjs src/lib/reward-image-policy.test.mjs src/lib/xlsx.test.mjs src/lib/payment-server.test.mjs
pnpm exec tsc --noEmit --incremental false
pnpm lint
```

111 เป็นจำนวนที่ runner รายงาน บาง suite import tests ชุดเดิมซ้ำ จึงไม่อ้างว่าเป็น 111 independent requirements; SQL ที่รันเป็น isolated PGlite ไม่ใช่หลักฐาน multi-connection race บน PostgreSQL จริง ส่วน auth/API tests บางชุดใช้ stub transport ไม่ใช่ระบบ mock แทน production

**ไฟล์ migration ที่เตรียม (ยังไม่ apply):** R3 `20261118_r3_package_catalog.sql` → `20261118_r3_package_catalog_checkin.sql`; R4 `20261118_R4_online_provenance.sql`; R5 `20261118_R5_finance.sql`; R6 `20261118_R6_time_supplement.sql` → R7 `20261118_R7_visits.sql` โดย R6 ต้องมี R3 และ R7 ต้องมี R6 ก่อน เอกสารแต่ละชุดอยู่ข้าง migration และ `R4_PROVENANCE_HANDOFF.md` combined core ทดสอบแล้วใน `src/lib/brief-combined-migrations.test.mjs` และมีข้อจำกัดใน `R10_COMBINED_CHECKPOINT.md` แต่ยังไม่ใช่ full bootstrap/ACL/concurrency หรือ live rollout ที่ตรวจรับแล้ว; ห้ามรัน runner เก่าทับหรือ drop audit เพื่อ rollback

**ผลตรวจเพิ่มหลัง R2 read-only + combined migration:** `node --test src/lib/admin-members-server.test.mjs src/lib/admin-permissions.test.mjs src/lib/brief-combined-migrations.test.mjs` ผ่าน **21/21, 0 skip**; `pnpm exec tsc --noEmit --incremental false` ผ่าน ไม่มี live DB/provider. R2 20 tests รวม real session/guard implementation บน stub DB, SQL recheck, ADMIN monetary select/payload denial และ rendered headings/role controls; combined test อีก1 เคสเรียก actual migrations/finalizer/finance/activation/visits ใน PGlite แบบ serial ไม่ใช้เป็นหลักฐาน race. วันเริ่มสิทธิ์เก่าไม่ทราบให้เป็น null ไม่อนุมานจากวันชำระ

**R2 ช่วงแก้โปรไฟล์ (ตรวจผ่านในรอบล่าสุด):** เพิ่ม `src/lib/admin-member-profile-server.ts`, API PATCH `/api/admin/members/[memberCode]/profile`, `AdminMemberProfileForm.tsx` และ migration prepare-only `20261118_R2_admin_member_profile.sql` ไม่แตะ migration เดิมหรือฐานจริง. ADMIN แก้ MEMBER; OWNER แก้ MEMBER/ADMIN; บัญชี OWNER ยังไม่เปิดให้แก้ผ่านฟอร์มนี้ (จำกัดสิทธิ์แบบ conservative ไม่ใช่ยืนยันกติกาลูกค้าเพิ่ม). SQL ตรวจ live NORMAL session/status/role ซ้ำ, lock actor/target, ตรวจ expected profile, strict fields ทั้ง API/SQL, audit before/after+reason+actor+payload hash+UUID พร้อม rollback ใน transaction เดียว. ไม่แก้ role/status/phone/expiry/points/payment. ยังไม่รวม email/person_type/password/avatar/card. วันเกิดใช้เฉพาะวัน/เดือน ตรวจ leap day ด้วยปี2000เพื่อ validation ไม่เก็บปีเกิด. stale comparison เป็นค่าฟิลด์ ไม่ใช่ monotonic revision; A→B→A ยังเท่ากับ snapshot A เดิม. รายละเอียด rollout/rollback/ACL อยู่ `R2_ADMIN_MEMBER_PROFILE.md`

```sh
node --test src/lib/admin-member-profile.test.mjs src/lib/admin-member-profile-server.test.mjs src/lib/admin-members-server.test.mjs src/lib/admin-permissions.test.mjs src/lib/auth/registration.test.mjs src/lib/member-profile-server.test.mjs src/lib/brief-combined-migrations.test.mjs
pnpm exec tsc --noEmit --incremental false
pnpm exec eslint --max-warnings 0 src/lib/admin-member-profile-server.ts src/lib/admin-member-profile.test.mjs src/lib/admin-member-profile-server.test.mjs 'src/app/api/admin/members/[memberCode]/profile/route.ts' 'src/app/admin/members/[memberCode]/AdminMemberProfileForm.tsx' 'src/app/admin/members/[memberCode]/page.tsx' 'src/app/admin/members/[memberCode]/MemberDetailClient.tsx'
```

ผลรอบล่าสุด **48 passed / 0 failed / 0 skipped**, TypeScript/scoped ESLint ผ่าน. Actual new SQL integration บน PGlite ตรวจ auth/stale/replay/rollback/audit immutable และ coexistence กับ payment/finance/R3–R7 โดยไม่เปลี่ยน orders/ledger/coupons/เงิน. API ใช้ stub transport; UI ยังเป็น source contract ไม่ใช่ browser UAT; ยังไม่มี PostgreSQL หลายconnection. ไม่ปิด CHECKPOINT R2 ทั้งรอบ; full lint ยังมี error เดิมตามบันทึกก่อนหน้า

**R2 ช่วงตั้งรหัสผ่านใหม่ (ตรวจผ่านในรอบล่าสุด):** เพิ่ม `src/lib/admin-member-password-server.ts`, POST `/api/admin/members/[memberCode]/password`, `AdminMemberPasswordForm.tsx` และ migration prepared `20261118_R2_admin_member_password.sql`. ADMIN → MEMBER; OWNER → MEMBER/ADMIN; ไม่เปิด self/OWNER/suspended target ตาม conservative least-privilege slice. ใช้ password policy 10–128 และ scrypt salted/work cap เดิม ไม่ส่ง SMS. Claim SQL ตรวจ live NORMAL session และจำกัด 5 claims/actor/15นาที, 3/target/15นาที, 50รวม/นาที; finalize ใน2นาทีพร้อมตรวจ target xmin ไม่เปลี่ยน. เปลี่ยนเฉพาะ password_hash/updated_at, revoke sessions ทุกโหมดของเป้าหมายและ invalidate password OTP/tickets atomically. Audit เก็บ metadata/reason ไม่เก็บ password/hash/session/HMAC. UUID/body ผูกด้วย domain-separated HMAC ใช้ `SMS_API_SECRET` เดิม (server-only) ใน restricted request table; ต้องมี secret ที่แข็งแรง ถ้าหมุน secret retry เดิม fail-closed และต้องตรวจการจัดการ secret/logging ก่อน rollout. ไม่มี browser storage ของรหัส/UUID body เก็บใน memory ชั่วคราวเพื่อ retry เท่านั้น

ตรวจ security เพิ่มพบ login/session issuance race จึงแก้ `src/lib/auth/server.ts` ให้ login lock member ก่อน recheck hash/status+insert session ใน transaction และคืน token หลัง commit; password completion lock member ก่อน consume ticket โดยคง one-shot claim ก่อน hash. Reset SQL lock member ตาม ID ก่อน lock/recheck session ลด session/member inversion. ห้าม rollout คละ auth instance เก่าโดยไม่ drain งานเดิม. ยังมี profile SQL session→member ซึ่งอาจ deadlock เมื่อชน reset จึงยังไม่อ้าง global deadlock-free; error abort แบบ fail-closed และต้องทดสอบหลายconnectionก่อนเปิดจริง

```sh
node --test src/lib/admin-member-password.test.mjs src/lib/admin-member-password-server.test.mjs src/lib/auth/password.test.mjs src/lib/auth/server.test.mjs src/lib/auth/registration.test.mjs src/lib/admin-member-profile.test.mjs src/lib/admin-member-profile-server.test.mjs src/lib/admin-members-server.test.mjs src/lib/admin-permissions.test.mjs src/lib/brief-combined-migrations.test.mjs
pnpm exec tsc --noEmit --incremental false
pnpm exec eslint --max-warnings 0 src/lib/admin-member-password-server.ts src/lib/admin-member-password.test.mjs src/lib/admin-member-password-server.test.mjs src/lib/auth/server.ts src/lib/auth/server.test.mjs 'src/app/api/admin/members/[memberCode]/password/route.ts' 'src/app/admin/members/[memberCode]/AdminMemberPasswordForm.tsx' 'src/app/admin/members/[memberCode]/page.tsx'
```

ผล rerun จริง **73 passed / 0 failed / 0 skipped**, TypeScript/scoped ESLint/diff check ผ่าน. SQL isolated ตรวจ reset/replay/stale/rollback/quotas/metadata audit/old credentials invalidation รวม serial lock protocol assertions; ไม่ใช่ multi-connection reproduction. หาก claim แล้ว hash/finalize ล้มไม่เริ่ม hash ซ้ำด้วย UUID เดิม ต้องตรวจผลและรอ deadline2นาทีก่อนเริ่มใหม่ ไม่มี blind retry. เอกสาร `admin-member-password.md`; ยังไม่ apply migration/DBจริง/browser/provider/commit/deploy และยังไม่ปิด CHECKPOINT R2 ทั้งรอบ

**R2 ช่วงอีเมลติดต่อ (ตรวจผ่านรอบล่าสุด):** เพิ่ม `member_contact_details` แยกจาก members/auth ไม่ backfill, migration prepared `20261118_R2_member_contact_email.sql`, helper `src/lib/member-contact-email-server.ts`, GET/PATCH `/api/admin/members/[memberCode]/contact-email` และฟอร์มใน detail. อีเมล optional ว่าง→null, trim/ASCII lowercase/max254/Zod email และ SQL validation; ไม่ใช้ login/recovery/ส่งอีเมล/ยืนยันตัวตน. ADMIN → MEMBER, OWNER → MEMBER/ADMIN ตาม conservative scope เดิม; SQL ตรวจ persisted live NORMAL session/current roles. Expected version monotonic กัน stale/A→B→A, UUID payload replay/conflict, audit before/after+reason และ mutation atomic. เดิมเคยตั้ง unique lower(email) ระหว่างพัฒนา แต่คำยืนยันล่าสุดอนุญาต shared contact จึงเอา unique email index ออกจาก migration ที่ยังไม่ apply แล้ว คงเฉพาะ PKสมาชิกและ unique audit replay key อีเมลไม่ใช่หลักฐานตัวตน. Missing migration แสดง unavailable ไม่ใช่ empty editable success. ไม่เพิ่มประเภทบุคคลจาก mock/ไม่เปลี่ยน role. รายละเอียด `R2_MEMBER_CONTACT_EMAIL.md`

```sh
node --test --test-concurrency=1 src/lib/member-contact-email.test.mjs src/lib/member-contact-email-server.test.mjs src/lib/admin-member-profile.test.mjs src/lib/admin-member-profile-server.test.mjs src/lib/admin-member-password.test.mjs src/lib/admin-member-password-server.test.mjs src/lib/admin-members-server.test.mjs src/lib/admin-permissions.test.mjs
pnpm exec tsc --noEmit --incremental false
pnpm exec eslint --max-warnings 0 src/lib/member-contact-email-server.ts src/lib/member-contact-email.test.mjs src/lib/member-contact-email-server.test.mjs 'src/app/api/admin/members/[memberCode]/contact-email/route.ts' 'src/app/admin/members/[memberCode]/AdminMemberContactEmailForm.tsx' 'src/app/admin/members/[memberCode]/page.tsx'
```

ผล rerun **73 passed / 0 failed / 0 skipped**, TypeScript/scoped ESLint/diff check ผ่าน. Tests ครอบคลุม actual contact SQL + coexistence payment/finance/R3–R7/profile/password ใน isolated PGlite, auth deny/strict payload/duplicate/null/stale/replay/audit rollback และไม่เปลี่ยนสมาชิก/auth/เงินเดิม. API ใช้ stub transport, UI source-contract; ยังไม่มี browser/หลายconnection/production acceptance. ไม่มี apply migration/DBจริง/provider/commit/deploy. ข้อความแยกประเภทบุคคลเดิมถูกแทนที่ด้วยคำยืนยันล่าสุดให้มีเพียง MEMBER/ADMIN/OWNER ไม่เพิ่ม taxonomy; ทำ avatar/card/dashboard ใน scope ต่อได้

**จุดทำต่อ (อิงคำยืนยันล่าสุด):** ปิด R2 dashboard payload partition/avatar/card โดยไม่เพิ่มประเภทบุคคล → R3 entitlement authority/override และสิทธิ์เสริมสำหรับสมาชิกต่ออายุ → R4 staff renewal/0บาท (ไม่เดา refund) → R5 import → R6 campaign → R7 kiosk/manual → R8 histories/filters → R9 exports ที่เหลือ แล้ว R10 combined SQL/PostgreSQL concurrency/browser. งาน R0 block เฉพาะส่วนที่ไม่ชัด ไม่ถือว่าอนุญาตแก้เงิน/ถอนสิทธิ์เอง

### R0 — ปิดคำถามที่ยังมีผลต่อข้อมูล (block เฉพาะงานที่เกี่ยวข้อง)

- [x] ข้อ 5 ใช้สมมติฐานแบบขั้นต่ำตามผู้ใช้สั่ง: สิทธิ์เสริมเป็นคูปองเปลี่ยนช่วงเวลาแบบใช้ครั้งเดียว แจกโดย ADMIN/OWNER หรือเป็นของแถมแพ็กเกจ ไม่ขายแยก ไม่คิดราคา/ส่วนต่าง สมาชิกต้องมีแพ็กเกจหลักที่ยังไม่หมดอายุจึงกดใช้ได้ เมื่อกดใช้จะหัก 1 สิทธิ์และให้เข้าในช่วงเวลาที่ระบุของวันนั้นตาม Asia/Bangkok เท่านั้น ต้องกดภายในช่วงเวลาที่ให้สิทธิ์ สิ้นสุดเมื่อถึงเวลาปิดช่วงหรือแพ็กเกจหลักหมดอายุ แล้วแต่ว่าอะไรถึงก่อน กดซ้ำขณะสิทธิ์เดิมยังทำงานให้คืนผลเดิมโดยไม่หักเพิ่ม ไม่เพิ่มวัน/เปลี่ยนแพ็กเกจหลัก ไม่จับเวลารายชั่วโมง ไม่สะสมช่วงเวลา ไม่เปิดให้สมาชิกเลือกเวลาเอง และไม่ย้อนหลัง ค่าเหล่านี้เป็นสมมติฐานของผู้พัฒนาที่ผู้ใช้อนุญาตให้เลือก ไม่ใช่คำยืนยันจากลูกค้า
- [x] สถิติอนุมัติแล้ว: นับคนไม่ซ้ำต่อกลุ่ม/ช่วงรายงาน, 3เดือน=90วัน, กลับเกิน90วันเป็นกลุ่มใหม่แต่รหัส/ประวัติเดิม, พ้นสภาพเมื่อเลย30วันจากหมดอายุ (หมดอายุเข้าไม่ได้ทันที), ใกล้หมดอายุอิงวันที่เลือกดูรายงาน
- [x] ผู้ใช้ยืนยันล่าสุดมีแค่ MEMBER/ADMIN/OWNER ไม่เพิ่มประเภทบุคคลแยก; ใช้แทนข้อสรุปแยกประเภทเก่า ไม่ทำ taxonomy หรือถามหมวดเพิ่ม
- [x] ยกเลิกกรณีใช้คะแนน/คูปองแล้ว คะแนนไม่พอ หรือมีแพ็กเกจต่อเนื่อง: หยุดรายการให้ OWNER ตรวจ ไม่ถอนสิทธิ์อื่นหรือทำคะแนนติดลบอัตโนมัติ
- [x] คูปองทั่วไป: ว่าง=ไม่จำกัดเวลาหลังเปิดใช้, 0=10นาที, หมดตามเงื่อนไขถึงก่อน; คะแนนแพ็กเกจเป็นโบนัสบวกสูตรเงินเดิม
- [x] ใช้เฉพาะกราฟครั้งเข้ารายชั่วโมง ไม่ทำวงกลมเพิ่ม; ประวัติเก่าไม่มีออกแสดงระยะเวลาไม่ทราบ
- [x] CHECKPOINT R0 ด้านคำตอบ: บันทึกคำยืนยันครบแล้ว งานที่เคยรอกติกาเดินต่อได้ แต่ R2–R10 ยังต้อง implement/test ไม่ติ๊กผ่านตาม R0

### R1 — ตรวจฐานระบบและออกแบบการเปลี่ยนแปลง

- [ ] ตรวจ route → server → SQL ที่ใช้งานจริง แยก mock ออกจากของจริง และตรวจ AGENTS.md ย่อยก่อนแก้
- [ ] อ่าน Next guides จาก package ที่ติดตั้งจริง; ตรวจ git status เก็บงานผู้ใช้ ไม่ commit/branch/push/deploy เอง
- [ ] ทำ requirement matrix ฟิลด์/สิทธิ์/รายงาน/API/migration/test ให้ครบบรีฟล่าสุด
- [ ] วาง model ประวัติสิทธิ์แบบมีที่มา: แพ็กเกจที่ซื้อ วันเริ่ม/จบ ช่วงเวลา override สิทธิ์เสริม การยกเลิก; ใช้ข้อมูลเดิมได้ ไม่สร้างระบบซ้ำโดยไม่จำเป็น
- [ ] ออกแบบ migration เพิ่มแบบรักษาประวัติ/มี rollback และ version/audit; ไม่แก้ migration ที่ apply แล้วหรือ rewrite PAID snapshots
- [ ] CHECKPOINT R1: ทวนแบบกับ payment/promo/coupon/checkin เดิม; วาง cases เงิน/สิทธิ์/กรณี retry ก่อนเริ่ม migration

### R2 — สิทธิ์และข้อมูลสมาชิก

- [ ] เปิด ADMIN เข้าหน้าตาม scope ยกเว้นการเงิน; OWNER ทุกหน้า; บังคับ server/API/SQL เท่าที่เกี่ยวข้อง
- [ ] ตัดยอดรวม/รายงานเงินออกจาก payload สำหรับ ADMIN รวม dashboard/export; ยังให้ทำยอดเฉพาะรายการที่มีสิทธิ์ได้
- [ ] ใช้ role เดิม MEMBER/ADMIN/OWNER เท่านั้น ไม่เพิ่มประเภทบุคคล; เพิ่ม/แก้ข้อมูลชื่อ รูป เพศ วันเดือนเกิด อีเมล ข้อมูลฉุกเฉิน และผูกบัตรตาม scope ตรวจ unique เฉพาะ identifier ที่ต้องไม่ซ้ำ (อีเมลติดต่อใช้ร่วมกันได้)
- [ ] ตั้งรหัสผ่านใหม่ผ่านช่องทาง admin ที่ปลอดภัย เก็บ audit ไม่เผย password/hash/session; คงกติกา OTP เปลี่ยนเบอร์เดิม
- [x] CHECKPOINT R2 ด้านซอฟต์แวร์: ตรวจสิทธิ์ MEMBER/ADMIN/OWNER และ production UAT โปรไฟล์/อีเมล/บัตร/รูป/reset ตามหลักฐานด้านบน; สแกน USB ด้วยเครื่องจริงพักไว้ตามผู้ใช้สั่ง

### R3 — แพ็กเกจหลักและช่วงเวลา

- ลง schema R3 สี่ migrations แล้ว (catalog → checkin → bonus → override) หลัง fresh backup/native restore/rollback; postflight ผ่านเทียบ 43 ตาราง, 21 sequences, 24 หมวด catalog และ ACL. คงกติกาเช็กอินของ PAID เดิมตรงเวลาปิดและ CLOSED นอกเวลาทำการ; ออเดอร์ใหม่ไม่รวมเวลาปิด. อ่านหลักฐานที่ `R3_PRODUCTION_REHEARSAL.md`
- เพิ่มโบนัสตาม catalog บวกสูตรเดิมหลังส่วนลด และฟอร์ม override เฉพาะออเดอร์ PAID ที่ยืนยันที่มาได้ ไม่เขียนทับ snapshot เดิม. Regression 105 ผ่านในรอบแก้ compatibility; native PostgreSQL ผ่าน bonus/override 5 ลำดับติดตั้ง; build ผ่าน. Push `23b90b2` ขึ้น `main` แล้ว
- Production browser smoke: OWNER เปิดหน้า packages/checkin และอ่าน API catalog/override ได้ 200; public catalog มี `bonusPoints`; ADMIN BLU-4 เปิดหน้า packages และเรียก catalog/override ได้ 200; MEMBER BLU-3 ถูกส่งกลับ `/member` และเรียกทั้งสอง API ได้ 403. Override ของ BLU-3 แสดงว่าไม่มีแพ็กเกจหลักตามข้อมูลจริง; ไม่ได้เปลี่ยนราคา/แพ็กเกจขายหรือสร้าง PAID เทียม
- ตรวจปิดรอบ R3: รันซ้ำ catalog/override/supplement **24/24 ผ่าน ไม่ข้าม** และ TypeScript ผ่าน; Production Browser PATCH override ให้ BLU-3 ที่ไม่มีแพ็กเกจหลักตอบ 409 และ version/สิทธิ์ไม่เปลี่ยน. ตรวจ metadata จริงแบบ read-only ยืนยันว่า migration สิทธิ์เสริมยังไม่ลง (`time_supplement_grants` ไม่มี)
- **ยังไม่ปิด R3 ทั้งเฟส:** catalog/โบนัส/override ลงแล้วและกรณีบวกโบนัส/เขียน override ผ่าน native tests; ยังไม่มี production UAT เส้นทางสำเร็จด้วยบัญชีที่มี PAID หลัก และยังไม่เปิดขายช่วงใหม่/ตั้งโบนัสจริง. สิทธิ์เสริมยังไม่ลง production และแบบที่เตรียมไว้รองรับเฉพาะประวัติที่ยืนยันแพ็กเกจหลักได้รายการเดียว ไม่ครอบคลุมผู้ต่ออายุ. ไม่สร้าง PAID เทียมหรือข้ามไป R4 อัตโนมัติ; สรุปให้ผู้ใช้เลือกลำดับก่อนเดินเฟสอื่น

- [ ] เพิ่ม/แก้ไข/ปิดแพ็กเกจ ราคา จำนวนวัน ช่วงเวลา และออฟชั่นเดิม (คูปองพาเพื่อน/เพิ่มวัน/โบนัสตามข้อสรุป) พร้อม version/audit
- [ ] เอาข้อจำกัด 2 ช่วงเวลา/10 รายการออกให้สอดคล้องทั้ง UI/API/SQL/PromptPay quote/checkin โดยไม่เปิดรับราคาจาก client
- [ ] การซื้อใหม่ snapshot ข้อมูลครบ; order เดิม/ผู้ซื้อเดิมไม่เปลี่ยนย้อนหลัง; แสดงราคา/ช่วงเวลาจริงทุกหน้าที่เกี่ยวข้อง
- [ ] ADMIN/OWNER override เฉพาะช่วงเวลาสมาชิกโดยไม่เปลี่ยนราคา วัน หรือของแถมเดิม พร้อมเหตุผลและ audit
- [ ] สิทธิ์เสริมช่วงเวลาแยกจากแพ็กเกจหลักตาม R0: ต้องมีหลักใช้งานอยู่ การกดใช้ atomic/idempotent ตรวจช่วงเวลา/โควตา/หมดอายุ ไม่มีต่อวันหรือยกเลิกหลักโดยปริยาย
- [ ] CHECKPOINT R3: stale version, pending order เก่า, PAID เดิม, ปิดแพ็กเกจ, 00:00/24:00 และขอบช่วงเวลา, กดใช้สิทธิ์เสริมซ้ำ/พร้อมกัน/ไม่มีหลัก

### R4 — ต่ออายุผ่านเจ้าหน้าที่และยกเลิกแพ็กเกจ

- **พักตามคำสั่งผู้ใช้ และไป R5 แล้ว:** คงโค้ดกับหลักฐานการซ้อมไว้ ไม่ลง migration หรือเปิด flags ของ R4. ค้างยืนยันช่วงพัก writers/jobs และ deployed principal, apply + postflight, เปิดตัวอ่านและตรวจ UAT ก่อนเปิด writer/cutover; รายการ PAID เก่าที่พิสูจน์ไม่ได้ยังส่ง OWNER ตรวจตามเดิม. ดู `R4_PRODUCTION_READINESS.md`

- ผู้ใช้อนุญาตเริ่ม R4 โดยพัก R3 production UAT ที่ต้องมีธุรกรรมชำระเงินจริง; R3 ยังไม่ปิด และสิทธิ์เสริมยังค้างตามบันทึกด้านบน ไม่ทำรายการเงินจริงหรือ PAID/สลิปเทียม
- เริ่ม R4 ด้วย `20261119_R4_staff_free_foundation.sql`: SQL foundation เก็บรายการ `STAFF_FREE` 0 บาทแยกจาก online order พร้อมที่มาช่วงสิทธิ์/การเงิน เจ้าหน้าที่และเหตุผล ไม่แก้ข้อมูลเดิม. Writer อยู่ในชุดทดสอบเท่านั้น; native PostgreSQL 18.4 ผ่าน 3 กลุ่มรวม auth/replay/ทำพร้อมกัน/rollback, regression 10/10 และ TypeScript ผ่าน ดู `R4_STAFF_FREE_FOUNDATION.md`
- ทำต่อแล้วในฐานแยก: เชื่อม `STAFF_FREE` กับ kiosk/frontdesk และรายงาน/Excel OWNER; เพิ่มตัวเขียนจริง, API และฟอร์มตรวจสิทธิ์/ยืนยันต่ออายุ 0 บาท ปิดไว้โดยค่าเริ่มต้น (`ENABLE_STAFF_FREE`). ไม่สร้างรายการโอน, สลิป หรือ PAID ออนไลน์
- Native PostgreSQL 18.4 ผ่านทั้ง reader รุ่น October และ R5 โดยใช้ตัวเขียนจริง: MEMBER ถูกปฏิเสธ, rollback ไม่เหลือรายการ, คำขอเดิมจากสอง connection ได้ receipt เดิม, key เดิมข้อมูลเปลี่ยนและต่อซ้ำถูกปฏิเสธ, รายงาน/Excel แสดง 0 ไม่เปลี่ยนยอดรวม. Regression หน้า member/finance/xlsx 16/16, TypeScript, scoped lint 5 ไฟล์และ build ผ่าน
- เพิ่มหน้าสมาชิก/แอดมินแสดงช่วงต่ออายุฟรีแยกจากวันหมดอายุเดิม และ OWNER ยกเลิกรายการ 0 บาทก่อนเริ่มสิทธิ์ได้: SQL ผูกรายการกับสมาชิก, ตรวจ session/รายการถัดไปและการใช้สิทธิ์, เก็บ audit กับรายการยกเลิก 0 บาทโดยไม่ลบต้นฉบับหรือคืนเงิน. ฟอร์ม/API ยังปิดโดยปริยาย
- ตรวจล่าสุด: native PostgreSQL 18.4 ชุด `scripts/r4-staff-free-cancellation-postgres-test.py` ผ่านทั้ง October และ R5 รวมรอล็อกหลาย connection, replay, rollback, คงประวัติเดิม และผลตรงกันระหว่าง check-in/การแสดงสิทธิ์/การเงิน. Regression หน้า member/display/cancellation/finance/xlsx **32/32 ไม่ข้าม**, TypeScript ผ่าน
- **ผู้ใช้ยืนยันแล้ว:** ไม่ให้ซื้อแพ็กเกจออนไลน์เพิ่มเมื่อมีเทอมต่ออายุจากเจ้าหน้าที่ที่จองไว้หรือยังไม่หมด ให้ UI แจ้งติดต่อเจ้าหน้าที่. เพิ่ม `20261121_R4_staff_free_purchase_guard.sql` หลัง cancellation (ต้องลงก่อนเปิด writer): ตรวจตอน INSERT ภายใต้ member lock, ไม่มีออเดอร์หรือ QR ใหม่, ไม่ขวางกรณีมีแค่แพ็กเกจออนไลน์เดิมหรือเทอม staff ถูกยกเลิกแล้ว. Native PostgreSQL ทั้ง October/R5 ผ่านรวมการรอล็อก; payment API 27/27 และ TypeScript ผ่าน. ยังไม่ลง production
- **ผู้ใช้ยืนยัน: ไม่มีเงินสด** ยกเลิกข้อเสนอเรื่องเงินสด ไม่เพิ่มช่องทางรับเงินหรือบังคับเลขอ้างอิงจากข้อเสนอที่ไม่ได้ยืนยัน ยึดบรีฟ: ต่อผ่านเจ้าหน้าที่บันทึกรายรับ รายการฟรีบันทึก 0 บาท ไม่สร้างรายการโอน/สลิปเทียม และลงย้อนหลังได้เฉพาะ OWNER. คืนเต็มนอกระบบโดย OWNER และหยุดรายการที่ใช้สิทธิ์/แต้มไม่พอ/มีเทอมต่อเนื่องตามกติกาที่ยืนยันแล้ว ไม่ถามซ้ำ
- Staff transfer ปัจจุบันและ OWNER ลงย้อนหลังในกรณีที่พิสูจน์ได้, OWNER ยกเลิกเทอมโอนก่อนเริ่มหลังยืนยันคืนเต็มนอกระบบ, และตัวอ่านสิทธิ์/บัญชีผ่าน native PostgreSQL ทั้ง October/R5 ตามรายงานรอบก่อน โค้ดปิดด้วย server flags: ยังไม่ apply/deploy/commit/push และไม่เริ่ม R5
- **ยกเลิกออนไลน์ต่อครบในขอบเขตที่พิสูจน์ได้:** `20261124_R4_online_settlement_evidence.sql` เก็บก่อน/หลังชำระและ check-in fingerprint; `20261125_R4_online_cancellation.sql` + OWNER API/UI บันทึกคืนเต็มที่ทำแล้วนอกระบบ ย้อนสิทธิ์/แต้มตรงหลักฐาน แยกประวัติ PAID ออกจากสิทธิ์ปัจจุบัน แสดงรายการชดเชยใน wallet และ `ONLINE_REFUND` ในรายงาน/Excel ไม่เรียก provider. รายการเก่าหรือกำกวมให้ OWNER ตรวจ ห้ามฝืนยกเลิก; writer ปิดจนกว่า reader cutover ผ่าน
- ตรวจล่าสุด: native cancellation ผ่าน October/R5; ชุดรวมแอป 120 ผ่าน 1 skip ไม่มี fail, build และ diff check ผ่าน; native restore/rehearsal ของ production clone ผ่าน 12 migrations/44 ตารางและ ACL; guarded schema-only runner 12/12 ผ่าน แต่ยังไม่ได้เรียก apply จริง ดู `R4_PRODUCTION_READINESS.md`
- **Production ยังรอช่วง rollout ที่ยืนยันว่าพักงานเขียนที่เกี่ยวข้องได้:** read-only preflight ยืนยัน R4 schema ยังไม่มี, live PENDING 0, PROCESSING 0; UNKNOWN 1/VERIFIED 2 ผูก PAID และเลยช่วงส่งสลิปแล้ว ไม่แก้รายการเหล่านี้. เครื่องมือ Vercel timeout จึงยังยืนยัน revision/principal และการพัก writers/jobs ไม่ได้ ไม่ข้าม `--confirm-runtime-ready`, ไม่ apply/deploy/เปิด flags/commit/push และไม่เริ่ม R5

- [ ] ต่ออายุ ADMIN/OWNER ผ่าน flow มีราคาที่อนุญาต เหตุผล หลักฐาน/วิธีรับเงินตามข้อตกลง และบันทึกบัญชี/สิทธิ์/คะแนนสัมพันธ์กัน
- [ ] รองรับ 0 บาทเป็นรายการเจ้าหน้าที่จริง แยกจาก online bank payment; OWNER เท่านั้นระบุย้อนหลัง พร้อมเวลาเหตุการณ์และเวลาบันทึก
- [ ] OWNER ยกเลิกแพ็กเกจรายรายการ เก็บประวัติซื้อ บันทึกคืนเงินนอกระบบ และถอนเฉพาะสิทธิ์/คะแนน/คูปองที่ผูกกับรายการนั้นตาม R0
- [ ] จัดการแพ็กเกจต่อเนื่องและสิทธิ์ใช้แล้วอย่างมีเงื่อนไข ไม่ UPDATE expire_date หรือ points รวมลอย ๆ; ledger และ audit ต้องอธิบายยอดได้
- [ ] รักษา cancellation ก่อนส่งสลิปให้เริ่มใหม่ได้ แยกจาก refund ของรายการจ่ายแล้ว; ห้ามยกเลิกผลตรวจ PROCESSING/UNKNOWN/VERIFIED หรือ PAID ผ่าน customer cancel
- [ ] CHECKPOINT R4: ซ้ำ/retry/พร้อมกัน/คะแนนไม่พอ/สิทธิ์ใช้แล้ว/0บาท/ย้อนหลัง/ยกเลิกบางแพ็กเกจ ไม่กระทบสิทธิ์อื่น และไม่มีเรียก provider คืนเงิน

### R5 — การเงินและนำเข้าข้อมูล

- เพิ่ม Import CSV บัญชีเก่าเฉพาะ OWNER: ดาวน์โหลดแม่แบบ, preview พร้อมข้อผิดพลาดรายบรรทัด, ยืนยันทั้ง batch แบบ atomic พร้อม audit, retry คำขอเดิมและกัน source reference ซ้ำ. จำกัด 200 แถว/256 KiB และรับเฉพาะรายการ manual ไม่รวมยอดแพ็กเกจ/คืนเงินที่ระบบบันทึกเอง; `.xlsx` ยังใช้ส่งออก
- ตรวจ native PostgreSQL 18.4 ผ่าน 3 แบบ: October และ R5 โดยไม่มี schema R4 ทั้งสองชุด, และ R5 พร้อม R4; ครอบคลุม OWNER guard, audit rollback, contention/retry, duplicate และยอดรายงาน. ตรวจเฉพาะส่วน import/finance/xlsx 17/17, TypeScript และ build ผ่าน
- ยังไม่เปิด `FINANCE_IMPORT_ENABLED`, ไม่ apply migration/import ข้อมูลจริงหรือ deploy. ยังไม่ปิด R5: ต้องตรวจ rollout/Browser UAT และ reconcile บัญชีจริง; ส่วนรายการ lifecycle จาก R4 ยังค้างตามสถานะ R4. ดู `src/db/migrations/20261126_R5_finance_import.md`

- [ ] หมวดรายจ่ายประจำเดือน เงินเดือน คอมมิชชัน อุปกรณ์ ค่าเสื่อม ต่อสมาชิก สมัครใหม่ ยกเลิก อื่น ๆ ให้ครบทั้ง UI/server/SQL
- [ ] วันยืนยันจริงใช้กับรายได้ออนไลน์; รายการ manual/backdate/import มีที่มา ไม่เอายอดซื้อซ้ำเข้าบัญชีสองรอบ
- [ ] ยอดรายรับ/รายจ่าย/สุทธิ สะสมและตาม filter จาก–ถึง/ประเภท/ลำดับ/หมวด ตารางสมาชิกที่เกี่ยวข้อง และ CRUD manual พร้อม audit/เหตุผล
- [ ] กราฟรายเดือนและกราฟตาม filter แสดงเดือน/วันที่ยอด 0; กำหนดชัดว่าเป็นยอดต่อช่วงหรือยอดสะสม ไม่รวมสลับนิยาม
- [ ] แม่แบบนำเข้ารายรับ–รายจ่าย preview/validation วันที่เงินหมวด/รายงานแถวผิด/กัน import ซ้ำ; จำกัดสิทธิ์ OWNER เก็บ batch/audit
- [ ] CHECKPOINT R5: reconcile ledger กับ order/คืนเงิน/0บาท/import, timezone Asia/Bangkok ขอบเดือนปี, soft cancel ไม่ทำประวัติหาย และยอดตรง export

### R6 — คูปองและโค้ดส่วนลด

- ไป R6 ตามคำสั่งผู้ใช้ ไม่รอ rollout ของ R4/R5; สถานะเดิมและงานค้างคงไว้ด้านบน
- ทำแล้วใน working tree: คูปองพาเพื่อน/เพิ่มวันเปิดใช้จากกระเป๋า (ว่าง = ไม่จำกัดเวลาหลังเปิดใช้, 0 = 10 นาที, หมดตามเส้นตายที่ถึงก่อน); โปรโมโค้ดตั้งยอดซื้อสูงสุดก่อนหักส่วนลดและแพ็กเกจที่ใช้ได้; เจ้าหน้าที่ตรวจผู้รับตามกลุ่มแพ็กเกจจาก BLU/CARD ก่อนยืนยันทีละคน ไม่แจกอัตโนมัติ. ไม่แก้คูปองและออเดอร์เดิมย้อนหลัง
- ชุด native PostgreSQL ครอบคลุม activation, ขอบยอด/แพ็กเกจ/โควตา และการแจกพร้อมกัน; Node regression ของ benefits/wallet/payment 44/44 ผ่านก่อนรวม targeting; targeting regression 16/16 ผ่าน และ build/diff check หลังรวมผ่าน. ยังไม่ apply/deploy หรือทำ Browser/USB UAT; การแจกปัจจุบันรับเฉพาะ PAID ออนไลน์เดี่ยวที่พิสูจน์สิทธิ์ได้ ผู้ต่ออายุและประวัติกำกวมยังไม่ครอบคลุม; ประเภทคูปอง/โควตา/ประวัติตามบรีฟยังไม่ครบ

- [ ] โค้ดส่วนลด: ชื่อ/code/%หรือบาท/มูลค่า/ครั้งสูงสุด/ยอดซื้อขั้นต่ำ–สูงสุด/เพดานส่วนลด/แพ็กเกจที่ใช้ได้/โควต้าผู้รับ/expiry/รายละเอียด
- [ ] คูปอง: ชื่อ/code/ประเภทส่วนลด ของขวัญ แถมฟรี แต้มเพิ่ม อื่น ๆ/จำนวน/หน่วยบาท-%-แต้ม/เงื่อนไขสูงสุด/ต่อคน/โควต้ารวม
- [ ] แยกวันหมดอายุ campaign อายุใช้งาน และ activation ตาม R0; server clock และ atomic activation/consume กันเริ่มนับใหม่
- [ ] แจกตามแพ็กเกจปัจจุบันรายวัน/เดือน/3/6/12เดือน/ทุกคนที่ยังไม่หมดอายุ สแกน BLU/CARD เลือกผู้รับ ยืนยันก่อนแจก ไม่ auto แจกผู้สมัครภายหลังโดยพลการ
- [ ] คุมจำนวนใบต่อคน โควต้ารวม และครั้งต่อใบแยกกัน; ส่วนลดตรวจ/จองจาก SQL เมื่อสร้าง order คืน quota เฉพาะสถานะที่ปลอดภัย
- [ ] กระเป๋า/ประวัติแจก/ใช้ ครบ member/name/code/type/ออก/หมดอายุ/ใช้/สถานะ filters ตามบรีฟ และ gift เป็นบรรยาย/ส่งมอบ ไม่ทำ inventory ใหม่
- [ ] CHECKPOINT R6: ใช้ซ้ำ/พร้อมกัน/โควต้าสุดท้าย/คูปองหมดเวลา/ขอบยอดส่วนลด/โบนัสไม่ซ้ำ/ยกเลิก order คืน quota โดยไม่ปล่อยเงินที่ยังไม่ทราบผล

### R7 — เข้า–ออกและประวัติบริการ

- ทำ R7 ต่อโดยไม่ย้อนเปิดงาน R2–R6: เพิ่ม `20261130_R7_kiosk_visits.sql` ให้ Kiosk/แอดมินใช้ visit เปิดเดียวกันต่อสมาชิกและจับคู่ IN/OUT จาก BLU/CARD; ก่อนลง migration ใช้โหมดเข้าอย่างเดียวเดิม ไม่แปลงคำขอ OUT เป็น IN ไม่แต่ง OUT เก่าและไม่ให้แต้ม
- เพิ่ม `20261201_R7_manual_visits.sql` และฟอร์ม OWNER บันทึกเวลาเข้า–ออกจริงย้อนหลังพร้อมเหตุผล/audit; ปฏิเสธช่วงซ้อน เวลาในอนาคต และออกก่อนเข้า ระบุออเดอร์จริงหรือไม่ทราบแพ็กเกจ ไม่เปลี่ยนสิทธิ์เข้าหน้างาน
- ตรวจ native PostgreSQL 18.4 ผ่านชุด kiosk และ manual; Node regression `real-checkin-server`, `kiosk-server`, `real-checkin-r7`, build และ diff check ผ่าน. ยังไม่ลง production หรือทำ Browser/USB/camera UAT; kiosk migration ต้องใช้ชุด R7 visits/R6 time supplement/card admission ที่รองรับ และไม่รับ R4 staff-term stack ปัจจุบันโดยอัตโนมัติ

- [ ] เก็บ IN/OUT จับคู่การออกกับการเข้าก่อน ไม่มี OUT ลอย; รองรับ USB/camera/ค้นสมาชิก code/phone ตามของเดิม
- [ ] เก็บแพ็กเกจและช่วงเวลาที่ใช้จริง ณ visit ไม่ join catalog ปัจจุบันแล้วทำประวัติเก่าเปลี่ยน
- [ ] manual วันที่ เวลา สมาชิก แพ็กเกจ ช่วงเวลา ประเภทบริการ หมายเหตุ; OWNER เท่านั้นย้อนหลัง/override หมดอายุพร้อม audit
- [ ] filter รหัสสมาชิก จาก datetime–ถึง datetime, pagination, รายชั่วโมงครบ24ชั่วโมง และวงกลมตาม R0; ข้อมูลเก่าไม่แต่ง OUT ขึ้นมา
- [ ] CHECKPOINT R7: เข้าออกหลายรอบ/ซ้ำ/ออกก่อนเข้า/ย้อนหลัง/นอกช่วง/หมดอายุ/สิทธิ์เสริม/ข้ามวันตามเวลาไทย และระยะเวลาไม่ติดลบ ไม่เพิ่มคะแนนจาก checkin

### R8 — รางวัลและหน้าประวัติสมาชิก

- ทำแล้วใน working tree: ประวัติรางวัลมีตัวกรองและแบ่งหน้า 50 รายการ; BLU-RW/UUID เดิม/BLU/CARD ใช้ค้นเท่านั้น ไม่ส่งมอบอัตโนมัติ. รายชื่อสมาชิกกรองชื่อ/เพศ/รหัส/โทร/วันที่สมัคร/แพ็กเกจและช่วงเวลาจาก snapshot PAID พร้อมสรุปบัญชีสมัครรายเดือนตามตัวกรอง. ADMIN ไม่ได้ข้อมูลการเงิน
- รายละเอียดสมาชิกใช้ snapshot R7 สำหรับแพ็กเกจ/ช่วงเวลาที่ใช้จริง และแสดงเวลาใช้คูปองจากหลักฐานที่ผูกกับใบเท่านั้น; ข้อมูลเดิมที่ไม่มีหลักฐานแสดงไม่ทราบ
- ตรวจรวม R8: 63 ผ่าน, 0 fail, 2 skip (ชุด native opt-in ในรอบรวม); native SQL ตัวกรองสมาชิกตรวจผ่านแยก, build และ diff check ผ่าน. ไม่ deploy หรือแตะ production
- **พักรวมกับงานค้างเฟสก่อน:** Browser/USB/camera UAT, ตัวกรองแพ็กเกจที่อิงสิทธิ์ปัจจุบันแทนประวัติซื้อ (ต้องใช้แหล่งสิทธิ์ที่พร้อม), และเชื่อมปุ่มต่ออายุ/แจกคูปองเมื่อ writer จริงของ R4/R6 เปิดใช้ ไม่สร้าง writer ซ้ำ. ยังไม่ถือว่าปิด checkpoint R8 และยังไม่เริ่ม R9

- [ ] รูปรางวัลเลือกไฟล์จากคอม/มือถือผ่าน upload ปลอดภัย ตรวจชนิด/ขนาด/สิทธิ์ ไม่ reuse endpoint โปรไฟล์จนละเมิดกติกา
- [ ] รางวัล filters codeสมาชิก/ประเภทแพ็กเกจ/ชื่อ/สถานะ/รหัสรางวัล สแกน BLU-RW หรือ BLU/CARD ค้นรายการ; รักษารหัสเก่าใช้ได้
- [ ] ตารางรอรับ/รับแล้ว: วันเวลา รหัสและชื่อสมาชิก ชื่อและรหัสรางวัล แต้ม สถานะ; ส่งมอบซ้ำไม่ได้
- [ ] รายชื่อสมาชิก filters วันเดือนปี/ช่วงเวลา/ประเภทแพ็กเกจ/ชื่อ/นามสกุล/เพศ/code/phone พร้อมสรุปรายเดือน
- [ ] โปรไฟล์และประวัติซื้อเริ่ม–จบ/ประเภท/ช่วงเวลา/ราคา, เข้าใช้วันเวลา/แพ็กเกจ/ช่วงเวลา, คูปองประเภทชื่อหมดอายุใช้เมื่อไรสถานะ; pagination ครบ ไม่ตัดเหลือ100โดยไม่มีทางดูต่อ
- [ ] เชื่อมปุ่มต่ออายุ/เพิ่มคูปองไป flow จริงที่ทำแล้ว ไม่สร้าง logic เงิน/สิทธิ์อีกชุด
- [ ] CHECKPOINT R8: รหัสเก่า/ใหม่และรางวัลไม่ซ้ำ, upload spoof/เกินขนาด, ข้อมูลสมาชิกไม่รั่ว, histories และ filters ตรง DB

### R9 — Dashboard และ .xlsx

- ตรวจรับอัตโนมัติครบ (รวม R7 Kiosk จุดเดียว Auto IN/OUT + ช่องแสดงรูปสมาชิก): Dashboard `/admin` อ่านจากฐานจริง พร้อมตัวกรองวัน/เดือน/ปีเวลาไทย, กราฟ SVG บน SSR/CSR (ระบุกลุ่มทับซ้อนชัดเจน ไม่ใช้ pie), ADMIN ตัด SQL/payload การเงินทั้งหมด, OWNER เห็นรายรับ–รายจ่าย–สุทธิสะสม/ตามช่วง และส่งออก `.xlsx` จริงครบทุกแถวสำหรับ Finance (`real-finance-export`), Members (`/api/admin/members/export`) และ Checkin (`/api/admin/checkin/export` + กราฟรายชั่วโมง 24 ชม.)
- Tests Dashboard metrics & exports: `admin-dashboard-metrics.test.mjs`, `admin-exports-xlsx.test.mjs`, `admin-members-server.test.mjs` (`64 checks` บน native PostgreSQL 18.4), `real-checkin-server.test.mjs` และ `real-finance-export-server.test.mjs` ผ่านทั้งหมด 0 skip
- [x] สมาชิกทั้งหมด/ปัจจุบัน/พ้นสภาพ/เก่าต่ออายุ/ต่ออายุเดือนนี้/ใหม่เดือนนี้/พ้นสภาพเดือนนี้/ใกล้หมดอายุ30วัน ตามนิยาม R0 และ filter วันเดือนปี
- [x] กราฟสมาชิกปัจจุบัน–พ้นสภาพ–ต่ออายุ และกราฟต่ออายุ–ใหม่–พ้นสภาพในเดือน; ระบุเมื่อกลุ่มทับซ้อน ห้ามใช้ pie ที่ทำให้เข้าใจว่าแยกกันถ้าไม่จริง
- [x] OWNER เห็นรายรับรายจ่ายสุทธิสะสม/เดือนที่เลือก กราฟรายเดือนและรายวันของเดือน ส่วน ADMIN ไม่มี payload ยอดเหล่านี้
- [x] export .xlsx ตาม filter ทุกแถวของแต่ละหน้ารายงานที่ตกลง รวมสิทธิ์/PII/formula-injection/เพดานข้อมูลที่ปลอดภัย ไม่เอา CSV เปลี่ยนนามสกุล
- [x] CHECKPOINT R9: fixture ที่รู้ผลล่วงหน้า ไม่มีข้อมูล/ข้ามเดือนปี/หมดอายุแล้วต่อใหม่/หลายรายการคนเดียว ยอดการ์ด=กราฟ=ตาราง=export และ ADMIN ดึงข้อมูลเงินไม่ได้

### R10 — ตรวจรับรวมและปล่อยใช้งาน

- **ตรวจรับอัตโนมัติรวม 21 พ.ย. 2026:**
  - Node unit/integration `src/**/*.test.mjs` ครบ **73/73 ไฟล์ (484 ผ่าน / 0 ล้ม / 0 ข้าม)**: แบ่งรัน non-native 70 ไฟล์ (`421/421`), `admin-members-server.test.mjs` พร้อม `R2_NATIVE_POSTGRES=1` + `R8_NATIVE_POSTGRES=1` (`34/34`), `member-card-sql.test.mjs` (`22/22`), `staff-avatar-sql.test.mjs` (`7/7`)
  - Script tests & SQL harness: `scripts/r3-production-rehearsal.test.mjs`, `r2-production-rollout.test.mjs`, `r4-production-rehearsal.test.mjs`, `db-payments.test.mjs`, `db-receiver-bank.test.mjs`, `db-tools.test.mjs`, `kiosk-sql-tests.mjs`, `payment-sql-tests.mjs` (**30/30 ผ่าน**) + `node scripts/payment-sql-tests.mjs --run-memory` ผ่าน
  - Native PostgreSQL 18.4 multi-connection race suites **7/7 ชุด ผ่านทั้งหมด**: `r4-online-cancellation-postgres-test.py`, `r4-staff-paid-postgres-test.py`, `r5-finance-import-postgres-test.py`, `r6-coupon-activation-postgres-test.py`, `r6-checkout-coupons-postgres-test.py`, `r347-compatibility-postgres-test.py`, และ `r10-kiosk-auto-inout-postgres-test.py` (R8 entitlement + Kiosk AUTO IN/OUT + ลืมสแกนออกข้ามวัน + race คู่ IN/OUT + รูปสมาชิก)
  - Quality gates: `pnpm run lint` (0 error, 0 warning), `pnpm exec tsc --noEmit` (0 error), `pnpm run build` (53 routes ผ่าน), HTTP production smoke (`next start` local `/`, `/member/login`, `/api/packages` = 200; `/admin`, `/kiosk` = 307 `/member/login`; `/api/admin/{members,checkin,finance}/export` = 401), และ audit mock-fallback/TODO ใน `src/app/` (0 รายการ)
- [x] แต่ละรอบรัน tests เฉพาะส่วน → TypeScript/lint → SQL isolated ตามเหมาะสม บันทึกคำสั่ง/ผล/ข้อจำกัด ไม่ติ๊กผ่านจากคาดเดา
- [x] ทดสอบ PostgreSQL หลาย connection สำหรับเงิน/สิทธิ์/activation/quota/คืนเงินที่เสี่ยง race ไม่ใช้ WASM อย่างเดียวอ้างว่าพร้อม production
- [ ] Browser UAT desktop/mobile MEMBER/ADMIN/OWNER ครบซื้อ–ยกเลิกก่อนส่งสลิป–ส่งสลิป–ต่ออายุ–สิทธิ์เสริม–คูปอง–เข้าออก–รางวัล–คืนเงิน–รายงาน–Excel
- [ ] ทดสอบ network timeout/retry/กดซ้ำ/refresh/กลับหน้าเดิม ไม่เพิ่มคะแนน/รายรับ/สิทธิ์ซ้ำ และไม่ให้โอนซ้ำเมื่อผลไม่ชัด
- [x] regression ระบบเดิม รวม payment receiver/amount/currency/duplicate/auth/scanner/profile ไม่แก้บั๊กนอก scope โดยพลการ
- [ ] ก่อน live migration ต้องมี backup ตรวจ restore/rollback และขออนุมัติชัดเจนก่อนแตะฐานจริง/นำเข้าจริง/โอนเงินจริง/commit/push/deploy (ฐาน Neon ทดลองลงชุด migration combined ถึง `20261208_R7_kiosk_auto_inout.sql` แล้ว; คงงานตั้ง Vercel env 10 flags + `reader_cutover` + ล้างข้อมูลทดสอบก่อน Go-Live)
- [x] CHECKPOINT สุดท้าย: สรุป requirement matrix ว่าเสร็จ/ค้าง/blocked พร้อมหลักฐานและคู่มือเจ้าหน้าที่ ไม่มี mock fallback หรือ TODO สำคัญซ่อนอยู่

---

## OWNER แก้แพ็กเกจเอง — 31 ต.ค. 2026

- [x] `/admin/packages` OWNERแก้ชื่อ/ราคา/วัน/ช่วงเวลา/ของแถม/เปิดปิด10แพ็กเกจ DBจริง มีversion/audit/UUIDretry ไม่มีmockfallback
- [x] หน้าร้านอ่านDBและorderquoteSQLauthoritative; staleversionให้โหลดใหม่, pending/PAIDเก่าราคาและสิทธิ์ไม่เปลี่ยน
- [x] Catalog+INSERTguardลงฐานพร้อมbackupแล้ว กันdeploymentเก่าส่งราคาเก่าหลังOWNERแก้ ไม่มีrewriteข้อมูลเดิม
- [x] Tests257/257,TypeScript/lint/build,Chromecatalog7/7+paymentregression6/6+9/9,liveDBrollback18checks/hash32tablesตรง,nativePGdeploymentlockผ่าน
- [ ] Deploycodeล่าสุดขึ้นVercelเพื่อเปิดเมนูและAPIใหม่ (ไม่commit/push/deployให้อัตโนมัติ)

## ตรวจรับเงินจริงเข้าบัญชีร้าน — 31 ต.ค. 2026

- [x] ผู้ใช้ตรวจสลิปจริง100บาทผ่านหลังแก้currency764และownerrecovery; DBPAID/ACTIVE+1วัน/points5, ledger1/audit1/transferclaim1/provider_calls2 ไม่มีเพิ่มซ้ำ
- [x] Parentตรวจread-onlyและรันregressionใหม่239/239+TypeScript+lintผ่าน
- [ ] ก่อนส่งมอบ: ตรวจChromeDangerous, rotateexposedcredentials, เอาLOCAL_UAT_OWNER_PASSWORD_NOTEออกจากProduction, testdata/accountcleanupแบบรักษาประวัติเงินจริง, owneraccess/backup/contractscope
- [x] เจ้าของปรับราคา/ของแถมแพ็กเกจเดิมผ่านAdminได้แล้ว ดูหัวข้อOWNERแก้แพ็กเกจด้านบน; ยังไม่มีเพิ่ม/ลบแพ็กเกจ

## ย้าย DB จริง — 24 ต.ค. 2026 (สถานะล่าสุด ใช้แทนประวัติ mock ด้านล่าง)

- [x] สมาชิก/Dashboardอ่านNeonจริง รวมmemberdetailของสมาชิกDBใหม่; detailเป็นread-onlyไม่ตั้งPAID/expiryเอง
- [x] Account/profile/wallet/historyใช้DB, ไม่มีOTPจำลองหรือbusinesslocalStorage; เปลี่ยนเบอร์ยังปิดจนมีOTPflowจริง
- [x] Rewardsหักแต้ม/stock/ledgeratomic, UUIDretryและstaffส่งมอบ; Financeจริงพร้อมaudit/version/แยกPAIDorders
- [x] คูปอง/โปรจริงพร้อมgrant/cancel/consume/audit; ส่วนลดตรวจและจองโควตาในDBตอนสร้างorder
- [x] ของแถมแพ็กเกจตรงBUSINESS ออกcouponในPAIDtransaction ไม่แจกย้อนหลัง; expiryตามorderเป็นสมมติฐานต้องยืนยัน
- [x] Uploadsignature/streamlimit/atomicfirst-photo guards; testsไม่ส่งCloudinaryจริง
- [x] Review/apply5migrationstransactionเดียว backup `.local-db/backup-2026-10-24T11-34-08.894Z`, ข้อมูลเดิม20ตารางไม่เปลี่ยน
- [x] Tests230/230,TypeScript,lint,isolatedSQL/ACL,แยกproductionbuildผ่าน; browser/APIจริง54/54 runtimeerrors0 cleanupครบ
- [x] DBจริงrollback23checksทุกtableไม่เปลี่ยน; browser/APIจริง54/54; UI/security121/121รวมแก้mobileoverflowและPaymentModalkeyboardครบ
- [x] NativePostgreSQLหลายconnection8racegroupsผ่าน (rewards/benefits/finance/frontdesk/payment/promocapacity/catalogsave) ไม่ใช่WASM; ดูscripts/real-modules-local-postgres.md
- [ ] เหลือcoverageเชิงวิศวกรรม: browserCRUDทุกstate/fullproduction-equivalentschema/load/pooling/contentionเพิ่ม ไม่ใช่งานที่ต้องให้ผู้ใช้ทำแทน
- [ ] ฟีเจอร์ที่ยังไม่ครบ: เปลี่ยนเบอร์OTP, memberadmineditingที่ปลอดภัย, แลกคะแนนเป็นคูปอง, ผูกบัตรแข็ง, guestwalk-inไม่สมัครเต็ม; packagecatalogแก้ไขรายการเดิมเสร็จแล้ว
- [ ] Productionconfig/บัญชีรับเงินร้าน/productionOTPและacceptance; ไม่ย้ายlocalStorageเก่าเป็นเงินจริงโดยอัตโนมัติ

## Kiosk USB ล่าสุด — 24 ต.ค. 2026

- [x] ADMIN/OWNERใช้บัญชีเดิมเข้าKioskเข้าอย่างเดียว; เปลี่ยนsessionmodeฝั่งDB/ล็อกnormalroutes/APIs ออกด้วยpassword ไม่ใช่ซ่อนเมนูเฉยๆ
- [x] Enterท้ายรหัส, samecode3วินาทีfrontend+DB, atomicUUID replay/concurrency, no checkout/no points, คนละcodeไม่ติดglobalcooldown
- [x] ตรวจpaid DB/timeSlotหรือwelcomeFREE_ENTRY1ครั้ง ไม่อาศัยmock/ไม่สร้างPAIDปลอม; review+applymigrationพร้อมbackupแล้ว
- [x] Browser/API TEMPผ่าน58checksและ1assertionredirectmismatchที่/testยังdenyถูก; runtimeerrors0 ผู้ใช้จริงและ20ตารางเดิมไม่เปลี่ยนหลังcleanup
- [x] QRทดสอบ: BLU-5ผ่านฟรี1ครั้ง/BLU-6หมดอายุ พร้อมPNG/SVGใน.local-db/kiosk-qr; ไม่เคยถูกautomationconsume
- [x] Suite169/169,TypeScript,fulllintผ่าน
- [x] USBจริงAdd CR suffix+ENG: BLU-6ปฏิเสธ/BLU-5ผ่านและใช้ซ้ำปฏิเสธ/ออกpasswordถูก; DBvisit1used1points0
- [ ] Hardwarebounce3วิ/paidmemberจริง ยังไม่ยืนยัน ดูKIOSK-01..12ในFINAL_TEST.md
- [ ] ยอมรับข้อจำกัดQRคงที่ส่งต่อได้/ไม่มีการพิสูจน์ตัวบุคคล และตั้งbrowser/OSkioskสำหรับไม่มีคนเฝ้าแยกจากfullscreen


## ผลทดสอบอัตโนมัติล่าสุด — 23 ต.ค. 2026

- [x] สร้างบัญชีทดสอบโดยได้รับอนุมัติ: `BLU-3` MEMBER / `BLU-4` ADMIN พร้อม password hash; ไม่ส่งSMSไปเบอร์ทดสอบ ไม่แก้Ownerจริง `BLU-2` หรือประวัติ `BLU-1`
- [x] ตั้งPlaywrightใน `.local-db/role-browser` และรันChromeแยกจากของผู้ใช้ มีภาพ/รายงาน ไม่ต้องใช้BrowserMCP
- [x] ทดสอบGuest/Member/Staff/Ownerfixture ผ่านเมนู/URL/API, roleเปลี่ยนผ่านAPIแล้วsessionเดิมเห็นผล, protectOWNER, CSRFและIDORตามroutesที่ตรวจ
- [x] Rolebrowserchecks177ผ่าน มี1smokefailที่ยังเป็นscopegap: OwnerเปิดdetailสมาชิกDBใหม่ไม่พบเพราะอ่านmock ไม่ใช่permissionbypass ดู `FINAL_TEST.md`
- [x] Auth/OTPnegativeผ่าน75checks: wrong/expired/consumed/maxattempts/newer/stalehash, ticketpurpose/scope/replay, login5x401→429, expired/revokedsession; ใช้DBfixtures ไม่ส่งSMS
- [x] StaffmockCRUD/grant/Cancel/redeem/reload, coupon7types/units, promo/rewardcatalogและcheckinmanualผ่านตาม23subcases ไม่ถือว่าallrecipientscommit/rewardspend/hardwareผ่าน
- [x] แก้ร้านรางวัลของสมาชิกจริงให้ดูcatalogread-onlyได้ ไม่เอาแต้มDBไปแลกผ่านmock
- [x] แก้migrationmockdefinitions/grants/batchesที่code/IDชนให้graphสอดคล้อง คงข้อมูลเดิม ไม่resetสิทธิ์ พร้อมregressiontests
- [x] แก้checkinmobileoverflow; browserretetest360/390/1440และAutoScanว่าง20/20ผ่าน ตาราง/กราฟยังเลื่อนในcontainer
- [x] ชุดtestsทั้งหมด165/165ผ่าน, TypeScriptผ่าน, fulllint0errors0warnings; baseline21fail/9errorsเดิมปิดแล้ว
- [ ] Ownerสมาชิกหลังบ้านยังmock: `/admin/members/BLU-3` ไม่พบสมาชิกDBจริง ต้องตัดสินขอบเขตread-only/เชื่อมDBเมื่อจำเป็น ไม่ถือว่าพร้อมproduction
- [ ] ยังเหลือAuth/APIบางส่วนเช่นupload/checkoutCSRFและlocalStorageforgery, realcouponAPIreplay, paymentnegative/concurrency, profile/Finance/benefitsที่ยังไม่ได้ครอบคลุม
- [ ] ผู้ใช้ช่วยเมื่อพร้อม: USBscannerจริง/กล้องจริง และโอนเงินเฉพาะเคสที่ต้องการสลิปใหม่; Agentยังทดสอบส่วนอื่นต่อเองได้

**บัญชีหลังcleanup:** `BLU-3=MEMBER`, `BLU-4=ADMIN`, sessionทดสอบrevoked; `BLU-2`ยังOWNERเดิม การเงินจริง/coupon/checkinของผู้ใช้ไม่เปลี่ยน Credentialsfixturesอยู่protectedignored file ไม่ลงGit/แชต

**หลักฐาน:** `FINAL_TEST.md`, `.local-db/role-uat-2026-10-23T08-21-15.656Z/`, `.local-db/auth-negative-uat-2026-10-23T08-28-07.144Z/`, `.local-db/staff-mock-uat-2026-10-23T08-56-13.102Z/combined-coverage.md`, `.local-db/checkin-layout-2026-10-23T09-08-02.170Z/report.md`, `.local-db/final-test-2026-10-23.txt`

---

เอกสารวางแผนและติดตามสถานะการพัฒนา: **ไล่ทำตามลำดับ Requirement จากการประชุมล่าสุด พร้อมเตรียมต่อยอดสู่ระบบจริง**

## ประวัติสถานะ / ขอบเขตช่วงทดสอบ (22 ต.ค. 2026 — ผลล่าสุดดูด้านบน)

- Final Test/UAT รวมทุกโมดูลและ scope gaps ดู `FINAL_TEST.md` ใช้เป็น checklist หลักของรอบร่วมกัน; HISTORY ไม่ใช่ PASS รอบปัจจุบัน

- ขณะนี้เป็นบัญชีและสภาพแวดล้อม **ทดสอบ ยังไม่ production**; ไม่จำเป็นต้องย้ายทุกโมดูลเข้า DB เพื่อทดสอบ UI หรือสาธิต flow
- Auth/session/รหัสผ่าน, คูปองแรกสมัคร และการชำระจริง/วันหมดอายุ/แต้มใช้ Neon แล้ว แม้เป็นบัญชีทดสอบ เพราะต้องตรวจธุรกรรมและป้องกันใช้สลิปซ้ำ
- EasySlip v2 ผ่านชำระจริง 100 บาทด้วย PromptPay: PAID, เพิ่มสิทธิ์รายวันและ 5 แต้ม; ทดสอบ paid-finalizer replay บน Neon สองครั้งไม่เพิ่มวัน/แต้มซ้ำ รายละเอียดใน `MANUAL_CHECK.md`
- ผู้ใช้ 3 ระดับ MEMBER/ADMIN/OWNER; พนักงานจัดการได้เฉพาะประวัติบริการ, รางวัล, โค้ดส่วนลด, คูปอง มี server guards แล้ว ยังต้องทดสอบ browser/API ทุกระดับครบ
- SMS Sender Name `Blufit1` ใช้งานใน local แล้ว: ผู้ใช้ผ่าน OTPตั้งรหัสครั้งแรก, สมัครใหม่, loginด้วยเบอร์+passwordโดยไม่ขอOTP, logout/direct/member guard และลืมรหัสแล้วsessionเก่าถูกยกเลิก; ยังเหลือ OTPnegative/APIsecurity/deployment acceptance
- บัญชีใช้งานต่อพรุ่งนี้: `BLU-2` เป็น OWNER ใช้เบอร์จริงและรหัสล่าสุดที่ผู้ใช้ตั้งเอง; `BLU-1` ถูกพักเบอร์เป็น `TEST-PARKED-BLU-1` และ revoke sessionแล้ว ประวัติซื้อ100บาท/5แต้มยังเก็บอยู่บัญชีเก่า ไม่ลบ/ย้ายให้อัตโนมัติ
- สมัคร `BLU-2` ได้ FREE_ENTRY1ครั้งอายุ30วันจริง; walletหลักแก้ให้แสดงDBแล้ว ผู้ใช้ผ่านยกเลิกก่อนใช้, ใช้จริง, refreshและlogout/loginแล้วยังUSED; DBused1/checkins1/points0 ไม่เติมแต้มจากคูปอง
- เพิ่มรูปตาทุกช่องpassword/confirmทั้งสมาชิกและหลังบ้านแล้ว ผู้ใช้แจ้งเปิดปิดผ่าน; testsยืนยันปุ่มไม่submit/ไม่เปลี่ยนค่า ยังไม่ถือว่าkeyboardและทุกหน้าผ่านครบ
- ข้อมูล admin/profile, Check-in, rewards, promo/coupons ทั่วไป และ Finance ยังมี mock/localStorage; ย้ายเฉพาะส่วนที่ต้องการทดสอบข้ามเครื่องหรือเชื่อม flow จริงก่อน ไม่เร่ง migrate ทุกอย่างในรอบทดสอบนี้
- ก่อนเปิดใช้จริง ต้องย้ายข้อมูลธุรกิจที่ใช้ร่วมกัน/มีผลต่อสิทธิ์หรือเงินไปฝั่งเซิร์ฟเวอร์, เชื่อมหน้าร้านและ Finance, เปลี่ยนบัญชีรับเงินเป็นของร้าน, ทำ acceptance/security/production deployment

### Final Test — ผลปิดรอบ 22/10/2026
- [x] OTPตั้งรหัสครั้งแรก → password loginOwner
- [x] สมัครใหม่ด้วยเบอร์เดิมที่พักบัญชีเก่าแล้ว → profile/password/sessionจริง → welcomeFREE_ENTRY1ครั้ง30วัน
- [x] สมัครเบอร์ซ้ำผ่านAPIถูกปฏิเสธ409 ไม่มีสมาชิก/คูปองซ้ำ; UIduplicateยังไม่retest
- [x] walletหลักแสดงcouponDBจริงหลังแก้WALLET-01; ไม่ใช้emptyจากmockกลบคูปองจริง
- [x] ยกเลิกใช้couponไม่consume; ใช้จริงได้1ครั้ง checkins1/points0; refreshและloginใหม่ยังUSED/ไม่มีปุ่มซ้ำ
- [x] logoutแล้ว/memberกลับlogin; loginpasswordไม่ขอOTP
- [x] ลืมรหัสด้วยOTP → ตั้งรหัสใหม่ → sessionเก่าหลุด → passwordใหม่เข้าได้
- [x] ปุ่มตาเปิด/ปิดpassword ผู้ใช้retestผ่าน; ค่าเริ่มต้นซ่อนและไม่submitจากcomponenttests
- [x] TypeScriptและfocusedtestsล่าสุดผ่าน; รายละเอียดข้อจำกัด/หลักฐานใน `FINAL_TEST.md`
- [ ] ตรวจรหัสเก่าเข้าไม่ได้, OTPผิด/หมดอายุ/ใช้ซ้ำ/quotas, APIใช้คูปองซ้ำ และback-cacheหลังlogout
- [ ] ทดสอบสิทธิ์3ระดับผ่าน UI/URL/API โดยไม่ลดroleOwnerหลักหรือยิงSMSเบอร์สุ่ม
- [ ] ทดสอบpaymentnegative/browser/concurrencyเพิ่มเติม ไม่ต้องโอนใหม่ทุกเคส; happy-pathและDBpaidreplayผ่านรอบก่อน
- [ ] Check-in/scanner/camera, profile/rewards/promo/couponAdmin/Finance mock และmobile/keyboardUXที่ยังไม่ทดสอบ
- [ ] แก้และretestbenefits suite21failures และfulllint9errors7warnings

**Automated suiteก่อนพักงาน:** 151เคส ผ่าน130 ล้ม21 (ไม่ซ่อนfail/ไม่อ้างว่าผ่านทั้งหมด) รายงาน `.local-db/final-test-2026-10-22-close.txt`; 143/122/21คือbaselineก่อนเพิ่มwallet/eye tests

### สรุปงานค้างที่ผู้ใช้ยืนยัน

**รอบทดสอบนี้:** ทำรายการที่ยังไม่ติ๊กใน Final Test ต่อ ไม่ต้องย้ายทุกโมดูลเข้าDBเพื่อเดโม; mockทดสอบUXได้ แต่ตรวจเงินจริง/สิทธิ์ร่วมกันต้องใช้serverDB

**ก่อน production:** ย้ายข้อมูลธุรกิจที่ยังเป็น mock และเชื่อม Check-in/Finance กับการซื้อจริง, เปลี่ยนบัญชีรับเงินเป็นของร้าน, ตั้งค่าและทดสอบ Vercel/โดเมนจริง, ทำ LINE ตามขอบเขตงาน, ปิดหน้าทดสอบ, จัดการข้อมูลทดลองและคู่มือ

**เริ่มพรุ่งนี้:** เปิด `FINAL_TEST.md` แล้วเริ่ม ROLE-01 ถึง ROLE-12 (Guest/MEMBER/ADMIN/OWNER) ก่อนกลับไปnegative Auth/OTP/coupon และpayment; เตรียมบัญชี/fixturesแยกที่มีแผนrecovery ไม่เปลี่ยนrole/ลบOwner `BLU-2` โดยไม่อนุมัติ ไม่ต้องสมัครใหม่หรือตั้งรหัสใหม่อีกรอบ

**ข้อจำกัดคงเดิม:** ไม่มีBrowserMCPโดยตรง; Playwrightสำหรับรอบนี้ยังไม่ติดตั้ง/ไม่ได้ใช้ควบคุมbrowser ข้อที่ผู้ใช้ทำถือUSER_PASSเฉพาะขั้นที่รายงาน ไม่เหมาว่าครบทุกbrowsercase

> **ประวัติสถานะ UI mock (26 ก.ย. 2026 ไม่ใช่สถานะล่าสุด):**
> — ของเดิมที่มี: ธีม, หน้าแพ็กเกจ, ฟอร์มสมัคร, Reward Shop, Admin Dashboard และระบบ Check-in / Rewards / Promo Codes / Coupons แบบ browser-only mock
> — หน้า Admin Members / Check-in / Rewards / Promo Codes / Coupons / Finance ใช้งาน flow หลักได้แล้ว
> — Check-in มี Auto Scan สำหรับเครื่อง USB Keyboard Wedge: เปิดโหมดแล้วรับรหัสสมาชิกพร้อม Enter, ดูประวัติวันนี้ และสลับเข้า/ออกอัตโนมัติ พร้อมสถานะกำลังทำงาน
> — Finance แยกรายการอัตโนมัติออกจาก Manual; รายการ Manual แก้ไขหรือย้อนรายการพร้อมเหตุผลได้ ไม่ลบข้อมูลเดิม
> — เพิ่มเพศในแบบสมัครสมาชิก, `MemberProfile` และ mock member data ที่เกี่ยวข้อง; Admin member หลักแสดง/กรองเพศได้
> — ข้อมูลธุรกรรม mock เก็บใน `localStorage`; ยังไม่มี Auth/API/Database/OTP/Payment verification ฝั่ง production
> — หน้า Account Mobile-First, Bottom Navigation 4 เมนู, ประวัติสมาชิก, Coupon Wallet และคะแนนจากยอดชำระทำเป็น browser-only mock แล้ว ดูข้อ 7
> — Check-in mock ไม่สร้างคะแนนแล้ว; คะแนนใช้ ledger ชุดเดียวจากยอดชำระและการแลกสิทธิ์
> — Auth/API/Database, OTP จริง, Payment verification และข้อมูลที่ซิงก์ข้ามอุปกรณ์ยังเป็นงาน production

---

## 🎯 รายการพัฒนาตามลำดับ (Action Plan)

### 🎨 1. ปรับธีมสีใหม่ (Theme Palette & Bright Yellow Accent)
- [x] **1.1 อัปเดต CSS Variables / Palette ใน `src/app/globals.css`:**
  - [x] กำหนดชุดสีฟ้า-น้ำเงิน 7 เฉดใหม่:
    - `#F0FCFE` (Light Ice Blue)
    - `#B7D9E2` (Soft Sky)
    - `#86B6C6` (Muted Ocean)
    - `#5C93AA` (Steel Blue)
    - `#3A728E` (Deep Blue Slate)
    - `#1F5372` (Classic Navy)
    - `#0C3756` (Dark Abyss Navy)
  - [x] กำหนดสี Highlight / Accent: **สีเหลืองสว่าง (Bright Yellow)**
- [x] **1.2 ตรวจสอบและเกลี่ยสีใน Layout และทุกหน้าของระบบ:**
  - [x] ปรับหน้าแรก (`src/app/page.tsx`) ให้ใช้คลาส Tailwind Theme 100%
  - [x] ปรับหน้าสมาชิก & Layout (`src/app/member/`) ให้สอดคล้องกัน
  - [x] ปรับหน้า Login (`src/app/member/login/page.tsx`) และ Register (`src/app/member/register/page.tsx`)
  - [x] ปรับ Component ส่วนกลาง (`PaymentModal.tsx`, `LanguageToggle.tsx`, `test/page.tsx`)

---

### 📦 2. ปรับปรุงการแสดงผลหน้าแพ็กเกจ (Package Display Simplification)
- [x] **2.1 อัปเดตโครงสร้างข้อมูลแพ็กเกจ (`src/lib/mock-data.ts`):**
  - [x] เปลี่ยนชื่อระยะเวลา: `30 วัน` ➔ **"1 เดือน"**, `365 วัน` ➔ **"1 ปี"**
  - [x] ตัดฟิลด์/ข้อมูลคูปองพาเพื่อนและแถมวันออกจากแพ็กเกจหลัก
- [x] **2.2 ปรับ UI การ์ดแพ็กเกจหน้าเว็บ (`src/app/page.tsx` & `PaymentModal.tsx`):**
  - [x] ตัดแถบ Badge หรือข้อความคูปองพาเพื่อนและเพิ่มวันทิ้งทั้งหมด
  - [x] ปรับดีไซน์การ์ดให้กระชับ เน้นแสดงผลชัดเจน 2 ส่วนหลักคือ **ระยะเวลา (Duration)** กับ **ราคา (Price)**

---

### 📝 3. ปรับปรุงฟอร์มสมัครสมาชิก (Registration Form)
- [x] **3.1 อัปเดต Data Model / Schema ฝั่งสมาชิก:**
  - [x] เพิ่มฟิลด์: **ชื่อเล่น (nickname)**
  - [x] เพิ่มฟิลด์ผู้ติดต่อฉุกเฉิน: **ชื่อจริงผู้ติดต่อ (emergencyName)**, **เบอร์โทร (emergencyPhone)**, **ความสัมพันธ์ (emergencyRelation)**
- [x] **3.2 ปรับปรุงหน้าสมัครสมาชิก (`src/app/member/register/page.tsx`):**
  - [x] เพิ่มช่องกรอกชื่อเล่น เพศ และกล่องข้อมูลติดต่อฉุกเฉิน 3 ฟิลด์
  - [x] ปรับข้อความปุ่ม/คำแนะนำอัปโหลดรูปโปรไฟล์เป็น: **"คลิ๊กเพื่ออัพโหลดรูป"**
  - [x] อัปเดตระบบแสดงผลในหน้าบัตรสมาชิก ([`member/page.tsx`](file:///c:/PROJECT/blue-fitness/src/app/member/page.tsx)) ครบถ้วน

---

### 💳 4. ระบบโค้ดส่วนลด (Promo Codes System)
- [x] **4.1 Mock Data & Logic โค้ดส่วนลด (`src/lib/mock-data.ts`):**
  - [x] สร้างโครงสร้างข้อมูล Promo Code (รหัสโค้ด, เปอร์เซ็นต์/จำนวนเงินลด, วันหมดอายุ, โควต้าจำกัดจำนวนครั้ง, จำนวนครั้งที่ใช้ไปแล้ว)
- [x] **4.2 หน้าชำระเงิน (`src/components/PaymentModal.tsx`):**
  - [x] ช่องกรอกรหัส BLU-PC ที่แจกให้สมาชิก ตรวจเจ้าของ/ยอดขั้นต่ำ/หมดอายุ; เอาชิปโค้ดสาธารณะตัวอย่างเดิมออก
  - [x] คำนวณส่วนลดและสร้าง Dynamic PromptPay QR ยอดใหม่ทันที
- [x] **4.3 ระบบจัดการโค้ดส่วนลดฝั่งแอดมิน — Mock (`src/app/admin/promo-codes/`):**
  - [x] CRUD ชื่อ/รหัส, ลดบาทหรือเปอร์เซ็นต์, ยอดขั้นต่ำ, วันหมดอายุเวลาไทย, โควต้าผู้รับ, เปิด/ปิด
  - [x] ค้นหา/เลือกหลายคน/สแกนสมาชิกหรือบัตรแข็ง และแจกทุกคนปัจจุบันเป็น snapshot ไม่แจกให้สมาชิกในอนาคต
  - [x] แสดงจำนวนแจกใหม่/ข้ามผู้รับเดิมและรายชื่อก่อนยืนยัน; ไม่แจกซ้ำแม้ใช้สิทธิ์ไปแล้ว
  - [x] เก็บกระเป๋าและประวัติใน localStorage; แจกไม่เพิ่มยอดใช้ ส่วนลดถูกใช้เมื่อซื้อแพ็กเกจ **mock** ผ่าน PaymentModal โดยบันทึกส่วนลด+แพ็กเกจใน write เดียว
  - [x] ยอด 0 บาทยืนยันได้โดยไม่แนบสลิป; เปลี่ยนแพ็กเกจ/เปิด Modal ใหม่ไม่ค้างส่วนลดเก่า; บันทึกล้มเหลวไม่แสดงสำเร็จ
  - [ ] เชื่อมสิทธิ์จริงและตรวจสลิป/ชำระเงินฝั่งเซิร์ฟเวอร์ (ปัจจุบันห้ามโอนเงินจริง)

---

### 🎁 5. ระบบแลกของรางวัล (Reward Redemption System)
- [x] **5.1 หน้าแลกของรางวัลฝั่งสมาชิก (`src/app/member/rewards/page.tsx`):**
  - [x] แสดงแต้มสะสมปัจจุบัน (Points Card สไตล์ Navy & Gold)
  - [x] รายการของรางวัล (รูปจาก Unsplash placeholder, ชื่อ, แต้มที่ต้องใช้) พร้อมปุ่มกดรับสิทธิ์
  - [x] Grid 2 การ์ด/แถว, สถานะปุ่ม (พอ/ไม่พอ/หมด/ใช้แล้ว), Success Modal + รหัสยืนยัน, Toast แจ้งเตือน
  - [x] ลิงก์จากหน้า "Redeem Rewards" ในหน้าบัตรสมาชิก + ปุ่ม Gift ใน Navbar
- [x] **5.2 ระบบรับของรางวัลและคลัง — Mock (`src/app/admin/rewards/`):**
  - [x] สแกนรหัสรับรางวัลที่หน้า Rewards โดยตรง หรือสแกนสมาชิก/บัตรแข็งเพื่อค้นหารายการ ตรวจผู้รับก่อนยืนยัน **ไม่หักแต้มซ้ำ**
  - [x] CRUD ชื่อ รูป HTTPS URL แต้ม สต็อกรวม เปิด/ปิด; เคยมีรายการแลกแล้วปิดใช้งานแทนลบ และยังส่งมอบรายการจองเดิมได้
  - [x] `/member/rewards` อ่านคลังเดียวกับ Admin; journal รายการแลกเป็นการจองสต็อกและหักแต้ม mock ใน write เดียวใต้ Web Lock; กันแลกซ้ำและคงประวัติ/QR หลังโหลดหน้าใหม่
  - หมายเหตุ: สต็อกคงเหลือ = สต็อกรวม − จำนวนจอง/รับแล้ว; คะแนนและประวัติยังเป็น browser-only mock
  - [x] เชื่อมการแลกสินค้าเข้ากับคะแนน ledger ชุดเดียว และเพิ่มการแลกคูปองด้วยคะแนน

---

### 🖥️ 6. ระบบผู้ดูแล & สแกน Check-in หน้าร้าน (Admin Dashboard & Front Desk)
- [x] **6.1 แดชบอร์ดสรุปภาพรวม (`src/app/admin/page.tsx`):**
  - [x] Admin Layout พร้อม Sidebar น้ำเงินเข้ม + Mobile Hamburger (`src/app/admin/layout.tsx`)
  - [x] KPI Cards: จำนวนสมาชิก, เช็กอินวันนี้, ยอดขาย, สมาชิกใกล้หมดอายุ
  - [x] รายการสมาชิกใกล้หมดอายุ, เช็คอินวันนี้, ตารางยอดขาย/ชำระเงินล่าสุด
  - [x] Mock Data แยก (`src/lib/admin-mock.ts`)
  - [x] การเข้าสู่หน้า Admin แบบ B: Admin เป็น Member ปกติ มี `role: ADMIN` + ปุ่ม "Admin Panel" ใน Navbar Dropdown (ลบหน้า login admin แยกออก)
- [x] **6.1b หน้าเมนู Admin ที่ต่อยอดจาก Dashboard:**
  - [x] `/admin/members` — ตารางจัดการข้อมูลสมาชิก ค้นหา/กรองเพศ/ดูประวัติ/แก้ข้อมูล
  - [x] `/admin/checkin` — เปิด Auto Scan ในหน้า (ไม่ใช้ Modal), รองรับพิมพ์/USB และกล้องผ่าน `AdminScanner`; ดูประวัติวันนี้แล้วเลือกเข้า/ออกอัตโนมัติ
  - [x] `/admin/rewards` — สแกนยืนยันรับของ + CRUD คลังรางวัล mock
  - [x] `/admin/promo-codes` — CRUD ส่วนลด + scanner เลือกผู้รับ/แจกบางคนหรือทุกคนปัจจุบัน
  - [x] `/admin/coupons` — CRUD คูปองพาเพื่อน/เพิ่มวัน mock + scanner แจกบางคน/ทุกคน + โหมดแลกใช้แยกจากแจก
- [ ] **6.2 จุดสแกน Check-in หน้าร้าน (mock ทำแล้ว; งาน production/ทดสอบเครื่องจริงยังค้าง):**
  - [x] UI Auto Scan QR/บัตรแข็ง + ปุ่มเปิด/หยุด + วงกลมกำลังทำงาน + Time Slot Guard ตามเวลาไทย (Mock): นอกสิทธิ์เตือนสีส้มและไม่บันทึก
  - [ ] เสียงตอบรับ, หน่วงเวลาป้องกันสแกนซ้ำระดับธุรกรรม และการรับรหัสแบบไม่พึ่งโฟกัสยังไม่ได้ทำ (Scanner ปัจจุบันกันรหัสเดิมซ้ำ 3 วินาทีเฉพาะ UI)
  - [x] มีประวัติ Check-in ทดลองใน localStorage และรองรับเข้าใช้ซ้ำ
  - [x] แกนประเมิน Check-in ใหม่บันทึกคะแนนเป็น 0 และ normalize ประวัติเดิมในหน่วยความจำ โดย Check-in ไม่เป็นแหล่งคะแนนแล้ว
  - [ ] ลบ field/ข้อความ/ข้อมูลคะแนนจาก Check-in เดิมที่ยังเหลือใน Admin Dashboard, mock data และ UI ที่เกี่ยวข้อง
  - [ ] เชื่อมข้อมูลจริงและ `/api/access/checkin` พร้อมตรวจสิทธิ์ Admin ฝั่งเซิร์ฟเวอร์และป้องกันการบันทึกซ้ำ
  - [ ] ทดสอบกล้องและเครื่องสแกน 4600s 2D USB กับอุปกรณ์หน้าร้านจริง (รอทดสอบกับเครื่องจริง)
  - [x] ทุกหน้าใช้กล้องพื้นฐาน `CheckinCamera` ผ่าน `AdminScanner`; แจก/รับรางวัล/แลกคูปองต้องตรวจผู้รับก่อนยืนยัน พักรับสแกนและไม่ใช้ Enter ยืนยัน
  - [x] ใช้รายชื่อ/รหัส/บัตรจาก `mockAdminMembers` ชุดเดียวกัน; checkin มีแพ็กเกจและวันหมดอายุทดลองแยก (Off-Peak/หมดอายุ/รอชำระ)
  - [x] `blu_redemptions` ใช้ร่วมระหว่าง Member/Rewards และ Admin/Rewards; ส่งมอบเปลี่ยนเฉพาะสถานะ/เวลารับ ไม่หักแต้ม/สต็อกซ้ำ
  - [x] `blu_benefits_mock_v1` เก็บนิยาม ผู้รับ batch และประวัติใช้คูปอง/ชำระ mock; ทุก write อ่านล่าสุดใต้ Web Lock, ตรวจ snapshot/โควต้า/หมดอายุ และเขียน envelope เดียว
  - [x] นิยามที่เคยแจกแล้วลบไม่ได้ (ปิดแทน); การแก้ไขไม่เปลี่ยนเงื่อนไข snapshot ของสิทธิ์เดิม แต่การปิดนิยามระงับสิทธิ์ค้างด้วย
  - [x] `/member/benefits` แสดงเฉพาะสมาชิกที่เข้าสู่ระบบ mock (ไม่มีข้อมูลใช้ defaultMockMember) พร้อม QR; นำส่วนลดไปใช้ใน PaymentModal ไม่ใช้ checkout แยก
  - [x] `/member` อ่านแพ็กเกจ mock จาก benefits state พร้อมวันหมดอายุ/Countdown; ต่ออายุทบจาก max(เวลาปัจจุบัน, วันหมดอายุเดิม)
  - [x] คูปอง EXTRA_DAYS ต้องมีแพ็กเกจ mock ก่อน ใช้สิทธิ์และเพิ่มวันใน write เดียว กันใช้ซ้ำ; ยังไม่เชื่อม API/สิทธิ์ประตูจริง
  - [x] Scanner คงกล้อง/input ไว้ระหว่างพัก ไม่ปิดทุกครั้งที่รับรหัส และวันหมดอายุเริ่มต้นตรงกับฟอร์ม 23:59:59 เวลาไทย
  - [x] Browser E2E Chromium: แจกบางคน/ทั้งหมดไม่ซ้ำ, ซื้อผ่าน PaymentModal ยอด 0, คูปองเพิ่ม 7 วัน, replay ไม่เปลี่ยนข้อมูล, บัตรอ่านวันใหม่, input ไม่ถูก unmount (`browser-admin.mjs`)
  - [x] ไม่อ่าน/ย้ายคูปอง DEMO รุ่นเก่าเข้ากระเป๋าใหม่; helper AUTO/DEMO ใน `front-desk.ts` คงไว้เฉพาะ regression/compatibility ไม่มีหน้าใหม่ใช้งาน
  - [x] ข้อมูล parse เสีย/อ่านไม่ได้/เขียนไม่ได้/ไม่มี Web Locks: ไม่ยืนยันสำเร็จ ไม่คืนสิทธิ์เริ่มต้นอัตโนมัติ
  - ตรวจล่าสุด: domain tests 65 รายการ, ESLint ไฟล์ที่แก้, `pnpm exec tsc --noEmit` และ `pnpm build` ผ่าน; ชุดทดสอบรวม `src/lib/member-account.test.mjs` สำหรับ points ledger และคูปองจากคะแนน
  - หมายเหตุ: ทั้งหมด browser-only mock ไม่มี Auth/API/DB จริง ใช้เวลาของเครื่อง; ไม่แก้ฐานข้อมูล/secret/บริการภายนอก; การล้าง localStorage ทำให้ประวัติ mock หาย; กล้องและ USB ยังต้องทดสอบอุปกรณ์จริง
- [x] **6.3 ตารางจัดการข้อมูลสมาชิก (Excel-Style Member Management):**
  - [x] ค้นหา/กรอง/แก้ไขข้อมูลสมาชิก/ดูประวัติ/แสดงเพศ/สถานะ และลิงก์ดูรายละเอียดสมาชิก

---

### 💰 6.4 ระบบรายรับ-รายจ่าย Admin
- [x] รายการอัตโนมัติจากแพ็กเกจล็อกแก้ไข/ย้อนรายการ
- [x] รายการ Manual แก้ไขได้ และใช้การย้อนรายการแทนการลบ โดยเก็บรายการเดิมพร้อมเหตุผล

---

### 📱 7. หน้า Account Mobile-First และกติกาคะแนนล่าสุด
- [x] **7.1 Bottom Navigation 4 เมนู:** `หน้าหลัก / QR Code / คูปอง / คะแนน`
  - [x] ใช้งาน Mobile-First, ระบุ active state และเข้าถึงทั้ง 4 หน้าจากหน้า Account ได้โดยตรง
- [x] **7.2 หน้าหลัก Account:**
  - [x] แสดงวันที่สมัครและข้อมูลสมาชิก
  - [x] แก้ข้อมูลส่วนตัวได้ ยกเว้นรูปโปรไฟล์ต้องติดต่อเจ้าหน้าที่
  - [x] เปลี่ยนเบอร์โทรศัพท์ได้เมื่อยืนยัน Mock OTP สำเร็จเท่านั้น (`123456`)
  - [x] แสดงประวัติซื้อล่าสุด / ใช้คูปองล่าสุด / เข้าใช้ล่าสุด พร้อม “ดูทั้งหมด” ของแต่ละประเภท
  - [x] แสดงโปรแนะนำที่ Admin แจกหรือกำหนดให้สมาชิก
- [x] **7.3 หน้า QR Code:** แสดง QR ประจำตัวสำหรับ Check-in โดยไม่ผูกกับการให้คะแนน
- [ ] **7.4 Coupon Wallet รวม:**
  - [x] มีต้นแบบ mock/localStorage สำหรับคูปองที่ Admin แจกและประวัติใช้จากงานเดิม
  - [x] มี data layer mock สำหรับแลกคะแนนเป็นคูปอง พร้อมหักคะแนนและสร้างคูปองใน transaction เดียว
  - [x] รวมคูปองจากแพ็กเกจ, Admin และการแลกคะแนนใน Wallet UI/ประวัติชุดเดียว
  - [x] แสดงสถานะพร้อมใช้ / ใช้แล้ว / หมดอายุ; คูปองที่ Admin ปิดยังตรวจตามนิยามเดิม
  - [x] Admin/Coupons สแกนยืนยันใช้คูปองจากคะแนน (`BLU-PTC-…`) ได้โดยไม่หักคะแนนซ้ำ
- [ ] **7.5 ระบบคะแนนตามยอดชำระ:**
  - [x] มี data layer mock คำนวณคะแนนจากยอดชำระหลังส่วนลดทุก 20 บาท = 1 คะแนน โดยปัดเศษทิ้ง
  - [x] มี mock ledger สำหรับยอดตั้งต้น, การซื้อ, แลกสินค้า และแลกคูปอง พร้อมตรวจยอดคงเหลือย้อนหลัง
  - [x] การซื้อแพ็กเกจ mock บันทึก membership/ส่วนลด/ประวัติซื้อ/คะแนนใน localStorage transaction ชุดเดียว
  - [x] แกน Check-in ไม่สร้าง transaction คะแนน
  - [x] เชื่อม Reward Shop ให้ใช้ ledger ชุดใหม่แทนคะแนนแยกเดิม
  - [x] หน้า Account แสดงยอดและประวัติรับ/ใช้คะแนน พร้อม UI แลกสินค้าและคูปอง
- [x] **7.6 ขอบเขต Implementation รอบนี้:**
  - [x] มี data layer ใหม่แบบ mock/browser-only เก็บใน `localStorage` และใช้ Web Locks/validation สำหรับ transaction หลัก
  - [x] เชื่อม data layer เข้ากับ Account UI และติดป้ายชัดว่าไม่ใช่ข้อมูล production
  - [ ] Production backend: Auth/OTP, API, Database, payment verification และ transaction จริง

---

### 🔌 8. การเชื่อมต่อระบบจริง (Backend Wiring & Database Integration)
- [ ] **8.0 Auth และสิทธิ์ผู้ใช้ 3 ระดับ (Member / พนักงาน Admin / Owner; Guest คือยังไม่ล็อกอิน):**
  - [x] Ownerทดสอบปัจจุบัน `BLU-2`; เก็บ `BLU-1` ที่พักเบอร์พร้อมประวัติเงินจริงไว้; Ownerของร้านก่อนproductionยังต้องยืนยันแยก
  - [x] เตรียม schema role/OTP hash/session/signup ticket; เพิ่ม API ขอ/ยืนยัน OTP, สมัครสมาชิกใหม่, ออกจากระบบ และ Owner ตั้ง/ปลด Admin; ตั้ง `BLU-1` เป็น OWNER ใน Neon ตามคำขอ
  - [x] ป้องกันหน้า Account, Admin และ Finance ฝั่งเซิร์ฟเวอร์; หน้า Login เลิกยอมรับรหัส mock
  - [x] เชื่อม flow สมัครและ OTP เข้าฐานข้อมูล Neon; upload รูปสมัครหลังยืนยันตัวตนและตรวจสิทธิ์
  - [x] ทดสอบAuth/SMS happy-pathจริงร่วมผู้ใช้: setup/register/login/logout/resetและwelcomecoupon ผ่านตาม `FINAL_TEST.md`
  - [ ] ย้ายAccount/ธุรกรรมAdminส่วนที่จำเป็นกับDBจริง; API/OTPnegativeและrolematrixยังต้องทดสอบ
  - [x] Guestถูกป้องกันAccount/Adminผ่านPlaywrightจริง; APIที่ทดสอบไม่คืนข้อมูล
  - [x] Memberเข้าหน้าตนได้และถูกปฏิเสธAdmin/OwnerAPIsที่ทดสอบด้วยบัญชีBLU-3
  - [x] Implemented พนักงาน: เฉพาะ `/admin/checkin`, `/admin/rewards`, `/admin/promo-codes`, `/admin/coupons` พร้อม server guards และกรองเมนู
  - [x] StaffBLU-4 เข้าได้สี่เมนูเท่านั้น ไม่เข้าMembers/Overview/Finance/OwnerAPIsผ่านURL/APIจริง
  - [x] Ownerfixtureเข้าหน้าAccountและทุกเมนูAdmin/Finance/testได้ โดยคืนrolefixtureหลังtest; detailของสมาชิกDBใหม่ยังไม่เชื่อมmock
  - [ ] ทดสอบสิทธิ์ฝั่งเซิร์ฟเวอร์ทุกหน้า/API ไม่พึ่งการซ่อนเมนู; guards มีแล้ว แต่ CRUD mock บางส่วนยังอยู่ใน browser
- [ ] **8.1 Database Migration (Neon PostgreSQL + Drizzle ORM):**
  - [x] เพิ่ม schema role/OTP/session และรัน `pnpm db:push` บน Neon ที่ `public` เดิมไม่มีตาราง (ยังต้อง migrate domain schema mock ให้ครบก่อน production)
- [ ] **8.2 เชื่อมต่อ Third-Party APIs:**
  - [x] ThaiBulkSMSเชื่อมและส่งOTPจริงผ่าน setup/register/resetแล้ว (Sender `Blufit1`); HTTP400เมื่อ2026-10-09เป็นประวัติ
  - [x] OTP/ticketnegativeผ่านlocalAPIด้วยDBfixtures และloginrate-limit5x401→429; ไม่ส่งSMS
  - [ ] SMSrequestquotas/providerfailureและdeploymentจริง ยังไม่ถือว่าทุกsecuritycaseผ่าน
  - [x] EasySlip v2: เชื่อม order/QR/ตรวจผู้รับบัญชีธนาคารและ PromptPay/ยอด/เวลา/transRef และเพิ่มวัน/แต้มแบบ transaction; migration บน Neon แล้ว; ผู้ใช้ชำระจริง 100 บาทสำเร็จและ paid replay ไม่เพิ่มสิทธิ์ซ้ำ
  - [ ] Payment acceptance เพิ่ม: negative/browser/concurrency และทดสอบ deployment จริง ไม่ถือว่าผ่าน production ทุกเคส
  - [ ] Cloudinary (อัปโหลดรูปภาพ)
  - [ ] LINE Messaging API (แจ้งเตือนหมดอายุผ่าน LINE OA `@816hbkyl`)

---

### 🚀 9. เช็กลิสต์เปิดใช้จริง / ส่งมอบ Production (ยังไม่บังคับทำครบเพื่อเดโมบัญชีทดสอบ)
- [ ] ย้ายข้อมูลสมาชิก/Check-in/สิทธิ์/รางวัล/โปร/คูปองทั่วไป/Finance ที่ใช้จริงร่วมกันเข้า DB และ server APIs; mock สำหรับเดโมยังคงใช้ได้เมื่อระบุชัด
- [ ] เชื่อมรายรับจาก real payment orders เข้า Finance และสิทธิ์จริงเข้าระบบหน้าร้าน
- [ ] ตั้งค่าและทดสอบ Vercel/โดเมนจริง, ปิด/ลบหน้าทดสอบชั่วคราว และจัดทำคู่มือ/backup
- [ ] เปลี่ยนบัญชี PromptPay เป็นเบอร์ลูกค้า (`089-772-0282`) และเปลี่ยนชื่อบัญชี
- [ ] ตรวจสอบการต่ออายุ EasySlip รายเดือน
- [ ] ตรวจสอบเครดิต ThaiBulkSMS
- [ ] เปลี่ยนรหัสผ่าน Admin และ Rotate Keys
- [ ] โอนย้ายโปรเจกต์ Vercel สู่บัญชีลูกค้า (`blufitness168@gmail.com`)
- [ ] แยกหรือ archive ข้อมูลทดสอบก่อนเปิดจริงตามรายการที่อนุมัติ; ห้ามลบสมาชิก/หลักฐานชำระเงินจริงแบบกว้าง
- [ ] ติดตั้ง Rich Menu บน LINE OA (`@816hbkyl`)

---

## 🧹 งานเสริม / Refactor ที่ทำแล้ว (UI & Infrastructure)

### 🏗️ Navbar ตัวเดียวกัน (Shared Component)
- [x] สร้าง `src/components/Navbar.tsx` ใช้ร่วมกันหน้าแรก / หน้า member / หน้า reward
- [x] เพิ่มปุ่ม **Reward (Gift)** ข้าง LanguageToggle → `/member/rewards`
- [x] เพิ่มเมนู **Admin Panel** ใน dropdown เฉพาะบัญชี `role: ADMIN`
- [x] เพิ่ม translation keys: `nav.rewards`, `nav.admin_panel`

### 🛠️ อื่น ๆ
- [x] เพิ่ม `images.unsplash.com` เข้า `next.config.ts` `remotePatterns` (รองรับรูป placeholder จาก Unsplash)
- [x] แก้ UI Admin Dashboard responsive (grid KPI, sidebar layout `lg:ml-64`, icon fixes)
- [x] เพิ่ม `role` field ใน `MemberProfile` (mock-data) และ `NavbarMember`
