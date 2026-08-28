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
} from "lucide-react";

export default function MemberDashboardPage() {
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
    } catch (e) {}
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("blu_member");
    router.push("/");
  };

  if (!member) {
    return (
      <div className="min-h-screen bg-[#0a1628] flex items-center justify-center text-white">
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
    <main className="min-h-screen bg-[#0a1628] text-white pb-16">
      {/* ═══════════════════════════════════════════════
          NAVBAR
      ═══════════════════════════════════════════════ */}
      <header className="sticky top-0 z-40 bg-[#0a1628]/95 backdrop-blur-md border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 h-15 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>หน้าหลัก</span>
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
            <span className="font-extrabold tracking-wider text-sm text-white">
              BLU FITNESS
            </span>
          </div>

          <button
            onClick={handleLogout}
            title="ออกจากระบบ"
            className="text-xs text-white/50 hover:text-rose-400 flex items-center gap-1 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">ออก</span>
          </button>
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
          {/* Card Body (Rounded-2xl, Direct White Card, Zero outer shadow) */}
          <div className="relative aspect-[1.58/1] w-full bg-white rounded-2xl overflow-hidden border border-slate-300 flex select-none">
            
            {/* ── Left 58%: White & Stacked Large Logo & Clean Single-Line Fields ── */}
            <div className="flex-1 p-4 sm:p-6 flex flex-col justify-between relative bg-white">
              
              {/* Stacked Large Brand Logo (Icon on top, BLU, FITNESS) */}
              <div className="flex flex-col items-start">
                <div className="relative w-32 h-32">
                  <Image
                    src="/logo.jpg"
                    alt="Blu Fitness Logo"
                    fill
                    sizes="320px"
                    className="object-contain"
                    priority
                  />
                </div>
                <div className="mt-1">
                  <div className="text-2xl sm:text-3xl font-black tracking-tight text-[#0047ba] leading-none">
                    BLU
                  </div>
                  <div className="text-[11px] sm:text-xs font-black tracking-[0.25em] text-[#0a1628] uppercase mt-0.5">
                    FITNESS
                  </div>
                </div>
              </div>

              {/* Member & Date Underlined Fields (Strictly 1 Line Each) */}
              <div className="space-y-2.5 z-10">
                {/* Member Name (1 Line) */}
                <div>
                  <div className="flex items-baseline gap-1.5 text-xs sm:text-sm whitespace-nowrap">
                    <span className="font-extrabold text-[#0a1628] shrink-0">Member:</span>
                    <span className="font-black text-[#0047ba] truncate">
                      {member.fullName}
                    </span>
                  </div>
                  <div className="h-[1.5px] bg-[#0047ba] w-full mt-0.5" />
                </div>

                {/* Date (1 Line) */}
                <div>
                  <div className="flex items-baseline justify-between text-xs sm:text-sm whitespace-nowrap gap-1">
                    <div className="flex items-baseline gap-1">
                      <span className="font-extrabold text-[#0a1628] shrink-0">Date:</span>
                      <span className="font-black text-[#0047ba] font-mono">
                        {activePackage.usedDays}/{activePackage.totalDays} วัน
                      </span>
                    </div>
                    <span className="text-[10px] sm:text-[11px] text-emerald-600 font-extrabold shrink-0">
                      (เหลือ {activePackage.daysLeft} วัน)
                    </span>
                  </div>
                  <div className="h-[1.5px] bg-[#0047ba] w-full mt-0.5" />
                </div>
              </div>
            </div>

            {/* ── Right 42%: Deep Metallic Blue Tab with Large QR ── */}
            <div
              onClick={() => setQrModalOpen(true)}
              className="w-[42%] bg-gradient-to-b from-[#0047ba] via-[#003087] to-[#001f5c] p-3 sm:p-4 flex flex-col items-center justify-center text-center text-white relative cursor-pointer hover:brightness-110 transition-all border-l border-[#003087]"
              title="แตะเพื่อขยาย QR Code"
            >
              {/* Large QR Code Container */}
              <div className="p-2 sm:p-2.5 bg-white rounded-lg shadow-sm transition-transform hover:scale-105 z-10">
                <QRCodeSVG
                  value={member.memberCode || "BLU-1001"}
                  size={140}
                  level="H"
                  marginSize={0}
                  className="w-22 h-22 sm:w-28 sm:h-28"
                />
              </div>

              {/* Member Code Below QR */}
              <div className="mt-2.5 z-10">
                <div className="font-mono font-black text-xs sm:text-sm tracking-wider text-[#ffd700]">
                  {member.memberCode || "BLU-1001"}
                </div>
                <span className="inline-flex items-center gap-1 text-[9px] sm:text-[10px] text-white/90 font-bold mt-0.5 whitespace-nowrap">
                  <Maximize2 className="w-2.5 h-2.5" /> แตะเพื่อขยาย
                </span>
              </div>
            </div>

          </div>
        </section>

        {/* ═══════════════════════════════════════════════
            2. PRIVILEGES DASHBOARD (2 BOXES)
        ═══════════════════════════════════════════════ */}
        <section className="grid grid-cols-2 gap-3.5">
          {/* Box 1: Points */}
          <div className="bg-[#0f2240] p-4 border border-white/10 flex flex-col justify-between shadow-md">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="w-8 h-8 bg-[#ffd700]/15 flex items-center justify-center text-[#ffd700] border border-[#ffd700]/30">
                  <Sparkles className="w-4 h-4" />
                </div>
                <span className="text-[10px] text-white/50 font-bold uppercase tracking-wider">
                  คะแนน
                </span>
              </div>
              <div className="text-2xl font-black text-white">
                {member.points ?? 25}
                <span className="text-xs text-white/60 font-normal ml-1">แต้ม</span>
              </div>
              <p className="text-[11px] text-white/50 mt-0.5">
                +1 แต้มทุกครั้งที่เช็คอิน
              </p>
            </div>

            <Link
              href="/member/rewards"
              className="mt-3 py-2 px-3 bg-white/10 hover:bg-white/15 text-xs font-semibold text-[#ffd700] flex items-center justify-between transition-colors border border-white/10"
            >
              <span>แลกของรางวัล</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {/* Box 2: Friend Pass Coupons */}
          <div className="bg-[#0f2240] p-4 border border-white/10 flex flex-col justify-between shadow-md">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="w-8 h-8 bg-sky-500/15 flex items-center justify-center text-sky-400 border border-sky-500/30">
                  <Ticket className="w-4 h-4" />
                </div>
                <span className="text-[10px] text-white/50 font-bold uppercase tracking-wider">
                  คูปอง
                </span>
              </div>
              <div className="text-2xl font-black text-white">
                {activePackage.friendCouponsLeft}
                <span className="text-xs text-white/60 font-normal ml-1">สิทธิ์</span>
              </div>
              <p className="text-[11px] text-white/50 mt-0.5">
                พาเพื่อนมาเล่นฟรี
              </p>
            </div>

            <Link
              href="/member/coupons"
              className="mt-3 py-2 px-3 bg-white/10 hover:bg-white/15 text-xs font-semibold text-sky-300 flex items-center justify-between transition-colors border border-white/10"
            >
              <span>เปิดคูปอง</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════
            3. ACTION BUTTON: RENEW / BUY PACKAGE
        ═══════════════════════════════════════════════ */}
        <section>
          <Link
            href="/member/packages"
            className="w-full btn-gold py-4 px-6 text-center font-extrabold text-sm sm:text-base flex items-center justify-center gap-2 shadow-lg hover:shadow-xl transition-all cursor-pointer border-2 border-[#ffd700]"
          >
            <CreditCard className="w-5 h-5" />
            <span>ซื้อแพ็กเกจ / ต่ออายุสมาชิก</span>
          </Link>
        </section>

        {/* ═══════════════════════════════════════════════
            4. MEMBER PERSONAL DETAILS
        ═══════════════════════════════════════════════ */}
        <section className="bg-[#0d1b3e]/80 p-5 border border-white/10 space-y-3 text-xs shadow-md">
          <div className="flex items-center justify-between pb-2.5 border-b border-white/10">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#ffd700]" />
              ข้อมูลสมาชิก
            </h3>
            <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" /> ยืนยันตัวตนแล้ว
            </span>
          </div>

          <div className="space-y-2.5 text-slate-300">
            <div className="flex items-center justify-between">
              <span className="text-white/50 flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5" /> แพ็กเกจปัจจุบัน
              </span>
              <span className="font-bold text-white text-right">
                {activePackage.name}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-white/50 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> วันหมดอายุ
              </span>
              <span className="font-semibold text-[#ffd700]">
                {activePackage.expireDate}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-white/50 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" /> เบอร์โทรศัพท์
              </span>
              <span className="font-mono font-bold text-white">
                {member.phone}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-white/50 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" /> วันเกิด
              </span>
              <span className="font-semibold text-white">
                {member.birthDay && member.birthMonth
                  ? `${member.birthDay} ${member.birthMonth}`
                  : "15 สิงหาคม"}
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
            className="absolute top-6 right-6 w-10 h-10 bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer border border-white/20"
          >
            <X className="w-5 h-5" />
          </button>

          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white p-8 text-center max-w-xs w-full shadow-2xl border-4 border-[#0047ba]"
          >
            <div className="text-xs font-black text-[#0047ba] uppercase tracking-wider mb-1">
              BLU FITNESS CHECK-IN
            </div>
            <div className="text-base font-bold text-[#0a1628] mb-4 truncate">
              {member.fullName}
            </div>

            <div className="inline-block p-4 bg-[#f8fafc] border-2 border-slate-200 shadow-inner">
              <QRCodeSVG
                value={member.memberCode || "BLU-1001"}
                size={230}
                level="H"
                marginSize={1}
              />
            </div>

            <div className="mt-4 font-mono font-black text-2xl text-[#0047ba] tracking-widest">
              {member.memberCode || "BLU-1001"}
            </div>

            <p className="text-xs text-slate-500 mt-2 font-medium">
              ยื่นหน้าจอนี้ให้พนักงานสแกนเช็คอิน
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
