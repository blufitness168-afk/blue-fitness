"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  ChevronLeft,
  Maximize2,
  X,
  Sparkles,
  Ticket,
  Calendar,
  Phone,
  CreditCard,
  CheckCircle2,
  Clock,
  LogOut,
  ArrowRight,
  ShieldCheck,
  Gift,
} from "lucide-react";
import LanguageToggle from "@/components/LanguageToggle";
import { useLanguage } from "@/context/LanguageContext";

export default function MemberDashboardPage() {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const [member, setMember] = useState<{
    fullName: string;
    phone: string;
    avatarUrl?: string;
    memberCode: string;
    cardNumber?: string;
    birthDay?: string;
    birthMonth?: string;
    points?: number;
    registeredAt?: string;
  } | null>(null);

  const [qrModalOpen, setQrModalOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("blu_member");
      if (saved) {
        setMember(JSON.parse(saved));
      } else {
        setMember({
          fullName: "สมชาย ใจดี",
          phone: "081-234-5678",
          avatarUrl: "",
          memberCode: "BLU-1001",
          cardNumber: "CARD-8899",
          birthDay: "15",
          birthMonth: "สิงหาคม",
          points: 25,
          registeredAt: "28 ส.ค. 2026",
        });
      }
    } catch (e) { }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("blu_member");
    router.push("/");
  };

  if (!member) {
    return (
      <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center text-slate-800">
        <div className="w-8 h-8 border-3 border-[#0047ba] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Active package details
  const activePackage = {
    name: "BLU 07:00-22:00 (ราย 90 วัน)",
    timeSlot: "07:00 - 22:00 น.",
    usedDays: 45,
    totalDays: 90,
    daysLeft: 45,
    expireDate: "12 ต.ค. 2026",
    friendCouponsLeft: 5,
  };

  return (
    <main className="min-h-screen bg-[#f1f5f9] text-slate-800 pb-16">
      {/* ═══════════════════════════════════════════════
          NAVBAR (Light Glass on Gray Background)
      ═══════════════════════════════════════════════ */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
        <div className="max-w-2xl mx-auto px-4 h-15 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 transition-colors font-medium"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>{t("member.back")}</span>
          </Link>

          <div className="flex items-center gap-2">
            <Image
              src="/logo.jpg"
              alt="Blu Fitness"
              width={38}
              height={38}
              className="w-[38px] h-[38px] rounded-lg object-cover"
              priority
            />
            <span className="font-extrabold tracking-wider text-sm text-[#0a1628]">
              BLU FITNESS
            </span>
          </div>

          <div className="flex items-center gap-2">
            <LanguageToggle variant="light" />
            <button
              onClick={handleLogout}
              title={t("nav.logout")}
              className="text-xs text-slate-500 hover:text-rose-600 flex items-center gap-1 transition-colors cursor-pointer font-medium p-1"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════
          MAIN CONTAINER
      ═══════════════════════════════════════════════ */}
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-6">

        {/* ═══════════════════════════════════════════════
            1. REALISTIC BLU FITNESS PHYSICAL CARD REPLICA
        ═══════════════════════════════════════════════ */}
        <section className="relative">
          {/* Card Body (Rounded-2xl, Clean White Card on Gray Background with Natural Drop Shadow) */}
          <div className="relative aspect-[1.58/1] w-full bg-white rounded-2xl overflow-hidden border border-slate-200/80 shadow-lg flex select-none">

            {/* ── Left Edge Blue Accent (Full Height with Center-to-Edge Gradient) ── */}
            <div className="absolute inset-y-0 left-0 w-2.5 sm:w-3 bg-gradient-to-b from-[#001f5c] via-[#0052cc] to-[#001f5c] rounded-l-2xl z-20" />

            {/* ── Left 58%: White & Stacked Large Logo & Clean Single-Line Fields ── */}
            <div className="flex-1 pl-6 pr-3 py-3.5 sm:pl-8 sm:pr-4 sm:py-4 flex flex-col justify-between relative bg-white">

              {/* Stacked Large Brand Logo (Big Icon with BLU pulled tight underneath) */}
              <div className="flex flex-col items-start z-10">
                <div className="relative w-[136px] h-[136px] sm:w-[154px] sm:h-[154px] -ml-2 -mt-3">
                  <Image
                    src="/logo.jpg"
                    alt="Blu Fitness Logo"
                    fill
                    sizes="350px"
                    className="object-contain"
                    priority
                  />
                </div>
                <div className="-mt-4 sm:-mt-5 relative z-20">
                  <div className="text-4xl sm:text-5xl font-black tracking-tight text-[#0047ba] leading-none drop-shadow-xs">
                    BLU
                  </div>
                  <div className="text-sm sm:text-base font-black tracking-[0.24em] text-[#0a1628] uppercase mt-0.5">
                    FITNESS
                  </div>
                </div>
              </div>

              {/* Member & Date Underlined Fields (Strictly 1 Line Each with clean underlines) */}
              <div className="space-y-2 sm:space-y-2.5 z-10">
                {/* Member Name (1 Line) */}
                <div>
                  <div className="flex items-baseline gap-1.5 text-xs sm:text-sm whitespace-nowrap">
                    <span className="font-extrabold text-[#0a1628] shrink-0">{t("member.member_label")}:</span>
                    <span className="font-black text-[#0047ba] truncate">
                      {member.fullName}
                    </span>
                  </div>
                  <div className="h-[1.5px] bg-[#0047ba] w-full mt-0.5 opacity-80" />
                </div>

                {/* Date (1 Line) */}
                <div>
                  <div className="flex items-baseline justify-between text-xs sm:text-sm whitespace-nowrap gap-1">
                    <div className="flex items-baseline gap-1">
                      <span className="font-extrabold text-[#0a1628] shrink-0">{t("member.date_label")}:</span>
                      <span className="font-black text-[#0047ba] font-mono">
                        {activePackage.usedDays}/{activePackage.totalDays} {t("member.days_unit")}
                      </span>
                    </div>
                    <span className="text-[10px] sm:text-[11px] text-emerald-600 font-extrabold shrink-0">
                      ({lang === "en" ? `${activePackage.daysLeft} left` : `เหลือ ${activePackage.daysLeft} วัน`})
                    </span>
                  </div>
                  <div className="h-[1.5px] bg-[#0047ba] w-full mt-0.5 opacity-80" />
                </div>
              </div>
            </div>

            {/* ── Right 40%: Metallic Deep Blue Tab (Subtle Diagonal Metallic Sheen & Pure QR) ── */}
            <div
              onClick={() => setQrModalOpen(true)}
              className="w-[40%] bg-[linear-gradient(135deg,_#001844_0%,_#00318c_25%,_#006eff_50%,_#00318c_75%,_#001844_100%)] p-3 sm:p-4 flex flex-col items-center justify-center text-center text-white relative cursor-pointer hover:brightness-110 transition-all border-l border-[#003087]"
              title="แตะเพื่อขยาย QR Code"
            >
              {/* Direct QR Code with Transparent Background (Printed on Blue Metal) */}
              <div className="transition-transform hover:scale-105 z-10">
                <QRCodeSVG
                  value={member.memberCode || "BLU-1001"}
                  size={150}
                  level="H"
                  bgColor="transparent"
                  fgColor="#051329"
                  marginSize={0}
                  className="w-24 h-24 sm:w-30 sm:h-30 drop-shadow-xs"
                />
              </div>
            </div>

          </div>
        </section>

        {/* ═══════════════════════════════════════════════
            2. BLU POINT 10-SLOT STAMP CARD (Luxury Navy & Gold Theme - Sharp Corners)
        ═══════════════════════════════════════════════ */}
        <section className="bg-gradient-to-br from-[#003087] via-[#0a1838] to-[#050e24] text-white rounded-none p-5 border-2 border-[#ffd700]/50 shadow-xl space-y-4 relative overflow-hidden">
          {/* Header Row: BLU POINT (Gold) & Total Points Summary (Right) */}
          <div className="flex items-center justify-between pb-3.5 border-b border-white/15">
            <h3 className="text-base sm:text-lg font-black tracking-wider text-[#ffd700] uppercase">
              {t("points.title")}
            </h3>
            <div className="font-mono font-black text-sm sm:text-base">
              <span className="text-[#ffd700] text-xl sm:text-2xl font-black">{member.points ?? 35}</span>
              <span className="text-white/60 font-bold ml-1">{t("points.of_100")}</span>
            </div>
          </div>

          {/* 10-Slot Stamp Grid (5 columns x 2 rows) */}
          <div className="grid grid-cols-5 gap-2 sm:gap-3">
            {Array.from({ length: 10 }).map((_, i) => {
              const slotNum = i + 1;
              const slotStart = i * 10;
              const slotEnd = slotNum * 10;
              const currentPts = member.points ?? 35;
              let fill = 0;
              if (currentPts >= slotEnd) {
                fill = 100;
              } else if (currentPts > slotStart) {
                fill = Math.round(((currentPts - slotStart) / 10) * 100);
              }
              const gradId = `db-stamp-gold-${slotNum}`;
              return (
                <div
                  key={i}
                  className={`aspect-square rounded-none flex flex-col items-center justify-center p-1 relative transition-all ${fill === 100
                      ? "bg-[#ffd700]/15 border-2 border-[#ffd700] shadow-[0_0_12px_rgba(255,215,0,0.25)]"
                      : fill > 0
                        ? "bg-white/10 border border-[#ffd700]/70"
                        : "bg-white/5 border border-white/10"
                    }`}
                >
                  <span className={`absolute top-1 left-1.5 text-[8px] sm:text-[9px] font-mono font-bold ${fill > 0 ? "text-[#ffd700]" : "text-white/30"
                    }`}>
                    {slotNum * 10}
                  </span>
                  <svg
                    viewBox="0 0 44 44"
                    className="w-full h-full p-0.5 sm:p-1 max-w-[58px] max-h-[58px] drop-shadow-xs"
                  >
                    <defs>
                      <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1="0" y1="22" x2="44" y2="22">
                        <stop offset={`${fill}%`} stopColor="#ffd700" />
                        <stop offset={`${fill}%`} stopColor="#334155" />
                      </linearGradient>
                    </defs>
                    {/* 45-Degree Diagonal Large Dumbbell with Separated Plate Gaps */}
                    <g transform="rotate(-45 22 22)" fill={`url(#${gradId})`}>
                      {/* Central Grip Bar */}
                      <rect x="12.5" y="18" width="19" height="8" rx="4" />
                      {/* Left Inner Plate */}
                      <rect x="5.5" y="10" width="5.5" height="24" rx="2.5" />
                      {/* Left Outer Plate (with 1.5px gap) */}
                      <rect x="0" y="13" width="4" height="18" rx="2" />
                      {/* Right Inner Plate */}
                      <rect x="33" y="10" width="5.5" height="24" rx="2.5" />
                      {/* Right Outer Plate (with 1.5px gap) */}
                      <rect x="40" y="13" width="4" height="18" rx="2" />
                    </g>
                  </svg>
                </div>
              );
            })}
          </div>

          {/* Bottom Action: Redeem Rewards (No Redirect) */}
          <div className="pt-1 text-center">
            <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-[#ffd700] hover:text-[#ffe55b] transition-colors underline underline-offset-4 decoration-[#ffd700]/70 cursor-pointer select-none">
              <span>{t("points.redeem")}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════
            3. LUXURY NAVY & GOLD FRIEND PASS TICKET (No Redirect)
        ═══════════════════════════════════════════════ */}
        <section>
          <div className="relative w-full max-w-md mx-auto hover:scale-[1.01] transition-transform select-none cursor-pointer">
            {/* 100% True Transparent Vector Ticket Graphic */}
            <svg
              viewBox="0 0 460 230"
              className="w-full h-auto drop-shadow-xl"
            >
              <defs>
                {/* Deep Royal Navy Gradient */}
                <linearGradient id="navyTicketGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#0d235c" />
                  <stop offset="50%" stopColor="#08173d" />
                  <stop offset="100%" stopColor="#050e26" />
                </linearGradient>

                {/* Metallic Gold Sheen Gradient */}
                <linearGradient id="goldTicketGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#f59e0b" />
                  <stop offset="25%" stopColor="#ffd700" />
                  <stop offset="50%" stopColor="#fff3b0" />
                  <stop offset="75%" stopColor="#ffd700" />
                  <stop offset="100%" stopColor="#d97706" />
                </linearGradient>
              </defs>

              {/* Main Ticket Base with Sharp 90° Corners & Side Notches */}
              <path
                d="M 16 12 L 444 12 L 444 32 A 5 5 0 0 0 444 44 L 444 54 A 5 5 0 0 0 444 66 L 444 90 A 25 25 0 0 0 444 140 L 444 164 A 5 5 0 0 0 444 176 L 444 186 A 5 5 0 0 0 444 198 L 444 218 L 16 218 L 16 198 A 5 5 0 0 0 16 186 L 16 176 A 5 5 0 0 0 16 164 L 16 140 A 25 25 0 0 0 16 90 L 16 66 A 5 5 0 0 0 16 54 L 16 44 A 5 5 0 0 0 16 32 L 16 12 Z"
                fill="url(#navyTicketGrad)"
              />

              {/* Inner Luxury Gold Border with Sharp 90° Corners (Curves only Around Notches) */}
              <path
                d="M 34 26 L 426 26 L 426 84 A 26 26 0 0 0 426 146 L 426 204 L 34 204 L 34 146 A 26 26 0 0 0 34 84 L 34 26 Z"
                fill="none"
                stroke="url(#goldTicketGrad)"
                strokeWidth="3.5"
              />
            </svg>

            {/* Centered Golden & White Typography Inside Ticket Frame */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center z-10 px-8 sm:px-12 py-3">
              <div className="space-y-1">
                <span className="inline-block text-[10px] sm:text-[11px] font-black tracking-widest text-[#ffd700] uppercase drop-shadow-sm">
                  {t("coupon.vip_pass")}
                </span>

                <h4 className="text-2xl sm:text-3xl font-black text-white tracking-tight uppercase leading-none drop-shadow-md">
                  {t("coupon.title")}
                </h4>

                <p className="text-xs sm:text-sm font-bold text-slate-200 mt-1">
                  {t("coupon.subtitle")}{" "}
                  <span className="text-[#ffd700] text-base sm:text-lg font-black">{activePackage.friendCouponsLeft}</span> {t("coupon.passes")}
                </p>

                <div className="pt-1">
                  <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-black text-[#ffd700] underline underline-offset-4 decoration-[#ffd700]/70 hover:text-[#ffe55b]">
                    <span>{t("coupon.open")}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════
            3. ACTION BUTTON: RENEW / BUY PACKAGE
        ═══════════════════════════════════════════════ */}
        <section>
          <Link
            href="/#packages"
            className="w-full btn-gold py-4 px-6 rounded-2xl text-center font-extrabold text-sm sm:text-base flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all cursor-pointer"
          >
            <CreditCard className="w-5 h-5" />
            <span>{t("action.renew")}</span>
          </Link>
        </section>

        {/* ═══════════════════════════════════════════════
            4. MEMBER PERSONAL DETAILS (White Card on Gray with Profile Photo)
        ═══════════════════════════════════════════════ */}
        <section className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4 text-xs">
          {/* Header Row: Member Avatar Profile Image + Name & Verified Badge */}
          <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
            <div className="flex items-center gap-3">
              {/* Member Avatar Photo */}
              <div className="relative w-13 h-13 rounded-full overflow-hidden bg-gradient-to-br from-[#003087] via-[#0052cc] to-[#001f5c] border-2 border-white shadow-sm ring-2 ring-slate-100 flex items-center justify-center shrink-0">
                {member.avatarUrl ? (
                  <Image
                    src={member.avatarUrl}
                    alt={member.fullName}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <span className="text-base font-black text-white">
                    {member.fullName ? member.fullName.charAt(0) : "ส"}
                  </span>
                )}
              </div>

              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="font-extrabold text-sm sm:text-base text-slate-900 leading-tight">
                    {member.fullName}
                  </h3>
                  <ShieldCheck className="w-4 h-4 text-[#003087] shrink-0" />
                </div>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  {t("details.code")} <span className="font-bold text-slate-700">{member.memberCode}</span>
                </p>
              </div>
            </div>

            <span className="text-[11px] text-emerald-600 flex items-center gap-1 font-bold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" /> {t("details.verified")}
            </span>
          </div>

          <div className="space-y-2.5 text-slate-600">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5 text-slate-400" /> {t("details.pkg_current")}
              </span>
              <span className="font-bold text-slate-900 text-right">
                {lang === "en" ? "BLU 07:00-22:00 (90 Days Pass)" : activePackage.name}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" /> {t("details.expire_date")}
              </span>
              <span className="font-bold text-[#003087]">
                {lang === "en" ? "12 Oct 2026" : activePackage.expireDate}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-slate-400" /> {t("details.phone")}
              </span>
              <span className="font-mono font-bold text-slate-900">
                {member.phone}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" /> {t("details.birthday")}
              </span>
              <span className="font-semibold text-slate-900">
                {(() => {
                  const day = member.birthDay || "15";
                  const month = member.birthMonth || "สิงหาคม";
                  const monthMapEn: Record<string, string> = {
                    "มกราคม": "January", "กุมภาพันธ์": "February", "มีนาคม": "March",
                    "เมษายน": "April", "พฤษภาคม": "May", "มิถุนายน": "June",
                    "กรกฎาคม": "July", "สิงหาคม": "August", "กันยายน": "September",
                    "ตุลาคม": "October", "พฤศจิกายน": "November", "ธันวาคม": "December"
                  };
                  return lang === "en" ? `${day} ${monthMapEn[month] || month}` : `${day} ${month}`;
                })()}
              </span>
            </div>
          </div>
        </section>

      </div>

      {/* ═══════════════════════════════════════════════
          FULLSCREEN QR CODE MODAL
      ═══════════════════════════════════════════════ */}
      {qrModalOpen && (
        <div
          onClick={() => setQrModalOpen(false)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-6 animate-in fade-in duration-200"
        >
          <button
            onClick={() => setQrModalOpen(false)}
            className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl p-8 text-center max-w-xs w-full shadow-2xl animate-in zoom-in-95 duration-150"
          >
            <div className="text-xs font-bold text-[#003087] uppercase tracking-wider mb-1">
              BLU FITNESS CHECK-IN
            </div>
            <div className="text-base font-bold text-[#0a1628] mb-4 truncate">
              {member.fullName}
            </div>

            <div className="inline-block p-4 bg-[#f8fafc] rounded-2xl border border-slate-200 shadow-inner">
              <QRCodeSVG
                value={member.memberCode || "BLU-1001"}
                size={230}
                level="H"
                marginSize={1}
              />
            </div>

            <div className="mt-4 font-mono font-black text-2xl text-[#003087] tracking-widest">
              {member.memberCode || "BLU-1001"}
            </div>

            <p className="text-xs text-slate-500 mt-2">
              {t("member.qr_instruction")}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
