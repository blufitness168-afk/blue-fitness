export const promoStatuses = {
  ASSIGNED: "มอบหมายแล้ว", RESERVED: "จองในคำสั่งซื้อ", USED: "ใช้แล้ว", CANCELLED: "ยกเลิกแล้ว",
  EXPIRED: "หมดอายุ", DISABLED: "ปิดใช้งาน",
} as const;

export type PromoHistoryPage = {
  rows: {
    id: number; member_code: string; full_name: string; title: string; code: string; description: string | null;
    issued_at: string; expires_at: string; used_at: string | null; status: keyof typeof promoStatuses;
    recipient_duration_days: number | null; discount_type: "FIXED" | "PERCENT"; discount_value: number;
    min_satang: number; max_satang: number | null; max_discount_satang: number | null; eligible_package_ids: number[] | null;
  }[];
  nextBefore: number | null;
};
