"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { LogOut, User, Gift, ShieldCheck } from "lucide-react";
import LanguageToggle from "@/components/LanguageToggle";
import { useLanguage } from "@/context/LanguageContext";

export type NavbarMember = {
  fullName?: string;
  avatarUrl?: string;
  phone?: string;
  role?: "MEMBER" | "ADMIN";
} | null;

export default function Navbar({
  member,
  onLogout,
}: {
  member: NavbarMember;
  onLogout: () => void;
}) {
  const { t } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-blu-dark/95 backdrop-blur-md border-b border-blu-navy/40">
      <div className="max-w-7xl mx-auto px-5 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
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
        </Link>

        <div className="flex items-center gap-2.5 sm:gap-4">
          <Link
            href="/member/rewards"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-white/80 hover:text-white hover:bg-white/5 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg transition-colors"
          >
            <Gift className="w-4 h-4 text-blu-yellow" />
            <span className="hidden sm:inline">{t("nav.rewards")}</span>
          </Link>

          <LanguageToggle variant="dark" />

          {member ? (
            <div className="relative" ref={menuRef}>
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

              {menuOpen && (
                <div className="absolute right-0 mt-2.5 w-56 rounded-2xl bg-white border border-blu-sky/40 shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150 ring-1 ring-blu-dark/5">
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

                  {member.role === "ADMIN" && (
                    <div className="p-1.5 border-t border-blu-sky/20">
                      <Link
                        href="/admin"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-blu-dark hover:text-blu-slate hover:bg-blu-ice transition-colors"
                      >
                        <ShieldCheck className="w-4 h-4 text-blu-yellow" />
                        <span>{t("nav.admin_panel")}</span>
                      </Link>
                    </div>
                  )}

                  <div className="p-1.5 border-t border-blu-sky/20">
                    <button
                      onClick={onLogout}
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
    </header>
  );
}
