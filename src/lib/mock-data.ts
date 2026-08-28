// ==============================================================================
// 📦 Mock Data สำหรับ Phase 1: UI Prototype
// ข้อมูลจำลองจาก schema packages ใน src/db/schema.ts
// ==============================================================================

export type TimeSlot = "07:00-14:00" | "07:00-22:00";

export interface MockPackage {
  id: number;
  name: string;
  durationDays: number;
  label: string; // "รายวัน", "30 วัน", etc.
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
    description: "เข้าใช้บริการ 1 วัน ช่วง 07:00-14:00",
    isActive: true,
  },
  {
    id: 2,
    name: "BLU 07:00-14:00 30 วัน",
    label: "30 วัน",
    durationDays: 30,
    timeSlot: "07:00-14:00",
    price: 900,
    friendCoupons: 5,
    bonusDays: 0,
    description: "เข้าใช้บริการ 30 วัน ช่วง 07:00-14:00 + คูปองพาเพื่อน 5 ครั้ง",
    isActive: true,
  },
  {
    id: 3,
    name: "BLU 07:00-14:00 90 วัน",
    label: "90 วัน",
    durationDays: 90,
    timeSlot: "07:00-14:00",
    price: 2400,
    friendCoupons: 5,
    bonusDays: 15,
    description: "เข้าใช้บริการ 90 วัน ช่วง 07:00-14:00 + คูปองพาเพื่อน 5 ครั้ง + เพิ่มวัน 15 วัน",
    isActive: true,
  },
  {
    id: 4,
    name: "BLU 07:00-14:00 180 วัน",
    label: "180 วัน",
    durationDays: 180,
    timeSlot: "07:00-14:00",
    price: 4200,
    friendCoupons: 5,
    bonusDays: 30,
    description: "เข้าใช้บริการ 180 วัน ช่วง 07:00-14:00 + คูปองพาเพื่อน 5 ครั้ง + เพิ่มวัน 30 วัน",
    isActive: true,
  },
  {
    id: 5,
    name: "BLU 07:00-14:00 365 วัน",
    label: "365 วัน",
    durationDays: 365,
    timeSlot: "07:00-14:00",
    price: 7200,
    friendCoupons: 10,
    bonusDays: 60,
    description: "เข้าใช้บริการ 1 ปี ช่วง 07:00-14:00 + คูปองพาเพื่อน 10 ครั้ง + เพิ่มวัน 60 วัน",
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
    description: "เข้าใช้บริการ 1 วัน ช่วง 07:00-22:00",
    isActive: true,
  },
  {
    id: 7,
    name: "BLU 07:00-22:00 30 วัน",
    label: "30 วัน",
    durationDays: 30,
    timeSlot: "07:00-22:00",
    price: 1000,
    friendCoupons: 5,
    bonusDays: 0,
    description: "เข้าใช้บริการ 30 วัน ช่วง 07:00-22:00 + คูปองพาเพื่อน 5 ครั้ง",
    isActive: true,
  },
  {
    id: 8,
    name: "BLU 07:00-22:00 90 วัน",
    label: "90 วัน",
    durationDays: 90,
    timeSlot: "07:00-22:00",
    price: 2700,
    friendCoupons: 5,
    bonusDays: 15,
    description: "เข้าใช้บริการ 90 วัน ช่วง 07:00-22:00 + คูปองพาเพื่อน 5 ครั้ง + เพิ่มวัน 15 วัน",
    isActive: true,
  },
  {
    id: 9,
    name: "BLU 07:00-22:00 180 วัน",
    label: "180 วัน",
    durationDays: 180,
    timeSlot: "07:00-22:00",
    price: 4800,
    friendCoupons: 5,
    bonusDays: 30,
    description: "เข้าใช้บริการ 180 วัน ช่วง 07:00-22:00 + คูปองพาเพื่อน 5 ครั้ง + เพิ่มวัน 30 วัน",
    isActive: true,
  },
  {
    id: 10,
    name: "BLU 07:00-22:00 365 วัน",
    label: "365 วัน",
    durationDays: 365,
    timeSlot: "07:00-22:00",
    price: 8400,
    friendCoupons: 10,
    bonusDays: 60,
    description: "เข้าใช้บริการ 1 ปี ช่วง 07:00-22:00 + คูปองพาเพื่อน 10 ครั้ง + เพิ่มวัน 60 วัน",
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
