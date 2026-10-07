"use client";

import CredentialTests from "./CredentialTests";
import Image from "next/image";
import React, { useState, useEffect } from "react";
import {
  Database,
  Cloud,
  Receipt,
  MessageSquare,
  Smartphone,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Send,
  Zap,
  ShieldCheck,
  Activity,
  ArrowRight,
} from "lucide-react";

interface ServiceResult {
  status: "SUCCESS" | "ERROR" | "IDLE" | "TESTING";
  latencyMs?: number;
  data?: any;
  error?: string;
}

export default function TestServicesPage() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{
    database?: ServiceResult;
    cloudinary?: ServiceResult;
    easyslip?: ServiceResult;
    thaibulksms?: ServiceResult;
    line?: ServiceResult;
  }>({});

  const runAllTests = async () => {
    setLoading(true);
    setResults({
      database: { status: "TESTING" },
      cloudinary: { status: "TESTING" },
      easyslip: { status: "TESTING" },
      thaibulksms: { status: "TESTING" },
      line: { status: "TESTING" },
    });

    try {
      const res = await fetch("/api/test-services", { cache: "no-store" });
      const data = await res.json();
      setResults(data.results || {});
    } catch (err: any) {
      console.error("Test fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runAllTests();
  }, []);

  const getStatusBadge = (res?: ServiceResult) => {
    if (!res || res.status === "TESTING") {
      return (
        <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-400 animate-pulse border border-blue-500/30">
          <RefreshCw className="w-3 h-3 animate-spin" /> กำลังทดสอบ...
        </span>
      );
    }
    if (res.status === "SUCCESS") {
      return (
        <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 className="w-3.5 h-3.5" /> ใช้งานได้ปกติ ({res.latencyMs}ms)
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">
        <XCircle className="w-3.5 h-3.5" /> มีข้อผิดพลาด
      </span>
    );
  };

  return (
    <main className="min-h-screen bg-blu-dark text-slate-100 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-blu-yellow/20">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded text-xs font-extrabold bg-blu-slate text-blu-yellow border border-blu-yellow/30 tracking-wider">
                DIAGNOSTICS & HEALTH CHECK
              </span>
              <span className="text-xs text-blu-sky/70">Environment: Staging / Dev</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
              <div className="relative w-9 h-9 rounded-lg overflow-hidden border border-blu-yellow/40 shadow-sm shrink-0">
                <Image
                  src="/logo.jpg"
                  alt="Blu Fitness Logo"
                  width={36}
                  height={36}
                  className="w-full h-full object-cover"
                />
              </div>
              <span>Blu Fitness</span> <span className="text-blu-yellow text-xl font-normal hidden sm:inline">| ตรวจสอบสถานะ API & Database</span>
            </h1>
          </div>

          <button
            onClick={runAllTests}
            disabled={loading}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm bg-gradient-to-r from-blu-yellow to-[#e6c200] text-blu-dark hover:shadow-[0_0_20px_rgba(255,215,0,0.4)] transition-all disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "กำลังวิเคราะห์..." : "ทดสอบระบบทั้งหมดอีกครั้ง"}
          </button>
        </div>

        {/* 5 Core Services Status Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 1. Neon Database */}
          <div className="bg-[#0d1b3e]/80 backdrop-blur-md rounded-2xl p-5 border border-amber-500/15 hover:border-amber-500/40 transition-all flex flex-col justify-between">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Database className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white">Neon PostgreSQL</h3>
                  <p className="text-xs text-slate-400">Serverless Pooling Database</p>
                </div>
              </div>
              {getStatusBadge(results.database)}
            </div>

            <div className="bg-[#060b19]/60 rounded-xl p-3 text-xs font-mono text-slate-300 space-y-1">
              {results.database?.status === "SUCCESS" ? (
                <>
                  <div className="text-emerald-400 font-semibold">✓ Connected successfully</div>
                  <div className="text-slate-400 truncate">Time: {results.database.data?.serverTime}</div>
                  <div className="text-slate-400">Engine: {results.database.data?.version}</div>
                </>
              ) : (
                <div className="text-rose-400 break-words">{results.database?.error || "ยังไม่ได้ทดสอบ"}</div>
              )}
            </div>
          </div>

          {/* 2. Cloudinary */}
          <div className="bg-[#0d1b3e]/80 backdrop-blur-md rounded-2xl p-5 border border-amber-500/15 hover:border-amber-500/40 transition-all flex flex-col justify-between">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  <Cloud className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white">Cloudinary Storage</h3>
                  <p className="text-xs text-slate-400">Media CDN & Image Optimization</p>
                </div>
              </div>
              {getStatusBadge(results.cloudinary)}
            </div>

            <div className="bg-[#060b19]/60 rounded-xl p-3 text-xs font-mono text-slate-300 space-y-1">
              {results.cloudinary?.status === "SUCCESS" ? (
                <>
                  <div className="text-emerald-400 font-semibold">✓ Cloudinary ping: OK</div>
                  <div className="text-slate-400">Cloud Name: {results.cloudinary.data?.cloudName}</div>
                </>
              ) : (
                <div className="text-rose-400 break-words">{results.cloudinary?.error || "ยังไม่ได้ทดสอบ"}</div>
              )}
            </div>
          </div>

          {/* 3. EasySlip API */}
          <div className="bg-[#0d1b3e]/80 backdrop-blur-md rounded-2xl p-5 border border-amber-500/15 hover:border-amber-500/40 transition-all flex flex-col justify-between">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Receipt className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white">EasySlip API</h3>
                  <p className="text-xs text-slate-400">ระบบตรวจสลิปโอนเงิน PromptPay</p>
                </div>
              </div>
              {getStatusBadge(results.easyslip)}
            </div>

            <div className="bg-[#060b19]/60 rounded-xl p-3 text-xs font-mono text-slate-300 space-y-1">
              {results.easyslip?.status === "SUCCESS" ? (
                <>
                  <div className="text-emerald-400 font-semibold">✓ {results.easyslip.data?.message || "Connected"}</div>
                  <div className="text-slate-400">
                    Status: {results.easyslip.data?.statusText || "Ready"}
                  </div>
                </>
              ) : (
                <div className="text-rose-400 break-words">
                  {results.easyslip?.data?.message || results.easyslip?.error || "ยังไม่ได้ทดสอบ"}
                </div>
              )}
            </div>
          </div>

          {/* 4. ThaiBulkSMS */}
          <div className="bg-[#0d1b3e]/80 backdrop-blur-md rounded-2xl p-5 border border-amber-500/15 hover:border-amber-500/40 transition-all flex flex-col justify-between">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Smartphone className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white">ThaiBulkSMS Gateway</h3>
                  <p className="text-xs text-slate-400">ระบบส่ง SMS OTP สมัครสมาชิก</p>
                </div>
              </div>
              {getStatusBadge(results.thaibulksms)}
            </div>

            <div className="bg-[#060b19]/60 rounded-xl p-3 text-xs font-mono text-slate-300 space-y-1">
              {results.thaibulksms?.status === "SUCCESS" ? (
                <>
                  <div className="text-emerald-400 font-semibold">✓ Authentication Valid</div>
                  <div className="text-slate-400">
                    Remaining Credit: {results.thaibulksms.data?.credit ?? "OK"}
                  </div>
                </>
              ) : (
                <div className="text-rose-400 break-words">
                  {results.thaibulksms?.data?.message || results.thaibulksms?.error || "ยังไม่ได้ทดสอบ"}
                </div>
              )}
            </div>
          </div>

          {/* 5. LINE Messaging API (Full width) */}
          <div className="md:col-span-2 bg-[#0d1b3e]/80 backdrop-blur-md rounded-2xl p-5 border border-amber-500/15 hover:border-amber-500/40 transition-all">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-green-500/10 text-green-400 border border-green-500/20">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white">LINE Official Account (Messaging API)</h3>
                  <p className="text-xs text-slate-400">ระบบแจ้งเตือนต่ออายุสมาชิกอัตโนมัติ</p>
                </div>
              </div>
              {getStatusBadge(results.line)}
            </div>

            <div className="bg-[#060b19]/60 rounded-xl p-3 text-xs font-mono text-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {results.line?.status === "SUCCESS" ? (
                <>
                  <div className="flex items-center gap-3">
                    {results.line.data?.pictureUrl && (
                      <img
                        src={results.line.data.pictureUrl}
                        alt="Bot Profile"
                        className="w-10 h-10 rounded-full border border-emerald-500/50"
                      />
                    )}
                    <div>
                      <div className="text-emerald-400 font-bold text-sm">{results.line.data?.botName}</div>
                      <div className="text-slate-400">LINE Basic ID: {results.line.data?.basicId}</div>
                    </div>
                  </div>
                  <div className="text-emerald-400 text-right">
                    ✓ Bot Active & Ready to Push Notifications
                  </div>
                </>
              ) : (
                <div className="text-rose-400 break-words">
                  {results.line?.data?.message || results.line?.error || "ยังไม่ได้ทดสอบ"}
                </div>
              )}
            </div>
          </div>
        </div>

        <CredentialTests />

        {/* Footer Note */}
        <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 pt-4 border-t border-slate-800">
          <div className="flex items-center gap-1.5 text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            เชื่อมต่อผ่าน Next.js App Router Server Actions & Route Handlers
          </div>
          <div className="mt-2 sm:mt-0 text-slate-400">
            URL: <span className="text-white">https://blue-fitness-chi.vercel.app/test</span>
          </div>
        </div>
      </div>
    </main>
  );
}
