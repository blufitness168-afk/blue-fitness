"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { X, Eye, EyeOff, Lock } from "lucide-react";
import LanguageToggle from "@/components/LanguageToggle";
import { useLanguage } from "@/context/LanguageContext";

type Step = "phone" | "otp" | "register";

export default function RegisterPage() {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [fullName, setFullName] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  
  // Local preview state for avatar
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ──── Handlers ────

  const processFile = (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      alert("ไฟล์รูปต้องมีขนาดไม่เกิน 5MB / Max file size is 5MB");
      return;
    }
    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      processFile(file);
    }
  };

  const handleRemoveImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedFile(null);
    setPreviewUrl("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSendOtp = async () => {
    if (phone.length < 9) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    setLoading(false);
    setStep("otp");
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleAutoFillOtp = () => {
    const demoOtp = ["1", "2", "3", "4", "5", "6"];
    setOtp(demoOtp);
  };

  const handleVerifyOtp = async () => {
    const otpStr = otp.join("");
    if (otpStr.length !== 6) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 600));
    setLoading(false);
    setStep("register");
  };

  const handleRegister = async () => {
    if (!fullName.trim() || !birthDay || !birthMonth || !password) return;
    if (password !== confirmPassword) {
      alert("รหัสผ่านไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง / Passwords do not match");
      return;
    }
    setLoading(true);

    let finalAvatarUrl = "";
    if (selectedFile) {
      try {
        const formData = new FormData();
        formData.append("file", selectedFile);
        formData.append("folder", "blue-fitness/profiles");

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (data.success && data.url) {
          finalAvatarUrl = data.url;
        }
      } catch (err) {
        console.error("Cloudinary upload error:", err);
      }
    }

    const memberData = {
      phone,
      fullName,
      birthDay,
      birthMonth,
      password,
      avatarUrl: finalAvatarUrl || previewUrl || "",
      memberCode: "BLU-1001",
      cardNumber: "CARD-8899",
      points: 0,
      status: "ACTIVE",
      registeredAt: new Date().toISOString(),
    };

    if (typeof window !== "undefined") {
      localStorage.setItem("blu_member", JSON.stringify(memberData));
    }

    setLoading(false);
    router.push("/");
  };

  useEffect(() => {
    if (step === "otp") {
      otpRefs.current[0]?.focus();
    }
  }, [step]);

  const thaiMonths = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน",
    "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม",
    "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
  ];

  const englishMonths = [
    "January", "February", "March", "April",
    "May", "June", "July", "August",
    "September", "October", "November", "December",
  ];

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
        <div className="flex items-center gap-3">
          <LanguageToggle variant="dark" />
          <Link
            href="/"
            className="text-white/70 hover:text-white text-xs sm:text-sm transition-colors"
          >
            {t("login.back_home")}
          </Link>
        </div>
      </header>

      {/* ─── Card ─── */}
      <div className="flex-1 flex items-start sm:items-center justify-center px-4 sm:px-5 py-6 sm:py-10">
        <div className="w-full max-w-md">
          {/* Progress Steps */}
          <div className="flex items-center justify-center gap-2 mb-8">
            {(["phone", "otp", "register"] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    step === s
                      ? "bg-[#ffd700] text-[#0a1628] scale-110"
                      : i < ["phone", "otp", "register"].indexOf(step)
                        ? "bg-[#003087] text-white"
                        : "bg-white/10 text-white/40"
                  }`}
                >
                  {i + 1}
                </div>
                {i < 2 && (
                  <div
                    className={`w-10 sm:w-14 h-0.5 rounded-full ${
                      i < ["phone", "otp", "register"].indexOf(step)
                        ? "bg-[#003087]"
                        : "bg-white/10"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          {/* ═══════════════════════════════════════
              Step 1: Phone Number
          ═══════════════════════════════════════ */}
          {step === "phone" && (
            <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-xl">
              <div className="text-center mb-6">
                <h1 className="text-2xl font-extrabold text-[#0a1628] mb-2">
                  {t("reg.phone_title")}
                </h1>
                <p className="text-sm text-[#64748b]">
                  {t("reg.phone_sub")}
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-[#334155] mb-1.5">
                    {t("login.phone_label")}
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) =>
                      setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
                    }
                    placeholder="0XX-XXX-XXXX"
                    className="w-full px-4 py-3.5 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] text-[#0a1628] text-lg font-semibold tracking-widest placeholder:text-[#cbd5e1] placeholder:tracking-normal placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[#003087] focus:border-transparent transition-all"
                    autoFocus
                  />
                </div>

                <button
                  onClick={handleSendOtp}
                  disabled={phone.length < 9 || loading}
                  className="w-full btn-gold py-3.5 rounded-xl text-base font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loading ? "..." : t("reg.btn_send_otp")}
                </button>
              </div>

              <div className="text-center mt-6 pt-5 border-t border-slate-100">
                <span className="text-xs text-slate-500">{t("reg.have_account")} </span>
                <Link
                  href="/member/login"
                  className="text-xs text-[#003087] font-bold hover:underline"
                >
                  {t("reg.login_link")}
                </Link>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════
              Step 2: OTP Verification
          ═══════════════════════════════════════ */}
          {step === "otp" && (
            <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-xl">
              <div className="text-center mb-6">
                <h1 className="text-2xl font-extrabold text-[#0a1628] mb-2">
                  {t("reg.otp_title")}
                </h1>
                <p className="text-sm text-[#64748b]">
                  {t("reg.otp_sub")}{" "}
                  <span className="font-bold text-[#003087]">{phone}</span>
                </p>
              </div>

              {/* OTP Inputs */}
              <div className="flex justify-center gap-2 sm:gap-2.5 mb-5">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      otpRefs.current[i] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className="w-11 h-13 sm:w-13 sm:h-15 text-center text-2xl font-black text-[#0a1628] border-2 border-[#e2e8f0] rounded-xl bg-[#f8fafc] focus:outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/20 transition-all"
                  />
                ))}
              </div>

              {/* Auto-fill Demo Button */}
              <button
                onClick={handleAutoFillOtp}
                className="w-full mb-4 py-2 rounded-lg text-xs font-semibold text-[#003087] bg-[#003087]/5 hover:bg-[#003087]/10 border border-[#003087]/20 transition-all cursor-pointer"
              >
                {t("reg.otp_demo")}
              </button>

              <button
                onClick={handleVerifyOtp}
                disabled={otp.join("").length !== 6 || loading}
                className="w-full btn-gold py-3.5 rounded-xl text-base font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {loading ? "..." : t("reg.btn_verify_otp")}
              </button>

              <div className="flex items-center justify-between mt-5">
                <button
                  onClick={() => {
                    setStep("phone");
                    setOtp(["", "", "", "", "", ""]);
                  }}
                  className="text-xs text-[#64748b] hover:text-[#0a1628] transition-colors cursor-pointer"
                >
                  ← {lang === "en" ? "Change Number" : "เปลี่ยนเบอร์"}
                </button>
                <button className="text-xs text-[#003087] font-semibold hover:underline cursor-pointer">
                  {lang === "en" ? "Resend OTP" : "ส่ง OTP อีกครั้ง"}
                </button>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════
              Step 3: Registration Form & Set Password
          ═══════════════════════════════════════ */}
          {step === "register" && (
            <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-xl">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#003087]/10 text-[#003087] mb-2 font-bold text-xl">
                  ✓
                </div>
                <h1 className="text-2xl font-extrabold text-[#0a1628] mb-1">
                  {t("reg.profile_title")}
                </h1>
                <p className="text-xs text-[#64748b]">
                  {t("reg.profile_sub")}
                </p>
              </div>

              <div className="space-y-4">
                {/* Full Name */}
                <div>
                  <label className="block text-sm font-semibold text-[#334155] mb-1">
                    {t("reg.fullname_label")} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={t("reg.fullname_placeholder")}
                    className="w-full px-4 py-3 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] text-[#0a1628] text-sm sm:text-base placeholder:text-[#cbd5e1] focus:outline-none focus:ring-2 focus:ring-[#003087] focus:border-transparent transition-all"
                    autoFocus
                  />
                </div>

                {/* Birthday */}
                <div>
                  <label className="block text-sm font-semibold text-[#334155] mb-1">
                    {t("reg.bday_label")} <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <select
                      value={birthDay}
                      onChange={(e) => setBirthDay(e.target.value)}
                      required
                      className="px-3.5 py-3 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] text-[#0a1628] text-sm focus:outline-none focus:ring-2 focus:ring-[#003087] focus:border-transparent transition-all cursor-pointer"
                    >
                      <option value="">{t("reg.day_select")} *</option>
                      {Array.from({ length: 31 }, (_, i) => (
                        <option key={i + 1} value={String(i + 1)}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                    <select
                      value={birthMonth}
                      onChange={(e) => setBirthMonth(e.target.value)}
                      required
                      className="px-3.5 py-3 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] text-[#0a1628] text-sm focus:outline-none focus:ring-2 focus:ring-[#003087] focus:border-transparent transition-all cursor-pointer"
                    >
                      <option value="">{t("reg.month_select")} *</option>
                      {(lang === "en" ? englishMonths : thaiMonths).map((m, i) => (
                        <option key={i + 1} value={String(i + 1)}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Password / PIN */}
                <div>
                  <label className="block text-sm font-semibold text-[#334155] mb-1">
                    {t("reg.pwd_label")} <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("reg.pwd_placeholder")}
                      className="w-full pl-10 pr-10 py-3 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] text-[#0a1628] text-sm placeholder:text-[#cbd5e1] focus:outline-none focus:ring-2 focus:ring-[#003087] focus:border-transparent transition-all"
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

                {/* Confirm Password */}
                <div>
                  <label className="block text-sm font-semibold text-[#334155] mb-1">
                    {t("reg.confirm_pwd_label")} <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder={t("reg.confirm_pwd_placeholder")}
                      className={`w-full pl-10 pr-4 py-3 rounded-xl border bg-[#f8fafc] text-[#0a1628] text-sm placeholder:text-[#cbd5e1] focus:outline-none focus:ring-2 focus:ring-[#003087] focus:border-transparent transition-all ${
                        confirmPassword && password !== confirmPassword
                          ? "border-rose-400 focus:ring-rose-400"
                          : "border-[#e2e8f0]"
                      }`}
                    />
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  </div>
                  {confirmPassword && password !== confirmPassword && (
                    <p className="text-xs text-rose-500 mt-1">
                      {lang === "en" ? "Passwords do not match" : "รหัสผ่านไม่ตรงกัน"}
                    </p>
                  )}
                </div>

                {/* Profile Photo */}
                <div>
                  <label className="block text-sm font-semibold text-[#334155] mb-1">
                    {t("reg.avatar_label")}
                  </label>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept="image/*"
                    className="hidden"
                  />
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`relative flex items-center gap-4 p-3.5 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
                      isDragging
                        ? "border-[#ffd700] bg-[#ffd700]/10"
                        : "border-[#cbd5e1] bg-[#f8fafc] hover:border-[#003087]/40"
                    }`}
                  >
                    <div className="relative w-14 h-14 rounded-full bg-[#e2e8f0] flex items-center justify-center text-[#94a3b8] text-2xl shrink-0 overflow-visible border-2 border-dashed border-[#003087]/30">
                      {previewUrl ? (
                        <div className="relative w-full h-full rounded-full overflow-hidden">
                          <Image
                            src={previewUrl}
                            alt="Profile Preview"
                            fill
                            sizes="56px"
                            className="object-cover"
                          />
                        </div>
                      ) : (
                        "👤"
                      )}

                      {previewUrl && (
                        <button
                          type="button"
                          onClick={handleRemoveImage}
                          title="ลบรูปภาพ"
                          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow-md transition-transform hover:scale-110 z-10 cursor-pointer"
                        >
                          <X className="w-3 h-3 stroke-[3]" />
                        </button>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-bold text-[#003087]">
                        {previewUrl
                          ? (lang === "en" ? "Change Image" : "เปลี่ยนรูปภาพ")
                          : t("reg.avatar_drop")}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleRegister}
                  disabled={
                    !fullName.trim() ||
                    !birthDay ||
                    !birthMonth ||
                    !password ||
                    password !== confirmPassword ||
                    loading
                  }
                  className="w-full btn-gold py-3.5 rounded-xl text-base font-bold disabled:opacity-40 disabled:cursor-not-allowed mt-2 cursor-pointer shadow-md"
                >
                  {loading ? t("reg.submitting") : t("reg.btn_complete")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Footer ─── */}
      <footer className="text-center text-[11px] text-white/25 pb-6 px-5">
        © 2026 Blu Fitness Cha-am
      </footer>
    </main>
  );
}
