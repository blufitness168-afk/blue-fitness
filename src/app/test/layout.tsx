import { getCurrentMember } from "@/lib/auth/server";

export default async function TestLayout({ children }: { children: React.ReactNode }) {
  const member = await getCurrentMember();
  if (member?.role !== "OWNER") return <main className="min-h-screen bg-blu-dark p-8 text-white">หน้านี้สำหรับ OWNER เท่านั้น กรุณาเข้าสู่ระบบด้วยบัญชีเจ้าของ</main>;
  return children;
}
