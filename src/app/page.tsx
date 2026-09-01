"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { User, LogOut } from "lucide-react";
import { getPackagesBySlot, type TimeSlot, type MockPackage } from "@/lib/mock-data";
import PaymentModal from "@/components/PaymentModal";
import LanguageToggle from "@/components/LanguageToggle";
import { useLanguage } from "@/context/LanguageContext";

function formatPrice(price: number) {
  return price.toLocaleString("th-TH");
}

export default function Home() {
  const { t, lang } = useLanguage();
  const [activeSlot, setActiveSlot] = useState<TimeSlot>("07:00-22:00");
  const [selectedPackage, setSelectedPackage] = useState<MockPackage | null>(null);
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
    } catch (e) { }
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
    <main className="min-h-screen bg-white text-blu-dark">
      {/* ═══════════════════════════════════════════════
          NAVBAR
      ═══════════════════════════════════════════════ */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-blu-dark/95 backdrop-blur-md border-b border-blu-navy/40">
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

          <div className="flex items-center gap-2.5 sm:gap-4">
            <LanguageToggle variant="dark" />

            {member ? (
              <div className="relative" ref={menuRef}>
                {/* Circular Avatar Only */}
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="relative w-10 h-10 rounded-full overflow-hidden border-2 border-blu-yellow bg-blu-slate flex items-center justify-center text-sm font-bold text-blu-yellow hover:scale-105 transition-transform shadow-md focus:outline-none cursor-pointer"
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
                  <div className="absolute right-0 mt-2.5 w-56 rounded-2xl bg-white border border-blu-sky/40 shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150 ring-1 ring-blu-dark/5">
                    {/* 1. Name */}
                    <div className="px-4 py-3 bg-blu-ice/60 border-b border-blu-sky/30">
                      <div className="text-sm font-bold text-blu-dark truncate">
                        {member.fullName || "สมาชิก"}
                      </div>
                      {member.phone && (
                        <div className="text-xs text-blu-steel font-mono mt-0.5">
                          {member.phone}
                        </div>
                      )}
                    </div>

                    {/* 2. My Account */}
                    <div className="p-1.5">
                      <Link
                        href="/member"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-blu-dark hover:text-blu-slate hover:bg-blu-ice transition-colors"
                      >
                        <User className="w-4 h-4 text-blu-slate" />
                        <span>{t("nav.my_account")}</span>
                      </Link>
                    </div>

                    {/* 3. Logout */}
                    <div className="p-1.5 border-t border-blu-sky/20">
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors text-left cursor-pointer"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>{t("nav.logout")}</span>
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
                  {t("nav.login")}
                </Link>
                <Link
                  href="/member/register"
                  className="btn-gold px-3.5 py-1.5 sm:px-5 sm:py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm"
                >
                  {t("nav.register")}
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
        <div className="absolute inset-0 bg-gradient-to-t from-blu-dark via-blu-dark/70 to-transparent sm:hidden" />
        <div className="absolute inset-0 hidden sm:block hero-overlay" />

        <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-6 w-full">
          <div className="max-w-xl space-y-5 sm:space-y-6">
            <div className="inline-block px-3.5 py-1.5 bg-blu-yellow text-blu-dark text-xs font-extrabold rounded tracking-wider uppercase shadow-sm">
              {t("hero.badge")}
            </div>

            <h1 className="text-[2.5rem] leading-[1.15] sm:text-5xl lg:text-6xl font-black text-white tracking-tight">
              {t("hero.title1")}
              <br />
              <span className="text-blu-yellow">{t("hero.title2")}</span>
              <br />
              {t("hero.title3")}
            </h1>

            <p className="text-white/85 text-base sm:text-lg leading-relaxed max-w-md">
              {t("hero.subtitle")}{" "}
              <span className="text-blu-yellow font-bold">{t("hero.price_start")}</span>
            </p>

            <div className="flex flex-row items-center gap-3.5 sm:gap-4 pt-2 w-full max-w-md">
              <Link
                href="/member/register"
                className="btn-gold flex-1 sm:flex-initial px-6 py-3.5 sm:px-8 rounded-xl text-center text-sm sm:text-base font-bold shadow-md whitespace-nowrap flex items-center justify-center"
              >
                {t("hero.btn_register")}
              </Link>
              <a
                href="#packages"
                className="flex-1 sm:flex-initial px-6 py-3.5 sm:px-8 rounded-xl text-center text-sm sm:text-base font-semibold text-white border border-white/30 hover:bg-white/10 transition-all backdrop-blur-xs whitespace-nowrap flex items-center justify-center"
              >
                {t("hero.btn_packages")}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          HIGHLIGHTS — Always 3-col
      ═══════════════════════════════════════════════ */}
      <section className="bg-blu-dark text-white border-b border-blu-navy/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-7 sm:py-12 grid grid-cols-3 text-center">
          <div className="border-r border-blu-navy/60 px-2">
            <div className="text-xl sm:text-3xl font-black text-blu-yellow mb-1">{t("highlight.hours")}</div>
            <div className="text-[11px] sm:text-sm text-blu-sky font-medium">{t("highlight.hours_sub")}</div>
          </div>
          <div className="border-r border-blu-navy/60 px-2">
            <div className="text-xl sm:text-3xl font-black text-blu-yellow mb-1">{t("highlight.price")}</div>
            <div className="text-[11px] sm:text-sm text-blu-sky font-medium">{t("highlight.price_sub")}</div>
          </div>
          <div className="px-2">
            <div className="text-xl sm:text-3xl font-black text-blu-yellow mb-1">{t("highlight.equip")}</div>
            <div className="text-[11px] sm:text-sm text-blu-sky font-medium">{t("highlight.equip_sub")}</div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          PACKAGES — with time slot toggle
      ═══════════════════════════════════════════════ */}
      <section id="packages" className="scroll-mt-20 bg-blu-ice">
        <div className="max-w-7xl mx-auto px-5 py-16 sm:py-20">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-blu-dark tracking-tight">
              {t("pkg.title")}
            </h2>
            <p className="text-blu-steel text-sm sm:text-base mt-3 max-w-lg mx-auto">
              {t("pkg.subtitle")}
            </p>

            {/* Time Slot Toggle */}
            <div className="mt-6 inline-flex items-center bg-white rounded-xl p-1.5 shadow-sm border border-blu-sky/60">
              <button
                onClick={() => setActiveSlot("07:00-14:00")}
                className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all cursor-pointer ${activeSlot === "07:00-14:00"
                  ? "bg-blu-slate text-white shadow-md"
                  : "text-blu-steel hover:text-blu-dark"
                  }`}
              >
                {t("pkg.offpeak")}
              </button>
              <button
                onClick={() => setActiveSlot("07:00-22:00")}
                className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all cursor-pointer ${activeSlot === "07:00-22:00"
                  ? "bg-blu-slate text-white shadow-md"
                  : "text-blu-steel hover:text-blu-dark"
                  }`}
              >
                {t("pkg.allday")}
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

              const durationText =
                lang === "en"
                  ? pkg.durationDays === 1
                    ? "1 Day Pass"
                    : pkg.durationDays === 30
                      ? "1 Month Pass"
                      : pkg.durationDays === 90
                        ? "3 Months Pass"
                        : pkg.durationDays === 180
                          ? "6 Months Pass"
                          : pkg.durationDays === 365
                            ? "1 Year Pass"
                            : `${pkg.durationDays} Days Pass`
                  : pkg.label;

              return (
                <div
                  key={pkg.id}
                  className={`relative bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-shadow flex flex-col justify-between ${isLast
                    ? "ring-2 ring-blu-yellow"
                    : isDaily
                      ? "ring-1 ring-blu-ocean/40 border border-blu-sky/40"
                      : "ring-2 ring-blu-slate"
                    }`}
                >
                  {/* Top Badge */}
                  <div
                    className={`text-center py-1.5 text-xs font-bold tracking-wider uppercase ${isLast
                      ? "bg-blu-yellow text-blu-dark"
                      : isDaily
                        ? "bg-blu-steel text-white"
                        : "bg-blu-slate text-white"
                      }`}
                  >
                    {isLast ? t("pkg.badge_best") : isDaily ? t("pkg.badge_general") : t("pkg.badge_popular")}
                  </div>

                  <div className="p-5 flex flex-col flex-1 justify-between text-center space-y-4">
                    {/* 1. Duration & Time Slot */}
                    <div>
                      <div className="text-xl font-black text-blu-dark tracking-tight">
                        {durationText}
                      </div>
                      <div className="text-xs text-blu-steel font-medium mt-1">
                        {pkg.timeSlot}
                      </div>
                    </div>

                    {/* 2. Price Section */}
                    <div className="py-3.5 px-3 bg-blu-ice/60 rounded-xl border border-blu-sky/40">
                      <div className="text-3xl font-black text-blu-dark tracking-tight">
                        ฿{formatPrice(pkg.price)}
                      </div>
                      {pricePerDay ? (
                        <div className="text-[11px] text-blu-steel font-medium mt-1">
                          {t("pkg.per_day")} {pricePerDay} {t("pkg.baht")}
                        </div>
                      ) : (
                        <div className="text-[11px] text-blu-steel font-medium mt-1">
                          {t("pkg.per_time")}
                        </div>
                      )}
                    </div>

                    {/* 3. Select CTA Button */}
                    <button
                      type="button"
                      onClick={() => setSelectedPackage(pkg)}
                      className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer shadow-xs ${isLast
                        ? "btn-gold"
                        : isDaily
                          ? "bg-blu-steel hover:bg-blu-slate text-white"
                          : "btn-blue"
                        }`}
                    >
                      {t("pkg.btn_select")}
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
            <h2 className="text-3xl sm:text-4xl font-extrabold text-blu-dark tracking-tight">
              {t("gym.title")}
            </h2>
            <p className="text-blu-steel text-sm sm:text-base mt-3">
              {t("gym.subtitle")}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-blu-ice border border-blu-sky/30">
              <Image
                src="/bg1.jpg"
                alt="Gym Interior 1"
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover hover:scale-105 transition-transform duration-500"
              />
            </div>
            <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-blu-ice border border-blu-sky/30">
              <Image
                src="/bg2.webp"
                alt="Gym Interior 2"
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover hover:scale-105 transition-transform duration-500"
              />
            </div>
            <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-blu-ice border border-blu-sky/30">
              <Image
                src="/bg3.jpg"
                alt="Gym Interior 3"
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
      <section className="bg-blu-navy">
        <div className="max-w-7xl mx-auto px-5 py-14 sm:py-16 flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left">
          <div>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-white">
              {t("cta.title")}
            </h3>
            <p className="text-blu-sky text-sm sm:text-base mt-2">
              {t("cta.subtitle")}
            </p>
          </div>
          <Link
            href="/member/register"
            className="btn-gold px-8 py-3.5 rounded-lg text-base shrink-0 font-extrabold"
          >
            {t("cta.btn")}
          </Link>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          FOOTER
      ═══════════════════════════════════════════════ */}
      <footer className="bg-blu-dark text-blu-sky/60 border-t border-blu-navy/80">
        <div className="max-w-7xl mx-auto px-5 py-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <Image
                src="/logo.jpg"
                alt="Blu Fitness"
                width={32}
                height={32}
                className="w-[32px] h-[32px] rounded-lg opacity-80 object-cover"
              />
              <div className="text-sm">
                <span className="text-white font-bold">BLU FITNESS</span>
                <span className="mx-2 text-blu-steel">·</span>
                <span className="text-blu-sky/80">{t("footer.location")}</span>
              </div>
            </div>

            <div className="text-xs text-blu-sky/80">
              <span>{t("footer.hours")}</span>
            </div>
          </div>

          <div className="border-t border-blu-navy/60 mt-8 pt-6 text-xs text-center text-blu-sky/40">
            {t("footer.rights")}
          </div>
        </div>
      </footer>

      {/* ═══════════════════════════════════════════════
          PAYMENT MODAL (PromptPay QR & Slip Verification)
      ═══════════════════════════════════════════════ */}
      <PaymentModal
        pkg={selectedPackage}
        isOpen={!!selectedPackage}
        onClose={() => setSelectedPackage(null)}
      />
    </main>
  );
}
