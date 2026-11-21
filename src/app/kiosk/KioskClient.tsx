"use client";
import { useEffect, useRef, useState } from "react";
import PasswordInput from "@/components/PasswordInput";

type Result = { ok?: boolean; reason?: string; error?: string; member?: { name: string; photo: string | null } };
type Direction = "IN" | "OUT";
type Scan = { code: string; requestKey: string; direction?: Direction };
const messages: Record<string, string> = {
  EXIT: "บันทึกออกแล้ว • ขอบคุณที่ใช้บริการ", ALREADY_IN: "มีรายการเข้าอยู่แล้ว กรุณาเลือกออกเมื่อต้องการเช็กเอาต์",
  NO_OPEN_VISIT: "ไม่พบรายการเข้าที่ยังเปิดอยู่ กรุณาติดต่อพนักงาน",
  PAID_ENTRY: "เข้าใช้บริการได้ • ยินดีต้อนรับ", FREE_ENTRY: "เข้าใช้บริการได้ • ใช้คูปองฟรี 1 ครั้งแล้ว",
  BOUNCE: "รับการสแกนนี้แล้ว กรุณารอสักครู่", NOT_FOUND: "ไม่พบสมาชิก กรุณาติดต่อพนักงาน",
  SUSPENDED: "ยังเข้าใช้บริการไม่ได้ กรุณาติดต่อพนักงาน", CLOSED: "นอกเวลาทำการ 07:00–22:00",
  OFF_PEAK: "นอกช่วงแพ็กเกจ 07:00–14:00", NO_ENTITLEMENT: "ไม่มีสิทธิ์ใช้งานที่ยังใช้ได้ กรุณาติดต่อพนักงาน",
};
export default function KioskClient({ expiresAt }: { expiresAt: string }) {
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const last = useRef(new Map<string, number>());
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState<Scan | null>(null);
  const [outSupported, setOutSupported] = useState<boolean | null>(null);
  const [direction, setDirection] = useState<Direction>("IN");
  const [working, setWorking] = useState(false);
  const [exit, setExit] = useState(false);
  const [password, setPassword] = useState("");
  const [expired, setExpired] = useState(false);
  const [sound, setSound] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => { if (Date.now() >= Date.parse(expiresAt)) { setExpired(true); setResult(null); } }, 1000);
    const controller = new AbortController();
    let checking = false;
    async function checkStatus() {
      if (checking) return;
      checking = true;
      try {
        const r = await fetch("/api/kiosk/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
        if (r.status === 401) { setExpired(true); setResult(null); }
        else if (r.ok) { const data = await r.json(); setOutSupported(data.outSupported === true); }
      } catch { /* Keep the last known mode and retry status on the next poll. */ }
      finally { checking = false; }
    }
    void checkStatus();
    const health = setInterval(() => { void checkStatus(); }, 30000);
    return () => { clearInterval(timer); clearInterval(health); controller.abort(); };
  }, [expiresAt]);
  useEffect(() => {
    if (!result || pending) return;
    const timer = setTimeout(() => setResult(null), 8000);
    return () => clearTimeout(timer);
  }, [result, pending]);
  useEffect(() => { if (!exit && !working && !pending && !expired && outSupported !== null) input.current?.focus(); }, [exit, working, pending, expired, outSupported]);
  async function scan(payload: Scan) {
    if (busy.current || expired) return;
    busy.current = true; setWorking(true); setPending(payload);
    try {
      const response = await fetch("/api/kiosk/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(12000) });
      const data: Result = await response.json();
      if (response.status === 401) { setExpired(true); setPending(null); }
      else if (response.status < 500) { setPending(null); last.current.set(payload.code, Date.now()); }
      setResult(data);
      if (sound && data.ok) {
        try {
        const audio = new AudioContext(); const oscillator = audio.createOscillator(); const gain = audio.createGain();
        gain.gain.value = 0.08; oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + 0.15); oscillator.onended = () => { void audio.close(); };
        } catch { /* Audio is optional; never turn a confirmed visit into a network retry. */ }
      }
    } catch { setResult({ error: "เครือข่ายขัดข้อง กด ‘ลองคำขอเดิม’ เพื่อยืนยันผล ห้ามสแกนใหม่" }); }
    finally { busy.current = false; setWorking(false); }
  }
  async function leave() {
    if (busy.current) return;
    busy.current = true; setWorking(true);
    try {
      const response = await fetch("/api/kiosk/exit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }), signal: AbortSignal.timeout(12000) });
      const data = await response.json();
      if (response.ok) window.location.replace("/admin"); else setResult(data);
    } catch { setResult({ error: "เชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง" }); }
    finally { setPassword(""); busy.current = false; setWorking(false); }
  }
  return <main className="min-h-screen bg-slate-950 text-white p-8 text-center" onClick={() => { if (!exit) input.current?.focus(); }}>
    <h1 className="text-4xl font-bold">BLU FITNESS • {outSupported && direction === "OUT" ? "เช็กเอาต์" : "เช็กอินเข้า"}</h1>
    <p className="my-4">{outSupported === null ? "กำลังตรวจสอบสถานี…" : outSupported ? "เลือกเข้า หรือ ออก ก่อนสแกน • ไม่เพิ่มแต้ม" : "สถานีเข้าเท่านั้น • ไม่เช็กเอาต์ • ไม่เพิ่มแต้ม"}</p>
    {expired ? <section role="alert" className="my-12 text-3xl">เซสชันสิ้นสุด กรุณาให้พนักงาน <a className="underline" href="/member/login">เข้าสู่ระบบใหม่</a></section> : <>
      {outSupported && <div role="group" aria-label="ประเภทการสแกน" className="flex justify-center gap-3">
        {(["IN", "OUT"] as const).map(mode => <button key={mode} type="button" aria-pressed={direction === mode}
          disabled={working || !!pending || exit} className={`border rounded-xl px-8 py-3 ${direction === mode ? "bg-white text-slate-950" : ""}`}
          onClick={() => { if (busy.current || pending || exit) return; setDirection(mode); setCode(""); setResult(null); }}>
          {mode === "IN" ? "เข้า" : "ออก"}
        </button>)}
      </div>}
      <form className="mx-auto max-w-lg" onSubmit={event => {
        event.preventDefault(); const normalized = code.trim().toUpperCase();
        if (busy.current || pending || exit || outSupported === null || !normalized) return;
        setCode(""); if (Date.now() - (last.current.get(normalized) ?? 0) < 3000) return;
        void scan({ code: normalized, requestKey: crypto.randomUUID(), ...(outSupported ? { direction } : {}) });
      }}>
        <label htmlFor="scanner" className="block text-2xl my-6">{working ? "กำลังตรวจสอบ…" : pending ? "รอยืนยันคำขอเดิม" : "พร้อมสแกน QR สมาชิกหรือบัตร"}</label>
        <input ref={input} id="scanner" value={code} onChange={e => setCode(e.target.value.slice(0, 100))} autoFocus autoComplete="off" disabled={working || !!pending || exit || outSupported === null} className="w-full rounded-xl bg-white text-black p-5 text-2xl" onBlur={() => { if (!exit) setTimeout(() => input.current?.focus(), 100); }} />
        <p className="my-3">ตั้งเครื่อง USB Keyboard Wedge ให้ส่ง Enter ท้ายรหัส</p>
      </form>
      <section aria-live="polite" role="status" className={`my-8 p-8 rounded-xl text-3xl ${result?.ok ? "bg-green-900" : result ? "bg-red-900" : "bg-slate-800"}`}>
        {result?.member && <p className="mb-4">{result.member.name}</p>}
        {result?.member?.photo && (
          // Kiosk uses the stored profile image directly, without a public image proxy.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={result.member.photo} alt="รูปสมาชิก" className="mx-auto h-32 w-32 rounded-xl object-cover mb-4" />
        )}
        {result ? result.error || messages[result.reason || ""] || "กรุณาติดต่อพนักงาน" : "ยินดีต้อนรับ กรุณาสแกน"}
      </section>
      {pending && <button disabled={working} onClick={() => void scan(pending)} className="p-4 border rounded-xl">ลองคำขอเดิม</button>}
      {exit ? <form className="mx-auto max-w-sm mt-8" onSubmit={e => { e.preventDefault(); void leave(); }}>
        <label htmlFor="exit-password">รหัสผ่านบัญชีพนักงานที่เปิดสถานี</label>
        <PasswordInput id="exit-password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={working} className="w-full rounded-xl bg-white text-black p-3" />
        <button disabled={working} className="p-4">ยืนยันออก kiosk</button><button type="button" onClick={() => { setExit(false); setPassword(""); }}>ยกเลิก</button>
      </form> : <button disabled={working || !!pending} onClick={() => { setExit(true); setResult(null); }} className="m-4 p-3 border rounded-xl">พนักงาน: ออกจาก kiosk</button>}
    </>}
    <footer className="mt-8 text-sm text-slate-300">
      <button className="underline m-3" onClick={() => { void document.documentElement.requestFullscreen().catch(() => {}); }}>เต็มหน้าจอ</button>
      <label><input type="checkbox" checked={sound} onChange={e => setSound(e.target.checked)} /> เสียงยืนยัน</label>
      <p>เต็มหน้าจอเป็นเพียงโหมดเบราว์เซอร์ ไม่สามารถป้องกันการออกสู่ระบบปฏิบัติการได้</p>
    </footer>
  </main>;
}
