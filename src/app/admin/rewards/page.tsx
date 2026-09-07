"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import {
  ScanLine,
  Gift,
  Search,
  CheckCircle2,
  X,
  User,
  Ticket,
} from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import {
  RedemptionRecord,
  findMemberByAnyCode,
  getRedemptions,
  saveRedemptions,
} from "@/lib/admin-mock";
import { mockRewards } from "@/lib/mock-data";

export default function AdminRewardsPage() {
  const { lang } = useLanguage();
  const th = lang === "th";

  const [redemptions, setRedemptions] = useState<RedemptionRecord[]>(() =>
    getRedemptions()
  );
  const [memberQuery, setMemberQuery] = useState("");
  const [rewardCode, setRewardCode] = useState("");
  const [scanOpen, setScanOpen] = useState(false);

  const [result, setResult] = useState<{
    kind: "success" | "error";
    title: string;
    detail: string;
  } | null>(null);

  const pending = useMemo(
    () => redemptions.filter((r) => r.status === "PENDING"),
    [redemptions]
  );

  const handleVerify = () => {
    // 1. Find member (support memberCode OR cardNumber)
    const member = findMemberByAnyCode(memberQuery);
    if (!member) {
      setResult({
        kind: "error",
        title: th ? "ไม่พบสมาชิก" : "Member not found",
        detail: th
          ? "ตรวจสอบรหัสสมาชิก (BLU-XXXX) หรือเลขบัตรแข็งอีกครั้ง"
          : "Check member code (BLU-XXXX) or card number again",
      });
      return;
    }

    // 2. Find matching pending redemption
    const normReward = rewardCode.trim().toUpperCase();
    const redemption = pending.find(
      (r) => r.rewardCode.toUpperCase() === normReward
    );
    if (!redemption) {
      setResult({
        kind: "error",
        title: th ? "ไม่พบรหัสของรางวัล" : "Reward code not found",
        detail: th
          ? "ตรวจสอบรหัสของรางวัล (BLU-RW-XXXX) หรืออาจถูกใช้ไปแล้ว"
          : "Check reward code (BLU-RW-XXXX) or it may already be used",
      });
      return;
    }

    // 3. Check the reward belongs to this member
    if (redemption.memberCode !== member.memberCode) {
      setResult({
        kind: "error",
        title: th ? "รหัสไม่ตรงกับสมาชิก" : "Code does not match member",
        detail: th
          ? `รหัสของรางวัลนี้เป็นของ ${redemption.memberName} ไม่ใช่ ${member.fullName}`
          : `This reward code belongs to ${redemption.memberName}, not ${member.fullName}`,
      });
      return;
    }

    // Success — mark completed
    const updated = redemptions.map((r) =>
      r.rewardCode === redemption.rewardCode
        ? { ...r, status: "COMPLETED" as const }
        : r
    );
    setRedemptions(updated);
    saveRedemptions(updated);

    setResult({
      kind: "success",
      title: th ? "ยืนยันการรับของรางวัลสำเร็จ!" : "Redemption confirmed!",
      detail: `${member.fullName} · ${redemption.rewardTitle}`,
    });

    // Reset inputs
    setMemberQuery("");
    setRewardCode("");
  };

  const handleSimulateScan = () => {
    // Prototype: simulate reading a QR (will fill a random member code)
    const sample = ["BLU-1001", "BLU-1012", "BLU-1020", "BLU-1025"];
    const picked = sample[Math.floor(Math.random() * sample.length)];
    setMemberQuery(picked);
    setScanOpen(false);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <header>
        <h1 className="text-xl sm:text-2xl font-black text-blu-dark tracking-tight">
          {th ? "ยืนยันการรับของรางวัล" : "Reward Redemption"}
        </h1>
        <p className="text-xs text-blu-steel mt-1">
          {th
            ? "กรอกรหัสสมาชิก + รหัสของรางวัล เพื่อมอบของที่เคาน์เตอร์"
            : "Enter member code + reward code to redeem at the counter"}
        </p>
      </header>

      {/* Verification Form */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Member lookup */}
        <div className="rounded-2xl bg-white border border-blu-sky/40 shadow-sm p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blu-ice border border-blu-sky/40 flex items-center justify-center">
              <User className="w-5 h-5 text-blu-slate" />
            </div>
            <div>
              <h2 className="text-sm font-black text-blu-dark">
                {th ? "1. รหัสสมาชิก" : "1. Member Code"}
              </h2>
              <p className="text-[10px] text-blu-steel">
                {th
                  ? "กรอกหรือสแกน QR (ใช้ได้ทั้งรหัสระบบและเลขบัตรแข็ง)"
                  : "Type or scan QR (system code or card number both work)"}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2.5 bg-blu-ice/50 border border-blu-sky/40 rounded-xl px-3.5 py-3 focus-within:border-blu-slate focus-within:bg-white transition-colors">
              <User className="w-4 h-4 text-blu-steel shrink-0" />
              <input
                type="text"
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                placeholder="BLU-1001 / CARD-8899"
                className="flex-1 bg-transparent text-blu-dark text-sm placeholder:text-blu-ocean/60 focus:outline-none uppercase"
              />
            </div>
            <button
              onClick={() => setScanOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-3 rounded-xl bg-blu-dark text-white text-xs font-bold hover:bg-blu-navy transition-colors cursor-pointer shrink-0"
            >
              <ScanLine className="w-4 h-4" />
              {th ? "สแกน" : "Scan"}
            </button>
          </div>
        </div>

        {/* Reward code */}
        <div className="rounded-2xl bg-white border border-blu-sky/40 shadow-sm p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blu-ice border border-blu-sky/40 flex items-center justify-center">
              <Ticket className="w-5 h-5 text-blu-slate" />
            </div>
            <div>
              <h2 className="text-sm font-black text-blu-dark">
                {th ? "2. รหัสของรางวัล" : "2. Reward Code"}
              </h2>
              <p className="text-[10px] text-blu-steel">
                {th
                  ? "รหัสที่สมาชิกได้รับตอนกดแลกในแอป"
                  : "Code the member received when redeeming"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 bg-blu-ice/50 border border-blu-sky/40 rounded-xl px-3.5 py-3 focus-within:border-blu-slate focus-within:bg-white transition-colors">
            <Gift className="w-4 h-4 text-blu-steel shrink-0" />
            <input
              type="text"
              value={rewardCode}
              onChange={(e) => setRewardCode(e.target.value)}
              placeholder="BLU-RW-2-XXXXXX"
              className="flex-1 bg-transparent text-blu-dark text-sm placeholder:text-blu-ocean/60 focus:outline-none uppercase font-mono"
            />
          </div>
        </div>
      </section>

      {/* Verify button */}
      <button
        onClick={handleVerify}
        disabled={!memberQuery.trim() || !rewardCode.trim()}
        className="btn-gold w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Search className="w-4 h-4" />
        {th ? "ตรวจสอบและยืนยัน" : "Verify & Confirm"}
      </button>

      {/* Result */}
      {result && (
        <div
          className={
            "rounded-2xl border p-4 flex items-start gap-3 " +
            (result.kind === "success"
              ? "bg-blu-yellow/10 border-blu-yellow/40"
              : "bg-rose-500/10 border-rose-500/30")
          }
        >
          {result.kind === "success" ? (
            <CheckCircle2 className="w-5 h-5 text-blu-yellow shrink-0 mt-0.5" />
          ) : (
            <X className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
          )}
          <div>
            <div className="text-sm font-black text-blu-dark">{result.title}</div>
            <div className="text-xs text-blu-steel mt-0.5">{result.detail}</div>
          </div>
        </div>
      )}

      {/* Pending list */}
      <section className="rounded-2xl bg-white border border-blu-sky/40 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-blu-sky/30 flex items-center justify-between">
          <h2 className="text-sm font-black text-blu-dark">
            {th ? "รายการรอรับของรางวัล" : "Pending Redemptions"}
          </h2>
          <span className="text-[10px] font-bold text-blu-yellow bg-blu-yellow/10 px-2 py-0.5 rounded-full">
            {pending.length} {th ? "รายการ" : "items"}
          </span>
        </div>

        {pending.length === 0 ? (
          <div className="p-8 text-center text-sm text-blu-steel">
            {th ? "ไม่มีรายการรอรับในขณะนี้" : "No pending redemptions"}
          </div>
        ) : (
          <ul className="divide-y divide-blu-sky/20">
            {pending.map((r) => {
              const reward = mockRewards.find((rw) => rw.id === r.rewardId);
              return (
                <li key={r.rewardCode} className="px-4 sm:px-5 py-3 flex items-center gap-3">
                  {reward?.imageUrl ? (
                    <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0">
                      <Image
                        src={reward.imageUrl}
                        alt={r.rewardTitle}
                        width={40}
                        height={40}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-blu-ice border border-blu-sky/40 flex items-center justify-center shrink-0">
                      <Gift className="w-5 h-5 text-blu-slate" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-blu-dark truncate">
                      {r.rewardTitle}
                    </div>
                    <div className="text-[10px] text-blu-steel font-mono">
                      {r.rewardCode} · {r.memberName}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-black text-blu-yellow">
                      -{r.pointsSpent}
                    </div>
                    <div className="text-[9px] text-blu-steel">
                      {th ? "แต้ม" : "pts"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Scan Modal (simulated for prototype) */}
      {scanOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-blu-dark/70 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white rounded-3xl p-6 text-center shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black text-blu-dark">
                {th ? "สแกน QR บัตรสมาชิก" : "Scan Member Card QR"}
              </h3>
              <button
                onClick={() => setScanOpen(false)}
                className="text-blu-steel hover:text-blu-dark transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Simulated viewfinder */}
            <div className="relative aspect-square rounded-2xl overflow-hidden bg-blu-dark mb-4">
              <div className="absolute inset-0 flex items-center justify-center">
                <ScanLine className="w-16 h-16 text-blu-sky/30" />
              </div>
              {/* Corner marks */}
              <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-blu-yellow rounded-tl-lg" />
              <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-blu-yellow rounded-tr-lg" />
              <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-blu-yellow rounded-bl-lg" />
              <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-blu-yellow rounded-br-lg" />
              <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-40 h-0.5 bg-blu-yellow/70 animate-pulse" />
            </div>

            <p className="text-[11px] text-blu-steel mb-4">
              {th
                ? "Phase ต้นแบบ: จำลองการสแกน (จะเชื่อมกล้อง/เครื่องอ่าน 4600s 2D USB ใน Phase จริง)"
                : "Prototype: simulated scan (real camera / 4600s 2D USB in production)"}
            </p>

            <button
              onClick={handleSimulateScan}
              className="btn-gold w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
            >
              <ScanLine className="w-4 h-4" />
              {th ? "จำลองสแกนสำเร็จ" : "Simulate Scan"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
