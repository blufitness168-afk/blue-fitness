# 🏋️‍♂️ Blu Fitness (ชะอำ) — Digital Membership & Management Web Application

เว็บแอปพลิเคชันจัดการระบบสมาชิกฟิตเนสออนไลน์แบบครบวงจร ออกแบบและพัฒนาเพื่อ **BLU FITNESS (ชะอำ)** ครอบคลุมทั้งระบบบัตรสมาชิกดิจิทัล (Digital Member Card), การชำระเงินพร้อมตรวจสอบสลิปอัตโนมัติ (EasySlip), ระบบคูปอง & แต้มสะสม, ระบบ Check-in หน้าร้าน (กล้องเว็บ + เครื่องสแกน 4600s 2D USB) และระบบหลังบ้านสำหรับผู้ดูแล (Admin Dashboard)

---

## 🚀 จุดเด่นของระบบ (Key Features)

### 👤 1. ฝั่งสมาชิก (Client Web App - Mobile First สไตล์ GON Member)
* **Mobile-First Experience:** ใช้งานผ่านสมาร์ตโฟนได้อย่างลื่นไหล รองรับการเปิดผ่านเบราว์เซอร์หรือ LINE OA (`@816hbkyl`)
* **SMS OTP Authentication:** สมัครและเข้าสู่ระบบด้วยเบอร์โทรศัพท์และรหัส OTP ผ่าน ThaiBulkSMS
* **Digital Member Card & Dual-ID:** บัตรสมาชิกพร้อมรูปโปรไฟล์, รหัสระบบ (`member_code`), และเลขบัตรแข็งจริง (`card_number`) พร้อม **QR Code ประจำตัว**
* **Live Countdown Timer:** นับถอยหลังวันหมดอายุสมาชิกแบบ Realtime (ต่ออายุแล้วระบบสะสมวันทบให้อัตโนมัติ)
* **Automated Payment & Slip Verification:** สแกน QR PromptPay ชำระเงิน แนบสลิปแล้วระบบตรวจสอบผ่าน **EasySlip API** ทันที
* **Coupon Wallet:** กระเป๋าคูปองสิทธิพิเศษ (พาเพื่อนมาเล่นฟรี, คูปองเพิ่มวัน)
* **Reward Points & Shop:** สะสมแต้มจากการเข้าใช้งาน (+1 แต้ม/วัน) นำไปแลกของรางวัลหรือสิทธิพิเศษได้

### 🏢 2. ฝั่งผู้ดูแล & หน้าร้าน (Admin Dashboard & Front Desk)
* **Dual-Mode Check-in Scanner:**
  1. *Web Camera Scan:* สแกน QR บัตรสมาชิกผ่านกล้องมือถือ/แท็บเล็ตของพนักงาน
  2. *Hardware Scanner (4600s 2D USB Platform):* สแกนผ่านเครื่องอ่าน QR/Barcode USB หน้าร้าน ยิงแล้วอ่านค่าอัตโนมัติ
* **Time Slot Guard:** ตรวจจับเวลาเข้าใช้จริง (07:00-14:00 Off-Peak vs 07:00-22:00 All-Day) หากสแกนนอกช่วงเวลาจะขึ้นเตือนสีส้ม
* **Auto Check-in & Point Increment:** สแกนแล้วตรวจสอบสถานะสมาชิก บันทึกเวลาเข้าใช้ และเพิ่มแต้มสะสม (+1 แต้ม) ทันที
* **Excel-Style Member Management:** ตารางจัดการข้อมูลสมาชิก ค้นหา กรอง ดูประวัติ แก้ไขข้อมูล และผูกเลขบัตรแข็ง
* **Package, Coupon & Reward CMS:** สร้างและปรับแต่งแพ็กเกจ โปรโมชั่น คูปอง และรายการของรางวัลได้เอง
* **Door Access Ready API:** มี REST API `/api/access/checkin` รองรับการเชื่อมต่อกับชุดควบคุมประตูอัตโนมัติ (Turnstile / Access Control) ในอนาคต

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
