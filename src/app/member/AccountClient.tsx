"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import Link from "next/link";
import { Coins, Home, Pencil, QrCode, Ticket, UserRound, X } from "lucide-react";
import Navbar from "@/components/Navbar";
import RealPaymentAccount from "@/components/RealPaymentAccount";
import WelcomeCoupons from "./benefits/WelcomeCoupons";
import type { WelcomeCoupon } from "@/lib/benefits-server";
import type { MemberWallet } from "@/lib/real-member-wallet-server";

const thaiMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
type Tab = "home" | "qr" | "coupons" | "points";
type ProfileDraft = { fullName: string; nickname: string; phone: string; gender: SavedProfile["gender"]; birthDay: string; birthMonth: string; emergencyContact: { name: string; phone: string; relation: string } };

type SavedProfile = { fullName: string; nickname: string | null; gender: "MALE" | "FEMALE" | "OTHER"; birthDay: number | null; birthMonth: number | null; emergencyName: string | null; emergencyPhone: string | null; emergencyRelation: string | null };
function profileDraft(profile: SavedProfile): Omit<ProfileDraft, "phone"> {
  return { fullName: profile.fullName, nickname: profile.nickname ?? "", gender: profile.gender,
    birthDay: profile.birthDay ? String(profile.birthDay) : "", birthMonth: profile.birthMonth ? String(profile.birthMonth) : "",
    emergencyContact: { name: profile.emergencyName ?? "", phone: profile.emergencyPhone ?? "", relation: profile.emergencyRelation ?? "" } };
}

const cardClass = "rounded-3xl border border-blu-sky/40 bg-white p-5 shadow-sm";
const buttonClass = "rounded-xl bg-blu-dark px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40";
const inputClass = "w-full rounded-xl border border-blu-sky/60 bg-white px-3 py-2.5 text-sm outline-none focus:border-blu-slate focus:ring-2 focus:ring-blu-sky/40";

function dateText(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" })
    : value;
}

type AccountIdentity = {
  id: number; memberCode: string; fullName: string; phone: string; avatarUrl: string;
  role: "MEMBER" | "ADMIN" | "OWNER"; birthDay: number | null; birthMonth: number | null;
  registeredAt: string; status: "PENDING" | "ACTIVE" | "EXPIRED" | "SUSPENDED";
};

export default function MemberAccountPage({ identity, welcomeCoupons }: { identity: AccountIdentity; welcomeCoupons: WelcomeCoupon[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("home");
  const [wallet, setWallet] = useState<MemberWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [serverProfile, setServerProfile] = useState<Omit<ProfileDraft, "phone"> | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const member = { ...identity, ...serverProfile };
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/member/wallet", { cache: "no-store", signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "โหลดกระเป๋าสมาชิกไม่สำเร็จ");
      if (!signal?.aborted) setWallet(result.data);
    } catch (cause) {
      if (!signal?.aborted) { setWallet(null); setError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ"); }
    } finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // Fetch on mount and after server coupon props refresh; balance is never seeded locally.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh(controller.signal);
    fetch("/api/member/profile", { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "โหลดข้อมูลส่วนตัวไม่สำเร็จ");
      if (!controller.signal.aborted) setServerProfile(profileDraft(data.profile));
    }).catch(cause => { if (!controller.signal.aborted) setProfileError(cause instanceof Error ? cause.message : "โหลดข้อมูลส่วนตัวไม่สำเร็จ"); });
    const onFocus = () => { void refresh(controller.signal); };
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); window.removeEventListener("focus", onFocus); };
  }, [identity.id, welcomeCoupons, refresh]);

  const logout = async () => {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed");
      router.push("/");
      router.refresh();
    } catch { setError("ออกจากระบบไม่สำเร็จ กรุณาลองใหม่"); }
  };

  const openEdit = () => {
    if (!member || !serverProfile) return;
    setProfileError("");
    setDraft({ ...serverProfile, phone: identity.phone });
    setEditing(true);
    setMessage("");
  };

  const submitProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!member || !draft || profileBusy) return;
    setProfileBusy(true);
    setProfileError("");
    try {
      const response = await fetch("/api/member/profile", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: draft.fullName, nickname: draft.nickname ?? "", gender: draft.gender,
          birthDay: Number(draft.birthDay), birthMonth: Number(draft.birthMonth),
          emergencyName: draft.emergencyContact?.name ?? "", emergencyPhone: draft.emergencyContact?.phone ?? "",
          emergencyRelation: draft.emergencyContact?.relation ?? "" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "บันทึกข้อมูลไม่สำเร็จ");
      const saved = profileDraft(data.profile);
      setServerProfile(saved);
      setEditing(false);
      setMessage("บันทึกข้อมูลส่วนตัวแล้ว");
    } catch (cause) {
      setProfileError(cause instanceof Error ? cause.message : "บันทึกข้อมูลไม่สำเร็จ");
    } finally {
      setProfileBusy(false);
    }
  };

  return <main className="min-h-screen bg-blu-ice pb-28 text-blu-dark">
    <Navbar member={member} onLogout={logout} />
    <div className="mx-auto max-w-lg space-y-5 px-4 pt-24">
      <h1 className="text-2xl font-black">บัญชีสมาชิก</h1>
      <button disabled={loading} className={buttonClass} onClick={() => void refresh()}>โหลดข้อมูลใหม่</button>
      {loading && <p role="status">กำลังโหลดข้อมูล...</p>}
      {error && <p role="alert" className="text-rose-700">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!editing && profileError && <p role="alert" className="text-rose-700">{profileError}</p>}
      {tab === "home" && <>
        <section className={cardClass}>
          {identity.avatarUrl && <Image src={identity.avatarUrl} alt={member.fullName} width={80} height={80} className="rounded-full" />}
          <h2 className="text-xl font-black">{member.fullName}</h2><p>{identity.memberCode} · {identity.phone}</p>
          <p className="text-sm">สมัครเมื่อ {dateText(identity.registeredAt)}</p>
          <button disabled={!serverProfile || profileBusy} className={`${buttonClass} mt-4`} onClick={openEdit}><Pencil className="mr-2 inline h-4 w-4" />แก้ไขข้อมูลส่วนตัว</button>
        </section>
        <RealPaymentAccount />
        {wallet && <>
          <section className={cardClass}><h2 className="font-bold">สถานะสมาชิก: {wallet.status}</h2><p>วันหมดอายุ: {wallet.expiresAt ? dateText(wallet.expiresAt) : "ไม่มีวันหมดอายุที่บันทึกไว้"}</p></section>
          <section className={cardClass}><h2 className="font-bold">ประวัติการซื้อที่ชำระแล้ว (ล่าสุด 100 รายการ)</h2>{wallet.purchases.map(item => <article key={item.id} className="border-b py-3 text-sm"><strong>{item.packageName ?? "ไม่มีชื่อแพ็กเกจในรายการ"}</strong><p>{dateText(item.paidAt)} · ฿{(item.amountSatang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })} · ได้ {item.pointsEarned} คะแนน</p><p>สมาชิกถึง {dateText(item.membershipExpiresAt)}</p></article>)}{!wallet.purchases.length && <p>ยังไม่มีรายการซื้อที่ชำระแล้ว</p>}</section>
          <section className={cardClass}><h2 className="font-bold">ประวัติเข้าใช้บริการ (ล่าสุด 100 รายการ)</h2>{wallet.checkins.map(item => <article key={item.id} className="border-b py-3 text-sm"><p>{dateText(item.checkedAt)}</p><p>{item.scannerDeviceId === "MEMBER_COUPON_SELF_SERVICE" ? "ยืนยันใช้คูปองด้วยตนเอง ไม่ใช่สแกนหน้าร้าน" : item.scannerDeviceId}</p></article>)}{!wallet.checkins.length && <p>ยังไม่มีประวัติเข้าใช้บริการ</p>}</section>
        </>}
      </>}
      {tab === "qr" && <section className={`${cardClass} flex flex-col items-center gap-4`}><h2>QR สำหรับเข้าใช้บริการ</h2><QRCodeSVG value={identity.memberCode} size={230} title={`รหัสสมาชิก ${identity.memberCode}`} /><p>{member.fullName} · {identity.memberCode}</p><p className="text-xs">แสดงให้เจ้าหน้าที่สแกน ไม่ใช่ QR คูปองหรือรหัสรับสินค้า</p></section>}
      {tab === "coupons" && <div className="space-y-5">
        <WelcomeCoupons key={identity.id} coupons={welcomeCoupons} />
        {wallet && <section className={cardClass}><h2 className="font-bold">คูปองอื่นจากฐานข้อมูล (ล่าสุด 100 รายการ)</h2><p className="text-xs">ติดต่อเจ้าหน้าที่เพื่อใช้สิทธิ์</p>{wallet.coupons.filter(otherCoupon).map(coupon => <article key={coupon.id} className="border-b py-3 text-sm"><strong>{coupon.title}</strong><p>{couponStatus(coupon)} · ใช้แล้ว {coupon.usedCount}/{coupon.totalQuota} ครั้ง</p><p>หมดอายุ: {coupon.expiresAt ? dateText(coupon.expiresAt) : "ไม่ระบุ"}</p></article>)}{!wallet.coupons.some(otherCoupon) && <p>ไม่มีคูปองอื่นที่บันทึกไว้</p>}</section>}
      </div>}
      {tab === "points" && <div className="space-y-5">
        {wallet && <section className={cardClass}><h2 className="font-bold">คะแนนสะสมของฉัน</h2><p className="my-3 text-4xl font-black">{wallet.points.toLocaleString()} คะแนน</p><p className="text-xs">ยอดชำระจริงหลังหักส่วนลดทุก 20 บาท = 1 คะแนน เศษปัดทิ้ง · เช็กอินไม่เพิ่มคะแนน</p></section>}
        <section className={cardClass}><Link href="/member/rewards" className="font-bold underline">เปิดร้านรางวัล ประวัติการแลก และรหัสรับสินค้า</Link></section>
        {wallet && <section className={cardClass}><h2 className="font-bold">ประวัติรับและใช้คะแนน (ล่าสุด 100 รายการ)</h2>{wallet.pointLedger.map(entry => <article key={entry.id} className="border-b py-3 text-sm"><strong>{entry.description} · {entry.delta > 0 ? "+" : ""}{entry.delta}</strong><p>{dateText(entry.createdAt)} · คงเหลือหลังรายการ {entry.balanceAfter}</p></article>)}{!wallet.pointLedger.length && <p>ยังไม่มีรายการรับหรือใช้คะแนนที่บันทึกไว้</p>}</section>}
      </div>}
    </div>
    <nav aria-label="เมนูบัญชีสมาชิก" className="fixed inset-x-0 bottom-0 z-40 border-t bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"><div className="mx-auto grid max-w-lg grid-cols-4">{([
      ["home", Home, "หน้าหลัก"], ["qr", QrCode, "QR Code"], ["coupons", Ticket, "คูปอง"], ["points", Coins, "คะแนน"],
    ] as const).map(([key, Icon, label]) => <button key={key} aria-current={tab === key ? "page" : undefined} onClick={() => { setTab(key); window.scrollTo({ top: 0, behavior: "smooth" }); }} className={`flex flex-col items-center gap-1 rounded-xl p-2 text-xs font-bold ${tab === key ? "bg-blu-dark text-blu-yellow" : "text-blu-steel"}`}><Icon className="h-5 w-5" />{label}</button>)}</div></nav>
    {editing && draft && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-blu-dark/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget) setEditing(false); }}><form onSubmit={submitProfile} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"><div className="flex items-center justify-between"><div><h2 className="text-xl font-black">แก้ไขข้อมูลส่วนตัว</h2><p className="text-xs text-blu-steel">เบอร์โทรแก้ไขไม่ได้ ต้องยืนยันผ่านขั้นตอน OTP สำหรับเปลี่ยนเบอร์</p></div><button type="button" aria-label="ปิด" onClick={() => setEditing(false)}><X /></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="space-y-1 text-xs font-bold sm:col-span-2">ชื่อ-นามสกุล<input required maxLength={100} className={inputClass} value={draft.fullName} onChange={e => setDraft({ ...draft, fullName: e.target.value })} /></label><label className="space-y-1 text-xs font-bold">ชื่อเล่น<input maxLength={50} className={inputClass} value={draft.nickname ?? ""} onChange={e => setDraft({ ...draft, nickname: e.target.value })} /></label><label className="space-y-1 text-xs font-bold">เบอร์โทร<input required inputMode="numeric" className={inputClass} value={draft.phone} readOnly /></label><label className="space-y-1 text-xs font-bold">เพศ<select required className={inputClass} value={draft.gender} onChange={e => setDraft({ ...draft, gender: e.target.value as SavedProfile["gender"] })}><option value="MALE">ชาย</option><option value="FEMALE">หญิง</option><option value="OTHER">อื่นๆ</option></select></label><label className="space-y-1 text-xs font-bold">วันเกิด<input required type="number" min={1} max={31} className={inputClass} value={draft.birthDay} onChange={e => setDraft({ ...draft, birthDay: e.target.value })} /></label><label className="space-y-1 text-xs font-bold">เดือนเกิด<select required className={inputClass} value={draft.birthMonth} onChange={e => setDraft({ ...draft, birthMonth: e.target.value })}><option value="">เลือกเดือน</option>{thaiMonths.map(month => <option key={month} value={thaiMonths.indexOf(month) + 1}>{month}</option>)}</select></label><div className="sm:col-span-2 rounded-2xl bg-blu-ice p-4"><p className="mb-3 text-xs font-black">ผู้ติดต่อฉุกเฉิน</p><div className="grid gap-3 sm:grid-cols-3"><input aria-label="ชื่อผู้ติดต่อฉุกเฉิน" placeholder="ชื่อ" className={inputClass} value={draft.emergencyContact?.name ?? ""} onChange={e => setDraft({ ...draft, emergencyContact: { ...(draft.emergencyContact ?? { phone: "", relation: "" }), name: e.target.value } })} /><input aria-label="ความสัมพันธ์" placeholder="ความสัมพันธ์" className={inputClass} value={draft.emergencyContact?.relation ?? ""} onChange={e => setDraft({ ...draft, emergencyContact: { ...(draft.emergencyContact ?? { name: "", phone: "" }), relation: e.target.value } })} /><input aria-label="เบอร์ผู้ติดต่อฉุกเฉิน" inputMode="numeric" placeholder="เบอร์โทร" className={inputClass} value={draft.emergencyContact?.phone ?? ""} onChange={e => setDraft({ ...draft, emergencyContact: { ...(draft.emergencyContact ?? { name: "", relation: "" }), phone: e.target.value.replace(/\D/g, "").slice(0, 10) } })} /></div></div><div className="sm:col-span-2 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"><UserRound className="h-5 w-5 shrink-0" />รูปโปรไฟล์ไม่สามารถแก้ไขเองได้ กรุณาติดต่อเจ้าหน้าที่</div></div><p role="alert" className="mt-3 text-sm text-rose-700">{profileError}</p><button disabled={profileBusy} className={`${buttonClass} mt-5 w-full`}>{profileBusy ? "กำลังบันทึก..." : "บันทึกข้อมูล"}</button></form></div>}


  </main>;
}
function otherCoupon(coupon: MemberWallet["coupons"][number]) {
  return coupon.source !== "WELCOME_REGISTRATION" || coupon.type !== "FREE_ENTRY";
}
function couponStatus(coupon: MemberWallet["coupons"][number]) {
  if (coupon.status === "USED" || coupon.usedCount >= coupon.totalQuota) return "ใช้ครบแล้ว";
  if (coupon.status === "EXPIRED" || (coupon.expiresAt && Date.parse(coupon.expiresAt) <= Date.now())) return "หมดอายุ";
  return coupon.status === "AVAILABLE" ? "ใช้ได้" : coupon.status;
}
