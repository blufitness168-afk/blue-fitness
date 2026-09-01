"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  ChevronLeft,
  X,
  Calendar,
  Phone,
  CreditCard,
  CheckCircle2,
  Clock,
  LogOut,
  ArrowRight,
  ShieldCheck,
  HeartHandshake,
  Tag,
  Copy,
  Check,
  Ticket,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import LanguageToggle from "@/components/LanguageToggle";
import { useLanguage } from "@/context/LanguageContext";
import { MemberProfile, defaultMockMember } from "@/lib/mock-data";

export default function MemberDashboardPage() {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const [member, setMember] = useState<MemberProfile | null>(null);

  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [showAllCoupons, setShowAllCoupons] = useState(false);
  const [showAllPromos, setShowAllPromos] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleCopyPromo = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // 🛡️ Live Anti-Fraud Countdown Timer (Ticks every 1s)
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  }>({ days: 45, hours: 14, minutes: 32, seconds: 45 });

  useEffect(() => {
    // 45 days, 14 hours, 32 mins, 45 seconds from now
    const target = new Date();
    target.setDate(target.getDate() + 45);
    target.setHours(target.getHours() + 14);
    target.setMinutes(target.getMinutes() + 32);
    target.setSeconds(target.getSeconds() + 45);

    const timer = setInterval(() => {
      const now = new Date();
      const diff = target.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / (1000 * 60)) % 60);
      const seconds = Math.floor((diff / 1000) % 60);

      setTimeLeft({ days, hours, minutes, seconds });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("blu_member");
      if (saved) {
        setMember(JSON.parse(saved));
      } else {
        setMember(defaultMockMember);
      }
    } catch (e) { }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("blu_member");
    router.push("/");
  };

  if (!member) {
    return (
      <div className="min-h-screen bg-blu-ice flex items-center justify-center text-blu-dark">
        <div className="w-8 h-8 border-3 border-blu-slate border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Active package details
  const activePackage = {
    name: "BLU 07:00-22:00 (ราย 3 เดือน)",
    timeSlot: "07:00 - 22:00 น.",
    usedDays: 45,
    totalDays: 90,
    daysLeft: 45,
    expireDate: "12 ต.ค. 2026",
    friendCouponsLeft: 5,
  };

  return (
    <main className="min-h-screen bg-blu-ice text-blu-dark pb-16">
      {/* ═══════════════════════════════════════════════
          NAVBAR (Light Glass on Gray Background)
      ═══════════════════════════════════════════════ */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-blu-sky/40 shadow-xs">
        <div className="max-w-2xl mx-auto px-4 h-15 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-blu-steel hover:text-blu-dark transition-colors font-medium"
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
            <span className="font-extrabold tracking-wider text-sm text-blu-dark">
              BLU FITNESS
            </span>
          </div>

          <div className="flex items-center gap-2">
            <LanguageToggle variant="light" />
            <button
              onClick={handleLogout}
              title={t("nav.logout")}
              className="text-xs text-blu-steel hover:text-rose-600 flex items-center gap-1 transition-colors cursor-pointer font-medium p-1"
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
          {/* Card Body */}
          <div className="relative aspect-[1.58/1] w-full bg-white rounded-2xl overflow-hidden border border-blu-sky/40 shadow-lg flex select-none">

            {/* ── Left Edge Animated Live Blue/Gold Shimmer Accent (Anti-Fraud Downward Flow) ── */}
            <div className="absolute inset-y-0 left-0 w-2.5 sm:w-3 bg-[linear-gradient(180deg,_#0c3756_0%,_#3a728e_20%,_#ffd700_50%,_#3a728e_80%,_#0c3756_100%)] animate-flow-down rounded-l-2xl z-20 shadow-xs" />

            {/* ── Left 58%: White & Stacked Large Logo & Clean Single-Line Fields ── */}
            <div className="flex-1 pl-6 pr-3 py-3.5 sm:pl-8 sm:pr-4 sm:py-4 flex flex-col justify-between relative bg-white">

              {/* Stacked Large Brand Logo */}
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
                  <div className="text-4xl sm:text-5xl font-black tracking-tight text-blu-slate leading-none drop-shadow-xs">
                    BLU
                  </div>
                  <div className="text-sm sm:text-base font-black tracking-[0.24em] text-blu-dark uppercase mt-0.5">
                    FITNESS
                  </div>
                </div>
              </div>

              {/* Member & Date Underlined Fields */}
              <div className="space-y-2 sm:space-y-2.5 z-10">
                {/* Member Name (1 Line) */}
                <div>
                  <div className="flex items-baseline gap-1.5 text-xs sm:text-sm whitespace-nowrap">
                    <span className="font-extrabold text-blu-dark shrink-0">{t("member.member_label")}:</span>
                    <span className="font-black text-blu-slate truncate">
                      {member.fullName}
                    </span>
                  </div>
                  <div className="h-[1.5px] bg-blu-slate w-full mt-0.5 opacity-80" />
                </div>

                {/* Date (1 Line with Live Ticking Seconds & Pulsing Dot) */}
                <div>
                  <div className="flex items-baseline justify-between text-xs sm:text-sm whitespace-nowrap gap-1">
                    <div className="flex items-baseline gap-1">
                      <span className="font-extrabold text-blu-dark shrink-0">{t("member.date_label")}:</span>
                      <span className="font-black text-blu-slate font-mono">
                        {activePackage.usedDays}/{activePackage.totalDays} {t("member.days_unit")}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] sm:text-[11px] text-emerald-600 font-extrabold shrink-0 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-200">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                      </span>
                      <span className="font-mono">
                        {lang === "en"
                          ? `${timeLeft.days}d ${String(timeLeft.hours).padStart(2, "0")}:${String(timeLeft.minutes).padStart(2, "0")}:${String(timeLeft.seconds).padStart(2, "0")}`
                          : `${timeLeft.days}วัน ${String(timeLeft.hours).padStart(2, "0")}:${String(timeLeft.minutes).padStart(2, "0")}:${String(timeLeft.seconds).padStart(2, "0")}`}
                      </span>
                    </div>
                  </div>
                  <div className="h-[1.5px] bg-blu-slate w-full mt-0.5 opacity-80" />
                </div>
              </div>
            </div>

            {/* ── Right 40%: Metallic Deep Blue Tab (Subtle Diagonal Metallic Sheen & Pure QR) ── */}
            <div
              onClick={() => setQrModalOpen(true)}
              className="w-[40%] bg-[linear-gradient(135deg,_#0c3756_0%,_#1f5372_30%,_#3a728e_50%,_#1f5372_70%,_#0c3756_100%)] p-3 sm:p-4 flex flex-col items-center justify-center text-center text-white relative cursor-pointer hover:brightness-110 transition-all border-l border-blu-slate"
              title="แตะเพื่อขยาย QR Code"
            >
              {/* Direct QR Code with Transparent Background (Printed on Blue Metal) */}
              <div className="transition-transform hover:scale-105 z-10">
                <QRCodeSVG
                  value={member.memberCode || "BLU-1001"}
                  size={150}
                  level="H"
                  bgColor="transparent"
                  fgColor="#0c3756"
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
        <section className="bg-gradient-to-br from-blu-dark via-blu-navy to-blu-dark text-white rounded-none p-5 border-2 border-blu-yellow/50 shadow-xl space-y-4 relative overflow-hidden">
          {/* Header Row: BLU POINT (Gold) & Total Points Summary (Right) */}
          <div className="flex items-center justify-between pb-3.5 border-b border-white/15">
            <h3 className="text-base sm:text-lg font-black tracking-wider text-blu-yellow uppercase">
              {t("points.title")}
            </h3>
            <div className="font-mono font-black text-sm sm:text-base">
              <span className="text-blu-yellow text-xl sm:text-2xl font-black">{member.points ?? 35}</span>
              <span className="text-blu-sky/80 font-bold ml-1">{t("points.of_100")}</span>
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
                      ? "bg-blu-yellow/15 border-2 border-blu-yellow shadow-[0_0_12px_rgba(255,215,0,0.25)]"
                      : fill > 0
                        ? "bg-white/10 border border-blu-yellow/70"
                        : "bg-white/5 border border-white/10"
                    }`}
                >
                  <span className={`absolute top-1 left-1.5 text-[8px] sm:text-[9px] font-mono font-bold ${fill > 0 ? "text-blu-yellow" : "text-white/30"
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
                        <stop offset={`${fill}%`} stopColor="#3a728e" />
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
            <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-blu-yellow hover:text-[#ffe55b] transition-colors underline underline-offset-4 decoration-blu-yellow/70 cursor-pointer select-none">
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
                  <stop offset="0%" stopColor="#1f5372" />
                  <stop offset="50%" stopColor="#0c3756" />
                  <stop offset="100%" stopColor="#061c2d" />
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
                <span className="inline-block text-[10px] sm:text-[11px] font-black tracking-widest text-blu-yellow uppercase drop-shadow-sm">
                  {t("coupon.vip_pass")}
                </span>

                <h4 className="text-2xl sm:text-3xl font-black text-white tracking-tight uppercase leading-none drop-shadow-md">
                  {t("coupon.title")}
                </h4>

                <p className="text-xs sm:text-sm font-bold text-blu-sky mt-1">
                  {t("coupon.subtitle")}{" "}
                  <span className="text-blu-yellow text-base sm:text-lg font-black">
                    {member.coupons?.friend_pass?.remaining ?? 5}
                  </span>{" "}
                  {t("coupon.passes")}
                </p>

                <div className="pt-1">
                  <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-black text-blu-yellow underline underline-offset-4 decoration-blu-yellow/70 hover:text-[#ffe55b]">
                    <span>{t("coupon.open")}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Button / Toggle: Show All Coupons */}
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={() => setShowAllCoupons(!showAllCoupons)}
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-blu-slate hover:text-blu-dark transition-colors cursor-pointer select-none"
            >
              <span>{showAllCoupons ? t("coupon.show_less") : t("coupon.show_all")}</span>
              {showAllCoupons ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {/* None State (When Show All is expanded) */}
          {showAllCoupons && (
            <div className="mt-3 p-4 rounded-2xl bg-white/90 border-2 border-dashed border-blu-sky/80 text-center text-xs text-blu-steel space-y-1 animate-in fade-in slide-in-from-top-2 duration-200 shadow-xs">
              <Ticket className="w-6 h-6 mx-auto text-blu-steel/50 mb-0.5" />
              <p className="font-bold text-blu-dark text-xs sm:text-sm">{t("coupon.none")}</p>
              <p className="text-[10px] text-blu-steel">
                {lang === "en" ? "Check back later for new member vouchers" : "รอติดตามคูปองและสิทธิพิเศษใหม่ๆ เร็วๆ นี้"}
              </p>
            </div>
          )}
        </section>

        {/* ═══════════════════════════════════════════════
            4. VIBRANT RUBY RED SCALLOPED STAMP DISCOUNT TAG (Anti-Screenshot Red Contrast)
        ═══════════════════════════════════════════════ */}
        <section>
          <div className="relative w-full max-w-md mx-auto hover:scale-[1.01] transition-transform select-none">
            {/* 100% True Transparent Vector Scalloped Stamp Tag Graphic */}
            <svg
              viewBox="0 0 460 220"
              className="w-full h-auto drop-shadow-xl"
            >
              <defs>
                {/* Vibrant Coral Ruby Red Gradient */}
                <linearGradient id="rubyStampGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ff2e63" />
                  <stop offset="50%" stopColor="#e11d48" />
                  <stop offset="100%" stopColor="#be123c" />
                </linearGradient>

                {/* Soft Gold/White Tag Accent */}
                <linearGradient id="whiteTagGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="100%" stopColor="#fef08a" />
                </linearGradient>
              </defs>

              {/* Scalloped Postage Stamp Border Base */}
              <path
                d="M 20 20 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 Z"
                fill="url(#rubyStampGrad)"
              />

              {/* Inner Dashed White Ticket Border */}
              <rect
                x="36"
                y="34"
                width="388"
                height="152"
                rx="14"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeDasharray="7 4"
                opacity="0.9"
              />

              {/* Top Tag Punch Hole */}
              <circle cx="230" cy="42" r="5" fill="#f0fcfe" stroke="white" strokeWidth="1.5" />
            </svg>

            {/* Typography & Code Box Inside Scalloped Tag */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center z-10 px-8 sm:px-12 py-2">
              <div className="space-y-1">
                {/* Limited Time Badge */}
                <div className="inline-flex items-center gap-1 bg-white/20 px-2.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-black tracking-widest text-white uppercase backdrop-blur-xs">
                  <span>✦ {lang === "en" ? "LIMITED TIME OFFER" : "ส่วนลดพิเศษจำกัดเวลา"} ✦</span>
                </div>

                {/* Big Discount Title */}
                <div className="flex items-center justify-center gap-2">
                  <span className="line-through text-white/60 text-xs sm:text-sm font-bold">฿1,000</span>
                  <h4 className="text-3xl sm:text-4xl font-black text-white tracking-tight uppercase leading-none drop-shadow-md">
                    {t("promo.title")}
                  </h4>
                </div>

                <p className="text-[11px] sm:text-xs font-bold text-white/90">
                  {t("promo.desc")}
                </p>

                {/* Promo Code Box + Copy CTA */}
                <div className="pt-1 flex items-center justify-center gap-2">
                  <div className="bg-white text-rose-600 px-3 py-1 rounded-lg flex items-center gap-1.5 font-mono font-black text-xs sm:text-sm tracking-wider shadow-md">
                    <Tag className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span>FITNESS10</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyPromo("FITNESS10")}
                    className="bg-blu-yellow hover:bg-[#ffe433] text-blu-dark px-3 py-1 rounded-lg text-xs font-black flex items-center gap-1 shadow-md hover:shadow-lg transition-all cursor-pointer"
                  >
                    {copiedCode === "FITNESS10" ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-800" />
                        <span>{t("promo.copied")}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-blu-dark" />
                        <span>{t("promo.copy")}</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="text-[10px] text-white/80 font-medium pt-0.5">
                  {t("promo.valid_thru")}
                </div>
              </div>
            </div>
          </div>

          {/* Second Scalloped Stamp Tag (BLU50 - 50 THB OFF) shown on Show All */}
          {showAllPromos && (
            <div className="relative w-full max-w-md mx-auto hover:scale-[1.01] transition-transform select-none mt-3.5 animate-in fade-in slide-in-from-top-2 duration-300">
              <svg
                viewBox="0 0 460 220"
                className="w-full h-auto drop-shadow-xl"
              >
                <defs>
                  {/* Sunset Amber-Crimson Gradient */}
                  <linearGradient id="amberRubyStampGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#f97316" />
                    <stop offset="50%" stopColor="#ea580c" />
                    <stop offset="100%" stopColor="#c2410c" />
                  </linearGradient>
                </defs>

                {/* Scalloped Postage Stamp Border Base */}
                <path
                  d="M 20 20 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 4 0 a 6 6 0 0 0 12 0 l 4 0 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l 0 4 a 6 6 0 0 0 0 12 l 0 4 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l -4 0 a 6 6 0 0 0 -12 0 l -4 0 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 l 0 -4 a 6 6 0 0 0 0 -12 l 0 -4 Z"
                  fill="url(#amberRubyStampGrad)"
                />

                {/* Inner Dashed White Ticket Border */}
                <rect
                  x="36"
                  y="34"
                  width="388"
                  height="152"
                  rx="14"
                  fill="none"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeDasharray="7 4"
                  opacity="0.9"
                />

                {/* Top Tag Punch Hole */}
                <circle cx="230" cy="42" r="5" fill="#f0fcfe" stroke="white" strokeWidth="1.5" />
              </svg>

              {/* Typography & Code Box Inside Scalloped Tag */}
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center z-10 px-8 sm:px-12 py-2">
                <div className="space-y-1">
                  {/* Limited Time Badge */}
                  <div className="inline-flex items-center gap-1 bg-white/20 px-2.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-black tracking-widest text-white uppercase backdrop-blur-xs">
                    <span>✦ {lang === "en" ? "ALL PASSES DISCOUNT" : "ส่วนลดพิเศษทุกแพ็กเกจ"} ✦</span>
                  </div>

                  {/* Big Discount Title */}
                  <div className="flex items-center justify-center gap-2">
                    <span className="line-through text-white/60 text-xs sm:text-sm font-bold">฿100</span>
                    <h4 className="text-3xl sm:text-4xl font-black text-white tracking-tight uppercase leading-none drop-shadow-md">
                      {t("promo.title_50")}
                    </h4>
                  </div>

                  <p className="text-[11px] sm:text-xs font-bold text-white/90">
                    {t("promo.desc_50")}
                  </p>

                  {/* Promo Code Box + Copy CTA */}
                  <div className="pt-1 flex items-center justify-center gap-2">
                    <div className="bg-white text-orange-600 px-3 py-1 rounded-lg flex items-center gap-1.5 font-mono font-black text-xs sm:text-sm tracking-wider shadow-md">
                      <Tag className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                      <span>BLU50</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyPromo("BLU50")}
                      className="bg-blu-yellow hover:bg-[#ffe433] text-blu-dark px-3 py-1 rounded-lg text-xs font-black flex items-center gap-1 shadow-md hover:shadow-lg transition-all cursor-pointer"
                    >
                      {copiedCode === "BLU50" ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-800" />
                          <span>{t("promo.copied")}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-blu-dark" />
                          <span>{t("promo.copy")}</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="text-[10px] text-white/80 font-medium pt-0.5">
                    {t("promo.valid_thru")}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Button / Toggle: Show All Discounts */}
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={() => setShowAllPromos(!showAllPromos)}
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-rose-600 hover:text-rose-800 transition-colors cursor-pointer select-none font-extrabold"
            >
              <span>{showAllPromos ? t("promo.show_less") : t("promo.show_all")}</span>
              {showAllPromos ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════
            5. ACTION BUTTON: RENEW / BUY PACKAGE
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
        <section className="bg-white rounded-2xl p-5 border border-blu-sky/40 shadow-sm space-y-4 text-xs">
          {/* Header Row: Member Avatar Profile Image + Name & Verified Badge */}
          <div className="flex items-center justify-between pb-3.5 border-b border-blu-sky/20">
            <div className="flex items-center gap-3">
              {/* Member Avatar Photo */}
              <div className="relative w-13 h-13 rounded-full overflow-hidden bg-gradient-to-br from-blu-slate via-blu-navy to-blu-dark border-2 border-white shadow-sm ring-2 ring-blu-sky/30 flex items-center justify-center shrink-0">
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
                  <h3 className="font-extrabold text-sm sm:text-base text-blu-dark leading-tight">
                    {member.fullName} {member.nickname && <span className="text-xs font-bold text-blu-slate">({member.nickname})</span>}
                  </h3>
                  <ShieldCheck className="w-4 h-4 text-blu-slate shrink-0" />
                </div>
                <p className="text-[11px] text-blu-steel font-mono mt-0.5">
                  {t("details.code")} <span className="font-bold text-blu-dark">{member.memberCode}</span>
                </p>
              </div>
            </div>

            <span className="text-[11px] text-emerald-600 flex items-center gap-1 font-bold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" /> {t("details.verified")}
            </span>
          </div>

          <div className="space-y-2.5 text-blu-steel">
            <div className="flex items-center justify-between">
              <span className="text-blu-steel flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5 text-blu-steel/70" /> {t("details.pkg_current")}
              </span>
              <span className="font-bold text-blu-dark text-right">
                {lang === "en" ? "BLU 07:00-22:00 (3 Months Pass)" : activePackage.name}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-blu-steel flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-blu-steel/70" /> {t("details.expire_date")}
              </span>
              <span className="font-bold text-blu-slate">
                {lang === "en" ? "12 Oct 2026" : activePackage.expireDate}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-blu-steel flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-blu-steel/70" /> {t("details.phone")}
              </span>
              <span className="font-mono font-bold text-blu-dark">
                {member.phone}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-blu-steel flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-blu-steel/70" /> {t("details.birthday")}
              </span>
              <span className="font-semibold text-blu-dark">
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

            {member.emergencyContact?.name && (
              <div className="flex items-center justify-between pt-1 border-t border-blu-sky/20">
                <span className="text-blu-steel flex items-center gap-1.5">
                  <HeartHandshake className="w-3.5 h-3.5 text-blu-steel/70" /> {t("details.emergency_contact")}
                </span>
                <span className="font-medium text-blu-dark text-right text-[11px]">
                  {member.emergencyContact.name}{" "}
                  {member.emergencyContact.relation && (
                    <span className="text-blu-steel">({member.emergencyContact.relation})</span>
                  )}{" "}
                  <span className="font-mono font-bold text-blu-dark">{member.emergencyContact.phone}</span>
                </span>
              </div>
            )}
          </div>
        </section>

      </div>

      {/* ═══════════════════════════════════════════════
          FULLSCREEN QR CODE MODAL
      ═══════════════════════════════════════════════ */}
      {qrModalOpen && (
        <div
          onClick={() => setQrModalOpen(false)}
          className="fixed inset-0 z-50 bg-blu-dark/90 backdrop-blur-md flex flex-col items-center justify-center p-6 animate-in fade-in duration-200"
        >
          <button
            onClick={() => setQrModalOpen(false)}
            className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl p-8 text-center max-w-xs w-full shadow-2xl animate-in zoom-in-95 duration-150 border border-blu-sky/40"
          >
            <div className="text-xs font-bold text-blu-slate uppercase tracking-wider mb-1">
              BLU FITNESS CHECK-IN
            </div>
            <div className="text-base font-bold text-blu-dark truncate">
              {member.fullName}
            </div>
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-emerald-600 font-bold mb-3">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="font-mono">
                LIVE: {timeLeft.days}d {String(timeLeft.hours).padStart(2, "0")}:{String(timeLeft.minutes).padStart(2, "0")}:{String(timeLeft.seconds).padStart(2, "0")}
              </span>
            </div>

            <div className="inline-block p-4 bg-blu-ice/60 rounded-2xl border border-blu-sky/40 shadow-inner">
              <QRCodeSVG
                value={member.memberCode || "BLU-1001"}
                size={230}
                level="H"
                marginSize={1}
              />
            </div>

            <div className="mt-4 font-mono font-black text-2xl text-blu-slate tracking-widest">
              {member.memberCode || "BLU-1001"}
            </div>

            <p className="text-xs text-blu-steel mt-2">
              {t("member.qr_instruction")}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
