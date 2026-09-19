# 🏋️‍♂️ Blu Fitness (ชะอำ) — Digital Membership & Management Web Application

เว็บแอปพลิเคชันจัดการระบบสมาชิกฟิตเนสออนไลน์แบบครบวงจร ออกแบบและพัฒนาเพื่อ **BLU FITNESS (ชะอำ)** ครอบคลุมทั้งระบบบัตรสมาชิกดิจิทัล (Digital Member Card), การชำระเงินพร้อมตรวจสอบสลิปอัตโนมัติ (EasySlip), ระบบคูปอง & คะแนนสะสม, ระบบ Check-in หน้าร้าน (กล้องเว็บ + เครื่องสแกน 4600s 2D USB) และระบบหลังบ้านสำหรับผู้ดูแล (Admin Dashboard)

> **สถานะปัจจุบัน:** ฟีเจอร์ธุรกรรมของสมาชิกที่มีอยู่เป็นต้นแบบ **mock/browser-only** และเก็บข้อมูลใน `localStorage` เท่านั้น ส่วน Auth, OTP, API, Database, การตรวจชำระเงินจริง และ production backend ยังเป็น TODO ห้ามใช้ข้อมูล mock เป็นหลักฐานการชำระเงินหรือสิทธิ์เข้าใช้จริง

---

## 🚀 จุดเด่นของระบบ (Key Features)

### 👤 1. ฝั่งสมาชิก (Account Web App - Mobile First สไตล์ GON Member)
* **Bottom Navigation 4 เมนู:** `หน้าหลัก / QR Code / คูปอง / คะแนน`
* **หน้าหลัก Account:** แสดงวันที่สมัครและข้อมูลสมาชิก สมาชิกแก้ข้อมูลส่วนตัวได้ ยกเว้นรูปโปรไฟล์ต้องติดต่อเจ้าหน้าที่ และการเปลี่ยนเบอร์โทรศัพท์ต้องยืนยัน OTP
* **Activity Overview:** แสดงประวัติล่าสุดของการซื้อ, การใช้คูปอง และการเข้าใช้ พร้อมทางเลือกดูประวัติทั้งหมด รวมถึงโปรแนะนำที่ Admin แจกให้
* **QR Code ประจำตัว:** ใช้สำหรับ Check-in โดยอ้างอิงสมาชิกคนเดียวกันกับ `member_code` และ `card_number`
* **Coupon Wallet:** รวมคูปองที่ได้จากแพ็กเกจ, Admin และการแลกคะแนนไว้ในกระเป๋าเดียว
* **Points & Redemption:** ยอดชำระจริงหลังหักส่วนลดทุก **20 บาท = 1 คะแนน** โดยปัดเศษทิ้ง; การ Check-in **ไม่ให้คะแนน**; สมาชิกดูประวัติรับ/ใช้คะแนนและแลกได้ทั้งสินค้าและคูปอง
* **Membership & Payment:** แสดงอายุสมาชิก/การต่ออายุ และรองรับ flow ชำระเงิน; การส่ง OTP, ตรวจสลิป EasySlip และบันทึกธุรกรรม production ยังต้องเชื่อม backend จริง

### 🏢 2. ฝั่งผู้ดูแล & หน้าร้าน (Admin Dashboard & Front Desk)
* **Dual-Mode Check-in Scanner:**
  1. *Web Camera Scan:* สแกน QR บัตรสมาชิกผ่านกล้องมือถือ/แท็บเล็ตของพนักงาน
  2. *Hardware Scanner (4600s 2D USB Platform):* สแกนผ่านเครื่องอ่าน QR/Barcode USB หน้าร้าน ยิงแล้วอ่านค่าอัตโนมัติ
* **Time Slot Guard:** ตรวจจับเวลาเข้าใช้จริง (07:00-14:00 Off-Peak vs 07:00-22:00 All-Day) หากสแกนนอกช่วงเวลาจะขึ้นเตือนสีส้ม
* **Check-in Logging:** สแกนแล้วตรวจสอบสถานะสมาชิกและบันทึกเวลาเข้าใช้ โดย **ไม่เพิ่มคะแนนจากการ Check-in**
* **Excel-Style Member Management:** ตารางจัดการข้อมูลสมาชิก ค้นหา กรอง ดูประวัติ แก้ไขข้อมูล และผูกเลขบัตรแข็ง
* **Package, Coupon & Reward CMS:** สร้างและปรับแต่งแพ็กเกจ โปรโมชั่น คูปอง และรายการของรางวัลได้เอง
* **Door Access Ready API (TODO):** เตรียมเชื่อม REST API `/api/access/checkin` กับชุดควบคุมประตูอัตโนมัติ (Turnstile / Access Control) ใน production

---

## 🎨 ธีมและอัตลักษณ์แบรนด์ (Brand Identity & Theme)

| ส่วนประกอบ | รหัสสี (HEX) | การนำไปใช้ |
| :--- | :---: | :--- |
| **Primary Color** | `#003087` | น้ำเงินเข้ม (พื้นหลังหลัก, การ์ด, Header, แถบเมนู) |
| **Secondary Color** | `#FFD700` | ทองพรีเมียม (ปุ่ม Action, Badge VIP, แต้มสะสม) |
| **Accent Color** | `#00A86B` | เขียวมรกต (สถานะ Active, ยืนยันชำระเงิน, ตรวจสลิปผ่าน) |
| **Background / Dark** | `#060B19` / `#0D1B3E` | โทน Dark Mode พรีเมียม |
| **Typography** | `Inter`, `Prompt`, `Kanit` | ฟอนต์อ่านง่าย รองรับภาษาไทยสมบูรณ์แบบ |

---

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)

* **Frontend & Backend Framework:** Next.js 16 (App Router) / React 19 / TypeScript
* **Styling:** Tailwind CSS v4
* **Database & ORM:** PostgreSQL (Neon Serverless) + Drizzle ORM
* **Third-Party APIs:**
  * **EasySlip API:** สำหรับตรวจสอบสลิปโอนเงิน PromptPay อัตโนมัติ
  * **ThaiBulkSMS Gateway:** สำหรับส่ง OTP ยืนยันเบอร์มือถือ
  * **LINE Messaging API:** แจ้งเตือนข้อความเตือนหมดอายุผ่าน LINE OA (`@816hbkyl`)
  * **Cloudinary:** สำหรับจัดเก็บรูปโปรไฟล์และรูปสลิป
* **Deployment:** Vercel / GitHub

---

## 📁 เอกสารที่เกี่ยวข้อง (Documentation)

* 📋 **คู่มือติดตามงาน:** [`TODO.md`](file:///c:/PROJECT/blue-fitness/TODO.md)
* 🏢 **ข้อกำหนดสัญญา & ธุรกิจ:** [`BUSINESS.md`](file:///c:/PROJECT/blue-fitness/BUSINESS.md)
* 🩺 **หน้าทดสอบระบบ & API Health:** `http://localhost:3000/test`
