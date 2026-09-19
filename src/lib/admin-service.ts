import { z } from "zod";
import { readAdminMembers, combinedMembershipHistory } from "./admin-members";
import { CHECKIN_STORAGE_KEY, parseCheckinRecords } from "./checkin";

export const SERVICE_STORAGE_KEY = "blu_admin_service_mock_v1";
export const SERVICE_EVENT = "blu-admin-service-updated";

const serviceRecordSchema = z.object({
  id: z.string().min(1).max(120),
  memberCode: z.string().regex(/^BLU-\d+$/),
  memberName: z.string().trim().min(1).max(200),
  occurredAt: z.string().datetime({ offset: true }),
  membershipType: z.string().trim().min(1).max(200),
  timeSlot: z.enum(["07:00-14:00", "07:00-22:00"]),
  serviceType: z.enum(["CHECKIN", "CHECKOUT"]),
  note: z.string().trim().max(500),
  source: z.enum(["SEED", "MANUAL", "SCANNER"]),
}).strict();
export type ServiceRecord = z.infer<typeof serviceRecordSchema>;
export type ServiceRecordInput = Omit<ServiceRecord, "id" | "source">;

const storeSchema = z.object({
  version: z.literal(1),
  records: z.array(serviceRecordSchema.refine((record) => record.source === "MANUAL")),
}).strict();

function seedRecords(): ServiceRecord[] {
  const members = readAdminMembers();
  const records: ServiceRecord[] = [];
  for (let day = 1; day <= 18; day++) {
    const dailyMembers = [members[day % members.length], members[(day + 2) % members.length]];
    dailyMembers.forEach((member, index) => {
      const history = combinedMembershipHistory(member);
      const membership = history.find((item) => item.startedAt <= `2026-09-${String(day).padStart(2, "0")}` && item.expiresAt >= `2026-09-${String(day).padStart(2, "0")}`) ?? history[0];
      const hour = index === 0 ? 8 + (day % 5) : 15 + (day % 7);
      const minute = (day * 7 + index * 11) % 60;
      const date = `2026-09-${String(day).padStart(2, "0")}`;
      const memberName = `${member.firstName} ${member.lastName}`;
      records.push(serviceRecordSchema.parse({ id: `seed-in-${day}-${index}`, memberCode: member.memberCode, memberName, occurredAt: `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`, membershipType: membership?.packageName ?? "รายวัน", timeSlot: membership?.timeSlot ?? "07:00-22:00", serviceType: "CHECKIN", note: "", source: "SEED" }));
      records.push(serviceRecordSchema.parse({ id: `seed-out-${day}-${index}`, memberCode: member.memberCode, memberName, occurredAt: `${date}T${String(Math.min(hour + 2, 22)).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`, membershipType: membership?.packageName ?? "รายวัน", timeSlot: membership?.timeSlot ?? "07:00-22:00", serviceType: "CHECKOUT", note: "", source: "SEED" }));
    });
  }
  return records;
}

function readStore() {
  const raw = localStorage.getItem(SERVICE_STORAGE_KEY);
  if (raw === null) return { version: 1 as const, records: [] as ServiceRecord[] };
  try {
    const store = storeSchema.parse(JSON.parse(raw));
    if (new Set(store.records.map((record) => record.id)).size !== store.records.length) throw new Error();
    return store;
  } catch {
    throw new Error("ข้อมูลประวัติใช้บริการ mock เสียหาย กรุณาตรวจสอบ localStorage");
  }
}

function legacyScannerRecords(): ServiceRecord[] {
  const members = readAdminMembers();
  return parseCheckinRecords(localStorage.getItem(CHECKIN_STORAGE_KEY)).map((record) => {
    const member = members.find((item) => item.memberCode === record.memberCode);
    const membership = member ? combinedMembershipHistory(member)[0] : undefined;
    return serviceRecordSchema.parse({
      id: `scanner-${record.id}`,
      memberCode: record.memberCode,
      memberName: record.fullName,
      occurredAt: record.checkedAt,
      membershipType: membership?.packageName ?? "ไม่ระบุแพ็กเกจ",
      timeSlot: membership?.timeSlot ?? "07:00-22:00",
      serviceType: "CHECKIN",
      note: record.source === "CAMERA" ? "สแกนผ่านกล้อง" : "สแกนที่เคาน์เตอร์",
      source: "SCANNER",
    });
  });
}

export function readServiceRecords(): ServiceRecord[] {
  const records = [...legacyScannerRecords(), ...readStore().records, ...seedRecords()];
  const unique = new Map(records.map((record) => [record.id, record]));
  return [...unique.values()].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
}

export function saveServiceRecord(input: ServiceRecordInput): ServiceRecord {
  const store = readStore();
  const created = serviceRecordSchema.parse({ ...input, id: crypto.randomUUID(), source: "MANUAL" });
  store.records.unshift(created);
  const serialized = JSON.stringify(storeSchema.parse(store));
  localStorage.setItem(SERVICE_STORAGE_KEY, serialized);
  window.dispatchEvent(new CustomEvent(SERVICE_EVENT));
  return structuredClone(created);
}
