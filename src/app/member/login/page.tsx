"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock, Phone, Eye, EyeOff } from "lucide-react";
import LanguageToggle from "@/components/LanguageToggle";
import { useLanguage } from "@/context/LanguageContext";

export default function LoginPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || !password) return;
    setLoading(true);
    setError("");

    await new Promise((r) => setTimeout(r, 600));

    // Check if there is registered member data in localStorage
    let savedMember: any = null;
    try {
      const stored = localStorage.getItem("blu_member");
      if (stored) savedMember = JSON.parse(stored);
    } catch (err) {}

    // Mock Login Success
    const memberData = savedMember || {
      phone,
      fullName: "สมชาย ใจดี",
      avatarUrl: "",
      memberCode: "BLU-1001",
      cardNumber: "CARD-8899",
      points: 25,
      status: "ACTIVE",
      registeredAt: new Date().toISOString(),
    };

    // Update session
    localStorage.setItem("blu_member", JSON.stringify({ ...memberData, phone }));

    setLoading(false);
    router.push("/");
  };

  const handleDemoFill = () => {
    setPhone("0812345678");
    setPassword("123456");
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
                  />
                  <Phone className="w-4 h-4 text-blu-steel absolute left-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              {/* Password Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-semibold text-blu-dark">
                    {t("login.password_label")}
                  </label>
                  <button
                    type="button"
                    onClick={() => alert("ระบบกู้คืนรหัสผ่านด้วย OTP จะเปิดให้บริการเร็วๆ นี้")}
                    className="text-xs text-blu-slate hover:underline cursor-pointer font-medium"
                  >
                    {t("login.forgot_pwd")}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("login.pwd_placeholder")}
                    className="w-full pl-10 pr-10 py-3 rounded-xl border border-blu-sky/50 bg-blu-ice/30 text-blu-dark text-base placeholder:text-blu-ocean/70 focus:outline-none focus:ring-2 focus:ring-blu-slate focus:border-transparent transition-all"
                    required
                  />
                  <Lock className="w-4 h-4 text-blu-steel absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-blu-steel hover:text-blu-dark cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-rose-50 text-rose-600 text-xs font-semibold">
                  {error}
                </div>
              )}

              {/* Demo Auto-fill Button */}
              <button
                type="button"
                onClick={handleDemoFill}
                className="w-full py-2 rounded-lg text-xs font-semibold text-blu-slate bg-blu-ice hover:bg-blu-sky/40 border border-blu-sky/60 transition-all cursor-pointer"
              >
                {t("login.demo_fill")}
              </button>

              <button
                type="submit"
                disabled={phone.length < 9 || !password || loading}
                className="w-full btn-gold py-3.5 rounded-xl text-base font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md"
              >
                {loading ? t("login.submitting") : t("login.btn_submit")}
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
