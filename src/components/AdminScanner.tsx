"use client";

import { useLayoutEffect, useRef, useState } from "react";
import CheckinCamera from "./CheckinCamera";

export const panelClass = "rounded-2xl border border-blu-sky/50 bg-white p-5 space-y-4";
export const inputClass = "w-full rounded-xl border border-blu-sky bg-white px-3 py-2 text-sm disabled:opacity-50";
export const buttonClass = "rounded-xl bg-blu-dark px-4 py-2 text-sm font-bold text-white disabled:opacity-40";

export function MockNotice() {
  return <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Mock • เฉพาะเบราว์เซอร์นี้</strong> — ข้อมูลบันทึกใน localStorage ไม่ใช่ฐานข้อมูลจริง ไม่มี API/Auth สำหรับ production ไม่ซิงก์ข้ามอุปกรณ์ ต้องใช้ HTTPS/localhost และ Web Locks; การล้างข้อมูลทำให้ประวัติ mock หาย</p>;
}

export default function AdminScanner({ label, disabled = false, onScan }: { label: string; disabled?: boolean; onScan: (code: string, source: "CAMERA" | "USB_MANUAL") => void | Promise<void> }) {
  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState("");
  const last = useRef({ code: "", time: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const restoreFocus = useRef(false);
  const usbRequested = useRef(false);
  const latest = useRef({ disabled, camera, onScan });
  const processing = useRef(false);
  useLayoutEffect(() => {
    latest.current = { disabled, camera, onScan };
    if (camera) return;
    const active = document.activeElement;
    if (disabled) {
      if (active === inputRef.current || (active && formRef.current?.contains(active))) restoreFocus.current = true;
    } else if (usbRequested.current) {
      usbRequested.current = false;
      restoreFocus.current = false;
      inputRef.current?.focus();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      // Do not take focus away from another field the operator chose while paused.
      if (active === document.body || (active && formRef.current?.contains(active))) inputRef.current?.focus();
    }
  }, [disabled, camera, onScan]);
  async function scan(value: string, source: "CAMERA" | "USB_MANUAL" = "USB_MANUAL") {
    const current = latest.current;
    if (current.disabled || processing.current || (source === "CAMERA") !== current.camera) return;
    const normalized = value.trim().toUpperCase();
    if (!normalized || (last.current.code === normalized && Date.now() - last.current.time < 3000)) return;
    last.current = { code: normalized, time: Date.now() };
    setCode("");
    processing.current = true;
    try { await current.onScan(normalized, source); }
    finally { processing.current = false; }
  }
  return <section className={panelClass}>
    <h2 className="font-bold">{label}</h2>
    <div className="flex gap-2"><button type="button" className={buttonClass} disabled={disabled} aria-pressed={!camera} onClick={() => { usbRequested.current = camera; setCamera(false); if (!camera) inputRef.current?.focus(); }}>USB / พิมพ์</button><button type="button" className={buttonClass} disabled={disabled} aria-pressed={camera} onClick={() => setCamera(true)}>กล้อง</button></div>
    {disabled && <p role="status">พักรับสแกนระหว่างตรวจสอบ/บันทึก</p>}
    {camera ? <CheckinCamera paused={disabled} onScan={value => { void scan(value, "CAMERA"); }} /> : <form ref={formRef} className="flex gap-2" onSubmit={e => { e.preventDefault(); void scan(code); }}><input ref={inputRef} aria-label={label} aria-disabled={disabled} readOnly={disabled} className={inputClass} autoComplete="off" maxLength={100} value={code} onChange={e => { if (!latest.current.disabled && !processing.current) setCode(e.target.value); }} placeholder="คลิกที่นี่ แล้วสแกนหรือพิมพ์รหัส" /><button className={buttonClass} disabled={disabled || !code.trim()}>ตรวจสอบ</button></form>}
    <p className="text-xs text-blu-steel">USB ส่ง Enter ท้ายรหัส • กันอ่านรหัสเดิมซ้ำ 3 วินาที • การสแกนไม่ยืนยันการแจก/แลกสิทธิ์เอง</p>
  </section>;
}

export function Confirmation({ children, busy, onConfirm, onCancel, label = "ยืนยันรายการ" }: { children: React.ReactNode; busy: boolean; onConfirm: () => void; onCancel: () => void; label?: string }) {
  const [verified, setVerified] = useState(false);
  return <section role="region" aria-label="ตรวจสอบก่อนยืนยัน" className="rounded-2xl border-2 border-blu-yellow bg-white p-5 space-y-4">
    {children}
    <label className="flex gap-3 text-sm"><input type="checkbox" checked={verified} disabled={busy} onChange={e => setVerified(e.target.checked)} />ตรวจสอบข้อมูลและผู้รับตรงกับรายการแล้ว</label>
    <p className="text-xs text-blu-steel">ไม่ใช้ Enter ยืนยัน เพื่อป้องกันเครื่องสแกนทำรายการเอง • คลิก/แตะ หรือ Tab แล้ว Space</p>
    <div className="flex gap-3"><button type="button" className={buttonClass} disabled={busy} onClick={onCancel}>ยกเลิก</button><button type="button" className="btn-gold rounded-xl px-4 py-2 disabled:opacity-40" disabled={busy || !verified} onClick={onConfirm}>{busy ? "กำลังบันทึก…" : label}</button></div>
  </section>;
}
