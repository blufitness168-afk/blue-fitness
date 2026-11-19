import { getStaffAvatar } from "@/lib/staff-avatar-server";
import { StaffAvatarForm } from "./StaffAvatarForm";

export async function StaffAvatarSection({ memberCode }: { memberCode: string }) {
  const initial = await getStaffAvatar(memberCode).catch(() => null);
  if (!initial) return <p role="status">ไม่สามารถอ่านสิทธิ์หรือข้อมูลรูปสมาชิกได้ กรุณาโหลดใหม่</p>;
  return <StaffAvatarForm key={`${memberCode}:${initial.version}`} memberCode={memberCode} initial={initial} />;
}
