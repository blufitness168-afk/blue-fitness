import { mockAdminMembers } from "./admin-mock";

export interface CheckinMember {
  memberCode: string;
  cardNumber: string;
  fullName: string;
  packageName: string;
  timeSlot: "07:00-14:00" | "07:00-22:00";
  expiresAt: string;
  status: "ACTIVE" | "PENDING";
  points: number;
}

export interface CheckinRecord {
  id: string;
  memberCode: string;
  fullName: string;
  checkedAt: string;
  source: "USB_MANUAL" | "CAMERA";
  points: number;
}

export interface CheckinResult {
  status: "success" | "warning" | "error";
  title: string;
  message: string;
  member?: CheckinMember;
  record?: CheckinRecord;
}

export const CHECKIN_STORAGE_KEY = "blu_checkin_demo_v1";

export function bangkokDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function createDemoMembers(now: Date): CheckinMember[] {
  const future = new Date(now.getTime() + 30 * 86400000).toISOString();
  const past = new Date(now.getTime() - 86400000).toISOString();
  return mockAdminMembers.map(member => ({
    memberCode: member.memberCode, cardNumber: member.cardNumber, fullName: member.fullName, points: member.points,
    packageName: member.memberCode === "BLU-1015" ? "3 เดือน • Off-Peak" : member.memberCode === "BLU-1020" ? "1 ปี • หมดอายุ" : member.memberCode === "BLU-1025" ? "1 เดือน • รอชำระเงิน" : "1 เดือน • All-Day",
    timeSlot: member.memberCode === "BLU-1015" ? "07:00-14:00" : "07:00-22:00",
    expiresAt: member.memberCode === "BLU-1020" ? past : future,
    status: member.memberCode === "BLU-1025" ? "PENDING" : "ACTIVE",
  }));
}

// Pure decision logic; production must run this against trusted server time and an atomic database transaction.
export function evaluateCheckin(
  code: string,
  members: CheckinMember[],
  records: CheckinRecord[],
  now: Date,
  source: CheckinRecord["source"],
  id: string,
): CheckinResult {
  const normalized = code.trim().toUpperCase();
  const member = members.find((m) => m.memberCode === normalized || m.cardNumber === normalized);
  if (!normalized || normalized.length > 100 || !member) {
    return { status: "error", title: "ไม่พบสมาชิก", message: "ตรวจสอบรหัสสมาชิกหรือเลขบัตรแข็ง แล้วลองอีกครั้ง" };
  }
  if (member.status !== "ACTIVE") {
    return { status: "error", title: "สมาชิกยังไม่พร้อมเข้าใช้", message: "กรุณาตรวจสอบการชำระเงินและเปิดใช้งานแพ็กเกจ", member };
  }
  if (!Number.isFinite(Date.parse(member.expiresAt)) || Date.parse(member.expiresAt) <= now.getTime()) {
    return { status: "error", title: "สมาชิกหมดอายุ", message: "กรุณาต่ออายุแพ็กเกจก่อนเข้าใช้บริการ", member };
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const seconds = get("hour") * 3600 + get("minute") * 60 + get("second");
  if (seconds < 7 * 3600 || seconds > 22 * 3600) {
    return { status: "warning", title: "อยู่นอกเวลาทำการ", message: "เปิดให้บริการ 07:00–22:00 น. • ยังไม่บันทึกเช็กอิน", member };
  }
  if (member.timeSlot === "07:00-14:00" && seconds > 14 * 3600) {
    return { status: "warning", title: "อยู่นอกช่วงเวลาแพ็กเกจ", message: "สิทธิ์ 07:00–14:00 น. • ยังไม่บันทึกเช็กอิน กรุณาติดต่อเคาน์เตอร์", member };
  }
  return {
    status: "success", title: "เข้าใช้บริการได้",
    message: "เช็กอินสำเร็จ • ยินดีต้อนรับ",
    member,
    record: { id, memberCode: member.memberCode, fullName: member.fullName, checkedAt: now.toISOString(), source, points: 0 },
  };
}

export function parseCheckinRecords(raw: string | null): CheckinRecord[] {
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || !value.every((r) =>
    r && typeof r === "object" && typeof r.id === "string" && r.id.trim().length > 0 &&
    typeof r.memberCode === "string" && /^BLU-\d+$/.test(r.memberCode) && typeof r.fullName === "string" && r.fullName.trim().length > 0 &&
    typeof r.checkedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(r.checkedAt) && Number.isFinite(Date.parse(r.checkedAt)) &&
    (r.source === "USB_MANUAL" || r.source === "CAMERA") && (r.points === 0 || r.points === 1)
  )) throw new Error("Invalid check-in history");
  const ids = new Set<string>();
  for (const record of value as CheckinRecord[]) {
    if (ids.has(record.id)) throw new Error("Duplicate check-in history");
    ids.add(record.id);
  }
  // Normalize legacy +1 check-ins in memory; check-in is no longer a point source.
  return (value as CheckinRecord[]).map(record => ({ ...record, points: 0 }));
}
