"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { User, LogOut } from "lucide-react";
import { getPackagesBySlot, type TimeSlot } from "@/lib/mock-data";

function formatPrice(price: number) {
  return price.toLocaleString("th-TH");
}

export default function Home() {
  const [activeSlot, setActiveSlot] = useState<TimeSlot>("07:00-22:00");
  const [member, setMember] = useState<{
    fullName?: string;
    avatarUrl?: string;
    phone?: string;
  } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("blu_member");
      if (saved) {
        setMember(JSON.parse(saved));
      }
    } catch (e) {}
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("blu_member");
    setMember(null);
    setMenuOpen(false);
  };

  const packages = getPackagesBySlot(activeSlot);

  return (
    <main className="min-h-screen bg-white text-[#0f172a]">
      {/* ═══════════════════════════════════════════════
          NAVBAR
      ═══════════════════════════════════════════════ */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0a1628]/95 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.jpg"
              alt="Blu Fitness"
              width={38}
              height={38}
              className="w-[38px] h-[38px] rounded-lg object-cover"
              priority
            />
            <span className="text-white font-extrabold tracking-wider text-lg">
              BLU FITNESS
            </span>
          </div>

          <div className="flex items-center gap-3">
            {member ? (
              <div className="relative" ref={menuRef}>
                {/* Circular Avatar Only */}
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="relative w-10 h-10 rounded-full overflow-hidden border-2 border-[#ffd700] bg-[#003087] flex items-center justify-center text-sm font-bold text-[#ffd700] hover:scale-105 transition-transform shadow-md focus:outline-none cursor-pointer"
                  aria-label="User Menu"
                >
                  {member.avatarUrl ? (
                    <Image
                      src={member.avatarUrl}
                      alt={member.fullName || "Member"}
                      fill
                      sizes="40px"
                      className="object-cover"
                    />
                  ) : (
                    <span>{member.fullName ? member.fullName.slice(0, 1) : "👤"}</span>
                  )}
                </button>

                {/* Dropdown Menu (White Background, Clean 3-Item Layout) */}
                {menuOpen && (
                  <div className="absolute right-0 mt-2.5 w-56 rounded-2xl bg-white border border-slate-100 shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150 ring-1 ring-black/5">
                    {/* 1. Name */}
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
                      <div className="text-sm font-bold text-slate-800 truncate">
                        {member.fullName || "สมาชิก"}
                      </div>
                      {member.phone && (
                        <div className="text-xs text-slate-400 font-mono mt-0.5">
                          {member.phone}
                        </div>
                      )}
                    </div>

                    {/* 2. My Account */}
                    <div className="p-1.5">
                      <Link
                        href="/member"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 hover:text-[#003087] hover:bg-slate-50 transition-colors"
                      >
                        <User className="w-4 h-4 text-[#003087]" />
                        <span>My Account</span>
                      </Link>
                    </div>

                    {/* 3. Logout */}
                    <div className="p-1.5 border-t border-slate-100">
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors text-left cursor-pointer"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Logout</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 sm:gap-3">
                <Link
                  href="/member/login"
                  className="text-white/80 hover:text-white text-xs sm:text-sm font-semibold px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg hover:bg-white/5 transition-colors"
                >
                  เข้าสู่ระบบ
                </Link>
                <Link
                  href="/member/register"
                  className="btn-gold px-3.5 py-1.5 sm:px-5 sm:py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm"
                >
                  สมัครสมาชิก
                </Link>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* ═══════════════════════════════════════════════
          HERO — Mobile-First
      ═══════════════════════════════════════════════ */}
      <section className="relative min-h-[600px] sm:min-h-[550px] sm:h-[85vh] sm:max-h-[750px] flex items-end sm:items-center pb-12 sm:pb-0 pt-20">
        <Image
          src="/bg1.jpg"
          alt="Blu Fitness Gym"
          fill
          sizes="100vw"
          className="object-cover"
          priority
        />
        {/* Mobile: dark from bottom up / Desktop: dark from left */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a1628] via-[#0a1628]/65 to-transparent sm:hidden" />
        <div className="absolute inset-0 hidden sm:block hero-overlay" />

        <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-6 w-full">
          <div className="max-w-xl space-y-5 sm:space-y-6">
            <div className="inline-block px-3.5 py-1.5 bg-[#ffd700] text-[#0a1628] text-xs font-extrabold rounded tracking-wider uppercase shadow-sm">
              Blu Fitness — ชะอำ
            </div>

            <h1 className="text-[2.5rem] leading-[1.15] sm:text-5xl lg:text-6xl font-black text-white tracking-tight">
              เริ่มต้น
              <br />
              <span className="text-[#ffd700]">ชีวิตที่แข็งแกร่ง</span>
              <br />
              วันนี้
            </h1>

            <p className="text-white/80 text-base sm:text-lg leading-relaxed max-w-md">
              ฟิตเนสครบวงจร อุปกรณ์ครบครัน สมัครออนไลน์ เริ่มต้นเพียง{" "}
              <span className="text-[#ffd700] font-bold">฿90/วัน</span>
            </p>

            <div className="flex flex-row items-center gap-3.5 sm:gap-4 pt-2 w-full max-w-md">
              <Link
                href="/member/register"
                className="btn-gold flex-1 sm:flex-initial px-6 py-3.5 sm:px-8 rounded-xl text-center text-sm sm:text-base font-bold shadow-md whitespace-nowrap flex items-center justify-center"
              >
                สมัครสมาชิก
              </Link>
              <a
                href="#packages"
                className="flex-1 sm:flex-initial px-6 py-3.5 sm:px-8 rounded-xl text-center text-sm sm:text-base font-semibold text-white border border-white/30 hover:bg-white/10 transition-all backdrop-blur-xs whitespace-nowrap flex items-center justify-center"
              >
                ดูแพ็กเกจ
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          HIGHLIGHTS — Always 3-col
      ═══════════════════════════════════════════════ */}
      <section className="bg-[#0a1628] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-7 sm:py-12 grid grid-cols-3 text-center">
          <div className="border-r border-white/10 px-2">
            <div className="text-xl sm:text-3xl font-black text-[#ffd700] mb-1">07:00-22:00</div>
            <div className="text-[11px] sm:text-sm text-white/50 font-medium">เปิดทุกวัน</div>
          </div>
          <div className="border-r border-white/10 px-2">
            <div className="text-xl sm:text-3xl font-black text-[#ffd700] mb-1">฿90/วัน</div>
            <div className="text-[11px] sm:text-sm text-white/50 font-medium">เริ่มต้นเพียง</div>
          </div>
          <div className="px-2">
            <div className="text-xl sm:text-3xl font-black text-[#ffd700] mb-1">ครบครัน</div>
            <div className="text-[11px] sm:text-sm text-white/50 font-medium">อุปกรณ์ทุกประเภท</div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          PACKAGES — with time slot toggle
      ═══════════════════════════════════════════════ */}
      <section id="packages" className="scroll-mt-20 bg-[#f1f5f9]">
        <div className="max-w-7xl mx-auto px-5 py-16 sm:py-20">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#0a1628] tracking-tight">
              แพ็กเกจสมาชิก
            </h2>
            <p className="text-[#64748b] text-sm sm:text-base mt-3 max-w-lg mx-auto">
              เลือกช่วงเวลาและแพ็กเกจที่เหมาะกับคุณ — ยิ่งนาน ยิ่งคุ้ม
            </p>

            {/* Time Slot Toggle */}
            <div className="mt-6 inline-flex items-center bg-white rounded-xl p-1.5 shadow-sm border border-[#e2e8f0]">
              <button
                onClick={() => setActiveSlot("07:00-14:00")}
                className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${activeSlot === "07:00-14:00"
                  ? "bg-[#003087] text-white shadow-md"
                  : "text-[#64748b] hover:text-[#0a1628]"
                  }`}
              >
                07:00 - 14:00
              </button>
              <button
                onClick={() => setActiveSlot("07:00-22:00")}
                className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${activeSlot === "07:00-22:00"
                  ? "bg-[#003087] text-white shadow-md"
                  : "text-[#64748b] hover:text-[#0a1628]"
                  }`}
              >
                07:00 - 22:00
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {packages.map((pkg, index) => {
              const isLast = index === packages.length - 1;
              const isDaily = pkg.durationDays === 1;
              const pricePerDay =
                pkg.durationDays > 1
                  ? Math.round(pkg.price / pkg.durationDays)
                  : null;

              return (
                <div
                  key={pkg.id}
                  className={`relative bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-shadow flex flex-col ${isLast
                    ? "ring-2 ring-[#ffd700]"
                    : isDaily
                      ? "ring-1 ring-slate-300 border border-slate-200"
                      : "ring-2 ring-[#003087]"
                    }`}
                >
                  {/* Badge */}
                  <div
                    className={`text-center py-1.5 text-xs font-bold tracking-wider uppercase ${isLast
                      ? "bg-[#ffd700] text-[#0a1628]"
                      : isDaily
                        ? "bg-slate-500 text-white"
                        : "bg-[#003087] text-white"
                      }`}
                  >
                    {isLast ? "คุ้มที่สุด" : isDaily ? "ทั่วไป" : "ยอดนิยม"}
                  </div>

                  <div className="p-5 flex flex-col flex-1">
                    {/* Package Label */}
                    <div className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">
                      {pkg.label}
                    </div>

                    {/* Price */}
                    <div className="mb-1">
                      <span className="text-3xl font-black text-[#0a1628]">
                        ฿{formatPrice(pkg.price)}
                      </span>
                    </div>
                    {pricePerDay ? (
                      <div className="text-[11px] text-[#94a3b8] mb-5">
                        เฉลี่ยวันละ {pricePerDay} บาท
                      </div>
                    ) : (
                      <div className="text-[11px] text-[#94a3b8] mb-5">
                        ต่อครั้ง
                      </div>
                    )}

                    {/* Features */}
                    <ul className="space-y-2 flex-1 mb-5 text-sm text-[#334155]">
                      <li className="flex items-start gap-2">
                        <span className="text-[#003087] font-bold mt-0.5">✓</span>
                        ใช้งาน {pkg.label}
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-[#003087] font-bold mt-0.5">✓</span>
                        ช่วง {pkg.timeSlot} น.
                      </li>
                      {pkg.friendCoupons > 0 && (
                        <li className="flex items-start gap-2">
                          <span className="text-[#003087] font-bold mt-0.5">✓</span>
                          พาเพื่อนฟรี {pkg.friendCoupons} ครั้ง
                        </li>
                      )}
                      {pkg.bonusDays > 0 && (
                        <li className="flex items-start gap-2">
                          <span className="text-[#ffd700] font-bold mt-0.5">★</span>
                          <span className="text-[#003087] font-semibold">
                            ฟรี! +{pkg.bonusDays} วัน
                          </span>
                        </li>
                      )}
                    </ul>

                    {/* CTA */}
                    <button
                      className={`w-full py-2.5 rounded-lg text-sm font-bold transition-all ${isLast
                        ? "btn-gold"
                        : isDaily
                          ? "bg-slate-700 hover:bg-slate-800 text-white"
                          : "btn-blue"
                        }`}
                    >
                      เลือกแพ็กเกจนี้
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          GYM PHOTOS
      ═══════════════════════════════════════════════ */}
      <section className="bg-white">
        <div className="max-w-7xl mx-auto px-5 py-16 sm:py-20">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#0a1628] tracking-tight">
              ภายในฟิตเนส
            </h2>
            <p className="text-[#64748b] text-sm sm:text-base mt-3">
              อุปกรณ์ออกกำลังกายครบครัน พร้อมให้บริการ
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-[#e2e8f0]">
              <Image
                src="/bg1.jpg"
                alt="ภายในฟิตเนส 1"
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover hover:scale-105 transition-transform duration-500"
              />
            </div>
            <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-[#e2e8f0]">
              <Image
                src="/bg2.webp"
                alt="ภายในฟิตเนส 2"
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover hover:scale-105 transition-transform duration-500"
              />
            </div>
            <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-[#e2e8f0]">
              <Image
                src="/bg3.jpg"
                alt="ภายในฟิตเนส 3"
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover hover:scale-105 transition-transform duration-500"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          CTA BANNER
      ═══════════════════════════════════════════════ */}
      <section className="bg-[#003087]">
        <div className="max-w-7xl mx-auto px-5 py-14 sm:py-16 flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left">
          <div>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-white">
              พร้อมเริ่มแล้วหรือยัง?
            </h3>
            <p className="text-white/60 text-sm sm:text-base mt-2">
              สมัครสมาชิกวันนี้ รับสิทธิพิเศษทันที
            </p>
          </div>
          <Link
            href="/member/register"
            className="btn-gold px-8 py-3.5 rounded-lg text-base shrink-0"
          >
            สมัครสมาชิกเลย
          </Link>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          FOOTER
      ═══════════════════════════════════════════════ */}
      <footer className="bg-[#0a1628] text-white/50">
        <div className="max-w-7xl mx-auto px-5 py-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <Image
                src="/logo.jpg"
                alt="Blu Fitness"
                width={32}
                height={32}
                className="w-[32px] h-[32px] rounded-lg opacity-70 object-cover"
              />
              <div className="text-sm">
                <span className="text-white/80 font-bold">BLU FITNESS</span>
                <span className="mx-2">·</span>
                ชะอำ, เพชรบุรี
              </div>
            </div>

            <div className="text-xs text-white/60">
              <span>เปิดบริการทุกวัน 07:00 - 22:00 น.</span>
            </div>
          </div>

          <div className="border-t border-white/10 mt-8 pt-6 text-xs text-center text-white/30">
            © 2026 Blu Fitness Cha-am. All rights reserved.
          </div>
        </div>
      </footer>
    </main>
  );
}
