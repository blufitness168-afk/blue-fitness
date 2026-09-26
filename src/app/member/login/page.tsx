"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock, Phone } from "lucide-react";
import LanguageToggle from "@/components/LanguageToggle";
import { useLanguage } from "@/context/LanguageContext";

export default function LoginPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch(challengeId ? "/api/auth/verify" : "/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(challengeId ? { challengeId, code } : { phone }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "ไม่สามารถเข้าสู่ระบบได้");
      if (challengeId) {
        localStorage.removeItem("blu_member");
        router.push("/member");
        router.refresh();
      } else {
        setChallengeId(result.challengeId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "ไม่สามารถเข้าสู่ระบบได้");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-blu-dark flex flex-col">
      {/* ─── Header ─── */}
      <header className="px-5 pt-6 pb-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/logo.jpg"
            alt="Blu Fitness"
            width={34}
            height={34}
            className="w-[34px] h-[34px] rounded-lg object-cover"
            priority
          />
          <span className="text-white font-extrabold tracking-wider text-base">
            BLU FITNESS
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <LanguageToggle variant="dark" />
          <Link
            href="/"
            className="text-blu-sky/80 hover:text-white text-xs sm:text-sm transition-colors"
          >
            {t("login.back_home")}
          </Link>
        </div>
      </header>

      {/* ─── Card ─── */}
      <div className="flex-1 flex items-start sm:items-center justify-center px-4 sm:px-5 py-6 sm:py-10">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-xl border border-blu-sky/30">
            <div className="text-center mb-6">
              <h1 className="text-2xl font-extrabold text-blu-dark mb-1.5">
                {t("login.title")}
              </h1>
              <p className="text-sm text-blu-steel">
                {t("login.subtitle")}
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              {/* Phone Input */}
              <div>
                <label className="block text-sm font-semibold text-blu-dark mb-1.5">
                  {t("login.phone_label")}
                </label>
                <div className="relative">
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) =>
                      setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
                    }
                    placeholder="0XX-XXX-XXXX"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-blu-sky/50 bg-blu-ice/30 text-blu-dark text-base font-semibold tracking-wider placeholder:text-blu-ocean/70 placeholder:tracking-normal placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-blu-slate focus:border-transparent transition-all"
                    autoFocus
                    required
                    disabled={Boolean(challengeId)}
                  />
                  <Phone className="w-4 h-4 text-blu-steel absolute left-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              {challengeId && (
                <div>
                  <label className="block text-sm font-semibold text-blu-dark mb-1.5">รหัส OTP จาก SMS</label>
                  <div className="relative">
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="รหัส 6 หลัก"
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-blu-sky/50 bg-blu-ice/30 text-blu-dark text-base focus:outline-none focus:ring-2 focus:ring-blu-slate"
                      required
                    />
                    <Lock className="w-4 h-4 text-blu-steel absolute left-3.5 top-1/2 -translate-y-1/2" />
                  </div>
                  <button type="button" onClick={() => { setChallengeId(""); setCode(""); }} className="mt-2 text-xs text-blu-slate hover:underline">เปลี่ยนเบอร์ / ขอรหัสใหม่</button>
                </div>
              )}

              {error && (
                <div className="p-3 rounded-xl bg-rose-50 text-rose-600 text-xs font-semibold">
                  {error}
                </div>
              )}


              <button
                type="submit"
                disabled={phone.length !== 10 || (Boolean(challengeId) && code.length !== 6) || loading}
                className="w-full btn-gold py-3.5 rounded-xl text-base font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md"
              >
                {loading ? t("login.submitting") : challengeId ? "ยืนยัน OTP" : "รับรหัส OTP"}
              </button>
            </form>

            <div className="text-center mt-6 pt-5 border-t border-blu-sky/30">
              <span className="text-xs text-blu-steel">{t("login.no_account")} </span>
              <Link
                href="/member/register"
                className="text-xs text-blu-slate font-bold hover:underline"
              >
                {t("login.register_link")}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Footer ─── */}
      <footer className="text-center text-[11px] text-blu-sky/40 pb-6 px-5">
        © 2026 Blu Fitness Cha-am
      </footer>
    </main>
  );
}
