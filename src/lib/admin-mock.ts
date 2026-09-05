// ==============================================================================
// 🖥️ Admin Dashboard Mock Data (Phase: UI Prototype)
// ข้อมูลจำลองสรุปภาพรวมสำหรับฝั่งผู้ดูแล / หน้าร้าน
// ==============================================================================

export interface KpiMetric {
  id: string;
  label: string;
  labelEn: string;
  value: number;
  unit?: string;
  delta: number; // เปลี่ยนแปลงจากก่อนหน้า (% หรือ +จำนวน)
  trend: "up" | "down" | "flat";
  icon: "members" | "checkin" | "sales" | "expiring";
}

export const mockKpis: KpiMetric[] = [
  {
    id: "members",
    label: "จำนวนสมาชิกทั้งหมด",
    labelEn: "Total Members",
    value: 186,
    delta: 12,
    trend: "up",
    icon: "members",
  },
  {
    id: "checkin",
    label: "เช็คอินวันนี้",
    labelEn: "Today's Check-ins",
    value: 47,
    delta: 9,
    trend: "up",
    icon: "checkin",
  },
  {
    id: "sales",
    label: "ยอดขายเดือนนี้",
    labelEn: "Monthly Sales",
    value: 84500,
    unit: "฿",
    delta: 8,
    trend: "up",
    icon: "sales",
  },
  {
    id: "expiring",
    label: "สมาชิกใกล้หมดอายุ (30 วัน)",
    labelEn: "Expiring Soon (30 days)",
    value: 23,
    delta: 4,
    trend: "down",
    icon: "expiring",
  },
];

export interface AdminMemberRow {
  id: number;
  memberCode: string;
  fullName: string;
  nickname?: string;
  phone: string;
  points: number;
  package: string;
  expireDate: string; // ISO date
  daysLeft: number;
  status: "ACTIVE" | "EXPIRED" | "PENDING";
}

// ตัวอย่างสมาชิกที่ใกล้หมดอายุ (ใช้แสดงใน "Expiring Soon")
export const mockExpiringMembers: AdminMemberRow[] = [
  {
    id: 101,
    memberCode: "BLU-1012",
    fullName: "นางสาววิภาดา รักฟิต",
    nickname: "วิว",
    phone: "089-111-2200",
    points: 42,
    package: "1 เดือน (07:00-22:00)",
    expireDate: "2026-09-08T23:59:59Z",
    daysLeft: 3,
    status: "ACTIVE",
  },
  {
    id: 102,
    memberCode: "BLU-1015",
    fullName: "นายจักรพงษ์ สมบูรณ์",
    nickname: "เจท",
    phone: "086-222-3311",
    points: 18,
    package: "3 เดือน (07:00-14:00)",
    expireDate: "2026-09-10T23:59:59Z",
    daysLeft: 5,
    status: "ACTIVE",
  },
  {
    id: 103,
    memberCode: "BLU-1020",
    fullName: "นายธีรภัทร ใจกล้า",
    nickname: "บอส",
    phone: "082-555-7788",
    points: 5,
    package: "1 ปี (07:00-22:00)",
    expireDate: "2026-09-12T23:59:59Z",
    daysLeft: 7,
    status: "ACTIVE",
  },
  {
    id: 104,
    memberCode: "BLU-1025",
    fullName: "นางสาวกัลยา ศรีสุข",
    nickname: "กานต์",
    phone: "090-444-5566",
    points: 63,
    package: "6 เดือน (07:00-22:00)",
    expireDate: "2026-09-14T23:59:59Z",
    daysLeft: 9,
    status: "ACTIVE",
  },
];

export interface AdminCheckinRow {
  id: number;
  memberCode: string;
  fullName: string;
  time: string; // HH:mm
  scanner: string;
  points: number;
}

// ตัวอย่างเช็คอินวันนี้
export const mockTodayCheckins: AdminCheckinRow[] = [
  { id: 1, memberCode: "BLU-1002", fullName: "สมศรี ใจดี", time: "06:12", scanner: "FRONT_DESK", points: 1 },
  { id: 2, memberCode: "BLU-1011", fullName: "อนุชา แสงทอง", time: "06:35", scanner: "FRONT_DESK", points: 1 },
  { id: 3, memberCode: "BLU-1008", fullName: "พิมพ์ใจ รักดี", time: "07:02", scanner: "WEB_CAMERA", points: 1 },
  { id: 4, memberCode: "BLU-1019", fullName: "ธนวัฒน์ พึ่งบุญ", time: "07:41", scanner: "FRONT_DESK", points: 1 },
  { id: 5, memberCode: "BLU-1030", fullName: "เมธาวี อ่อนนุ่ม", time: "08:03", scanner: "WEB_CAMERA", points: 1 },
  { id: 6, memberCode: "BLU-1005", fullName: "สมพงษ์ ใจเย็น", time: "08:22", scanner: "FRONT_DESK", points: 1 },
  { id: 7, memberCode: "BLU-1022", fullName: "เจนจิรา คล่องแคล่ว", time: "08:47", scanner: "FRONT_DESK", points: 1 },
];

export interface AdminSaleRow {
  id: number;
  memberCode: string;
  memberName: string;
  package: string;
  amount: number;
  time: string;
  status: "APPROVED" | "PENDING";
}

// ตัวอย่างการชำระเงินล่าสุด
export const mockRecentSales: AdminSaleRow[] = [
  {
    id: 1,
    memberCode: "BLU-1012",
    memberName: "วิภาดา รักฟิต",
    package: "1 เดือน (07:00-22:00)",
    amount: 1000,
    time: "10:24",
    status: "APPROVED",
  },
  {
    id: 2,
    memberCode: "BLU-1020",
    memberName: "ธีรภัทร ใจกล้า",
    package: "1 ปี (07:00-22:00)",
    amount: 8400,
    time: "09:48",
    status: "APPROVED",
  },
  {
    id: 3,
    memberCode: "BLU-1025",
    memberName: "กัลยา ศรีสุข",
    package: "6 เดือน (07:00-22:00)",
    amount: 4800,
    time: "09:05",
    status: "PENDING",
  },
  {
    id: 4,
    memberCode: "BLU-1019",
    memberName: "ธนวัฒน์ พึ่งบุญ",
    package: "3 เดือน (07:00-14:00)",
    amount: 2400,
    time: "08:33",
    status: "APPROVED",
  },
];
