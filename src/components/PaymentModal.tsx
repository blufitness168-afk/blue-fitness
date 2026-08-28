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
  CalendarPlus,
  Ticket,
} from "lucide-react";
import { MockPackage } from "@/lib/mock-data";
import { generatePromptPayPayload } from "@/lib/promptpay";

// PromptPay Gym Account (Khun James)
const PROMPTPAY_NUMBER = "0897720282";
const PROMPTPAY_NAME = "BLU FITNESS (ชะอำ)";

interface PaymentModalProps {
  pkg: MockPackage | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function PaymentModal({ pkg, isOpen, onClose }: PaymentModalProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationSuccess, setVerificationSuccess] = useState(false);
  const [copiedPromptPay, setCopiedPromptPay] = useState(false);

  if (!isOpen || !pkg) return null;

  const handleCopyPromptPay = () => {
    navigator.clipboard.writeText(PROMPTPAY_NUMBER);
    setCopiedPromptPay(true);
    setTimeout(() => setCopiedPromptPay(false), 2000);
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
        colors: ["#ffd700", "#003087", "#00a86b", "#3b82f6"],
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
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto space-y-5 animate-in slide-in-from-bottom duration-300">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-extrabold text-base sm:text-lg text-slate-900">
              ชำระเงินผ่าน PromptPay
            </h3>
            <p className="text-xs text-slate-500">
              สแกน QR และแนบสลิปเพื่อเปิดใช้งานทันที
            </p>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors cursor-pointer"
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
            <h4 className="text-xl font-black text-slate-900">
              ชำระเงินสำเร็จ!
            </h4>
            <p className="text-xs text-slate-600 max-w-xs mx-auto">
              ระบบเพิ่มวันสมาชิกแพ็กเกจ <span className="font-bold text-[#003087]">{pkg.name}</span> เรียบร้อยแล้ว กำลังพากลับหน้าสมาชิก...
            </p>
          </div>
        ) : (
          <>
            {/* Order Summary Box */}
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">แพ็กเกจที่เลือก:</span>
                <span className="font-extrabold text-slate-900">{pkg.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">ช่วงเวลาเข้าใช้:</span>
                <span className="font-bold text-slate-800">{pkg.timeSlot} น.</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">อายุการใช้งาน:</span>
                <span className="font-bold text-slate-800">
                  {pkg.durationDays} วัน {pkg.bonusDays > 0 && `(+ แถม ${pkg.bonusDays} วัน)`}
                </span>
              </div>
              {pkg.friendCoupons > 0 && (
                <div className="flex justify-between items-center text-sky-700">
                  <span className="flex items-center gap-1 font-bold">
                    <Ticket className="w-3.5 h-3.5" /> สิทธิ์คูปองเพื่อน:
                  </span>
                  <span className="font-extrabold">+{pkg.friendCoupons} สิทธิ์</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-2 border-t border-slate-200 text-sm">
                <span className="font-bold text-slate-700">ยอดชำระสุทธิ:</span>
                <span className="text-xl font-black text-[#003087]">
                  ฿{pkg.price.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Dynamic PromptPay QR Box */}
            <div className="bg-gradient-to-b from-[#002f87] to-[#001f5c] rounded-2xl p-5 text-white text-center shadow-md space-y-3">
              <div className="inline-flex items-center gap-1.5 bg-white/10 px-3 py-1 rounded-full text-[11px] font-bold text-slate-200">
                <QrCode className="w-3.5 h-3.5 text-[#ffd700]" />
                <span>Thai QR Payment / PromptPay</span>
              </div>

              {/* QR Code Canvas */}
              <div className="bg-white p-3.5 rounded-2xl inline-block shadow-inner mx-auto">
                <QRCodeSVG
                  value={generatePromptPayPayload(PROMPTPAY_NUMBER, pkg.price)}
                  size={180}
                  level="M"
                  includeMargin={false}
                />
              </div>

              {/* Account Name & Copy Button */}
              <div className="space-y-1 text-xs">
                <div className="font-extrabold text-white text-sm">
                  {PROMPTPAY_NAME}
                </div>
                <div className="flex items-center justify-center gap-2 text-white/80 font-mono">
                  <span>พร้อมเพย์: {PROMPTPAY_NUMBER}</span>
                  <button
                    type="button"
                    onClick={handleCopyPromptPay}
                    className="text-[#ffd700] hover:text-white transition-colors flex items-center gap-0.5 text-[11px] font-bold cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copiedPromptPay ? "คัดลอกแล้ว!" : "คัดลอก"}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Slip Upload & Verification Section */}
            <div className="space-y-3">
              <label className="block text-xs font-extrabold text-slate-800">
                แนบสลิปการโอนเงิน (ตรวจอัตโนมัติ)
              </label>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                className="hidden"
              />

              {slipPreview ? (
                <div className="relative rounded-2xl overflow-hidden border-2 border-emerald-500 bg-slate-50 p-2 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative w-12 h-16 rounded-lg overflow-hidden bg-slate-200 shrink-0">
                      <Image
                        src={slipPreview}
                        alt="Slip Preview"
                        fill
                        className="object-cover"
                      />
                    </div>
                    <div className="text-xs">
                      <div className="font-bold text-slate-900 truncate max-w-[180px]">
                        {slipFile?.name}
                      </div>
                      <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1 mt-0.5">
                        <CheckCircle2 className="w-3 h-3" /> พร้อมตรวจสอบ
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSlipFile(null);
                      setSlipPreview(null);
                    }}
                    className="p-2 text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 hover:border-[#003087] rounded-2xl p-5 text-center cursor-pointer transition-colors bg-slate-50 hover:bg-sky-50/50 space-y-1.5"
                >
                  <div className="w-10 h-10 rounded-full bg-sky-100 text-[#003087] flex items-center justify-center mx-auto">
                    <UploadCloud className="w-5 h-5" />
                  </div>
                  <div className="text-xs font-bold text-slate-800">
                    คลิกเพื่ออัปโหลดสลิป
                  </div>
                  <p className="text-[10px] text-slate-500">
                    รองรับไฟล์ JPG, PNG (รูปสลิปจากแอปธนาคาร)
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
                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                }`}
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-slate-700" />
                    <span>กำลังตรวจสอบสลิป EasySlip...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>ยืนยันการชำระเงิน</span>
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
