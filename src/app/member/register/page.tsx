"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { X, User, HeartHandshake, UploadCloud } from "lucide-react";
import LanguageToggle from "@/components/LanguageToggle";
import { useLanguage } from "@/context/LanguageContext";

type Step = "phone" | "otp" | "register";

export default function RegisterPage() {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [challengeId, setChallengeId] = useState("");
  const [signupTicket, setSignupTicket] = useState("");
  const [formError, setFormError] = useState("");
  
  // Registration Form Fields
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [nickname, setNickname] = useState("");
  const [gender, setGender] = useState<"MALE" | "FEMALE" | "OTHER">("OTHER");
  const [birthDay, setBirthDay] = useState("");
  const [birthMonth, setBirthMonth] = useState("");

  // Emergency Contact Fields
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [emergencyRelation, setEmergencyRelation] = useState("");
  
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
    if (!/^0[689]\d{8}$/.test(phone.replace(/\D/g, ""))) return;
    setLoading(true); setFormError("");
    try {
      const response = await fetch("/api/auth/register/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: phone.replace(/\D/g, "") }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "ส่ง OTP ไม่สำเร็จ");
      setChallengeId(result.challengeId); setStep("otp");
    } catch (error) { setFormError(error instanceof Error ? error.message : "ส่ง OTP ไม่สำเร็จ"); }
    finally { setLoading(false); }
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



  const handleVerifyOtp = async () => {
    const otpStr = otp.join("");
    if (otpStr.length !== 6) return;
    setLoading(true); setFormError("");
    try {
      const response = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId, code: otp.join("") }) });
      const result = await response.json();
      if (!response.ok || !result.ticket) throw new Error(result.error || "OTP ไม่ถูกต้องหรือหมดอายุ");
      setSignupTicket(result.ticket); setStep("register");
    } catch (error) { setFormError(error instanceof Error ? error.message : "ยืนยัน OTP ไม่สำเร็จ"); }
    finally { setLoading(false); }
  };

  const handleRegister = async () => {
    if (!fullName.trim() || !gender || !birthDay || !birthMonth || !signupTicket) return;
    if (password.length < 10 || password.length > 128 || password !== confirmPassword) { setFormError("รหัสผ่านต้องยาว 10–128 ตัวอักษร และตรงกันทั้งสองช่อง"); return; }
    setLoading(true); setFormError("");
    try {
      const response = await fetch("/api/auth/register/complete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: signupTicket, profile: {
          password, fullName, nickname, gender, birthDay: Number(birthDay), birthMonth: Number(birthMonth),
          emergencyName, emergencyPhone: emergencyPhone.replace(/\D/g, ""), emergencyRelation,
        } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "สมัครสมาชิกไม่สำเร็จ");
      if (selectedFile) {
        const formData = new FormData(); formData.append("file", selectedFile);
        const upload = await fetch("/api/upload", { method: "POST", body: formData });
        if (!upload.ok) setFormError("สมัครสำเร็จแล้ว แต่บันทึกรูปไม่สำเร็จ สามารถติดต่อเจ้าหน้าที่เพื่อเพิ่มรูปได้");
      }
      localStorage.removeItem("blu_member");
      router.push("/member"); router.refresh();
    } catch (error) { setFormError(error instanceof Error ? error.message : "สมัครสมาชิกไม่สำเร็จ"); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (step === "otp") {
      otpRefs.current[0]?.focus();
    }
  }, [step]);

  const thaiMonths = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
  ];
  const englishMonths = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  return (
    <main className="min-h-screen bg-blu-dark text-white flex flex-col justify-between">
      {/* ─── Top Navbar ─── */}
      <header className="w-full max-w-7xl mx-auto px-5 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/logo.jpg"
            alt="Blu Fitness"
            width={36}
            height={36}
            className="w-9 h-9 rounded-lg object-cover"
          />
          <span className="font-extrabold tracking-wider text-sm text-white">
            BLU FITNESS
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <LanguageToggle variant="dark" />
          <Link
            href="/"
            className="text-xs text-blu-sky/70 hover:text-white transition-colors"
          >
            {t("member.back")}
          </Link>
        </div>
      </header>

      {/* ─── Main Content ─── */}
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {/* Progress Steps (Numbered Circles 1 - 2 - 3) */}
          <div className="flex items-center justify-center gap-3 sm:gap-4 mb-8">
            {/* Step 1 */}
            <div className="flex items-center gap-2">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-sm transition-all ${
                  step === "phone"
                    ? "bg-blu-yellow text-blu-dark shadow-md ring-4 ring-blu-yellow/30"
                    : "bg-blu-slate text-white"
                }`}
              >
                {step === "otp" || step === "register" ? "✓" : "1"}
              </div>
              <span
                className={`text-xs font-bold ${
                  step === "phone" ? "text-blu-yellow" : "text-blu-sky/70"
                }`}
              >
                {t("reg.step_phone")}
              </span>
            </div>

            <div
              className={`w-6 sm:w-10 h-0.5 transition-all ${
                step === "otp" || step === "register"
                  ? "bg-blu-yellow"
                  : "bg-white/20"
              }`}
            />

            {/* Step 2 */}
            <div className="flex items-center gap-2">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-sm transition-all ${
                  step === "otp"
                    ? "bg-blu-yellow text-blu-dark shadow-md ring-4 ring-blu-yellow/30"
                    : step === "register"
                      ? "bg-blu-slate text-white"
                      : "bg-white/10 text-blu-sky/50 border border-white/15"
                }`}
              >
                {step === "register" ? "✓" : "2"}
              </div>
              <span
                className={`text-xs font-bold ${
                  step === "otp" ? "text-blu-yellow" : "text-blu-sky/70"
                }`}
              >
                {t("reg.step_otp")}
              </span>
            </div>

            <div
              className={`w-6 sm:w-10 h-0.5 transition-all ${
                step === "register" ? "bg-blu-yellow" : "bg-white/20"
              }`}
            />

            {/* Step 3 */}
            <div className="flex items-center gap-2">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-sm transition-all ${
                  step === "register"
                    ? "bg-blu-yellow text-blu-dark shadow-md ring-4 ring-blu-yellow/30"
                    : "bg-white/10 text-blu-sky/50 border border-white/15"
                }`}
              >
                3
              </div>
              <span
                className={`text-xs font-bold ${
                  step === "register" ? "text-blu-yellow" : "text-blu-sky/70"
                }`}
              >
                {t("reg.step_profile")}
              </span>
            </div>
          </div>

          {formError && <p role="alert" className="mb-4 rounded-xl bg-rose-100 p-3 text-sm text-rose-700">{formError}</p>}

          {/* ═══════════════════════════════════════
              Step 1: Phone Number
          ═══════════════════════════════════════ */}
          {step === "phone" && (
            <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-xl border border-blu-sky/30">
              <div className="text-center mb-6">
                <h1 className="text-2xl font-extrabold text-blu-dark mb-1">
                  {t("reg.phone_title")}
                </h1>
                <p className="text-xs text-blu-steel">
                  {t("reg.phone_sub")}
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-blu-dark mb-1">
                    {t("login.phone_label")}
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="08X-XXX-XXXX"
                    className="w-full px-4 py-3 rounded-xl border border-blu-sky/50 bg-blu-ice/30 text-blu-dark text-base placeholder:text-blu-ocean/70 focus:outline-none focus:ring-2 focus:ring-blu-slate focus:border-transparent transition-all font-mono"
                    autoFocus
                  />
                </div>

                <button
                  onClick={handleSendOtp}
                  disabled={phone.length < 9 || loading}
                  className="w-full btn-gold py-3.5 rounded-xl text-base font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md transition-all"
                >
                  {loading ? "กำลังส่ง OTP..." : t("reg.btn_send_otp")}
                </button>
              </div>

              <div className="mt-6 text-center text-xs text-blu-steel">
                {t("reg.have_account")}{" "}
                <Link
                  href="/member/login"
                  className="font-bold text-blu-slate hover:underline cursor-pointer"
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
            <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-xl border border-blu-sky/30">
              <div className="text-center mb-6">
                <h1 className="text-2xl font-extrabold text-blu-dark mb-1">
                  {t("reg.otp_title")}
                </h1>
                <p className="text-xs text-blu-steel">
                  {t("reg.otp_sub")}{" "}
                  <span className="font-bold text-blu-dark font-mono">
                    {phone}
                  </span>
                </p>
              </div>

              <div className="space-y-5">
                <div className="flex justify-center gap-2 sm:gap-2.5">
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
                      className="w-11 h-13 sm:w-12 sm:h-14 text-center text-xl font-bold font-mono rounded-xl border border-blu-sky/50 bg-blu-ice/30 text-blu-dark focus:outline-none focus:ring-2 focus:ring-blu-slate focus:border-transparent transition-all shadow-xs"
                    />
                  ))}
                </div>


                <button
                  onClick={handleVerifyOtp}
                  disabled={otp.join("").length !== 6 || loading}
                  className="w-full btn-gold py-3.5 rounded-xl text-base font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md transition-all"
                >
                  {loading ? "กำลังตรวจสอบ..." : t("reg.btn_verify_otp")}
                </button>

                <div className="flex justify-between items-center text-xs text-blu-steel pt-2">
                  <button
                    type="button"
                    onClick={() => setStep("phone")}
                    className="hover:text-blu-dark font-medium cursor-pointer"
                  >
                    ← แก้ไขเบอร์โทร
                  </button>
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    className="text-blu-slate hover:underline font-bold cursor-pointer"
                  >
                    ส่งรหัสใหม่ (Resend)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════
              Step 3: Registration Form & Profile Setup
          ═══════════════════════════════════════ */}
          {step === "register" && (
            <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-xl border border-blu-sky/30">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blu-ice text-blu-slate mb-2 font-bold text-xl">
                  ✓
                </div>
                <h1 className="text-2xl font-extrabold text-blu-dark mb-1">
                  {t("reg.profile_title")}
                </h1>
                <p className="text-xs text-blu-steel">
                  {t("reg.profile_sub")}
                </p>
              </div>

              <div className="space-y-4">
                <label className="block text-sm text-blu-dark">รหัสผ่าน (10–128 ตัวอักษร)
                  <input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} className="w-full border rounded-xl p-3" required />
                </label>
                <label className="block text-sm text-blu-dark">ยืนยันรหัสผ่าน
                  <input type="password" autoComplete="new-password" maxLength={128} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full border rounded-xl p-3" required />
                </label>
                {/* 1. Full Name */}
                <div>
                  <label className="block text-sm font-semibold text-blu-dark mb-1">
                    {t("reg.fullname_label")} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={t("reg.fullname_placeholder")}
                    className="w-full px-4 py-3 rounded-xl border border-blu-sky/50 bg-blu-ice/30 text-blu-dark text-sm sm:text-base placeholder:text-blu-ocean/70 focus:outline-none focus:ring-2 focus:ring-blu-slate focus:border-transparent transition-all"
                    autoFocus
                  />
                </div>

                {/* 2. Nickname */}
                <div>
                  <label className="block text-sm font-semibold text-blu-dark mb-1">
                    {t("reg.nickname_label")}
                  </label>
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder={t("reg.nickname_placeholder")}
                    className="w-full px-4 py-3 rounded-xl border border-blu-sky/50 bg-blu-ice/30 text-blu-dark text-sm sm:text-base placeholder:text-blu-ocean/70 focus:outline-none focus:ring-2 focus:ring-blu-slate focus:border-transparent transition-all"
                  />
                </div>

                {/* 3. Gender */}
                <div>
                  <label className="block text-sm font-semibold text-blu-dark mb-1">
                    เพศ <span className="text-rose-500">*</span>
                  </label>
                  <select
                    required
                    value={gender}
                    onChange={(e) => setGender(e.target.value as "MALE" | "FEMALE" | "OTHER")}
                    className="w-full px-3.5 py-3 rounded-xl border border-blu-sky/50 bg-blu-ice/30 text-blu-dark text-sm focus:outline-none focus:ring-2 focus:ring-blu-slate focus:border-transparent transition-all cursor-pointer"
                  >
                    <option value="MALE">ชาย</option>
                    <option value="FEMALE">หญิง</option>
                    <option value="OTHER">อื่นๆ</option>
                  </select>
                </div>

                {/* 4. Birthday */}
                <div>
                  <label className="block text-sm font-semibold text-blu-dark mb-1">
                    {t("reg.bday_label")} <span className="text-rose-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <select
                      value={birthDay}
                      onChange={(e) => setBirthDay(e.target.value)}
                      required
                      className="px-3.5 py-3 rounded-xl border border-blu-sky/50 bg-blu-ice/30 text-blu-dark text-sm focus:outline-none focus:ring-2 focus:ring-blu-slate focus:border-transparent transition-all cursor-pointer"
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
                      className="px-3.5 py-3 rounded-xl border border-blu-sky/50 bg-blu-ice/30 text-blu-dark text-sm focus:outline-none focus:ring-2 focus:ring-blu-slate focus:border-transparent transition-all cursor-pointer"
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

                {/* 5. Emergency Contact Section */}
                <div className="pt-2 pb-1">
                  <div className="bg-blu-ice/50 rounded-2xl p-4 border border-blu-sky/60 space-y-3">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-blu-slate uppercase tracking-wider">
                      <HeartHandshake className="w-4 h-4 text-blu-slate" />
                      <span>{t("reg.emergency_title")}</span>
                    </div>

                    {/* Emergency Name */}
                    <div>
                      <label className="block text-xs font-semibold text-blu-dark mb-1">
                        {t("reg.emergency_name_label")}
                      </label>
                      <input
                        type="text"
                        value={emergencyName}
                        onChange={(e) => setEmergencyName(e.target.value)}
                        placeholder={t("reg.emergency_name_placeholder")}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-blu-sky/50 bg-white text-blu-dark text-xs sm:text-sm placeholder:text-blu-ocean/70 focus:outline-none focus:ring-2 focus:ring-blu-slate focus:border-transparent transition-all"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {/* Emergency Phone */}
                      <div>
                        <label className="block text-xs font-semibold text-blu-dark mb-1">
                          {t("reg.emergency_phone_label")}
                        </label>
                        <input
                          type="tel"
                          value={emergencyPhone}
                          onChange={(e) => setEmergencyPhone(e.target.value)}
                          placeholder={t("reg.emergency_phone_placeholder")}
                          className="w-full px-3.5 py-2.5 rounded-xl border border-blu-sky/50 bg-white text-blu-dark text-xs sm:text-sm placeholder:text-blu-ocean/70 focus:outline-none focus:ring-2 focus:ring-blu-slate focus:border-transparent transition-all font-mono"
                        />
                      </div>

                      {/* Emergency Relation */}
                      <div>
                        <label className="block text-xs font-semibold text-blu-dark mb-1">
                          {t("reg.emergency_relation_label")}
                        </label>
                        <input
                          type="text"
                          value={emergencyRelation}
                          onChange={(e) => setEmergencyRelation(e.target.value)}
                          placeholder={t("reg.emergency_relation_placeholder")}
                          className="w-full px-3.5 py-2.5 rounded-xl border border-blu-sky/50 bg-white text-blu-dark text-xs sm:text-sm placeholder:text-blu-ocean/70 focus:outline-none focus:ring-2 focus:ring-blu-slate focus:border-transparent transition-all"
                        />
                      </div>
                    </div>
                  </div>
                </div>


                {/* 7. Profile Photo */}
                <div>
                  <label className="block text-sm font-semibold text-blu-dark mb-1">
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
                        ? "border-blu-yellow bg-blu-yellow/10"
                        : "border-blu-sky/70 bg-blu-ice/40 hover:border-blu-slate"
                    }`}
                  >
                    <div className="relative w-14 h-14 rounded-full bg-blu-ice flex items-center justify-center text-blu-steel text-2xl shrink-0 overflow-visible border-2 border-dashed border-blu-slate/40">
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
                        <User className="w-6 h-6 text-blu-slate" />
                      )}

                      {previewUrl && (
                        <button
                          type="button"
                          onClick={handleRemoveImage}
                          title="ลบรูปภาพ"
                          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow-md transition-transform hover:scale-110 z-10 cursor-pointer"
                        >
                          <X className="w-3 h-3 stroke-3" />
                        </button>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <span className="inline-flex items-center gap-1.5 text-sm font-bold text-blu-slate hover:underline">
                        <UploadCloud className="w-4 h-4 text-blu-slate" />
                        <span>{previewUrl ? t("reg.avatar_change") : t("reg.avatar_drop")}</span>
                      </span>
                      <p className="text-[11px] text-blu-steel mt-0.5">
                        {t("reg.avatar_hint")}
                      </p>
                    </div>
                  </div>
                  <p className="text-[11px] text-blu-steel/80 mt-1">
                    {t("reg.avatar_note")}
                  </p>
                </div>

                {formError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{formError}</p>}
                <button
                  onClick={handleRegister}
                  disabled={
                    !fullName.trim() ||
                    !birthDay ||
                    !birthMonth ||
                    !signupTicket ||
                    loading
                  }
                  className="w-full btn-gold py-3.5 rounded-xl text-base font-bold disabled:opacity-40 disabled:cursor-not-allowed mt-2 cursor-pointer shadow-md transition-all"
                >
                  {loading ? t("reg.submitting") : t("reg.btn_complete")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Footer ─── */}
      <footer className="text-center text-[11px] text-blu-sky/40 pb-6 px-5">
        © 2026 Blu Fitness Cha-am
      </footer>
    </main>
  );
}
