import { readCheckinHistoryForExport } from "@/lib/real-checkin-server";
import { createXlsx, XlsxLimitError } from "@/lib/xlsx";

export const runtime = "nodejs";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

function formatBangkokDateTime(value: string) {
  return new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
}

export async function GET(request: Request) {
  try {
    const result = await readCheckinHistoryForExport(request);
    if (result.status !== 200) return fail(result.error, result.status);

    const rows: (string | number)[][] = [
      [
        "ลำดับ",
        "เวลาเข้า (เวลาไทย)",
        "เวลาออก (เวลาไทย)",
        "ระยะเวลา (นาที)",
        "รหัสสมาชิก",
        "ชื่อ-นามสกุล",
        "แพ็กเกจ ณ ครั้งบริการ",
        "ช่วงเวลาที่ใช้",
        "เครื่องสแกน / ประเภท",
        "หมายเหตุ",
      ],
      ...result.records.map((record, index) => [
        index + 1,
        formatBangkokDateTime(record.checkedAt),
        record.exitedAt ? formatBangkokDateTime(record.exitedAt) : "ไม่มีเวลาออก",
        record.exitedAt && record.durationSeconds != null
          ? Math.floor(Number(record.durationSeconds) / 60)
          : "",
        record.memberCode,
        record.fullName,
        record.snapshot
          ? record.snapshot.package?.name ||
            (record.snapshot.reason === "MANUAL_PAIR"
              ? "ไม่ทราบแพ็กเกจ"
              : record.snapshot.reason || "—")
          : "ข้อมูลเก่า ไม่มี snapshot",
        record.snapshot?.usedTimeSlot || "—",
        record.snapshot?.reason === "MANUAL_PAIR"
          ? `บันทึกย้อนหลัง / ${record.snapshot.serviceType ?? ""}`
          : record.scannerType,
        record.notes ?? "",
      ]),
    ];

    const workbook = createXlsx(rows, "Checkins");
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    return new Response(workbook, {
      headers: {
        ...headers,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="checkins-${today}.xlsx"`,
      },
    });
  } catch (error) {
    if (error instanceof XlsxLimitError) return fail(error.message, 413);
    return fail("ส่งออกไม่สำเร็จ กรุณาลองใหม่", 503);
  }
}
