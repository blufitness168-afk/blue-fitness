import Link from "next/link";
import {
  CreditCard,
  QrCode,
  ShieldAlert,
  Activity,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Flame,
} from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-[#060b19] via-[#0a122c] to-[#060b19] text-white flex flex-col justify-between p-6 sm:p-12 relative overflow-hidden">
      {/* Background Glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[40vw] h-[40vw] bg-[#003087]/30 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] bg-[#ffd700]/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Header */}
      <header className="max-w-6xl w-full mx-auto flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#003087] to-[#001845] border border-[#ffd700]/40 flex items-center justify-center font-black text-[#ffd700] text-xl shadow-[0_0_15px_rgba(0,48,135,0.8)]">
            BLU
          </div>
          <div>
            <div className="font-extrabold tracking-wider text-lg leading-tight">BLU FITNESS</div>
            <div className="text-[10px] text-[#ffd700] tracking-widest uppercase">Digital Membership</div>
          </div>
        </div>

        <Link
          href="/test"
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all"
        >
          <Activity className="w-3.5 h-3.5 animate-pulse" />
          <span>API Diagnostics</span>
        </Link>
      </header>

      {/* Hero Section */}
      <section className="max-w-4xl w-full mx-auto text-center my-12 z-10 space-y-6">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#0d1b3e] border border-amber-500/30 text-amber-300 text-xs font-bold shadow-lg">
          <Sparkles className="w-3.5 h-3.5 text-[#ffd700]" />
          ระบบจัดการสมาชิกและสแกนเช็คอินฟิตเนสออนไลน์
        </div>

        <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-tight">
          SMART FITNESS <br />
          <span className="bg-gradient-to-r from-[#ffd700] via-[#fff2a3] to-[#d4af37] bg-clip-text text-transparent">
            ONLINE MEMBERSHIP
          </span>
        </h1>

        <p className="text-slate-300 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
          ระบบบัตรสมาชิกดิจิทัล นับเวลาถอยหลังอายุสมาชิก ชำระเงิน PromptPay ตรวจสลิปอัตโนมัติ 
          และสแกน Check-in สะสมแต้มหน้าร้านครบวงจร
        </p>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6 text-left">
          {/* Card 1: Diagnostics */}
          <Link
            href="/test"
            className="group bg-[#0d1b3e]/70 hover:bg-[#132452] border border-amber-500/20 hover:border-amber-500/60 rounded-2xl p-5 transition-all flex flex-col justify-between shadow-xl hover:shadow-[0_0_25px_rgba(255,215,0,0.15)]"
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Activity className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base text-white mb-1">ทดสอบระบบ (Health Check)</h3>
              <p className="text-xs text-slate-400">ตรวจสอบสถานะ Neon, Cloudinary, EasySlip, SMS, และ LINE</p>
            </div>
            <div className="mt-4 flex items-center text-xs font-bold text-emerald-400 group-hover:translate-x-1 transition-transform">
              เปิดหน้าทดสอบ <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </div>
          </Link>

          {/* Card 2: Member App */}
          <div className="bg-[#0d1b3e]/70 border border-slate-700/60 rounded-2xl p-5 flex flex-col justify-between opacity-85">
            <div>
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center mb-4">
                <CreditCard className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base text-white mb-1">ฝั่งสมาชิก (Member App)</h3>
              <p className="text-xs text-slate-400">บัตรดิจิทัล, ตัวเลขนับถอยหลัง, แพ็กเกจ, กระเป๋าคูปอง และแลกแต้ม</p>
            </div>
            <div className="mt-4 flex items-center text-xs font-bold text-[#ffd700]">
              Phase 2 & 3 (In Progress)
            </div>
          </div>

          {/* Card 3: Admin & Scanner */}
          <div className="bg-[#0d1b3e]/70 border border-slate-700/60 rounded-2xl p-5 flex flex-col justify-between opacity-85">
            <div>
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center mb-4">
                <QrCode className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base text-white mb-1">ฝั่งแอดมิน (Front Desk)</h3>
              <p className="text-xs text-slate-400">เครื่องสแกนกล้อง/ฮาร์ดแวร์ +1 แต้ม, ตารางสมาชิก Excel, ตรวจสลิป</p>
            </div>
            <div className="mt-4 flex items-center text-xs font-bold text-[#ffd700]">
              Phase 4 (In Progress)
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="max-w-6xl w-full mx-auto text-center text-xs text-slate-500 py-4 border-t border-slate-800/80 z-10 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div>© 2026 Blu Fitness Cha-am. All rights reserved.</div>
        <div className="text-slate-400">
          Staging URL: <span className="text-[#ffd700]">https://blue-fitness-chi.vercel.app</span>
        </div>
      </footer>
    </main>
  );
}
