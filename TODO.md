# 📋 MASTER TODO: Blu Fitness (อัปเดตสถานะ 24/10/2026)

## Kiosk USB ล่าสุด — 24 ต.ค. 2026

- [x] ADMIN/OWNERใช้บัญชีเดิมเข้าKioskเข้าอย่างเดียว; เปลี่ยนsessionmodeฝั่งDB/ล็อกnormalroutes/APIs ออกด้วยpassword ไม่ใช่ซ่อนเมนูเฉยๆ
- [x] Enterท้ายรหัส, samecode3วินาทีfrontend+DB, atomicUUID replay/concurrency, no checkout/no points, คนละcodeไม่ติดglobalcooldown
- [x] ตรวจpaid DB/timeSlotหรือwelcomeFREE_ENTRY1ครั้ง ไม่อาศัยmock/ไม่สร้างPAIDปลอม; review+applymigrationพร้อมbackupแล้ว
- [x] Browser/API TEMPผ่าน58checksและ1assertionredirectmismatchที่/testยังdenyถูก; runtimeerrors0 ผู้ใช้จริงและ20ตารางเดิมไม่เปลี่ยนหลังcleanup
- [x] QRทดสอบ: BLU-5ผ่านฟรี1ครั้ง/BLU-6หมดอายุ พร้อมPNG/SVGใน.local-db/kiosk-qr; ไม่เคยถูกautomationconsume
- [x] Suite169/169,TypeScript,fulllintผ่าน
- [ ] HardwareUAT: สแกนBLU-6ก่อน แล้วBLU-5และbounce3วิ/ใช้ซ้ำ/ออกkioskpasswordจริง ดูKIOSK-01..12ในFINAL_TEST.md
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
