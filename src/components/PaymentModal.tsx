"use client";

import React, { useState, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import confetti from "canvas-confetti";
import {
  X,
  QrCode,
  Copy,
  UploadCloud,
  CheckCircle2,
  ShieldCheck,
  Loader2,
  Tag,
  Sparkles,
} from "lucide-react";
import { MockPackage, PromoCode, validatePromoCode } from "@/lib/mock-data";
import { generatePromptPayPayload } from "@/lib/promptpay";
import { useLanguage } from "@/context/LanguageContext";

// PromptPay Gym Account (Khun James)
const PROMPTPAY_NUMBER = "0897720282";

interface PaymentModalProps {
  pkg: MockPackage | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function PaymentModal({ pkg, isOpen, onClose }: PaymentModalProps) {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationSuccess, setVerificationSuccess] = useState(false);
  const [copiedPromptPay, setCopiedPromptPay] = useState(false);

  // 🎟️ Promo Code States
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<PromoCode | null>(null);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [promoError, setPromoError] = useState("");

  if (!isOpen || !pkg) return null;

  // Final Price Calculation
  const finalAmount = Math.max(0, pkg.price - discountAmount);

  const handleCopyPromptPay = () => {
    navigator.clipboard.writeText(PROMPTPAY_NUMBER);
    setCopiedPromptPay(true);
    setTimeout(() => setCopiedPromptPay(false), 2000);
  };

  const handleApplyPromo = (codeToApply?: string) => {
    const code = codeToApply || promoInput;
    if (!code.trim()) return;

    setPromoError("");
    const result = validatePromoCode(code, pkg.price);

    if (result.valid && result.promo) {
      setAppliedPromo(result.promo);
      setDiscountAmount(result.discountAmount);
      setPromoInput(result.promo.code);
    } else {
      setPromoError(lang === "en" ? (result.errorMessageEn || "Invalid promo code") : (result.errorMessage || "โค้ดส่วนลดไม่ถูกต้อง"));
    }
  };

  const handleRemovePromo = () => {
    setAppliedPromo(null);
    setDiscountAmount(0);
    setPromoInput("");
    setPromoError("");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSlipFile(file);
      const reader = new FileReader();
      reader.onload = () => {
        setSlipPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleVerifySlip = async () => {
    if (!slipFile || !pkg) return;

    setIsVerifying(true);

    try {
      // Simulate verification delay
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Confetti burst
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#ffd700", "#0c3756", "#3a728e", "#5c93aa"],
      });

      setVerificationSuccess(true);
      setIsVerifying(false);

      // Save package to localStorage
      try {
        const bonusDays = pkg.bonusDays || 0;
        const totalAddDays = pkg.durationDays + bonusDays;

        const now = new Date();
        now.setDate(now.getDate() + totalAddDays);

        const dayNames = [
          "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
          "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
        ];
        const newExpireStr = `${now.getDate()} ${dayNames[now.getMonth()]} ${now.getFullYear() + 543}`;

        const updatedPackage = {
          id: `PKG-${Date.now()}`,
          name: pkg.name,
          timeSlot: pkg.timeSlot,
          startDate: "วันนี้",
          expireDate: newExpireStr,
          totalDays: totalAddDays,
          usedDays: 0,
          friendCouponsLeft: 5 + (pkg.friendCoupons || 0),
          paidAmount: finalAmount,
          promoApplied: appliedPromo?.code || null,
          status: "active",
        };

        localStorage.setItem("blu_active_package", JSON.stringify(updatedPackage));
      } catch (e) {}

      // Auto redirect to /member
      setTimeout(() => {
        onClose();
        router.push("/member");
      }, 2500);
    } catch (error) {
      setIsVerifying(false);
      alert("เกิดข้อผิดพลาดในการตรวจสอบสลิป กรุณาลองใหม่อีกครั้ง");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-blu-dark/80 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl border border-blu-sky/40 max-h-[92vh] overflow-y-auto space-y-5 animate-in slide-in-from-bottom duration-300">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-blu-sky/30">
          <div>
            <h3 className="font-extrabold text-base sm:text-lg text-blu-dark">
              {t("pay.title")}
            </h3>
            <p className="text-xs text-blu-steel">
              {t("pay.subtitle")}
            </p>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-blu-ice hover:bg-blu-sky/40 flex items-center justify-center text-blu-steel transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Success State */}
        {verificationSuccess ? (
          <div className="py-8 text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto ring-8 ring-emerald-50 animate-bounce">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h4 className="text-xl font-black text-blu-dark">
              {t("pay.success_title")}
            </h4>
            <p className="text-xs text-blu-steel max-w-xs mx-auto">
              {t("pay.success_desc")}
            </p>
          </div>
        ) : (
          <>
            {/* 1. Order Summary Box */}
            <div className="bg-blu-ice/50 rounded-2xl p-4 border border-blu-sky/40 space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-blu-steel">{t("pay.selected_pkg")}</span>
                <span className="font-extrabold text-blu-dark">
                  {lang === "en"
                    ? `BLU ${pkg.timeSlot} (${
                        pkg.durationDays === 1
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
                      })`
                    : pkg.name}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-blu-steel">{t("pay.time_slot")}</span>
                <span className="font-bold text-blu-dark">{pkg.timeSlot}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-blu-steel">{t("pay.duration")}</span>
                <span className="font-bold text-blu-dark">
                  {lang === "en"
                    ? `${
                        pkg.durationDays === 1
                          ? "1 Day"
                          : pkg.durationDays === 30
                            ? "1 Month"
                            : pkg.durationDays === 90
                              ? "3 Months"
                              : pkg.durationDays === 180
                                ? "6 Months"
                                : pkg.durationDays === 365
                                  ? "1 Year"
                                  : `${pkg.durationDays} Days`
                      } (${pkg.durationDays} ${t("pkg.days")})`
                    : `${pkg.label} (${pkg.durationDays} ${t("pkg.days")})`}
                </span>
              </div>

              {/* Original Price (if promo applied) */}
              {discountAmount > 0 && (
                <div className="flex justify-between items-center text-blu-steel">
                  <span>{t("pay.original_price")}</span>
                  <span className="line-through">฿{pkg.price.toLocaleString()}</span>
                </div>
              )}

              {/* Discount Row */}
              {discountAmount > 0 && appliedPromo && (
                <div className="flex justify-between items-center text-emerald-600 font-bold bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200/80">
                  <span className="flex items-center gap-1">
                    <Tag className="w-3 h-3" />
                    <span>{t("pay.promo_discount_label")} ({appliedPromo.code})</span>
                  </span>
                  <span>-฿{discountAmount.toLocaleString()}</span>
                </div>
              )}

              {/* Final Total Amount */}
              <div className="flex justify-between items-center pt-2 border-t border-blu-sky/40 text-sm">
                <span className="font-bold text-blu-dark">{t("pay.total")}</span>
                <span className="text-xl font-black text-blu-slate">
                  ฿{finalAmount.toLocaleString()}
                </span>
              </div>
            </div>

            {/* 2. Promo Code Input Box */}
            <div className="bg-blu-ice/30 rounded-2xl p-3.5 border border-blu-sky/40 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-blu-dark">
                <Tag className="w-3.5 h-3.5 text-blu-slate" />
                <span>{t("pay.promo_title")}</span>
              </div>

              {appliedPromo ? (
                <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-emerald-700 bg-white px-2 py-0.5 rounded border border-emerald-300">
                      {appliedPromo.code}
                    </span>
                    <span className="text-emerald-700 font-semibold">
                      {lang === "en"
                        ? `Saved ฿${discountAmount.toLocaleString()}${appliedPromo.discountType === "PERCENT" && appliedPromo.maxDiscount ? ` (Capped at ฿${appliedPromo.maxDiscount})` : ""}`
                        : `ลดแล้ว ฿${discountAmount.toLocaleString()}${appliedPromo.discountType === "PERCENT" && appliedPromo.maxDiscount ? ` (สูงสุดไม่เกิน ฿${appliedPromo.maxDiscount})` : ""}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemovePromo}
                    className="text-xs font-bold text-rose-500 hover:text-rose-700 hover:underline cursor-pointer"
                  >
                    {t("pay.promo_remove")}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleApplyPromo();
                      }
                    }}
                    placeholder={t("pay.promo_placeholder")}
                    className="flex-1 px-3 py-2 rounded-xl border border-blu-sky/60 bg-white text-xs sm:text-sm font-mono uppercase text-blu-dark placeholder:text-blu-ocean/70 focus:outline-none focus:ring-2 focus:ring-blu-slate"
                  />
                  <button
                    type="button"
                    onClick={() => handleApplyPromo()}
                    className="btn-blue px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    {t("pay.promo_apply")}
                  </button>
                </div>
              )}

              {promoError && (
                <p className="text-[11px] font-semibold text-rose-500">
                  {promoError}
                </p>
              )}

              {/* Demo Hint Badges */}
              {!appliedPromo && (
                <div className="pt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="text-blu-steel flex items-center gap-0.5">
                    <Sparkles className="w-3 h-3 text-blu-yellow" />
                    <span>{lang === "en" ? "Try:" : "ลองใช้:"}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleApplyPromo("BLU100")}
                    className="bg-white hover:bg-blu-ice border border-blu-sky/60 text-blu-slate font-mono font-bold px-2 py-0.5 rounded cursor-pointer transition-all"
                  >
                    BLU100 (-100฿)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPromo("FITNESS10")}
                    className="bg-white hover:bg-blu-ice border border-blu-sky/60 text-blu-slate font-mono font-bold px-2 py-0.5 rounded cursor-pointer transition-all"
                  >
                    FITNESS10 (-10%)
                  </button>
                </div>
              )}
            </div>

            {/* 3. Dynamic PromptPay QR Box (Reflects finalAmount) */}
            <div className="bg-gradient-to-b from-blu-slate to-blu-dark rounded-2xl p-5 text-white text-center shadow-md space-y-3">
              <div className="inline-flex items-center gap-1.5 bg-white/10 px-3 py-1 rounded-full text-[11px] font-bold text-blu-sky">
                <QrCode className="w-3.5 h-3.5 text-blu-yellow" />
                <span>{t("pay.qr_label")}</span>
              </div>

              {/* QR Code Canvas */}
              <div className="bg-white p-3.5 rounded-2xl inline-block shadow-inner mx-auto">
                <QRCodeSVG
                  value={generatePromptPayPayload(PROMPTPAY_NUMBER, finalAmount)}
                  size={180}
                  level="M"
                  includeMargin={false}
                />
              </div>

              {/* Account Name & Copy Button */}
              <div className="space-y-1 text-xs">
                <div className="font-extrabold text-white text-sm">
                  {t("pay.account_name")}
                </div>
                <div className="flex items-center justify-center gap-2 text-blu-sky/90 font-mono">
                  <span>{t("pay.promptpay_no")} {PROMPTPAY_NUMBER}</span>
                  <button
                    type="button"
                    onClick={handleCopyPromptPay}
                    className="text-blu-yellow hover:text-white transition-colors flex items-center gap-0.5 text-[11px] font-bold cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copiedPromptPay ? t("pay.copied") : t("pay.copy")}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 4. Slip Upload & Verification Section */}
            <div className="space-y-3">
              <label className="block text-xs font-extrabold text-blu-dark">
                {t("pay.slip_label")}
              </label>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                className="hidden"
              />

              {slipPreview ? (
                <div className="relative rounded-2xl overflow-hidden border-2 border-emerald-500 bg-blu-ice/40 p-2 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative w-12 h-16 rounded-lg overflow-hidden bg-blu-sky/30 shrink-0">
                      <Image
                        src={slipPreview}
                        alt="Slip Preview"
                        fill
                        className="object-cover"
                      />
                    </div>
                    <div className="text-xs">
                      <div className="font-bold text-blu-dark truncate max-w-[180px]">
                        {slipFile?.name}
                      </div>
                      <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1 mt-0.5">
                        <CheckCircle2 className="w-3 h-3" /> {t("pay.slip_ready")}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSlipFile(null);
                      setSlipPreview(null);
                    }}
                    className="p-2 text-blu-steel hover:text-rose-500 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-blu-sky hover:border-blu-slate rounded-2xl p-5 text-center cursor-pointer transition-colors bg-blu-ice/40 hover:bg-blu-ice space-y-1.5"
                >
                  <div className="w-10 h-10 rounded-full bg-blu-ice text-blu-slate flex items-center justify-center mx-auto">
                    <UploadCloud className="w-5 h-5" />
                  </div>
                  <div className="text-xs font-bold text-blu-dark">
                    {t("pay.slip_upload")}
                  </div>
                  <p className="text-[10px] text-blu-steel">
                    {t("pay.slip_hint")}
                  </p>
                </div>
              )}

              {/* Submit Action Button */}
              <button
                type="button"
                disabled={!slipFile || isVerifying}
                onClick={handleVerifySlip}
                className={`w-full py-3.5 px-6 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all ${
                  slipFile && !isVerifying
                    ? "btn-gold cursor-pointer shadow-md hover:shadow-lg"
                    : "bg-blu-sky/40 text-blu-steel/60 cursor-not-allowed"
                }`}
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-blu-dark" />
                    <span>{t("pay.verifying")}</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>{t("pay.btn_confirm")}</span>
                  </>
                )}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
