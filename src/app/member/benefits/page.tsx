"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { buttonClass, MockNotice, panelClass } from "@/components/AdminScanner";
import { defaultMockMember } from "@/lib/mock-data";
import { BENEFITS_EVENT, BENEFITS_KEY, readBenefits, readMembership, type BenefitsState, type MockMembership } from "@/lib/benefits";

export default function MockBenefitsWallet() {
  const [state, setState] = useState<BenefitsState | null>(null);
  const [member, setMember] = useState<{ memberCode: string; fullName: string } | null>(null);
  const [membership, setMembership] = useState<MockMembership | null>(null);
  const [usingDefault, setUsingDefault] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(() => {
    try {
      const saved = localStorage.getItem("blu_member");
      const profile = saved === null ? defaultMockMember : JSON.parse(saved);
      if (!profile || typeof profile.memberCode !== "string" || !/^BLU-\d+$/.test(profile.memberCode) || typeof profile.fullName !== "string") throw new Error("ข้อมูลโปรไฟล์สมาชิกไม่ถูกต้อง กรุณาตรวจสอบ blu_member");
      const benefits = readBenefits();
      const current = readMembership(profile.memberCode);
      setMember({ memberCode: profile.memberCode, fullName: profile.fullName });
      setUsingDefault(saved === null);
      setState(benefits);
      setMembership(current);
      setError("");
    } catch (cause) {
      setState(null); setMember(null); setMembership(null);
      setError(cause instanceof Error ? cause.message : "อ่านกระเป๋าไม่ได้");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const sync = (e: StorageEvent) => { if (e.key === BENEFITS_KEY || e.key === "blu_member" || e.key === null) refresh(); };
    window.addEventListener("storage", sync); window.addEventListener(BENEFITS_EVENT, refresh);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener(BENEFITS_EVENT, refresh); };
  }, [refresh]);
  const grants = state?.grants.filter(g => g.memberCode === member?.memberCode) ?? [];
  return <main className="mx-auto max-w-4xl space-y-5 px-4 py-24 text-blu-dark">
    <h1 className="text-2xl font-black">กระเป๋าสิทธิ์ทดลอง (Mock Wallet)</h1><MockNotice />
    <p className="text-sm">ใช้โปรไฟล์ blu_member ในเบราว์เซอร์ หรือ defaultMockMember เมื่อยังไม่มีโปรไฟล์ ไม่ใช่การยืนยันตัวตนจาก backend • แสดงเฉพาะสิทธิ์ที่แจกให้รหัสสมาชิกนี้</p>
    <p className="text-sm">ส่วนลดที่ได้รับแจกใช้ใน PaymentModal ตอนซื้อแพ็กเกจ mock: บันทึกแพ็กเกจและใช้ส่วนลดพร้อมกันเมื่อยืนยันสำเร็จ ไม่มีการตัดเงินจริง • คูปองนำ QR ไปแลกที่ Admin/Coupons; คูปองเพิ่มวันต้องมีแพ็กเกจ mock ที่บันทึกแล้ว</p>
    <nav className="flex flex-wrap gap-4 text-sm underline"><Link href="/#packages">เลือกซื้อ / ต่ออายุแพ็กเกจ</Link><Link href="/member">บัตรสมาชิก</Link><Link href="/member/rewards">ของรางวัล</Link></nav>
    <section className={panelClass}>
      {member && <p>สมาชิก: <strong>{member.fullName} ({member.memberCode})</strong> • {usingDefault ? "โปรไฟล์ตัวอย่างเริ่มต้น (mock)" : "โปรไฟล์ในเบราว์เซอร์ (mock)"}</p>}
      {member && (membership ? <p className="text-sm">แพ็กเกจ mock: {membership.name} • {membership.timeSlot} • หมดอายุ {new Date(membership.expiresAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</p> : <p className="text-sm">ยังไม่มีแพ็กเกจ mock ที่บันทึก — ต้องซื้อแพ็กเกจก่อนแลกคูปองเพิ่มวัน</p>)}
      <button className={buttonClass} onClick={refresh}>โหลดกระเป๋าใหม่</button>
    </section>
    {error && <p role="alert" className="rounded-xl bg-rose-100 p-4">{error}</p>}
    <div className="grid gap-4 sm:grid-cols-2">{grants.map(g => <article key={g.id} className={panelClass}>
      <h2 className="font-bold">{g.definition.name}</h2>
      <p className="text-sm">{g.definition.kind === "PROMO" ? `ส่วนลด ${g.definition.amount}${g.definition.discountType === "PERCENT" ? "%" : " บาท"} • ยอดขั้นต่ำ ${g.definition.minSpend} บาท` : `${g.definition.benefit === "EXTRA_DAYS" ? "เพิ่มวันแพ็กเกจ (mock)" : "พาเพื่อน"} ${g.definition.amount}`}</p>
      <p className="text-sm">{g.definition.detail}</p>
      <p className="text-xs">หมดอายุ {new Date(g.definition.expiresAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</p>
      <p className="font-bold">{g.status === "USED" ? "ใช้แล้ว" : "ยังไม่ใช้"}{!state!.definitions.find(d => d.id === g.definition.id)?.active ? " • ระงับ" : ""}</p>
      {g.usedAt && <p className="text-xs">ใช้เมื่อ {new Date(g.usedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}{g.paymentId && ` • ชำระ mock ${g.paidAmount} บาท • รายการ ${g.paymentId}`}</p>}
      <QRCodeSVG value={g.code} size={144} title={`สิทธิ์ ${g.memberName}`} />
      <p className="break-all font-mono text-xs select-all">{g.code}</p>
      {g.definition.kind === "PROMO" && <Link className="block text-sm underline" href="/#packages">เลือกแพ็กเกจเพื่อใช้ส่วนลด — ตรวจสอบสิทธิ์อีกครั้งตอนชำระ</Link>}
    </article>)}</div>
    {state && !grants.length && <p className={panelClass}>ยังไม่มีสิทธิ์ที่แจกให้สมาชิกนี้ — ไม่สร้างคูปองหรือส่วนลดอัตโนมัติ</p>}
  </main>;
}
