import { z } from "zod";

export const registrationSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  nickname: z.string().trim().max(50).optional().default(""),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  birthDay: z.number().int().min(1).max(31),
  birthMonth: z.number().int().min(1).max(12),
  emergencyName: z.string().trim().max(100).optional().default(""),
  emergencyPhone: z.string().trim().max(20).optional().default(""),
  emergencyRelation: z.string().trim().max(50).optional().default(""),
}).refine(({ birthDay, birthMonth }) => new Date(2000, birthMonth - 1, birthDay).getMonth() === birthMonth - 1 && new Date(2000, birthMonth - 1, birthDay).getDate() === birthDay, {
  path: ["birthDay"],
  message: "วันเกิดไม่ถูกต้อง",
});

export type MemberProfileInput = z.infer<typeof registrationSchema>;
