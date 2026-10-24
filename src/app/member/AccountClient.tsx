"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import {

  ChevronDown,
  ChevronUp,
  Clock3,
  Coins,
  Gift,
  History,
  Home,
  Info,
  Pencil,
  Phone,
  QrCode,
  ShieldCheck,
  ShoppingBag,
  Ticket,
  UserRound,
  X,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import RealPaymentAccount from "@/components/RealPaymentAccount";
import WelcomeCoupons from "./benefits/WelcomeCoupons";
import type { WelcomeCoupon } from "@/lib/benefits-server";
import { BENEFITS_EVENT, BENEFITS_KEY, readBenefits, readMembership, type BenefitGrant, type MockMembership } from "@/lib/benefits";
import { CHECKIN_STORAGE_KEY, parseCheckinRecords, type CheckinRecord } from "@/lib/checkin";
import { DESK_UPDATED_EVENT, readDeskRewards } from "@/lib/front-desk";
import {
  MEMBER_ACCOUNT_EVENT,
  MEMBER_ACCOUNT_KEY,
  readMemberAccount,
  readPointCouponCatalog,
  redeemPointCoupon,
  type MemberAccount,
  type PointCoupon,
  type PointCouponOffer,
} from "@/lib/member-account";
import { defaultMockMember, type MemberProfile, type RewardItem } from "@/lib/mock-data";
import { readRewardCatalog, remainingStock, requestMockReward } from "@/lib/reward-catalog";
import type { RedemptionRecord } from "@/lib/admin-mock";

const thaiMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
type Tab = "home" | "qr" | "coupons" | "points";
type ProfileDraft = Pick<MemberProfile, "fullName" | "nickname" | "phone" | "gender" | "birthDay" | "birthMonth" | "emergencyContact">;

type SavedProfile = { fullName: string; nickname: string | null; gender: MemberProfile["gender"]; birthDay: number | null; birthMonth: number | null; emergencyName: string | null; emergencyPhone: string | null; emergencyRelation: string | null };
function profileDraft(profile: SavedProfile): Omit<ProfileDraft, "phone"> {
  return { fullName: profile.fullName, nickname: profile.nickname ?? "", gender: profile.gender,
    birthDay: profile.birthDay ? String(profile.birthDay) : "", birthMonth: profile.birthMonth ? String(profile.birthMonth) : "",
    emergencyContact: { name: profile.emergencyName ?? "", phone: profile.emergencyPhone ?? "", relation: profile.emergencyRelation ?? "" } };
}

const cardClass = "rounded-3xl border border-blu-sky/40 bg-white p-5 shadow-sm";
const buttonClass = "rounded-xl bg-blu-dark px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40";
const inputClass = "w-full rounded-xl border border-blu-sky/60 bg-white px-3 py-2.5 text-sm outline-none focus:border-blu-slate focus:ring-2 focus:ring-blu-sky/40";

function dateText(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" })
    : value;
}

function statusText(status: "UNUSED" | "USED", expiresAt: string, suspended = false) {
  if (status === "USED") return { label: "ใช้แล้ว", className: "bg-slate-100 text-slate-600" };
  if (suspended) return { label: "ระงับ", className: "bg-amber-100 text-amber-800" };
  if (Date.parse(expiresAt) <= Date.now()) return { label: "หมดอายุ", className: "bg-rose-100 text-rose-700" };
  return { label: "ใช้ได้", className: "bg-emerald-100 text-emerald-700" };
}

function SectionTitle({ icon: Icon, title, action }: { icon: typeof History; title: string; action?: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Icon className="h-5 w-5 text-blu-slate" /><h2 className="font-black text-blu-dark">{title}</h2></div>{action}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-blu-sky/70 bg-blu-ice/50 p-5 text-center text-sm text-blu-steel">{children}</p>;
}

type AccountIdentity = {
  id: number; memberCode: string; fullName: string; phone: string; avatarUrl: string;
  role: "MEMBER" | "ADMIN" | "OWNER"; birthDay: number | null; birthMonth: number | null;
  registeredAt: string; status: "PENDING" | "ACTIVE" | "EXPIRED" | "SUSPENDED";
};

export default function MemberAccountPage({ identity, welcomeCoupons }: { identity: AccountIdentity; welcomeCoupons: WelcomeCoupon[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("home");
  const [member, setMember] = useState<MemberProfile | null>(null);
  const [account, setAccount] = useState<MemberAccount | null>(null);
  const [membership, setMembership] = useState<MockMembership | null>(null);
  const [benefits, setBenefits] = useState<BenefitGrant[]>([]);
  const [suspendedBenefitIds, setSuspendedBenefitIds] = useState<string[]>([]);
  const [checkins, setCheckins] = useState<CheckinRecord[]>([]);
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionRecord[]>([]);
  const [couponOffers, setCouponOffers] = useState<PointCouponOffer[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [serverProfile, setServerProfile] = useState<Partial<ProfileDraft> | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [showPurchases, setShowPurchases] = useState(false);
  const [showCheckins, setShowCheckins] = useState(false);
  const [showCouponHistory, setShowCouponHistory] = useState(false);
  const [showPointHistory, setShowPointHistory] = useState(false);

  const refresh = useCallback(() => {
    try {
      const profile = {
        ...defaultMockMember,
        id: identity.id, memberCode: identity.memberCode, fullName: identity.fullName,
        phone: identity.phone, avatarUrl: identity.avatarUrl, role: identity.role,
        birthDay: identity.birthDay ? String(identity.birthDay) : "", birthMonth: identity.birthMonth ? String(identity.birthMonth) : "",
        registeredAt: identity.registeredAt, status: identity.status === "SUSPENDED" ? "PENDING" : identity.status,
        nickname: "", gender: "OTHER", cardNumber: "", emergencyContact: { name: "", phone: "", relation: "" },
        coupons: {}, activityLogs: [], points: 0,
        ...serverProfile,
      } as MemberProfile;
      if (typeof profile.memberCode !== "string" || !/^BLU-\d+$/.test(profile.memberCode) || typeof profile.fullName !== "string" ||
        !profile.fullName.trim() || typeof profile.phone !== "string" || typeof profile.birthDay !== "string" || typeof profile.birthMonth !== "string") {
        throw new Error("ข้อมูลโปรไฟล์สมาชิกไม่ถูกต้อง");
      }
      const benefitState = readBenefits();
      setMember(profile);
      let memberAccount: MemberAccount;
      try {
        memberAccount = readMemberAccount(profile.memberCode);
      } catch (cause) {
        if (!(cause instanceof Error) || !cause.message.includes("ไม่พบบัญชีสมาชิกในรายชื่อ mock")) throw cause;
        memberAccount = { memberCode: profile.memberCode, points: 0, purchases: [], pointLedger: [], pointCoupons: [] };
      }
      setAccount(memberAccount);
      setMembership(readMembership(profile.memberCode));
      setBenefits(benefitState.grants.filter(grant => grant.memberCode === profile.memberCode));
      setSuspendedBenefitIds(benefitState.definitions.filter(definition => !definition.active).map(definition => definition.id));
      setCheckins(parseCheckinRecords(localStorage.getItem(CHECKIN_STORAGE_KEY)).filter(record => record.memberCode === profile.memberCode));
      setRewards(readRewardCatalog().filter(reward => reward.isActive));
      setRedemptions(readDeskRewards().filter(record => record.memberCode === profile.memberCode));
      setCouponOffers(readPointCouponCatalog());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "อ่านข้อมูลบัญชีไม่ได้");
    }
  }, [identity, serverProfile]);

  useEffect(() => {
    // Hydrate the browser-only mock stores after the client mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const storage = (event: StorageEvent) => {
      if ([null, "blu_member", BENEFITS_KEY, CHECKIN_STORAGE_KEY, MEMBER_ACCOUNT_KEY].includes(event.key)) refresh();
    };
    window.addEventListener("storage", storage);
    window.addEventListener(BENEFITS_EVENT, refresh);
    window.addEventListener(MEMBER_ACCOUNT_EVENT, refresh);
    window.addEventListener(DESK_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", storage);
      window.removeEventListener(BENEFITS_EVENT, refresh);
      window.removeEventListener(MEMBER_ACCOUNT_EVENT, refresh);
      window.removeEventListener(DESK_UPDATED_EVENT, refresh);
    };
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/member/profile", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "โหลดข้อมูลส่วนตัวไม่สำเร็จ");
        setServerProfile(profileDraft(data.profile));
      })
      .catch(cause => { if (!controller.signal.aborted) setProfileError(cause instanceof Error ? cause.message : "โหลดข้อมูลส่วนตัวไม่สำเร็จ"); });
    return () => controller.abort();
  }, [identity.id]);

  const purchases = useMemo(() => [...(account?.purchases ?? [])].sort((a, b) => Date.parse(b.purchasedAt) - Date.parse(a.purchasedAt)), [account]);
  const memberCheckins = useMemo(() => [...checkins].sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt)), [checkins]);
  const couponHistory = useMemo(() => [
    ...benefits.map(grant => ({ id: grant.id, title: grant.definition.name, detail: grant.status === "USED" ? `ใช้เมื่อ ${dateText(grant.usedAt)}` : `ได้รับเมื่อ ${dateText(grant.issuedAt)}`, date: grant.usedAt ?? grant.issuedAt })),
    ...(account?.pointCoupons ?? []).map(coupon => ({ id: coupon.id, title: coupon.title, detail: `แลกด้วย ${coupon.pointsSpent} คะแนน`, date: coupon.redeemedAt })),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)), [account, benefits]);
  const adminCoupons = benefits.filter(grant => grant.definition.kind === "COUPON");
  const adminPromos = benefits.filter(grant => grant.definition.kind === "PROMO");
  const pointCoupons = account?.pointCoupons ?? [];

  const logout = async () => {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) return;
    localStorage.removeItem("blu_member");
    router.push("/");
    router.refresh();
  };

  const openEdit = () => {
    if (!member || !serverProfile) return;
    setProfileError("");
    setDraft({
      fullName: member.fullName,
      nickname: member.nickname ?? "",
      gender: member.gender,
      phone: member.phone,
      birthDay: member.birthDay,
      birthMonth: member.birthMonth,
      emergencyContact: member.emergencyContact ?? { name: "", phone: "", relation: "" },
    });
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
      setMember({ ...member, ...saved });
      setEditing(false);
      setMessage("บันทึกข้อมูลส่วนตัวแล้ว");
    } catch (cause) {
      setProfileError(cause instanceof Error ? cause.message : "บันทึกข้อมูลไม่สำเร็จ");
    } finally {
      setProfileBusy(false);
    }
  };

  const redeemProduct = async (reward: RewardItem) => {
    if (!member || busy) return;
    setBusy(true); setMessage("");
    try {
      await requestMockReward(reward, member.memberCode);
      setMessage(`แลก ${reward.title} สำเร็จ แสดงรหัสรับสินค้าที่ประวัติด้านล่าง`);
      refresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "แลกรางวัลไม่สำเร็จ"); }
    finally { setBusy(false); }
  };

  const redeemCouponOffer = async (offer: PointCouponOffer) => {
    if (!member || busy) return;
    setBusy(true); setMessage("");
    try {
      await redeemPointCoupon(member.memberCode, offer);
      setMessage(`แลก ${offer.title} สำเร็จ คูปองอยู่ในเมนูคูปองแล้ว`);
      refresh();
      setTab("coupons");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "แลกคูปองไม่สำเร็จ"); }
    finally { setBusy(false); }
  };

  if (!member || !account) return <main className="min-h-screen space-y-4 bg-blu-ice p-6 text-blu-dark"><RealPaymentAccount />{error ? <div className={cardClass}><p role="alert">{error}</p><button className={`${buttonClass} mt-4`} onClick={refresh}>ลองใหม่</button></div> : <div className="h-9 w-9 animate-spin rounded-full border-4 border-blu-slate border-t-transparent" />}</main>;

  return <main className="min-h-screen bg-blu-ice pb-28 text-blu-dark">
    <Navbar member={member} onLogout={logout} />
    <div className="mx-auto max-w-lg space-y-5 px-4 pt-24">
      <header className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-blu-steel">My Account</p><h1 className="text-2xl font-black">{({ home: "หน้าหลัก", qr: "QR Code", coupons: "คูปอง", points: "คะแนน" } as const)[tab]}</h1></div>
        <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[11px] font-bold text-amber-800">สมาชิกจริง / สิทธิ์อื่นทดลอง</span>
      </header>

      {message && <div role="status" className="flex items-start justify-between gap-3 rounded-2xl bg-blu-dark p-4 text-sm text-white"><span>{message}</span><button aria-label="ปิดข้อความ" onClick={() => setMessage("")}><X className="h-4 w-4" /></button></div>}
      {error && <p role="alert" className="rounded-2xl bg-rose-100 p-4 text-sm text-rose-800">{error}</p>}

      {tab === "home" && <div className="space-y-5">
        <section className={`${cardClass} overflow-hidden p-0`}>
          <div className="bg-gradient-to-br from-blu-dark via-blu-navy to-blu-slate p-5 text-white">
            <div className="flex items-center gap-4">
              <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-white/80 bg-blu-slate text-2xl font-black shadow-lg">
                {member.avatarUrl ? <Image src={member.avatarUrl} alt={member.fullName} fill sizes="80px" className="object-cover" /> : member.fullName.charAt(0)}
              </div>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-1"><h2 className="truncate text-xl font-black">{member.fullName}</h2><ShieldCheck className="h-4 w-4 text-blu-yellow" /></div><p className="font-mono text-xs text-blu-sky">{member.memberCode}</p><p className="mt-1 text-xs text-white/75">รูปโปรไฟล์เปลี่ยนได้โดยติดต่อเจ้าหน้าที่เท่านั้น</p></div>
            </div>
          </div>
          <div className="space-y-3 p-5 text-sm">
            <RealPaymentAccount />
            <div className="flex justify-between gap-3"><span className="text-blu-steel">สมัครครั้งแรก</span><strong>{dateText(member.registeredAt)}</strong></div>
            <button className={`${buttonClass} mt-2 flex w-full items-center justify-center gap-2`} onClick={openEdit}><Pencil className="h-4 w-4" />แก้ไขข้อมูลส่วนตัว</button>
          </div>
        </section>

        {adminPromos.length > 0 && <section className={`${cardClass} border-amber-300 bg-gradient-to-br from-amber-50 to-white`}><SectionTitle icon={Gift} title="คูปองแนะนำจาก Admin" /><div className="mt-4 space-y-3">{adminPromos.filter(grant => grant.status === "UNUSED").slice(0, 2).map(grant => <div key={grant.id} className="rounded-2xl bg-white p-4 shadow-sm"><strong>{grant.definition.name}</strong><p className="mt-1 text-xs text-blu-steel">{grant.definition.detail}</p><button className="mt-2 text-xs font-bold text-blu-slate underline" onClick={() => setTab("coupons")}>เปิดคูปอง</button></div>)}</div></section>}

        <HistoryBlock title="ประวัติการซื้อทดลองในเบราว์เซอร์" icon={ShoppingBag} expanded={showPurchases} setExpanded={setShowPurchases} total={purchases.length}>
          {(showPurchases ? purchases : purchases.slice(0, 3)).map(item => <div key={item.id} className="flex justify-between gap-3 border-b border-blu-sky/20 py-3 last:border-0"><div><strong className="text-sm">{item.packageName}</strong><p className="text-xs text-blu-steel">{dateText(item.purchasedAt)} • ได้ {item.pointsEarned} คะแนน</p></div><strong className="whitespace-nowrap">฿{item.paidAmount.toLocaleString()}</strong></div>)}
          {!purchases.length && <Empty>ยังไม่มีประวัติการซื้อบนเครื่องนี้</Empty>}
        </HistoryBlock>

        <HistoryBlock title="ประวัติการใช้คูปอง" icon={Ticket} expanded={showCouponHistory} setExpanded={setShowCouponHistory} total={couponHistory.length}>
          {(showCouponHistory ? couponHistory : couponHistory.slice(0, 3)).map(item => <div key={item.id} className="border-b border-blu-sky/20 py-3 last:border-0"><strong className="text-sm">{item.title}</strong><p className="text-xs text-blu-steel">{item.detail}</p></div>)}
          {!couponHistory.length && <Empty>ยังไม่มีประวัติคูปอง</Empty>}
        </HistoryBlock>

        <HistoryBlock title="ข้อมูลการเข้าใช้บริการ" icon={Clock3} expanded={showCheckins} setExpanded={setShowCheckins} total={memberCheckins.length}>
          {(showCheckins ? memberCheckins : memberCheckins.slice(0, 3)).map(item => <div key={item.id} className="flex justify-between border-b border-blu-sky/20 py-3 text-sm last:border-0"><span>เช็กอินเข้าใช้บริการ</span><span className="text-xs text-blu-steel">{dateText(item.checkedAt)}</span></div>)}
          {!memberCheckins.length && <Empty>ยังไม่มีประวัติเช็กอินบนเครื่องนี้</Empty>}
        </HistoryBlock>
      </div>}

      {tab === "qr" && <section className={`${cardClass} overflow-hidden p-0`}>
        <div className="bg-gradient-to-br from-blu-dark via-blu-navy to-blu-slate px-5 py-7 text-center text-white"><QrCode className="mx-auto mb-2 h-7 w-7 text-blu-yellow" /><h2 className="text-xl font-black">QR สำหรับเข้าใช้บริการ</h2><p className="mt-1 text-xs text-blu-sky">แสดงให้เจ้าหน้าที่สแกนที่เคาน์เตอร์</p></div>
        <div className="flex flex-col items-center p-7"><div className="rounded-3xl border-4 border-blu-dark bg-white p-5 shadow-xl"><QRCodeSVG value={member.memberCode} size={230} level="H" title={`รหัสสมาชิก ${member.memberCode}`} /></div><h3 className="mt-5 text-xl font-black">{member.fullName}</h3><p className="font-mono text-sm font-bold text-blu-slate">{member.memberCode}</p><div className="mt-5 flex gap-2 rounded-2xl bg-blu-ice p-3 text-xs text-blu-steel"><Info className="h-4 w-4 shrink-0" /><p>QR นี้เป็นรหัสสมาชิกสำหรับเช็กอินเท่านั้น ไม่ใช่ QR คูปองหรือรหัสรับสินค้า</p></div></div>
      </section>}

      {tab === "coupons" && <div className="space-y-5">
        <WelcomeCoupons key={identity.id} coupons={welcomeCoupons} />
        {membership && membership.friendCouponsLeft > 0 && <section className={`${cardClass} border-blu-yellow/70 bg-gradient-to-br from-blu-dark to-blu-navy text-white`}><div className="flex justify-between gap-3"><div><p className="text-xs font-bold text-blu-yellow">สิทธิ์จากแพ็กเกจ</p><h2 className="mt-1 text-xl font-black">คูปองพาเพื่อน</h2><p className="text-sm text-blu-sky">คงเหลือ {membership.friendCouponsLeft} ครั้ง</p></div><Ticket className="h-10 w-10 text-blu-yellow" /></div><p className="mt-4 text-xs text-white/70">แสดงบัตรสมาชิกและติดต่อเจ้าหน้าที่เพื่อใช้สิทธิ์</p></section>}
        {adminCoupons.map(coupon => <AdminCouponCard key={coupon.id} coupon={coupon} source="Admin แจก" suspended={suspendedBenefitIds.includes(coupon.definition.id)} />)}
        {adminPromos.map(coupon => <AdminCouponCard key={coupon.id} coupon={coupon} source="โปรสมาชิก" suspended={suspendedBenefitIds.includes(coupon.definition.id)} />)}
        {pointCoupons.map(coupon => <PointCouponCard key={coupon.id} coupon={coupon} />)}
        {!membership?.friendCouponsLeft && !adminCoupons.length && !adminPromos.length && !pointCoupons.length && <section className={cardClass}><Empty>ยังไม่มีคูปองทดลองจาก Admin หรือที่แลกด้วยคะแนน<br />คูปองต้อนรับจากฐานข้อมูลจริงแสดงแยกด้านบน</Empty></section>}
      </div>}

      {tab === "points" && <div className="space-y-5">
        <section className="overflow-hidden rounded-3xl border-2 border-blu-yellow/50 bg-gradient-to-br from-blu-dark via-blu-navy to-blu-dark p-5 text-white shadow-xl"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-blu-sky">คะแนนสะสมของฉัน</p><div className="mt-1 text-4xl font-black text-blu-yellow">{account.points.toLocaleString()} <span className="text-sm text-white">คะแนน</span></div></div><Coins className="h-10 w-10 text-blu-yellow" /></div><div className="mt-5 rounded-2xl bg-white/10 p-3 text-xs text-blu-sky"><strong className="text-white">เงื่อนไข:</strong> ทุกยอดชำระจริงหลังหักส่วนลด 20 บาท = 1 คะแนน เศษไม่ครบ 20 บาทปัดทิ้ง • เช็กอินไม่เพิ่มคะแนน</div></section>

        <section className={cardClass}><SectionTitle icon={ShoppingBag} title="แลกสินค้า" /><div className="mt-4 grid grid-cols-2 gap-3">{rewards.map(reward => { const stock = remainingStock(reward, redemptions); const redeemed = redemptions.some(record => record.rewardId === reward.id); const canRedeem = account.points >= reward.pointCost && stock > 0 && !redeemed; return <article key={reward.id} className="overflow-hidden rounded-2xl border border-blu-sky/40"><div className="relative aspect-[4/3] bg-blu-ice"><Image unoptimized src={reward.imageUrl} alt={reward.title} fill sizes="220px" className="object-cover" /></div><div className="space-y-2 p-3"><h3 className="line-clamp-2 text-xs font-bold">{reward.title}</h3><p className="text-xs font-black text-blu-slate">{reward.pointCost} คะแนน</p><button className={`${buttonClass} w-full px-2 py-2 text-xs`} disabled={!canRedeem || busy} onClick={() => void redeemProduct(reward)}>{redeemed ? "แลกแล้ว" : stock < 1 ? "สินค้าหมด" : account.points < reward.pointCost ? "คะแนนไม่พอ" : "แลกสินค้า"}</button></div></article>; })}</div></section>

        <section className={cardClass}><SectionTitle icon={Ticket} title="แลกคูปอง" /><div className="mt-4 space-y-3">{couponOffers.map(offer => { const held = pointCoupons.some(coupon => coupon.offerId === offer.id && coupon.status === "UNUSED" && Date.parse(coupon.expiresAt) > Date.now()); return <article key={offer.id} className="flex items-center justify-between gap-3 rounded-2xl bg-blu-ice p-4"><div><strong className="text-sm">{offer.title}</strong><p className="text-xs text-blu-steel">{offer.detail} • อายุ {offer.validDays} วัน</p><p className="mt-1 text-xs font-black text-blu-slate">{offer.pointCost} คะแนน</p></div><button className={buttonClass} disabled={busy || held || account.points < offer.pointCost} onClick={() => void redeemCouponOffer(offer)}>{held ? "มีแล้ว" : "แลก"}</button></article>; })}</div></section>

        <HistoryBlock title="ประวัติรับและใช้คะแนน" icon={History} expanded={showPointHistory} setExpanded={setShowPointHistory} total={account.pointLedger.length}>
          {[...account.pointLedger].reverse().slice(0, showPointHistory ? undefined : 5).map(entry => <div key={entry.id} className="flex items-center justify-between gap-3 border-b border-blu-sky/20 py-3 last:border-0"><div><strong className="text-sm">{entry.description}</strong><p className="text-xs text-blu-steel">{dateText(entry.createdAt)} • คงเหลือ {entry.balanceAfter}</p></div><strong className={entry.delta >= 0 ? "text-emerald-600" : "text-rose-600"}>{entry.delta >= 0 ? "+" : ""}{entry.delta}</strong></div>)}
        </HistoryBlock>

        {redemptions.length > 0 && <section className={cardClass}><SectionTitle icon={Gift} title="รหัสรับสินค้า" /><div className="mt-4 space-y-3">{redemptions.map(record => <details key={record.id} className="rounded-2xl bg-blu-ice p-4"><summary className="cursor-pointer text-sm font-bold">{record.rewardTitle} • {record.status === "PENDING" ? "รอรับ" : "รับแล้ว"}</summary><div className="mt-4 flex flex-col items-center"><QRCodeSVG value={record.rewardCode} size={150} title={record.rewardTitle} /><p className="mt-2 break-all text-center font-mono text-[10px]">{record.rewardCode}</p></div></details>)}</div></section>}
      </div>}
    </div>

    {!editing && profileError && <p role="alert" className="p-4 text-rose-700">{profileError}</p>}
    <nav aria-label="เมนูบัญชีสมาชิก" className="fixed inset-x-0 bottom-0 z-40 border-t border-blu-sky/30 bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_30px_rgba(12,55,86,0.12)] backdrop-blur-lg"><div className="mx-auto grid max-w-lg grid-cols-4">{([
      ["home", Home, "หน้าหลัก"], ["qr", QrCode, "QR Code"], ["coupons", Ticket, "คูปอง"], ["points", Coins, "คะแนน"],
    ] as const).map(([key, Icon, label]) => <button key={key} aria-current={tab === key ? "page" : undefined} onClick={() => { setTab(key); window.scrollTo({ top: 0, behavior: "smooth" }); }} className={`flex flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[11px] font-bold transition ${tab === key ? "bg-blu-dark text-blu-yellow" : "text-blu-steel hover:bg-blu-ice"}`}><Icon className="h-5 w-5" /><span>{label}</span></button>)}</div></nav>

    {editing && draft && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-blu-dark/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget) setEditing(false); }}><form onSubmit={submitProfile} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"><div className="flex items-center justify-between"><div><h2 className="text-xl font-black">แก้ไขข้อมูลส่วนตัว</h2><p className="text-xs text-blu-steel">เบอร์โทรแก้ไขไม่ได้ ต้องยืนยันผ่านขั้นตอน OTP สำหรับเปลี่ยนเบอร์</p></div><button type="button" aria-label="ปิด" onClick={() => setEditing(false)}><X /></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="space-y-1 text-xs font-bold sm:col-span-2">ชื่อ-นามสกุล<input required maxLength={100} className={inputClass} value={draft.fullName} onChange={e => setDraft({ ...draft, fullName: e.target.value })} /></label><label className="space-y-1 text-xs font-bold">ชื่อเล่น<input maxLength={50} className={inputClass} value={draft.nickname ?? ""} onChange={e => setDraft({ ...draft, nickname: e.target.value })} /></label><label className="space-y-1 text-xs font-bold">เบอร์โทร<input required inputMode="numeric" className={inputClass} value={draft.phone} readOnly /></label><label className="space-y-1 text-xs font-bold">เพศ<select required className={inputClass} value={draft.gender} onChange={e => setDraft({ ...draft, gender: e.target.value as MemberProfile["gender"] })}><option value="MALE">ชาย</option><option value="FEMALE">หญิง</option><option value="OTHER">อื่นๆ</option></select></label><label className="space-y-1 text-xs font-bold">วันเกิด<input required type="number" min={1} max={31} className={inputClass} value={draft.birthDay} onChange={e => setDraft({ ...draft, birthDay: e.target.value })} /></label><label className="space-y-1 text-xs font-bold">เดือนเกิด<select required className={inputClass} value={draft.birthMonth} onChange={e => setDraft({ ...draft, birthMonth: e.target.value })}><option value="">เลือกเดือน</option>{thaiMonths.map(month => <option key={month} value={thaiMonths.indexOf(month) + 1}>{month}</option>)}</select></label><div className="sm:col-span-2 rounded-2xl bg-blu-ice p-4"><p className="mb-3 text-xs font-black">ผู้ติดต่อฉุกเฉิน</p><div className="grid gap-3 sm:grid-cols-3"><input aria-label="ชื่อผู้ติดต่อฉุกเฉิน" placeholder="ชื่อ" className={inputClass} value={draft.emergencyContact?.name ?? ""} onChange={e => setDraft({ ...draft, emergencyContact: { ...(draft.emergencyContact ?? { phone: "", relation: "" }), name: e.target.value } })} /><input aria-label="ความสัมพันธ์" placeholder="ความสัมพันธ์" className={inputClass} value={draft.emergencyContact?.relation ?? ""} onChange={e => setDraft({ ...draft, emergencyContact: { ...(draft.emergencyContact ?? { name: "", phone: "" }), relation: e.target.value } })} /><input aria-label="เบอร์ผู้ติดต่อฉุกเฉิน" inputMode="numeric" placeholder="เบอร์โทร" className={inputClass} value={draft.emergencyContact?.phone ?? ""} onChange={e => setDraft({ ...draft, emergencyContact: { ...(draft.emergencyContact ?? { name: "", relation: "" }), phone: e.target.value.replace(/\D/g, "").slice(0, 10) } })} /></div></div><div className="sm:col-span-2 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"><UserRound className="h-5 w-5 shrink-0" />รูปโปรไฟล์ไม่สามารถแก้ไขเองได้ กรุณาติดต่อเจ้าหน้าที่</div></div><p role="alert" className="mt-3 text-sm text-rose-700">{profileError}</p><button disabled={profileBusy} className={`${buttonClass} mt-5 w-full`}>{profileBusy ? "กำลังบันทึก..." : "บันทึกข้อมูล"}</button></form></div>}


  </main>;
}

function HistoryBlock({ title, icon, expanded, setExpanded, total, children }: { title: string; icon: typeof History; expanded: boolean; setExpanded: (value: boolean) => void; total: number; children: React.ReactNode }) {
  return <section className={cardClass}><SectionTitle icon={icon} title={title} action={total > 3 ? <button className="flex items-center gap-1 text-xs font-bold text-blu-slate" onClick={() => setExpanded(!expanded)}>{expanded ? "ย่อรายการ" : "ดูทั้งหมด"}{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button> : undefined} /><div className="mt-3">{children}</div></section>;
}

function AdminCouponCard({ coupon, source, suspended }: { coupon: BenefitGrant; source: string; suspended: boolean }) {
  const status = statusText(coupon.status, coupon.definition.expiresAt, suspended);
  return <section className={cardClass}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-blu-slate">{source}</p><h2 className="mt-1 text-lg font-black">{coupon.definition.name}</h2></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${status.className}`}>{status.label}</span></div><p className="mt-2 text-sm text-blu-steel">{coupon.definition.detail}</p><p className="mt-1 text-xs text-blu-steel">หมดอายุ {dateText(coupon.definition.expiresAt)}</p><div className="mt-4 flex flex-col items-center rounded-2xl bg-blu-ice p-4"><QRCodeSVG value={coupon.code} size={150} title={coupon.definition.name} /><p className="mt-2 break-all text-center font-mono text-[10px]">{coupon.code}</p></div></section>;
}

function PointCouponCard({ coupon }: { coupon: PointCoupon }) {
  const status = statusText(coupon.status, coupon.expiresAt);
  return <section className={`${cardClass} border-blu-yellow/60`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-blu-slate">แลกจากคะแนน</p><h2 className="mt-1 text-lg font-black">{coupon.title}</h2></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${status.className}`}>{status.label}</span></div><p className="mt-2 text-sm text-blu-steel">{coupon.detail}</p><p className="mt-1 text-xs text-blu-steel">ใช้ {coupon.pointsSpent} คะแนน • หมดอายุ {dateText(coupon.expiresAt)}</p><div className="mt-4 flex flex-col items-center rounded-2xl bg-blu-ice p-4"><QRCodeSVG value={coupon.code} size={150} title={coupon.title} /><p className="mt-2 break-all text-center font-mono text-[10px]">{coupon.code}</p></div></section>;
}
