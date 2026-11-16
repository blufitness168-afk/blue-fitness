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
      <span className="text-xs text-slate-400">
        —
      </span>
    );
  }

  const targetRole = currentRole === "ADMIN" ? "MEMBER" : "ADMIN";
  const actionLabel = currentRole === "ADMIN" ? "ปรับเป็น Member" : "ปรับเป็น Admin";
  const confirmText = currentRole === "ADMIN"
    ? `ยืนยันการปรับสิทธิ์ (${phone}) เป็น สมาชิกทั่วไป (MEMBER) หรือไม่?`
    : `ยืนยันการแต่งตั้ง (${phone}) เป็น แอดมิน (ADMIN) หรือไม่?`;

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
        className={`inline-flex items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer ${
          currentRole === "ADMIN"
            ? "bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-300"
            : "bg-blue-600 text-white hover:bg-blue-700"
        }`}
      >
        {busy ? "กำลังบันทึก…" : actionLabel}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
