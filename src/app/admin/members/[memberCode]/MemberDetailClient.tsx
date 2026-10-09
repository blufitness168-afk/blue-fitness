"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Gift, KeyRound, Save, UserRound } from "lucide-react";
import {
  addAdminMemberCoupon,
  ADMIN_MEMBERS_EVENT,
  ADMIN_MEMBERS_KEY,
  combinedMembershipHistory,
  readAdminMember,
  saveAdminMemberProfile,
  setAdminMemberPassword,
  type AdminMember,
  type AdminMemberCoupon,
  type AdminMemberProfileInput,
} from "@/lib/admin-members";
import { BENEFITS_EVENT, BENEFITS_KEY, purchaseMockPackage, readBenefits, type BenefitGrant } from "@/lib/benefits";
import { CHECKIN_STORAGE_KEY } from "@/lib/checkin";
import { readServiceRecords, SERVICE_EVENT, SERVICE_STORAGE_KEY, type ServiceRecord } from "@/lib/admin-service";
import { MEMBER_ACCOUNT_EVENT, MEMBER_ACCOUNT_KEY } from "@/lib/member-account";
import { mockPackages } from "@/lib/mock-data";

function dateText(value?: string) {
  if (!value) return "-";
  return new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function timeText(value: string) {
  return new Date(value).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}

function roleLabel(role: AdminMember["role"]) {
  return { MEMBER: "สมาชิก", ADMIN: "พนักงาน", OWNER: "เจ้าของ" }[role];
}

function profileOf(member: AdminMember): AdminMemberProfileInput {
  return {
    firstName: member.firstName, lastName: member.lastName, nickname: member.nickname, email: member.email, phone: member.phone,
    gender: member.gender, birthDate: member.birthDate, registeredAt: member.registeredAt, avatarUrl: member.avatarUrl,
    emergencyName: member.emergencyName, emergencyPhone: member.emergencyPhone, emergencyRelation: member.emergencyRelation, role: member.role,
  };
}

export default function AdminMemberDetailPage({ params }: { params: Promise<{ memberCode: string }> }) {
  const { memberCode } = use(params);
  const normalizedCode = decodeURIComponent(memberCode).toUpperCase();
  const [member, setMember] = useState<AdminMember | null>(null);
  const [profile, setProfile] = useState<AdminMemberProfileInput | null>(null);
  const [checkins, setCheckins] = useState<ServiceRecord[]>([]);
  const [benefitCoupons, setBenefitCoupons] = useState<BenefitGrant[]>([]);
  const [packageId, setPackageId] = useState(mockPackages[6]?.id ?? mockPackages[0].id);
  const [password, setPassword] = useState("");
  const [couponForm, setCouponForm] = useState<{ type: AdminMemberCoupon["type"]; name: string; validDays: number }>({ type: "แถมฟรี", name: "", validDays: 30 });
  const [busy, setBusy] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    try {
      const next = readAdminMember(normalizedCode);
      setMember(next);
      setProfile(next ? profileOf(next) : null);
      setCurrentTime(Date.now());
      setCheckins(readServiceRecords().filter((record) => record.memberCode === normalizedCode).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)));
      try { setBenefitCoupons(readBenefits().grants.filter((grant) => grant.memberCode === normalizedCode && grant.definition.kind === "COUPON")); }
      catch { setBenefitCoupons([]); }
      setError(next ? "" : "ไม่พบสมาชิกตามรหัสที่ระบุ");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "อ่านข้อมูลสมาชิกไม่สำเร็จ");
    }
  }, [normalizedCode]);

  useEffect(() => {
    // Browser-only mock stores are loaded after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const storage = (event: StorageEvent) => { if ([null, ADMIN_MEMBERS_KEY, MEMBER_ACCOUNT_KEY, BENEFITS_KEY, CHECKIN_STORAGE_KEY, SERVICE_STORAGE_KEY].includes(event.key)) load(); };
    window.addEventListener("storage", storage);
    window.addEventListener(ADMIN_MEMBERS_EVENT, load);
    window.addEventListener(MEMBER_ACCOUNT_EVENT, load);
    window.addEventListener(BENEFITS_EVENT, load);
    window.addEventListener(SERVICE_EVENT, load);
    return () => { window.removeEventListener("storage", storage); window.removeEventListener(ADMIN_MEMBERS_EVENT, load); window.removeEventListener(MEMBER_ACCOUNT_EVENT, load); window.removeEventListener(BENEFITS_EVENT, load); window.removeEventListener(SERVICE_EVENT, load); };
  }, [load]);

  const memberships = useMemo(() => member ? combinedMembershipHistory(member) : [], [member]);
  const allCoupons = useMemo(() => [
    ...(member?.coupons.map((coupon) => ({ id: coupon.id, type: coupon.type, name: coupon.name, code: coupon.code, expiresAt: coupon.expiresAt, usedAt: coupon.usedAt, status: coupon.usedAt ? "ใช้แล้ว" : Date.parse(coupon.expiresAt) <= currentTime ? "หมดอายุ" : "ยังไม่ใช้งาน" })) ?? []),
    ...benefitCoupons.map((coupon) => ({ id: coupon.id, type: coupon.definition.benefit === "EXTRA_DAYS" ? "แถมฟรี" : "ของขวัญ", name: coupon.definition.name, code: coupon.code, expiresAt: coupon.definition.expiresAt, usedAt: coupon.usedAt, status: coupon.status === "USED" ? "ใช้แล้ว" : Date.parse(coupon.definition.expiresAt) <= currentTime ? "หมดอายุ" : "ยังไม่ใช้งาน" })),
  ], [member, benefitCoupons, currentTime]);

  const saveProfile = (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile) return;
    try { const updated = saveAdminMemberProfile(normalizedCode, profile); setMember(updated); setProfile(profileOf(updated)); setNotice("บันทึกข้อมูลส่วนตัวเรียบร้อย"); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "บันทึกข้อมูลไม่สำเร็จ"); }
  };

  const renew = async () => {
    const pkg = mockPackages.find((item) => item.id === packageId);
    if (!pkg || !member) return;
    setBusy(true); setNotice("");
    try { await purchaseMockPackage(member.memberCode, pkg, null); setNotice(`ต่ออายุแพ็กเกจ ${pkg.name} เรียบร้อย และสร้างรายรับอัตโนมัติแล้ว`); load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "ต่ออายุไม่สำเร็จ"); }
    finally { setBusy(false); }
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await setAdminMemberPassword(normalizedCode, password); setPassword(""); setNotice("ตั้งรหัสผ่านใหม่เรียบร้อย ระบบจัดเก็บเฉพาะค่า hash"); load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "ตั้งรหัสผ่านไม่สำเร็จ"); }
    finally { setBusy(false); }
  };

  const addCoupon = (event: React.FormEvent) => {
    event.preventDefault();
    try { addAdminMemberCoupon(normalizedCode, couponForm.type, couponForm.name, couponForm.validDays); setCouponForm({ ...couponForm, name: "" }); setNotice("เพิ่มคูปองให้สมาชิกเรียบร้อย"); load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "เพิ่มคูปองไม่สำเร็จ"); }
  };

  if (!member || !profile) return <div className="mx-auto max-w-5xl space-y-4"><Link href="/admin/members" className="inline-flex items-center gap-2 text-sm font-bold text-blu-slate"><ArrowLeft className="h-4 w-4" /> กลับหน้าสมาชิก</Link><div className="rounded-2xl border border-blu-sky/40 bg-white p-8 text-center text-sm text-blu-steel">{error || "กำลังโหลดข้อมูลสมาชิก…"}</div></div>;

  return <div className="mx-auto max-w-375 space-y-6">
    <header className="flex items-center justify-between"><div><Link href="/admin/members" className="mb-2 inline-flex items-center gap-1 text-xs font-bold text-blu-slate hover:underline"><ArrowLeft className="h-4 w-4" /> กลับหน้าสมาชิก</Link><h1 className="text-2xl font-black text-blu-dark">{member.firstName} {member.lastName} <span className="font-mono text-lg text-blu-steel">{member.memberCode}</span></h1></div><span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600">{roleLabel(member.role)}</span></header>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-600">{error}</p>}{notice && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">{notice}</p>}

    <div className="grid gap-5 xl:grid-cols-[1fr_260px]">
      <form onSubmit={saveProfile} className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm"><h2 className="flex items-center gap-2 font-black text-blu-dark"><UserRound className="h-5 w-5 text-blu-slate" /> ข้อมูลส่วนตัว</h2><div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Field label="ชื่อ"><input required className="detail-input" value={profile.firstName} onChange={(event) => setProfile({ ...profile, firstName: event.target.value })} /></Field><Field label="นามสกุล"><input required className="detail-input" value={profile.lastName} onChange={(event) => setProfile({ ...profile, lastName: event.target.value })} /></Field><Field label="รหัสสมาชิก"><input disabled className="detail-input disabled:bg-blu-ice" value={member.memberCode} /></Field><Field label="เลขบัตรแข็ง"><input disabled className="detail-input disabled:bg-blu-ice" value={member.cardNumber} /></Field>
        <Field label="ชื่อเล่น"><input maxLength={100} className="detail-input" value={profile.nickname} onChange={(event) => setProfile({ ...profile, nickname: event.target.value })} /></Field><Field label="อีเมล"><input type="email" className="detail-input" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} /></Field><Field label="เพศ"><select className="detail-input" value={profile.gender} onChange={(event) => setProfile({ ...profile, gender: event.target.value as AdminMember["gender"] })}><option value="MALE">ชาย</option><option value="FEMALE">หญิง</option><option value="OTHER">อื่นๆ</option></select></Field><Field label="วันเกิด (เดือน-วัน ไม่เก็บปี)"><input required pattern="\d{2}-\d{2}" placeholder="08-15" className="detail-input" value={profile.birthDate} onChange={(event) => setProfile({ ...profile, birthDate: event.target.value })} /></Field><Field label="วันที่สมัคร"><input type="date" className="detail-input" value={profile.registeredAt} onChange={(event) => setProfile({ ...profile, registeredAt: event.target.value })} /></Field>
        <Field label="เบอร์โทร"><input required className="detail-input" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} /></Field><Field label="ผู้ติดต่อฉุกเฉิน"><input className="detail-input" value={profile.emergencyName} onChange={(event) => setProfile({ ...profile, emergencyName: event.target.value })} /></Field><Field label="เบอร์โทรฉุกเฉิน"><input className="detail-input" value={profile.emergencyPhone} onChange={(event) => setProfile({ ...profile, emergencyPhone: event.target.value })} /></Field><Field label="ความสัมพันธ์"><input className="detail-input" value={profile.emergencyRelation} onChange={(event) => setProfile({ ...profile, emergencyRelation: event.target.value })} /></Field>
        <Field label="บทบาท (mock ไม่เปลี่ยนสิทธิ์จริง)"><input disabled className="detail-input" value={roleLabel(profile.role)} /></Field><div className="col-span-2 lg:col-span-3"><Field label="URL รูปประจำตัว"><input type="url" className="detail-input" placeholder="https://…" value={profile.avatarUrl} onChange={(event) => setProfile({ ...profile, avatarUrl: event.target.value })} /></Field></div>
      </div><button type="submit" className="btn-blue mt-4 inline-flex h-10 items-center gap-2 rounded-xl px-5 text-xs"><Save className="h-4 w-4" /> บันทึกข้อมูล</button></form>
      <aside className="space-y-4"><section className="rounded-2xl border border-blu-sky/40 bg-white p-5 text-center shadow-sm"><div className="mx-auto flex h-36 w-36 items-center justify-center overflow-hidden rounded-full bg-blu-ice text-5xl font-black text-blu-steel">{profile.avatarUrl ? <span role="img" aria-label={`${member.firstName} ${member.lastName}`} className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url(${profile.avatarUrl})` }} /> : member.firstName.slice(0, 1)}</div><p className="mt-3 text-xs text-blu-steel">รูปประจำตัว</p></section><section className="rounded-2xl border border-blu-sky/40 bg-white p-4 text-xs shadow-sm"><Info label="รหัสสมาชิก" value={member.memberCode} /><Info label="อีเมล" value={member.email || "-"} /><Info label="วันสมัคร" value={dateText(member.registeredAt)} /><Info label="โทรศัพท์" value={member.phone} /><Info label="บทบาท" value={roleLabel(member.role)} /></section></aside>
    </div>

    <form onSubmit={savePassword} className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm"><h2 className="flex items-center gap-2 font-black"><KeyRound className="h-5 w-5 text-blu-slate" /> รหัสผ่านสำหรับเข้าระบบ</h2><p className="mt-1 text-xs text-blu-steel">สถานะ: {member.passwordHash ? "ตั้งรหัสผ่านแล้ว" : "ยังไม่ได้ตั้งรหัสผ่าน"} · ไม่สามารถดูรหัสเดิมได้</p><div className="mt-3 flex max-w-xl gap-3"><input required minLength={8} maxLength={100} type="password" autoComplete="new-password" className="detail-input" placeholder="รหัสผ่านใหม่อย่างน้อย 8 ตัว" value={password} onChange={(event) => setPassword(event.target.value)} /><button disabled={busy} className="btn-blue shrink-0 rounded-xl px-4 text-xs disabled:opacity-50">บันทึกรหัสผ่าน</button></div></form>

    <section className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm"><h2 className="font-black text-blu-dark">ประวัติแพ็กเกจ / การต่ออายุ</h2><HistoryTable headings={["ประเภทสมาชิก", "เริ่ม", "สิ้นสุด", "ประเภทช่วงเวลา", "ราคา", "รายการ"]} empty={!memberships.length}>{memberships.map((item) => <tr key={item.id} className="border-t border-blu-sky/20"><Cell>{item.packageName}</Cell><Cell>{dateText(item.startedAt)}</Cell><Cell>{dateText(item.expiresAt)}</Cell><Cell>{item.timeSlot}</Cell><Cell>{item.price.toLocaleString("th-TH")} ฿</Cell><Cell>{item.kind === "NEW" ? "สมัครใหม่" : "ต่ออายุ"}</Cell></tr>)}</HistoryTable><div className="mt-4 rounded-xl bg-blu-ice/70 p-4"><h3 className="text-sm font-black">+ ต่ออายุ / เพิ่มแพ็กเกจใหม่</h3><div className="mt-3 flex gap-3"><select className="detail-input max-w-xl" value={packageId} onChange={(event) => setPackageId(Number(event.target.value))}>{mockPackages.filter((item) => item.isActive).map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name} ({pkg.price.toLocaleString("th-TH")} ฿)</option>)}</select><button type="button" disabled={busy} onClick={() => void renew()} className="btn-blue shrink-0 rounded-xl px-4 text-xs disabled:opacity-50">บันทึกการต่ออายุ</button></div></div></section>

    <section className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm"><h2 className="font-black text-blu-dark">ประวัติการใช้บริการ</h2><HistoryTable headings={["วันที่", "เวลา", "ประเภทสมาชิก", "ประเภทช่วงเวลา", "ช่องทาง"]} empty={!checkins.length}>{checkins.map((item) => <tr key={item.id} className="border-t border-blu-sky/20"><Cell>{dateText(item.occurredAt)}</Cell><Cell>{timeText(item.occurredAt)}</Cell><Cell>{item.membershipType}</Cell><Cell>{item.timeSlot}</Cell><Cell>{item.serviceType === "CHECKIN" ? "เข้ายิม" : "ออกยิม"} · {item.source === "SCANNER" ? "เครื่องสแกน" : item.source === "MANUAL" ? "บันทึกเอง" : "ข้อมูลตัวอย่าง"}</Cell></tr>)}</HistoryTable></section>

    <section className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm"><h2 className="flex items-center gap-2 font-black text-blu-dark"><Gift className="h-5 w-5 text-blu-slate" /> ประวัติการใช้คูปอง</h2><HistoryTable headings={["ประเภทคูปอง", "ชื่อคูปอง", "รหัส", "วันหมดอายุ", "วันที่ใช้งาน", "สถานะ"]} empty={!allCoupons.length}>{allCoupons.map((coupon) => <tr key={coupon.id} className="border-t border-blu-sky/20"><Cell>{coupon.type}</Cell><Cell>{coupon.name}</Cell><Cell><span className="font-mono text-[10px]">{coupon.code}</span></Cell><Cell>{dateText(coupon.expiresAt)}</Cell><Cell>{dateText(coupon.usedAt)}</Cell><Cell><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${coupon.status === "ยังไม่ใช้งาน" ? "bg-emerald-500/10 text-emerald-600" : coupon.status === "ใช้แล้ว" ? "bg-blu-ice text-blu-slate" : "bg-rose-500/10 text-rose-500"}`}>{coupon.status}</span></Cell></tr>)}</HistoryTable><form onSubmit={addCoupon} className="mt-4 rounded-xl bg-blu-ice/70 p-4"><h3 className="text-sm font-black">+ เพิ่มคูปองให้สมาชิก</h3><div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-[180px_1fr_180px_auto]"><Field label="ประเภท"><select className="detail-input" value={couponForm.type} onChange={(event) => setCouponForm({ ...couponForm, type: event.target.value as AdminMemberCoupon["type"] })}>{["ส่วนลด", "ของขวัญ", "แถมฟรี", "แต้มเพิ่ม", "อื่นๆ"].map((type) => <option key={type}>{type}</option>)}</select></Field><Field label="ชื่อคูปอง"><input required className="detail-input" value={couponForm.name} onChange={(event) => setCouponForm({ ...couponForm, name: event.target.value })} /></Field><Field label="อายุการใช้งาน (วัน)"><input type="number" min="0" max="3650" className="detail-input" value={couponForm.validDays} onChange={(event) => setCouponForm({ ...couponForm, validDays: Number(event.target.value) })} /></Field><div className="flex items-end"><button className="btn-blue h-10 rounded-xl px-4 text-xs">เพิ่มคูปอง</button></div></div><p className="mt-2 text-[10px] text-blu-steel">ใส่ 0 เพื่อให้หมดอายุภายใน 10 นาที</p></form></section>
    <style jsx>{`.detail-input { width: 100%; height: 2.5rem; border: 1px solid color-mix(in srgb, var(--blu-sky) 55%, transparent); border-radius: .75rem; background: white; padding: 0 .75rem; font-size: .75rem; outline: none; } .detail-input:focus { border-color: var(--blu-slate); }`}</style>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="min-w-0 space-y-1.5"><span className="block text-[10px] font-semibold text-blu-steel">{label}</span>{children}</label>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3 border-b border-blu-sky/20 py-2.5 last:border-0"><span className="text-blu-steel">{label}</span><strong className="text-right">{value}</strong></div>; }
function Cell({ children }: { children: React.ReactNode }) { return <td className="whitespace-nowrap px-3 py-3 text-xs">{children}</td>; }
function HistoryTable({ headings, empty, children }: { headings: string[]; empty: boolean; children: React.ReactNode }) { return <div className="mt-3 overflow-x-auto"><table className="w-full min-w-200 text-left"><thead><tr className="bg-blu-ice/60">{headings.map((heading) => <th key={heading} className="px-3 py-3 text-[10px] font-semibold text-blu-steel">{heading}</th>)}</tr></thead><tbody>{children}{empty && <tr><td colSpan={headings.length} className="p-8 text-center text-xs text-blu-steel">ยังไม่มีประวัติ</td></tr>}</tbody></table></div>; }
