// ==============================================================================
// 📦 Mock Data สำหรับ Phase 1: UI Prototype
// ข้อมูลจำลองแพ็กเกจ และ ระบบโค้ดส่วนลด (Promo Codes)
// ==============================================================================

export type TimeSlot = "07:00-14:00" | "07:00-22:00";

export interface MockPackage {
  id: number;
  name: string;
  durationDays: number;
  label: string; // "รายวัน", "1 เดือน", "3 เดือน", "6 เดือน", "1 ปี"
  timeSlot: TimeSlot;
  price: number;
  friendCoupons: number;
  bonusDays: number;
  description: string;
  isActive: boolean;
}

// ช่วง Off-Peak: 07:00 - 14:00
const offPeakPackages: MockPackage[] = [
  {
    id: 1,
    name: "BLU 07:00-14:00 รายวัน",
    label: "รายวัน",
    durationDays: 1,
    timeSlot: "07:00-14:00",
    price: 90,
    friendCoupons: 0,
    bonusDays: 0,
    description: "เข้าใช้บริการ 1 วัน ช่วง 07:00 - 14:00 น.",
    isActive: true,
  },
  {
    id: 2,
    name: "BLU 07:00-14:00 1 เดือน",
    label: "1 เดือน",
    durationDays: 30,
    timeSlot: "07:00-14:00",
    price: 900,
    friendCoupons: 5,
    bonusDays: 0,
    description: "เข้าใช้บริการ 1 เดือน (30 วัน) ช่วง 07:00 - 14:00 น.",
    isActive: true,
  },
  {
    id: 3,
    name: "BLU 07:00-14:00 3 เดือน",
    label: "3 เดือน",
    durationDays: 90,
    timeSlot: "07:00-14:00",
    price: 2400,
    friendCoupons: 5,
    bonusDays: 15,
    description: "เข้าใช้บริการ 3 เดือน (90 วัน) ช่วง 07:00 - 14:00 น.",
    isActive: true,
  },
  {
    id: 4,
    name: "BLU 07:00-14:00 6 เดือน",
    label: "6 เดือน",
    durationDays: 180,
    timeSlot: "07:00-14:00",
    price: 4200,
    friendCoupons: 5,
    bonusDays: 30,
    description: "เข้าใช้บริการ 6 เดือน (180 วัน) ช่วง 07:00 - 14:00 น.",
    isActive: true,
  },
  {
    id: 5,
    name: "BLU 07:00-14:00 1 ปี",
    label: "1 ปี",
    durationDays: 365,
    timeSlot: "07:00-14:00",
    price: 7200,
    friendCoupons: 10,
    bonusDays: 60,
    description: "เข้าใช้บริการ 1 ปี (365 วัน) ช่วง 07:00 - 14:00 น.",
    isActive: true,
  },
];

// ช่วง All-Day: 07:00 - 22:00
const allDayPackages: MockPackage[] = [
  {
    id: 6,
    name: "BLU 07:00-22:00 รายวัน",
    label: "รายวัน",
    durationDays: 1,
    timeSlot: "07:00-22:00",
    price: 100,
    friendCoupons: 0,
    bonusDays: 0,
    description: "เข้าใช้บริการ 1 วัน ช่วง 07:00 - 22:00 น.",
    isActive: true,
  },
  {
    id: 7,
    name: "BLU 07:00-22:00 1 เดือน",
    label: "1 เดือน",
    durationDays: 30,
    timeSlot: "07:00-22:00",
    price: 1000,
    friendCoupons: 5,
    bonusDays: 0,
    description: "เข้าใช้บริการ 1 เดือน (30 วัน) ช่วง 07:00 - 22:00 น.",
    isActive: true,
  },
  {
    id: 8,
    name: "BLU 07:00-22:00 3 เดือน",
    label: "3 เดือน",
    durationDays: 90,
    timeSlot: "07:00-22:00",
    price: 2700,
    friendCoupons: 5,
    bonusDays: 15,
    description: "เข้าใช้บริการ 3 เดือน (90 วัน) ช่วง 07:00 - 22:00 น.",
    isActive: true,
  },
  {
    id: 9,
    name: "BLU 07:00-22:00 6 เดือน",
    label: "6 เดือน",
    durationDays: 180,
    timeSlot: "07:00-22:00",
    price: 4800,
    friendCoupons: 5,
    bonusDays: 30,
    description: "เข้าใช้บริการ 6 เดือน (180 วัน) ช่วง 07:00 - 22:00 น.",
    isActive: true,
  },
  {
    id: 10,
    name: "BLU 07:00-22:00 1 ปี",
    label: "1 ปี",
    durationDays: 365,
    timeSlot: "07:00-22:00",
    price: 8400,
    friendCoupons: 10,
    bonusDays: 60,
    description: "เข้าใช้บริการ 1 ปี (365 วัน) ช่วง 07:00 - 22:00 น.",
    isActive: true,
  },
];

export const mockPackages: MockPackage[] = [
  ...offPeakPackages,
  ...allDayPackages,
];

/** กรองแพ็กเกจตาม time slot */
export function getPackagesBySlot(slot: TimeSlot): MockPackage[] {
  return mockPackages.filter((p) => p.timeSlot === slot && p.isActive);
}

// ==============================================================================
// 🎟️ Promo Codes System (ระบบโค้ดส่วนลด)
// ==============================================================================

export type DiscountType = "FIXED" | "PERCENT";

export interface PromoCode {
  id: string;
  code: string; // เช่น BLU100, FIT10
  discountType: DiscountType; // "FIXED" (ลดเป็นบาท) หรือ "PERCENT" (ลดเป็น %)
  discountValue: number; // 100 (บาท) หรือ 10 (%)
  minSpend?: number; // ยอดสั่งซื้อขั้นต่ำ
  maxDiscount?: number; // ส่วนลดสูงสุด (สำหรับแบบ %)
  usageLimit: number; // โควต้าจำนวนครั้งที่ใช้ได้รวม
  usedCount: number; // จำนวนครั้งที่ถูกใช้ไปแล้ว
  expiresAt: string; // วันหมดอายุ (ISO date string)
  isActive: boolean; // สถานะเปิด/ปิด
  description: string; // บันทึกช่วยจำ
}

export const mockPromoCodes: PromoCode[] = [
  {
    id: "promo-1",
    code: "BLU100",
    discountType: "FIXED",
    discountValue: 100,
    minSpend: 500,
    usageLimit: 100,
    usedCount: 18,
    expiresAt: "2026-12-31T23:59:59Z",
    isActive: true,
    description: "ส่วนลด 100 บาท สำหรับแพ็กเกจ 500 บาทขึ้นไป",
  },
  {
    id: "promo-2",
    code: "FITNESS10",
    discountType: "PERCENT",
    discountValue: 10,
    minSpend: 900,
    maxDiscount: 300,
    usageLimit: 50,
    usedCount: 12,
    expiresAt: "2026-12-31T23:59:59Z",
    isActive: true,
    description: "ส่วนลด 10% (ลดสูงสุดไม่เกิน 300 บาท) สำหรับแพ็กเกจ 1 เดือนขึ้นไป",
  },
  {
    id: "promo-3",
    code: "VIP500",
    discountType: "FIXED",
    discountValue: 500,
    minSpend: 2400,
    usageLimit: 20,
    usedCount: 4,
    expiresAt: "2026-12-31T23:59:59Z",
    isActive: true,
    description: "ส่วนลด 500 บาท พิเศษสำหรับแพ็กเกจ 3 เดือน, 6 เดือน, 1 ปี",
  },
  {
    id: "promo-4",
    code: "EXPIRED",
    discountType: "FIXED",
    discountValue: 200,
    minSpend: 100,
    usageLimit: 10,
    usedCount: 10,
    expiresAt: "2025-01-01T00:00:00Z",
    isActive: true,
    description: "โค้ดทดสอบหมดอายุและโควต้าเต็ม",
  },
  {
    id: "promo-5",
    code: "BLU50",
    discountType: "FIXED",
    discountValue: 50,
    minSpend: 90,
    usageLimit: 100,
    usedCount: 24,
    expiresAt: "2026-12-31T23:59:59Z",
    isActive: true,
    description: "ส่วนลด 50 บาท สำหรับทุกแพ็กเกจ",
  },
];

/** ตรวจสอบความถูกต้องและคำนวณส่วนลด */
export function validatePromoCode(
  inputCode: string,
  totalAmount: number
): {
  valid: boolean;
  discountAmount: number;
  finalAmount: number;
  promo?: PromoCode;
  errorMessage?: string;
  errorMessageEn?: string;
} {
  const cleanCode = inputCode.trim().toUpperCase();
  const promo = mockPromoCodes.find(
    (p) => p.code.toUpperCase() === cleanCode
  );

  if (!promo) {
    return {
      valid: false,
      discountAmount: 0,
      finalAmount: totalAmount,
      errorMessage: "ไม่พบโค้ดส่วนลดนี้ หรือพิมพ์ไม่ถูกต้อง",
      errorMessageEn: "Invalid promo code. Please check and try again.",
    };
  }

  if (!promo.isActive) {
    return {
      valid: false,
      discountAmount: 0,
      finalAmount: totalAmount,
      errorMessage: "โค้ดส่วนลดนี้ถูกปิดใช้งานชั่วคราว",
      errorMessageEn: "This promo code is currently inactive.",
    };
  }

  // Check expiration date
  const now = new Date();
  const expiry = new Date(promo.expiresAt);
  if (now > expiry) {
    return {
      valid: false,
      discountAmount: 0,
      finalAmount: totalAmount,
      errorMessage: "โค้ดส่วนลดนี้หมดอายุแล้ว",
      errorMessageEn: "This promo code has expired.",
    };
  }

  // Check usage limit quota
  if (promo.usageLimit > 0 && promo.usedCount >= promo.usageLimit) {
    return {
      valid: false,
      discountAmount: 0,
      finalAmount: totalAmount,
      errorMessage: "โค้ดส่วนลดนี้ถูกใช้สิทธิ์เต็มจำนวนแล้ว",
      errorMessageEn: "This promo code has reached its usage limit.",
    };
  }

  // Check min spend
  if (promo.minSpend && totalAmount < promo.minSpend) {
    return {
      valid: false,
      discountAmount: 0,
      finalAmount: totalAmount,
      errorMessage: `โค้ดนี้ใช้ได้กับยอดขั้นต่ำ ฿${promo.minSpend.toLocaleString()}`,
      errorMessageEn: `Minimum spend of ฿${promo.minSpend.toLocaleString()} required for this code.`,
    };
  }

  // Calculate discount amount
  let discountAmount = 0;
  if (promo.discountType === "FIXED") {
    discountAmount = promo.discountValue;
  } else if (promo.discountType === "PERCENT") {
    discountAmount = Math.round((totalAmount * promo.discountValue) / 100);
    if (promo.maxDiscount && discountAmount > promo.maxDiscount) {
      discountAmount = promo.maxDiscount;
    }
  }

  discountAmount = Math.min(discountAmount, totalAmount);
  const finalAmount = Math.max(0, totalAmount - discountAmount);

  return {
    valid: true,
    discountAmount,
    finalAmount,
    promo,
  };
}

// ==============================================================================
// 👤 Member Profile & Activity Logs Mock Data (โครงสร้างตารางสมาชิกแบบรวมศูนย์)
// ==============================================================================

export interface MemberCoupon {
  title: string;
  total: number;
  remaining: number;
  expireDate: string; // ISO date string เช่น "2026-10-12T23:59:59Z"
}

export interface ActivityLog {
  id: string;
  type: "POINT" | "COUPON" | "REWARD" | "CHECKIN";
  action: string;
  amount?: string;
  note: string;
  createdAt: string;
}

export interface MemberProfile {
  id: number;
  fullName: string;
  nickname?: string;
  gender: "MALE" | "FEMALE" | "OTHER";
  phone: string;
  avatarUrl?: string;
  memberCode: string;
  cardNumber?: string;
  birthDay: string;
  birthMonth: string;
  emergencyContact?: {
    name: string;
    phone: string;
    relation: string;
  };
  points: number; // แต้มสะสมปัจจุบัน
  coupons: Record<string, MemberCoupon>; // กระเป๋าคูปองต่างๆ (เช่น friend_pass, free_trainer)
  activityLogs: ActivityLog[]; // ประวัติความเคลื่อนไหวทั้งหมด (แต้ม, เช็คอิน, คูปอง)
  status: "ACTIVE" | "EXPIRED" | "PENDING";
  role?: "MEMBER" | "ADMIN" | "OWNER"; // สิทธิ์ผู้ใช้งาน (default: MEMBER)
  registeredAt: string;
}

export const defaultMockMember: MemberProfile = {
  id: 1,
  fullName: "สมชาย ใจดี",
  nickname: "ชาย",
  gender: "MALE",
  phone: "081-234-5678",
  avatarUrl: "",
  memberCode: "BLU-1001",
  cardNumber: "CARD-8899",
  birthDay: "15",
  birthMonth: "สิงหาคม",
  emergencyContact: {
    name: "สมศรี ใจดี",
    phone: "089-999-8888",
    relation: "ภรรยา",
  },
  points: 25,
  coupons: {
    friend_pass: {
      title: "Friend Pass (พาเพื่อนเล่นฟรี)",
      total: 5,
      remaining: 5,
      expireDate: "2026-10-12T23:59:59Z",
    },
  },
  activityLogs: [
    {
      id: "log-1",
      type: "CHECKIN",
      action: "CHECKIN",
      note: "สแกนเช็คอินเข้ายิม (ไม่เพิ่มคะแนน)",
      createdAt: "2026-09-01T08:30:00Z",
    },
    {
      id: "log-2",
      type: "CHECKIN",
      action: "CHECKIN",
      note: "สแกนเช็คอินเข้ายิม (ไม่เพิ่มคะแนน)",
      createdAt: "2026-08-31T17:15:00Z",
    },
    {
      id: "log-3",
      type: "COUPON",
      action: "USE_FRIEND_PASS",
      amount: "-1",
      note: "พาเพื่อนชื่อเอกชัยมาเล่น",
      createdAt: "2026-08-25T10:00:00Z",
    },
  ],
  status: "ACTIVE",
  role: "ADMIN", // ตัวอย่าง: บัญชีนี้เป็น Admin (เห็นเมนู Admin Panel ใน dropdown)
  registeredAt: "28 ส.ค. 2026",
};

// ==============================================================================
// 🎁 Rewards System (ระบบแลกของรางวัล)
// ==============================================================================

export interface RewardItem {
  id: number;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  imageUrl: string;
  pointCost: number;
  stock: number;
  isActive: boolean;
}

// รูปอ้างอิงจาก Unsplash (placeholder) — เปลี่ยนเป็นรูปสินค้าจริงภายหลัง
export const mockRewards: RewardItem[] = [
  {
    id: 1,
    title: "เครื่องดื่มเกลือแร่ / น้ำดื่ม 1 ขวด",
    titleEn: "Sports Drink / Bottled Water",
    description: "แลกรับเครื่องดื่มเย็นสดชื่นที่เคาน์เตอร์ฟิตเนส",
    descriptionEn: "Redeem a refreshing drink at the front desk",
    imageUrl:
      "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=400&q=80",
    pointCost: 10,
    stock: 100,
    isActive: true,
  },
  {
    id: 2,
    title: "ผ้าขนหนูออกกำลังกาย Blu Fitness",
    titleEn: "Blu Fitness Gym Towel",
    description: "ผ้าขนหนูซับเหงื่อไมโครไฟเบอร์ พรีเมียม พกพาสะดวก",
    descriptionEn: "Premium microfiber sweat towel, easy to carry",
    imageUrl:
      "https://images.unsplash.com/photo-1616803689943-5601631c7fec?auto=format&fit=crop&w=400&q=80",
    pointCost: 30,
    stock: 50,
    isActive: true,
  },
  {
    id: 3,
    title: "เสื้อยืด Blu Fitness Limited Edition",
    titleEn: "Blu Fitness Limited Edition Shirt",
    description: "เสื้อกีฬาเนื้อผ้าระบายอากาศดีเยี่ยม สกรีนโลโก้ทอง Blu Fitness",
    descriptionEn: "Breathable sports shirt with gold Blu Fitness logo",
    imageUrl:
      "https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=400&q=80",
    pointCost: 60,
    stock: 30,
    isActive: true,
  },
  {
    id: 4,
    title: "ฟรีสมาชิกเพิ่ม 7 วัน",
    titleEn: "Free 7 Days Membership Extension",
    description: "รับวันใช้งานฟิตเนสเพิ่มฟรีทันที 7 วัน",
    descriptionEn: "Get 7 extra days of gym access for free",
    imageUrl:
      "https://images.unsplash.com/photo-1540497077202-7c8a3999166f?auto=format&fit=crop&w=400&q=80",
    pointCost: 80,
    stock: 999,
    isActive: true,
  },
];

