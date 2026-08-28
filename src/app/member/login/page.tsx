"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";

type Step = "phone" | "otp" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [fullName, setFullName] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  
  // Local preview state (upload occurs upon clicking submit)
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ──── Handlers ────

  const processFile = (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      alert("ไฟล์รูปต้องมีขนาดไม่เกิน 5MB");
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
    await new Promise((r) => setTimeout(r, 1200));
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
    await new Promise((r) => setTimeout(r, 800));
    setLoading(false);
    setStep("register");
  };

  const handleRegister = async () => {
    if (!fullName.trim() || !birthDay || !birthMonth) return;
    setLoading(true);

    let finalAvatarUrl = "";
    // Upload image to Cloudinary on form submit if selected
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
        console.error("Cloudinary upload error during registration:", err);
      }
    }

    // Save session in localStorage for demonstration
    const memberData = {
      phone,
      fullName,
      birthDay,
      birthMonth,
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
                  เข้าสู่ระบบ
                </h1>
                <p className="text-sm text-[#64748b]">
                  กรอกเบอร์มือถือเพื่อรับรหัส OTP
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-[#334155] mb-1.5">
                    เบอร์มือถือ
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
                  className="w-full btn-gold py-3.5 rounded-xl text-base font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loading ? "กำลังส่ง OTP..." : "ส่งรหัส OTP"}
                </button>
              </div>

              <p className="text-[11px] text-[#94a3b8] text-center mt-5 leading-relaxed">
                ระบบจะส่งรหัส OTP 6 หลักไปยังเบอร์มือถือของคุณ
                <br />
                ผ่าน ThaiBulkSMS
              </p>
            </div>
          )}

          {/* ═══════════════════════════════════════
              Step 2: OTP Verification
          ═══════════════════════════════════════ */}
          {step === "otp" && (
            <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-xl">
              <div className="text-center mb-6">
                <h1 className="text-2xl font-extrabold text-[#0a1628] mb-2">
                  ยืนยัน OTP
                </h1>
                <p className="text-sm text-[#64748b]">
                  กรอกรหัส 6 หลักที่ส่งไปยัง{" "}
                  <span className="font-bold text-[#003087]">{phone}</span>
                </p>
              </div>

              {/* OTP Inputs */}
              <div className="flex justify-center gap-2.5 sm:gap-3 mb-5">
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
                    className="w-12 h-14 sm:w-14 sm:h-16 text-center text-2xl font-black text-[#0a1628] border-2 border-[#e2e8f0] rounded-xl bg-[#f8fafc] focus:outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/20 transition-all"
                  />
                ))}
              </div>

              {/* Auto-fill Demo Button */}
              <button
                onClick={handleAutoFillOtp}
                className="w-full mb-4 py-2 rounded-lg text-xs font-semibold text-[#003087] bg-[#003087]/5 hover:bg-[#003087]/10 border border-[#003087]/20 transition-all"
              >
                🔑 Auto-fill OTP (Demo: 123456)
              </button>

              <button
                onClick={handleVerifyOtp}
                disabled={otp.join("").length !== 6 || loading}
                className="w-full btn-gold py-3.5 rounded-xl text-base font-bold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? "กำลังตรวจสอบ..." : "ยืนยัน OTP"}
              </button>

              <div className="flex items-center justify-between mt-5">
                <button
                  onClick={() => {
                    setStep("phone");
                    setOtp(["", "", "", "", "", ""]);
                  }}
                  className="text-xs text-[#64748b] hover:text-[#0a1628] transition-colors"
                >
                  ← เปลี่ยนเบอร์
                </button>
                <button className="text-xs text-[#003087] font-semibold hover:underline">
                  ส่ง OTP อีกครั้ง
                </button>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════
              Step 3: Registration Form
          ═══════════════════════════════════════ */}
          {step === "register" && (
            <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-xl">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#003087]/10 text-[#003087] mb-3">
                  <span className="text-2xl">✓</span>
                </div>
                <h1 className="text-2xl font-extrabold text-[#0a1628] mb-2">
                  ลงทะเบียนสมาชิก
                </h1>
                <p className="text-sm text-[#64748b]">
                  กรอกข้อมูลเพื่อสร้างบัตรสมาชิกดิจิทัล
                </p>
              </div>

              <div className="space-y-4">
                {/* Full Name */}
                <div>
                  <label className="block text-sm font-semibold text-[#334155] mb-1.5">
                    ชื่อ-นามสกุล <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="เช่น สมชาย ใจดี"
                    className="w-full px-4 py-3 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] text-[#0a1628] text-base placeholder:text-[#cbd5e1] focus:outline-none focus:ring-2 focus:ring-[#003087] focus:border-transparent transition-all"
                    autoFocus
                  />
                </div>

                {/* Birthday */}
                <div>
                  <label className="block text-sm font-semibold text-[#334155] mb-1.5">
                    วันเกิด (วัน/เดือน) <span className="text-red-500">*</span>{" "}
                    <span className="text-xs font-normal text-[#64748b]">
                      (เพื่อรับสิทธิพิเศษวันเกิด)
                    </span>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <select
                      value={birthDay}
                      onChange={(e) => setBirthDay(e.target.value)}
                      required
                      className="px-4 py-3 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] text-[#0a1628] text-base focus:outline-none focus:ring-2 focus:ring-[#003087] focus:border-transparent transition-all appearance-none cursor-pointer"
                    >
                      <option value="">เลือกวันที่ *</option>
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
                      className="px-4 py-3 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] text-[#0a1628] text-base focus:outline-none focus:ring-2 focus:ring-[#003087] focus:border-transparent transition-all appearance-none cursor-pointer"
                    >
                      <option value="">เลือกเดือน *</option>
                      {[
                        "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน",
                        "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม",
                        "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
                      ].map((m, i) => (
                        <option key={i + 1} value={String(i + 1)}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Profile Photo */}
                <div>
                  <label className="block text-sm font-semibold text-[#334155] mb-1.5">
                    รูปโปรไฟล์
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
                    className={`relative flex items-center gap-4 p-4 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
                      isDragging
                        ? "border-[#ffd700] bg-[#ffd700]/10"
                        : "border-[#cbd5e1] bg-[#f8fafc] hover:border-[#003087]/40"
                    }`}
                  >
                    <div className="relative w-16 h-16 rounded-full bg-[#e2e8f0] flex items-center justify-center text-[#94a3b8] text-2xl shrink-0 overflow-visible border-2 border-dashed border-[#003087]/30">
                      {previewUrl ? (
                        <div className="relative w-full h-full rounded-full overflow-hidden">
                          <Image
                            src={previewUrl}
                            alt="Profile Preview"
                            fill
                            sizes="64px"
                            className="object-cover"
                          />
                        </div>
                      ) : (
                        "👤"
                      )}

                      {/* Red circle with X button to remove and re-upload */}
                      {previewUrl && (
                        <button
                          type="button"
                          onClick={handleRemoveImage}
                          title="ลบรูปภาพ"
                          className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow-md transition-transform hover:scale-110 z-10"
                        >
                          <X className="w-3.5 h-3.5 stroke-[3]" />
                        </button>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-bold text-[#003087]">
                        {previewUrl ? "เปลี่ยนรูปภาพ" : "อัปโหลดรูปภาพ"}
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
                    loading
                  }
                  className="w-full btn-gold py-3.5 rounded-xl text-base font-bold disabled:opacity-40 disabled:cursor-not-allowed mt-2"
                >
                  {loading ? "กำลังสมัครสมาชิก..." : "สมัครสมาชิก"}
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
