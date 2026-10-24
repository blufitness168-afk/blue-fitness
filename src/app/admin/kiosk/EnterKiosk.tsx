"use client";
import { useState } from "react";
export default function EnterKiosk() {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <section className="p-8"><h1 className="text-3xl font-bold">สถานีเช็กอิน USB</h1>
    <p className="my-4">ใช้บัญชีพนักงานปัจจุบัน จำกัดสิทธิ์เฉพาะเช็กอินเข้า สูงสุด 12 ชั่วโมง ออกด้วยรหัสผ่านบัญชีเดิม</p>
    <button disabled={busy} className="p-4 rounded-xl bg-blu-dark text-white" onClick={async () => {
      setBusy(true); setError("");
      try { const response = await fetch("/api/kiosk/enter", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const result = await response.json(); if (response.ok) window.location.replace("/kiosk"); else setError(result.error);
      } catch { setError("เชื่อมต่อไม่ได้ กรุณาลองใหม่"); } finally { setBusy(false); }
    }}>เปิด kiosk</button><p role="alert">{error}</p></section>;
}
