# 📋 MASTER TODO: Blu Fitness (อัปเดตตาม Meeting ล่าสุด 01/09/2026)

เอกสารวางแผนและติดตามสถานะการพัฒนา: **ไล่ทำตามลำดับ Requirement จากการประชุมล่าสุด พร้อมเตรียมต่อยอดสู่ระบบจริง**

> 📌 **สถานะปัจจุบัน (ณ วันที่ 01 ก.ย. 2026):**
> อัปเดต Requirement จากที่ประชุมล่าสุดเรียบร้อย พร้อมเริ่มดำเนินการจากข้อ 1 (ปรับธีมสี) เป็นต้นไป

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
- [ ] **5.1 หน้าแลกของรางวัลฝั่งสมาชิก (`src/app/member/rewards/page.tsx`):**
  - [ ] แสดงแต้มสะสมปัจจุบัน
  - [ ] รายการของรางวัล (รูป, ชื่อ, แต้มที่ต้องใช้) พร้อมปุ่มกดรับสิทธิ์
- [ ] **5.2 ระบบยืนยันการรับของรางวัลหน้าร้านฝั่งแอดมิน (`src/app/admin/rewards/`):**
  - [ ] ฟอร์ม/หน้าสำหรับค้นหาสมาชิกและกดยืนยันการตัดแต้มเพื่อมอบของรางวัล
  - [ ] ระบบจัดการรายการของรางวัล (Admin CMS: เพิ่ม/ลบ/แก้ไขรางวัลและแต้ม)

---

### 🖥️ 6. ระบบผู้ดูแล & สแกน Check-in หน้าร้าน (Admin Dashboard & Front Desk)
- [ ] **6.1 แดชบอร์ดสรุปภาพรวม (`src/app/admin/page.tsx`):**
  - [ ] KPI Cards: จำนวนสมาชิก, เช็กอินวันนี้, ยอดขาย, สมาชิกใกล้หมดอายุ
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
