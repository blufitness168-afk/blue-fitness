import "server-only";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { members } from "@/db/schema";
import { getCurrentMember } from "./auth/server";
import { json, readBody } from "./auth/http";
import { registrationSchema } from "./auth/registration";

const profileSchema = z.object(registrationSchema.shape).omit({ password: true }).strict()
  .refine(({ birthDay, birthMonth }) => new Date(2000, birthMonth - 1, birthDay).getMonth() === birthMonth - 1, { message: "วันเกิดไม่ถูกต้อง" });
const profileColumns = {
  fullName: members.fullName, nickname: members.nickname, gender: members.gender,
  birthDay: members.birthDay, birthMonth: members.birthMonth,
  emergencyName: members.emergencyName, emergencyPhone: members.emergencyPhone,
  emergencyRelation: members.emergencyRelation,
};

export async function getMemberProfile() {
  try {
    const member = await getCurrentMember();
    if (!member) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    const profile = Object.fromEntries(Object.keys(profileColumns).map(key => [key, member[key as keyof typeof member]]));
    return json({ profile });
  } catch {
    return json({ error: "โหลดข้อมูลส่วนตัวไม่สำเร็จ" }, 503);
  }
}

export async function updateMemberProfile(request: Request) {
  try {
    const member = await getCurrentMember();
    if (!member) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    const body = await readBody(request);
    if (!body) return json({ error: "คำขอไม่ถูกต้อง" }, 400);
    if (Object.hasOwn(body, "phone")) return json({ error: "ไม่สามารถเปลี่ยนเบอร์โทรได้ ต้องใช้ขั้นตอนยืนยัน OTP สำหรับเปลี่ยนเบอร์" }, 400);
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) return json({ error: "ข้อมูลส่วนตัวไม่ถูกต้อง กรุณาตรวจสอบชื่อ วันเกิด และผู้ติดต่อฉุกเฉิน" }, 400);
    if (parsed.data.emergencyPhone && !/^0\d{8,9}$/.test(parsed.data.emergencyPhone)) {
      return json({ error: "เบอร์ผู้ติดต่อฉุกเฉินไม่ถูกต้อง" }, 400);
    }
    const [profile] = await db.update(members).set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(members.id, member.id), ne(members.status, "SUSPENDED")))
      .returning(profileColumns);
    if (!profile) return json({ error: "ไม่สามารถบันทึกข้อมูลสมาชิกได้" }, 409);
    return json({ profile });
  } catch {
    return json({ error: "บันทึกข้อมูลส่วนตัวไม่สำเร็จ กรุณาลองใหม่" }, 503);
  }
}
