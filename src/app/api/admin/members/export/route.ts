import { getCurrentMember } from "@/lib/auth/server";
import {
  currentStatus,
  getAdminMembersForExport,
  memberListGenders,
  type MemberListInput,
} from "@/lib/admin-members-server";
import { createXlsx, XlsxLimitError } from "@/lib/xlsx";

export const runtime = "nodejs";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

const allowedParams = [
  "q",
  "name",
  "code",
  "phone",
  "gender",
  "from",
  "to",
  "month",
  "reportMonth",
  "packageLabel",
  "slot",
  "currentDuration",
  "currentSlot",
] as const;

export async function GET(request: Request) {
  try {
    const member = await getCurrentMember();
    if (!member || member.status === "SUSPENDED") return fail("กรุณาเข้าสู่ระบบ", 401);
    if (!["ADMIN", "OWNER"].includes(member.role)) return fail("ไม่มีสิทธิ์เข้าถึง", 403);

    if (request.url.length > 2048) return fail("ตัวกรองไม่ถูกต้อง", 400);
    const params = new URL(request.url).searchParams;
    if (
      [...params.keys()].some(
        (key) =>
          !(allowedParams as readonly string[]).includes(key) ||
          params.getAll(key).length !== 1,
      )
    ) {
      return fail("ตัวกรองไม่ถูกต้อง", 400);
    }

    const input: MemberListInput = {};
    for (const key of allowedParams) {
      const value = params.get(key);
      if (value !== null) input[key] = value;
    }

    const result = await getAdminMembersForExport(input);
    if (result.status !== 200) return fail(result.error, result.status);

    const rows: (string | number)[][] = [
      [
        "ลำดับ",
        "รหัสสมาชิก",
        "ชื่อ-นามสกุล",
        "เพศ",
        "โทรศัพท์",
        "วันสมัคร (เวลาไทย)",
        "สถานะปัจจุบัน",
        "วันหมดอายุ (เวลาไทย)",
        "บทบาท",
      ],
      ...result.rows.map((row, index) => [
        index + 1,
        row.memberCode,
        row.fullName,
        memberListGenders[row.gender as keyof typeof memberListGenders] ?? row.gender,
        row.phone,
        new Date(row.createdAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }),
        currentStatus(row, result.asOf),
        row.expireDate
          ? new Date(row.expireDate).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })
          : "—",
        row.role,
      ]),
    ];

    const workbook = createXlsx(rows, "Members");
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(result.asOf));

    return new Response(workbook, {
      headers: {
        ...headers,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="members-${today}.xlsx"`,
      },
    });
  } catch (error) {
    if (error instanceof XlsxLimitError) return fail(error.message, 413);
    if (
      (error as { code?: string }).code === "42501" ||
      (error instanceof Error && ["Forbidden", "Unauthorized"].includes(error.message))
    ) {
      return fail("เซสชันหมดอายุหรือไม่มีสิทธิ์", 403);
    }
    return fail("ส่งออกไม่สำเร็จ กรุณาลองใหม่", 503);
  }
}
