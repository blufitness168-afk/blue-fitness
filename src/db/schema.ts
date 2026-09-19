import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ==============================================================================
// 🏷️ ENUMS
// ==============================================================================
export const memberStatusEnum = pgEnum("member_status", [
  "PENDING",
  "ACTIVE",
  "EXPIRED",
  "SUSPENDED",
]);

export const couponTypeEnum = pgEnum("coupon_type", [
  "FRIEND_PASS", // คูปองพาเพื่อนมาเล่นฟรี
  "EXTRA_DAYS",  // คูปองเพิ่มวันใช้งาน
  "CUSTOM",      // คูปองพิเศษอื่นๆ
]);

export const couponStatusEnum = pgEnum("coupon_status", [
  "AVAILABLE",
  "USED",
  "EXPIRED",
]);

export const scannerTypeEnum = pgEnum("scanner_type", [
  "WEB_CAMERA",  // สแกนผ่านกล้องมือถือพนักงาน
  "HARDWARE_USB",// สแกนผ่านเครื่องอ่านบาร์โค้ด USB
  "API_GATE",    // สแกนผ่านระบบเปิด-ปิดประตูอัตโนมัติ
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

// ==============================================================================
// 👤 1. MEMBERS (ข้อมูลสมาชิก)
// ==============================================================================
export const members = pgTable("members", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  fullName: text("full_name").notNull(),
  birthDay: integer("birth_day"),     // วันที่เกิด (1 - 31)
  birthMonth: integer("birth_month"), // เดือนที่เกิด (1 - 12)
  memberCode: varchar("member_code", { length: 50 }).notNull().unique(), // เช่น BLU-1001
  avatarUrl: text("avatar_url"),
  avatarChanged: boolean("avatar_changed").default(false).notNull(), // สมาชิกอัปโหลดเองได้ 1 ครั้ง
  points: integer("points").default(0).notNull(),
  expireDate: timestamp("expire_date", { withTimezone: true }),
  status: memberStatusEnum("status").default("PENDING").notNull(),
  isFirstRegistration: boolean("is_first_registration").default(true).notNull(),
  lineUserId: varchar("line_user_id", { length: 100 }), // สำหรับแจ้งเตือนผ่าน LINE
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ==============================================================================
// 📦 2. PACKAGES (แพ็กเกจสมาชิก)
// ==============================================================================
export const packages = pgTable("packages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // เช่น "Package 30 วัน", "Package 90 วัน"
  durationDays: integer("duration_days").notNull(), // 30, 90, 120, 365
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  friendCoupons: integer("friend_coupons").default(0).notNull(), // คูปองพาเพื่อน (ครั้งแรก)
  bonusDays: integer("bonus_days").default(0).notNull(),         // วันแถมพิเศษ (ครั้งแรก)
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ==============================================================================
// 🎟️ 3. COUPONS (กระเป๋าคูปองสมาชิก)
// ==============================================================================
export const coupons = pgTable("coupons", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id")
    .references(() => members.id, { onDelete: "cascade" })
    .notNull(),
  type: couponTypeEnum("type").notNull(),
  title: text("title").notNull(), // เช่น "คูปองพาเพื่อนมาเล่นฟรี 1 คน (5 ครั้ง)"
  totalQuota: integer("total_quota").default(1).notNull(),
  usedCount: integer("used_count").default(0).notNull(),
  bonusDaysValue: integer("bonus_days_value").default(0).notNull(), // จำนวนวันที่ได้เพิ่มถ้าเป็น EXTRA_DAYS
  expireDate: timestamp("expire_date", { withTimezone: true }),
  status: couponStatusEnum("status").default("AVAILABLE").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ==============================================================================
// ⏱️ 4. CHECKINS (ประวัติการเช็กอิน & สะสมแต้ม)
// ==============================================================================
export const checkins = pgTable("checkins", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id")
    .references(() => members.id, { onDelete: "cascade" })
    .notNull(),
  checkinTime: timestamp("checkin_time", { withTimezone: true }).defaultNow().notNull(),
  scannerType: scannerTypeEnum("scanner_type").default("WEB_CAMERA").notNull(),
  scannerDeviceId: text("scanner_device_id").default("FRONT_DESK").notNull(),
  pointsAwarded: integer("points_awarded").default(0).notNull(), // Check-in no longer awards points; retained for audit compatibility
  notes: text("notes"),
});

// ==============================================================================
// 💳 5. PAYMENTS (ประวัติการชำระเงิน & ตรวจสลิป EasySlip)
// ==============================================================================
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id")
    .references(() => members.id, { onDelete: "cascade" })
    .notNull(),
  packageId: integer("package_id")
    .references(() => packages.id, { onDelete: "restrict" })
    .notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  slipUrl: text("slip_url"),
  slipVerified: boolean("slip_verified").default(false).notNull(),
  easyslipTransRef: varchar("easyslip_trans_ref", { length: 100 }), // รหัสอ้างอิงสลิปจาก EasySlip
  easyslipRaw: jsonb("easyslip_raw"),                               // Raw JSON ตอบกลับจาก EasySlip
  status: paymentStatusEnum("status").default("PENDING").notNull(),
  approvedBy: text("approved_by").default("SYSTEM_EASYSLIP").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ==============================================================================
// 🎁 6. REWARDS & REDEMPTIONS (ระบบของรางวัล & แลกแต้ม)
// ==============================================================================
export const rewards = pgTable("rewards", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  pointCost: integer("point_cost").notNull(),
  stock: integer("stock").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const redemptions = pgTable("redemptions", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id")
    .references(() => members.id, { onDelete: "cascade" })
    .notNull(),
  rewardId: integer("reward_id")
    .references(() => rewards.id, { onDelete: "restrict" })
    .notNull(),
  pointsSpent: integer("points_spent").notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).defaultNow().notNull(),
  status: text("status").default("COMPLETED").notNull(),
});

// ==============================================================================
// 📱 7. OTP REQUESTS (ประวัติการส่ง SMS OTP)
// ==============================================================================
export const otpRequests = pgTable("otp_requests", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull(),
  otpCode: varchar("otp_code", { length: 10 }).notNull(),
  refCode: varchar("ref_code", { length: 10 }).notNull(),
  isVerified: boolean("is_verified").default(false).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ==============================================================================
// 🔗 RELATIONS
// ==============================================================================
export const membersRelations = relations(members, ({ many }) => ({
  coupons: many(coupons),
  checkins: many(checkins),
  payments: many(payments),
  redemptions: many(redemptions),
}));

export const couponsRelations = relations(coupons, ({ one }) => ({
  member: one(members, {
    fields: [coupons.memberId],
    references: [members.id],
  }),
}));

export const checkinsRelations = relations(checkins, ({ one }) => ({
  member: one(members, {
    fields: [checkins.memberId],
    references: [members.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  member: one(members, {
    fields: [payments.memberId],
    references: [members.id],
  }),
  package: one(packages, {
    fields: [payments.packageId],
    references: [packages.id],
  }),
}));

export const redemptionsRelations = relations(redemptions, ({ one }) => ({
  member: one(members, {
    fields: [redemptions.memberId],
    references: [members.id],
  }),
  reward: one(rewards, {
    fields: [redemptions.rewardId],
    references: [rewards.id],
  }),
}));
