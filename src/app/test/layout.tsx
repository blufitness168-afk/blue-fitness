import { getCurrentMember } from "@/lib/auth/server";

export default async function TestLayout({ children }: { children: React.ReactNode }) {
  const member = await getCurrentMember();
  if (member?.role !== "OWNER") return <main className="p-8">หน้านี้สำหรับ OWNER เท่านั้น กรุณาเข้าสู่ระบบด้วยบัญชีเจ้าของ</main>;
  return children;
}
