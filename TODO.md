# 📋 MASTER TODO: Blu Fitness (อัปเดตตาม Meeting ล่าสุด 01/09/2026 + Sprint หน้าฝั่ง Admin)

เอกสารวางแผนและติดตามสถานะการพัฒนา: **ไล่ทำตามลำดับ Requirement จากการประชุมล่าสุด พร้อมเตรียมต่อยอดสู่ระบบจริง**

> 📌 **สถานะปัจจุบัน (อัปเดต 05 ก.ย. 2026):**
> — เสร็จ Thème ต, หน้าแพ็กเกจ, ฟอร์มสมัคร, โค้ดส่วนลด (ส่วนหน้า)
> — เสร็จหน้า **Reward Shop ฝั่งสมาชิก** (ข้อ 5.1) + **Admin Dashboard** (ข้อ 6.1) + **Navbar ตัวเดียวกัน** + **การเข้าสู่หน้า Admin แบบ B (Admin เป็น Member + Dropdown)**
> — เหลือ: ระบบยืนยันรางวัลหน้าร้าน, จุดสแกน Check-in, ตารางจัดการสมาชิก, เชื่อมต่อ Backend จริง

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
  - [x] เพิ่มช่องกรอกชื่อเล่น และกล่องข้อมูลติดต่อฉุกเฉิน 3 ฟิลด์
  - [x] ปรับข้อความปุ่ม/คำแนะนำอัปโหลดรูปโปรไฟล์เป็น: **"คลิ๊กเพื่ออัพโหลดรูป"**
  - [x] อัปเดตระบบแสดงผลในหน้าบัตรสมาชิก ([`member/page.tsx`](file:///c:/PROJECT/blue-fitness/src/app/member/page.tsx)) ครบถ้วน

---

### 💳 4. ระบบโค้ดส่วนลด (Promo Codes System)
- [x] **4.1 Mock Data & Logic โค้ดส่วนลด (`src/lib/mock-data.ts`):**
  - [x] สร้างโครงสร้างข้อมูล Promo Code (รหัสโค้ด, เปอร์เซ็นต์/จำนวนเงินลด, วันหมดอายุ, โควต้าจำกัดจำนวนครั้ง, จำนวนครั้งที่ใช้ไปแล้ว)
- [x] **4.2 หน้าชำระเงิน (`src/components/PaymentModal.tsx`):**
  - [x] เพิ่มช่องกรอกโค้ดส่วนลด + ปุ่ม "ใช้โค้ด" (และปุ่มชิปทดลองใช้โค้ด)
  - [x] คำนวณส่วนลดและสร้าง Dynamic PromptPay QR ยอดใหม่ทันที
- [ ] **4.3 ระบบจัดการโค้ดส่วนลดฝั่งแอดมิน (`src/app/admin/promo-codes/`):**
  - [ ] หน้าแสดงตารางโค้ดส่วนลด, วันหมดอายุ, โควต้า และปุ่มสร้าง/แก้ไขโค้ด (รวมใน Phase Admin)

---

### 🎁 5. ระบบแลกของรางวัล (Reward Redemption System)
- [x] **5.1 หน้าแลกของรางวัลฝั่งสมาชิก (`src/app/member/rewards/page.tsx`):**
  - [x] แสดงแต้มสะสมปัจจุบัน (Points Card สไตล์ Navy & Gold)
  - [x] รายการของรางวัล (รูปจาก Unsplash placeholder, ชื่อ, แต้มที่ต้องใช้) พร้อมปุ่มกดรับสิทธิ์
  - [x] Grid 2 การ์ด/แถว, สถานะปุ่ม (พอ/ไม่พอ/หมด/ใช้แล้ว), Success Modal + รหัสยืนยัน, Toast แจ้งเตือน
  - [x] ลิงก์จากหน้า "Redeem Rewards" ในหน้าบัตรสมาชิก + ปุ่ม Gift ใน Navbar
- [ ] **5.2 ระบบยืนยันการรับของรางวัลหน้าร้านฝั่งแอดมิน (`src/app/admin/rewards/`):**
  - [ ] ฟอร์ม/หน้าสำหรับค้นหาสมาชิกและกดยืนยันการตัดแต้มเพื่อมอบของรางวัล
  - [ ] ระบบจัดการรายการของรางวัล (Admin CMS: เพิ่ม/ลบ/แก้ไขรางวัลและแต้ม)

---

### 🖥️ 6. ระบบผู้ดูแล & สแกน Check-in หน้าร้าน (Admin Dashboard & Front Desk)
- [x] **6.1 แดชบอร์ดสรุปภาพรวม (`src/app/admin/page.tsx`):**
  - [x] Admin Layout พร้อม Sidebar น้ำเงินเข้ม + Mobile Hamburger (`src/app/admin/layout.tsx`)
  - [x] KPI Cards: จำนวนสมาชิก, เช็กอินวันนี้, ยอดขาย, สมาชิกใกล้หมดอายุ
  - [x] รายการสมาชิกใกล้หมดอายุ, เช็คอินวันนี้, ตารางยอดขาย/ชำระเงินล่าสุด
  - [x] Mock Data แยก (`src/lib/admin-mock.ts`)
  - [x] การเข้าสู่หน้า Admin แบบ B: Admin เป็น Member ปกติ มี `role: ADMIN` + ปุ่ม "Admin Panel" ใน Navbar Dropdown (ลบหน้า login admin แยกออก)
- [ ] **6.1b หน้าเมนู Admin ที่ยังว่าง (สร้างต่อจาก Dashboard):**
  - [ ] `/admin/members` — ตารางจัดการข้อมูลสมาชิก
  - [ ] `/admin/checkin` — จุดสแกน Check-in หน้าร้าน
  - [ ] `/admin/rewards` — ระบบยืนยัน/จัดการของรางวัล
  - [ ] `/admin/promo-codes` — ระบบจัดการโค้ดส่วนลด
- [ ] **6.2 จุดสแกน Check-in หน้าร้าน (รองรับกล้อง + เครื่องสแกน 4600s 2D USB):**
  - [ ] ระบบสแกน QR และ Time Slot Guard (เตือนสีส้มหากหลัง 14:00 สำหรับ Off-Peak)
  - [ ] บันทึกเวลาและเพิ่มแต้มสะสมอัตโนมัติ (+1 แต้ม/วัน)
- [ ] **6.3 ตารางจัดการข้อมูลสมาชิก (Excel-Style Member Management):**
  - [ ] ค้นหา/กรอง/แก้ไขข้อมูลสมาชิก/ผูกบัตรแข็ง/เปลี่ยนรูปโปรไฟล์

---

### 🔌 7. การเชื่อมต่อระบบจริง (Backend Wiring & Database Integration)
- [ ] **7.1 Database Migration (Neon PostgreSQL + Drizzle ORM):**
  - [ ] อัปเดต schema และรัน `pnpm db:push`
- [ ] **7.2 เชื่อมต่อ Third-Party APIs:**
  - [ ] ThaiBulkSMS (OTP)
  - [ ] EasySlip API (ตรวจสลิปอัตโนมัติ)
  - [ ] Cloudinary (อัปโหลดรูปภาพ)
  - [ ] LINE Messaging API (แจ้งเตือนหมดอายุผ่าน LINE OA `@816hbkyl`)

---

### 🚀 8. เช็กลิสต์ส่งมอบงานจริง (Production Handover Checklist)
- [ ] เปลี่ยนบัญชี PromptPay เป็นเบอร์ลูกค้า (`089-772-0282`) และเปลี่ยนชื่อบัญชี
- [ ] ตรวจสอบการต่ออายุ EasySlip รายเดือน
- [ ] ตรวจสอบเครดิต ThaiBulkSMS
- [ ] เปลี่ยนรหัสผ่าน Admin และ Rotate Keys
- [ ] โอนย้ายโปรเจกต์ Vercel สู่บัญชีลูกค้า (`blufitness168@gmail.com`)
- [ ] ล้าง Mock Data ในฐานข้อมูล Neon
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
