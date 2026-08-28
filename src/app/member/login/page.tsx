"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock, Phone, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
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
    <main className="min-h-screen bg-[#0a1628] flex flex-col">
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
        <Link
          href="/"
          className="text-white/50 hover:text-white text-sm transition-colors"
        >
          กลับหน้าหลัก
        </Link>
      </header>

      {/* ─── Card ─── */}
      <div className="flex-1 flex items-start sm:items-center justify-center px-4 sm:px-5 py-6 sm:py-10">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-xl">
            <div className="text-center mb-6">
              <h1 className="text-2xl font-extrabold text-[#0a1628] mb-1.5">
                เข้าสู่ระบบสมาชิก
              </h1>
              <p className="text-sm text-[#64748b]">
                กรอกเบอร์มือถือและรหัสผ่านเพื่อเข้าใช้งาน
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              {/* Phone Input */}
              <div>
                <label className="block text-sm font-semibold text-[#334155] mb-1.5">
                  เบอร์มือถือ
                </label>
                <div className="relative">
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) =>
                      setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
                    }
                    placeholder="0XX-XXX-XXXX"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] text-[#0a1628] text-base font-semibold tracking-wider placeholder:text-[#cbd5e1] placeholder:tracking-normal placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[#003087] focus:border-transparent transition-all"
                    autoFocus
                    required
                  />
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              {/* Password Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-semibold text-[#334155]">
                    รหัสผ่าน / PIN
                  </label>
                  <button
                    type="button"
                    onClick={() => alert("ระบบกู้คืนรหัสผ่านด้วย OTP จะเปิดให้บริการเร็วๆ นี้")}
                    className="text-xs text-[#003087] hover:underline cursor-pointer"
                  >
                    ลืมรหัสผ่าน?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="กรอกรหัสผ่าน"
                    className="w-full pl-10 pr-10 py-3 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] text-[#0a1628] text-base placeholder:text-[#cbd5e1] focus:outline-none focus:ring-2 focus:ring-[#003087] focus:border-transparent transition-all"
                    required
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
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
                className="w-full py-2 rounded-lg text-xs font-semibold text-[#003087] bg-[#003087]/5 hover:bg-[#003087]/10 border border-[#003087]/20 transition-all cursor-pointer"
              >
                🔑 Auto-fill บัญชีทดสอบ (081-234-5678 / 123456)
              </button>

              <button
                type="submit"
                disabled={phone.length < 9 || !password || loading}
                className="w-full btn-gold py-3.5 rounded-xl text-base font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md"
              >
                {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
              </button>
            </form>

            <div className="text-center mt-6 pt-5 border-t border-slate-100">
              <span className="text-xs text-slate-500">ยังไม่ได้เป็นสมาชิก? </span>
              <Link
                href="/member/register"
                className="text-xs text-[#003087] font-bold hover:underline"
              >
                สมัครสมาชิกใหม่
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Footer ─── */}
      <footer className="text-center text-[11px] text-white/25 pb-6 px-5">
        © 2026 Blu Fitness Cha-am
      </footer>
    </main>
  );
}
