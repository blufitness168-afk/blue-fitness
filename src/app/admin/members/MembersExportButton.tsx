"use client";

import { useState } from "react";
import { Download } from "lucide-react";

export default function MembersExportButton({ queryString }: { queryString: string }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const exportXlsx = async () => {
    if (exporting) return;
    setExporting(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/members/export${queryString ? `?${queryString}` : ""}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "ส่งออกไม่สำเร็จ");
      }
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? "members.xlsx";
      const url = URL.createObjectURL(await response.blob());
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ส่งออกไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void exportXlsx()}
        disabled={exporting}
        className="btn-blue inline-flex h-10 items-center gap-2 rounded-xl px-4 text-xs disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        {exporting ? "กำลังส่งออก…" : "Export .xlsx"}
      </button>
      {error && (
        <p role="alert" className="text-xs font-semibold text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}
