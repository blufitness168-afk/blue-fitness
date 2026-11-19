import { getMemberCard } from "@/lib/member-card-server";
import AdminMemberCardForm from "./AdminMemberCardForm";

// Parent integration is intentionally separate. The real SQL read enforces target roles.
export default async function MemberCardSection({ memberCode }: { memberCode: string }) {
  let initial;
  try {
    initial = await getMemberCard(memberCode);
  } catch {
    initial = null;
  }
  if (!initial) return <p role="status">ข้อมูลบัตรยังไม่พร้อมใช้งาน หรือไม่มีสิทธิ์จัดการสมาชิกคนนี้</p>;
  return <AdminMemberCardForm key={`${memberCode}:${initial.version}`} memberCode={memberCode} initial={initial} />;
}
