export const couponKinds = {
  FRIEND_PASS: "พาเพื่อน", EXTRA_DAYS: "เพิ่มวัน", GIFT: "ของขวัญ", FREEBIE: "แถมฟรี", OTHER: "อื่น ๆ",
  FREE_ENTRY: "เข้าใช้ฟรี", CUSTOM: "สิทธิ์พิเศษเดิม",
  DISCOUNT: "ส่วนลดตอนซื้อแพ็กเกจ", POINTS: "แต้มเพิ่มเมื่อซื้อแพ็กเกจ",
} as const;
export const couponStatuses = {
  AVAILABLE: "พร้อมใช้", PENDING_ACTIVATION: "รอเปิดใช้", USED: "ใช้ครบแล้ว", EXPIRED: "หมดอายุ", CANCELLED: "ยกเลิกแล้ว",
} as const;
export const couponGroups = { "1": "รายวัน", "30": "1 เดือน", "90": "3 เดือน", "180": "6 เดือน", "365": "12 เดือน" } as const;

export type CouponHistoryPage = {
  rows: {
    id: number; title: string; kind: keyof typeof couponKinds; status: keyof typeof couponStatuses;
    code: string | null; description: string | null; member_code: string; full_name: string;
    total_quota: number; used_count: number; created_at: string; expire_date: string | null;
    campaign_expires_at: string | null; activated_at: string | null; activation_duration_minutes: number | null;
    recipient_duration_days: number | null; assignment_id: number | null; used_at: string | null; use_times: string[];
  }[];
  nextBefore: number | null;
};
