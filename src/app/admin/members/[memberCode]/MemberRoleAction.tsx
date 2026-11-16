"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface MemberRoleActionProps {
  phone: string;
  currentRole: string;
  callerRole?: string;
}

export default function MemberRoleAction({
  phone,
  currentRole,
  callerRole,
}: MemberRoleActionProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only OWNER can change roles
  if (callerRole !== "OWNER") {
    return null;
  }

  // Target member is already OWNER - cannot be modified via UI
  if (currentRole === "OWNER") {
    return (
      <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700 ring-1 ring-inset ring-purple-600/20">
        สิทธิ์ OWNER (กำหนดผ่านเดฟเท่านั้น)
      </span>
    );
  }

  const targetRole = currentRole === "ADMIN" ? "MEMBER" : "ADMIN";
  const actionLabel = currentRole === "ADMIN" ? "ปรับเป็น Member" : "ตั้งเป็น Admin";
  const confirmText = currentRole === "ADMIN"
    ? "ต้องการปรับสิทธิ์เป็น สมาชิกทั่วไป (MEMBER) ใช่หรือไม่?"
    : "ต้องการแต่งตั้งเป็น แอดมิน (ADMIN) ใช่หรือไม่?";

  async function handleToggleRole() {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, role: targetRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "เปลี่ยนบทบาทไม่สำเร็จ");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleToggleRole()}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer ${
          currentRole === "ADMIN"
            ? "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300"
            : "bg-blu-slate text-white hover:bg-blu-navy"
        }`}
      >
        {busy ? "กำลังบันทึก…" : actionLabel}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
