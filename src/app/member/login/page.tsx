"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Mode = "LOGIN" | "PASSWORD_SETUP" | "PASSWORD_RESET";
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("LOGIN");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [ticket, setTicket] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  function changeMode(next: Mode) {
    setMode(next); setChallengeId(""); setTicket(""); setCode(""); setPassword(""); setConfirmation(""); setMessage("");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (ticket && (password.length < 10 || password.length > 128 || password !== confirmation)) {
      setMessage("รหัสผ่านต้องยาว 10–128 ตัวอักษร และตรงกันทั้งสองช่อง"); return;
    }
    setLoading(true); setMessage("");
    try {
      const path = mode === "LOGIN" ? "/api/auth/login" : ticket ? "/api/auth/password/complete" : challengeId ? "/api/auth/verify" : "/api/auth/password/request";
      const body = mode === "LOGIN" ? { phone, password } : ticket ? { ticket, purpose: mode, password } : challengeId ? { challengeId, code } : { phone, purpose: mode };
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "ทำรายการไม่สำเร็จ");
      if (mode === "LOGIN") {
        localStorage.removeItem("blu_member"); router.push("/member"); router.refresh();
      } else if (ticket) {
        changeMode("LOGIN"); setMessage("ตั้งรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบใหม่");
      } else if (challengeId) {
        if (!result.ticket || result.purpose !== mode) throw new Error("การยืนยันไม่ตรงกับรายการ กรุณาขอ OTP ใหม่");
        setTicket(result.ticket);
      } else { setChallengeId(result.challengeId); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "ระบบไม่พร้อมใช้งาน"); }
    finally { setLoading(false); }
  }
  return (
    <main className="min-h-screen bg-blu-dark flex items-center justify-center p-5">
      <section className="w-full max-w-md rounded-2xl bg-white p-7 space-y-5 text-blu-dark">
        <Link href="/" className="font-bold">BLU FITNESS · กลับหน้าหลัก</Link>
        <h1 className="text-2xl font-bold">{mode === "LOGIN" ? "เข้าสู่ระบบ" : mode === "PASSWORD_SETUP" ? "ตั้งรหัสผ่านครั้งแรก" : "ลืมรหัสผ่าน"}</h1>
        <p className="text-sm">{mode === "LOGIN" ? "ใช้เบอร์โทรและรหัสผ่าน สมาชิกเดิมที่ยังไม่มีรหัสผ่าน ให้ตั้งรหัสผ่านครั้งแรก" : "ยืนยันเบอร์โทรด้วย OTP ก่อนตั้งรหัสผ่านใหม่"}</p>
        <form onSubmit={submit} className="space-y-4">
          <label className="block">เบอร์โทรศัพท์
            <input type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} disabled={Boolean(challengeId) || loading} required className="w-full border rounded-xl p-3" />
          </label>
          {mode !== "LOGIN" && challengeId && !ticket && <label className="block">รหัส OTP
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} required className="w-full border rounded-xl p-3" />
          </label>}
          {(mode === "LOGIN" || ticket) && <label className="block">รหัสผ่าน{ticket ? "ใหม่ (10–128 ตัวอักษร)" : ""}
            <input type="password" autoComplete={ticket ? "new-password" : "current-password"} minLength={ticket ? 10 : 1} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} required className="w-full border rounded-xl p-3" />
          </label>}
          {ticket && <label className="block">ยืนยันรหัสผ่านใหม่
            <input type="password" autoComplete="new-password" maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} required className="w-full border rounded-xl p-3" />
          </label>}
          {message && <p role="status" className="text-sm text-rose-700">{message}</p>}
          <button disabled={loading} className="w-full btn-gold rounded-xl p-3 disabled:opacity-50">{loading ? "กำลังดำเนินการ..." : mode === "LOGIN" ? "เข้าสู่ระบบ" : ticket ? "บันทึกรหัสผ่าน" : challengeId ? "ยืนยัน OTP" : "รับ OTP"}</button>
        </form>
        <div className="flex flex-wrap gap-3 text-sm">
          {(["LOGIN", "PASSWORD_SETUP", "PASSWORD_RESET"] as const).filter(item => item !== mode).map(item => <button key={item} disabled={loading} onClick={() => changeMode(item)} className="underline">{item === "LOGIN" ? "เข้าสู่ระบบ" : item === "PASSWORD_SETUP" ? "ตั้งรหัสผ่านครั้งแรก" : "ลืมรหัสผ่าน"}</button>)}
          {challengeId && <button disabled={loading} onClick={() => changeMode(mode)} className="underline">ขอ OTP ใหม่ / เปลี่ยนเบอร์</button>}
          <Link href="/member/register" className="underline">สมัครสมาชิก</Link>
        </div>
      </section>
    </main>
  );
}
