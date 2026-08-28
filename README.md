# 🏋️‍♂️ Blu Fitness — Digital Membership & Management Web Application

เว็บแอปพลิเคชันจัดการระบบสมาชิกฟิตเนสออนไลน์แบบครบวงจร ครอบคลุมทั้งระบบบัตรสมาชิกดิจิทัล (Digital Member Card), การชำระเงินพร้อมตรวจสอบสลิปอัตโนมัติ (EasySlip), ระบบคูปอง & แต้มสะสม, ระบบ Check-in หน้าร้าน (กล้องเว็บ + เครื่องสแกนบาร์โค้ดฮาร์ดแวร์) และระบบหลังบ้านสำหรับผู้ดูแล (Admin Dashboard)

---

## 🚀 จุดเด่นของระบบ (Key Features)

### 👤 1. ฝั่งสมาชิก (Client Web App)
* **Mobile-First Experience:** ใช้งานผ่านสมาร์ตโฟนได้อย่างลื่นไหล รองรับการเปิดผ่านเบราว์เซอร์หรือ LINE OA
* **SMS OTP Authentication:** สมัครและเข้าสู่ระบบด้วยเบอร์โทรศัพท์และรหัส OTP
* **Digital Member Card:** บัตรสมาชิกพร้อมรูปโปรไฟล์, รหัสสมาชิก, และ **QR Code ประจำตัว**
* **Live Countdown Timer:** นับถอยหลังวันหมดอายุสมาชิกแบบ Realtime (ต่ออายุแล้วระบบสะสมวันทบให้อัตโนมัติ)
* **Automated Payment & Slip Verification:** สแกน QR PromptPay ชำระเงิน แนบสลิปแล้วระบบตรวจสอบผ่าน **EasySlip API** ทันที ไม่ต้องรอแอดมินอนุมัติ
* **Coupon Wallet:** กระเป๋าคูปองสิทธิพิเศษ (พาเพื่อนมาเล่นฟรี, คูปองเพิ่มวัน) ได้รับสิทธิ์ตามแพ็กเกจแรกเข้า
* **Reward Points & Shop:** สะสมแต้มจากการเข้าใช้งาน และสามารถนำแต้มไปแลกของรางวัลหรือโปรโมชั่นได้

### 🏢 2. ฝั่งผู้ดูแล & หน้าร้าน (Admin Dashboard & Front Desk)
* **Dual-Mode Check-in Scanner:**
  1. *Web Camera Scan:* สแกน QR บัตรสมาชิกผ่านกล้องมือถือ/แท็บเล็ตของพนักงาน
  2. *Hardware Scanner:* สแกนผ่านเครื่องอ่าน QR/Barcode USB/Serial หน้าร้าน
* **Auto Check-in & Point Increment:** สแกนแล้วตรวจสอบสถานะสมาชิก บันทึกเวลาเข้าใช้ และเพิ่มแต้มสะสม (+1 แต้ม) ทันที
* **Excel-Style Member Management:** ตารางจัดการข้อมูลสมาชิก ค้นหา กรอง ดูประวัติ และแก้ไขข้อมูลได้สะดวกรวดเร็ว
* **Package, Coupon & Reward CMS:** สร้างและปรับแต่งแพ็กเกจ โปรโมชั่น คูปอง และรายการของรางวัลได้เอง
* **Door Access Ready API:** มี REST API รองรับการเชื่อมต่อกับชุดควบคุมประตูอัตโนมัติ (Turnstile / Access Control) ในอนาคต

---

## 🎨 ธีมและแนวทางการออกแบบ (Design System)

| ส่วนประกอบ | รหัสสี (HEX) | การนำไปใช้ |
| :--- | :---: | :--- |
| **Primary Color** | `#003087` | น้ำเงินเข้ม (พื้นหลังหลัก, การ์ด, Header, แถบเมนู) |
| **Secondary Color** | `#FFD700` | ทองพรีเมียม (ปุ่ม Action, Badge สมาชิก, ไอคอนแต้มสะสม) |
| **Accent Color** | `#00A86B` | เขียวมรกต (สถานะ Active, ปุ่มยืนยันชำระเงิน, แจ้งเตือนสำเร็จ) |
| **Background / Dark** | `#0B132B` / `#1C2541` | โทน Dark Mode พรีเมียม |
| **Typography** | `Inter`, `Prompt`, `Kanit` | ฟอนต์อ่านง่าย รองรับภาษาไทยสมบูรณ์แบบ |

---

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)

* **Frontend & Backend Framework:** Next.js 16 (App Router) / React 19 / TypeScript
* **Styling:** Tailwind CSS v4
* **Database & ORM:** PostgreSQL (Neon Serverless) + Drizzle ORM
* **Third-Party APIs:**
  * **EasySlip API:** สำหรับตรวจสอบสลิปโอนเงิน PromptPay อัตโนมัติ
  * **SMS OTP Gateway:** สำหรับส่ง OTP ยืนยันเบอร์มือถือ
  * **LINE Messaging API:** แจ้งเตือนข้อความเตือนหมดอายุผ่าน LINE OA
  * **Cloudinary:** สำหรับจัดเก็บรูปโปรไฟล์และรูปสลิปพร้อม Auto-crop
* **Deployment:** Vercel / Cloudflare

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```text
blue-fitness/
├── public/                  # Static Assets, Icons, Logos
├── src/
│   ├── app/                 # Next.js App Router (Pages & API Routes)
│   │   ├── (auth)/          # เข้าสู่ระบบ / สมัครสมาชิก / ยืนยัน OTP
│   │   ├── (member)/        # หน้าสมาชิก: บัตรดิจิทัล, แพ็กเกจ, คูปอง, แลกแต้ม
│   │   ├── (admin)/         # หน้าแอดมิน: แดชบอร์ด, เช็คอิน, จัดการสมาชิก
│   │   └── api/             # Backend API Endpoints (EasySlip, Scanner, Door Access)
│   ├── components/          # Reusable UI Components (Cards, QRScanner, Modals)
│   ├── lib/                 # Utilities, Database Client, External API Helpers
│   ├── server/              # Server Actions & Business Logic
│   └── styles/              # Global CSS & Color Variables
├── BUSINESS.md              # เอกสารสรุปข้อตกลงและขอบเขตทางธุรกิจ
├── README.md                # เอกสารแนะนำโปรเจกต์และคู่มือการติดตั้ง
└── package.json             # Dependencies & Scripts
```

---

## ⚙️ การตั้งค่า Environment Variables (`.env.local`)

สร้างไฟล์ `.env.local` ที่ Root ของโปรเจกต์และระบุค่าดังต่อไปนี้:

```bash
# App Configuration
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Database (Neon Postgres)
DATABASE_URL="postgres://..."

# Cloudinary (Image Storage)
CLOUDINARY_CLOUD_NAME=""
CLOUDINARY_API_KEY=""
CLOUDINARY_API_SECRET=""

# SMS OTP Service
SMS_API_KEY=""
SMS_API_SECRET=""
SMS_SENDER_NAME="BluFitness"

# EasySlip API (Auto Slip Verification)
EASYSLIP_API_KEY=""
EASYSLIP_MERCHANT_ID=""

# LINE Official Account (LINE Messaging API)
LINE_CHANNEL_ACCESS_TOKEN=""
LINE_CHANNEL_SECRET=""

# Security
JWT_SECRET="your-super-secret-jwt-key"
ADMIN_PIN_HASH=""
```

---

## 🔌 API สำหรับ Hardware Scanner & Door Access

### 1. Check-in via Scanner API
* **Endpoint:** `POST /api/access/checkin`
* **Payload:**
```json
{
  "memberCode": "BLU-889912",
  "scannerDeviceId": "GATE-01"
}
```
* **Response (Success):**
```json
{
  "success": true,
  "status": "APPROVED",
  "message": "เช็คอินสำเร็จ สมาชิกยังมีอายุการใช้งาน",
  "data": {
    "memberName": "สมชาย สุขภาพดี",
    "expireDate": "2026-12-31",
    "daysRemaining": 125,
    "pointsAdded": 1,
    "totalPoints": 15,
    "unlockDoor": true
  }
}
```

---

## 📖 ข้อมูลเพิ่มเติม
* รายละเอียดสัญญาและขอบเขตงานทางธุรกิจ: ดูที่ [`BUSINESS.md`](file:///c:/PROJECT/blue-fitness/BUSINESS.md)
