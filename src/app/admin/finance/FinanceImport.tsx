"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FINANCE_IMPORT_CATEGORIES, FINANCE_IMPORT_TEMPLATE, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS,
  type ImportIssue, type ImportReceipt, type ImportRow,
} from "@/lib/finance-import-csv";

const messages: Record<string, string> = {
  header: "หัวตารางไม่ตรงแม่แบบ", row_count: `ต้องมี 1–${MAX_IMPORT_ROWS} รายการ`, csv: "รูปแบบ CSV ไม่ถูกต้อง (6 ช่อง ห้ามขึ้นบรรทัดในช่อง)",
  reference: "รหัสต้นทางต้องใช้ A–Z, 0–9, จุด, ขีด หรือ _ ไม่เกิน 80 ตัว",
  duplicate_content: "ข้อมูลรายการซ้ำกันในไฟล์แม้รหัสต้นทางต่างกัน",
  duplicate_reference: "รหัสต้นทางซ้ำในไฟล์หรือเคยนำเข้าแล้ว", date: "วันที่ไม่ถูกต้อง (YYYY-MM-DD ค.ศ.)",
  historical_date: "ต้องเป็นวันที่ก่อนวันนี้ตามเวลาไทย ตั้งแต่ปี 2000", category: "ประเภทหรือหมวดไม่อนุญาตให้นำเข้า",
  category_unavailable: "ระบบบัญชีรุ่นนี้ยังไม่รองรับหมวดนี้", amount: "ยอดต้องมากกว่า 0 ไม่เกิน 10 ล้านบาท ทศนิยมไม่เกิน 2 ตำแหน่ง",
  note: "ต้องมีหมายเหตุไม่เกิน 500 ตัวอักษร", manual_match: "ตรงกับรายการบัญชีที่เคยบันทึกแล้ว",
  lifecycle_match: "อาจซ้ำกับรายการแพ็กเกจ/รายการเจ้าหน้าที่/คืนเงิน ให้นำออกจากไฟล์และตรวจสอบ",
};
const money = (satang: number) => (satang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function FinanceImport() {
  const router = useRouter();
  const [upload, setUpload] = useState<{ file: File; key: string } | null>(null);
  const [preview, setPreview] = useState<{ rows: ImportRow[]; proof: string } | null>(null);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [receipt, setReceipt] = useState<ImportReceipt | null>(null);
  const [error, setError] = useState("");
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);

  async function send(action: "preview" | "commit") {
    if (!upload || lock.current || (action === "commit" && (!preview || !attested))) return;
    lock.current = true;
    setBusy(true); setError(""); setIssues([]);
    if (action === "preview") { setPreview(null); setAttested(false); }
    try {
      const response = await fetch(`/api/admin/finance/import?action=${action}`, {
        method: "POST", body: upload.file, headers: {
          "Content-Type": "text/csv", "X-Import-Key": upload.key,
          ...(action === "commit" && preview ? { "X-Import-Preview": preview.proof, "X-Import-Attested": "yes" } : {}),
        },
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.issues) {
          setIssues(result.issues); setPreview(null); setUncertain(false);
        } else {
          setError(result.error ?? "นำเข้าไม่สำเร็จ");
          if (action === "commit" && response.status >= 500) setUncertain(true);
          else if (!uncertain) setPreview(null);
        }
      } else if (result.receipt) {
        setReceipt(result.receipt); setPreview(null); setUncertain(false);
        router.refresh();
      } else if (action === "preview" && result.rows && result.proof) {
        setPreview({ rows: result.rows, proof: result.proof });
      } else throw new Error("Unexpected response");
    } catch {
      if (action === "commit") setUncertain(true);
      setError(action === "commit" ? "ยังยืนยันผลไม่ได้ ให้ลองยืนยันชุดเดิมอีกครั้ง" : "ตรวจไฟล์ไม่สำเร็จ กรุณาลองใหม่");
    } finally { lock.current = false; setBusy(false); }
  }

  return <details className="rounded-xl border border-blu-steel/20 bg-white p-4 text-sm" >
    <summary className="cursor-pointer font-bold">นำเข้ารายรับ–รายจ่ายย้อนหลัง (CSV)</summary>
    <div className="mt-3 space-y-3">
      <a className="underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(FINANCE_IMPORT_TEMPLATE)}`} download="finance-history-template.csv">ดาวน์โหลดแม่แบบ CSV</a>
      <p>ใช้ CSV UTF-8 สูงสุด {MAX_IMPORT_ROWS} รายการ / 256 KiB · วันที่ ค.ศ. YYYY-MM-DD ก่อนวันนี้ตามเวลาไทย · ยอดบาทไม่ใส่คอมมา</p>
      <p>ใช้รหัสต้นทางเดิม (เช่น ARCHIVE-1001) ต่อหนึ่งรายการ ห้ามนำเข้าค่าสมัคร ต่ออายุ แพ็กเกจออนไลน์ รายการเจ้าหน้าที่ หรือเงินคืน</p>
      <p>INCOME: {FINANCE_IMPORT_CATEGORIES.INCOME.join(" / ")}<br />EXPENSE: {FINANCE_IMPORT_CATEGORIES.EXPENSE.join(" / ")}</p>
      <fieldset disabled={busy || uncertain} className="flex flex-wrap items-center gap-2 disabled:opacity-60">
        <label htmlFor="finance-history-csv" className="font-semibold">ไฟล์ CSV</label>
        <input id="finance-history-csv" type="file" accept=".csv,text/csv" onChange={event => {
          const file = event.currentTarget.files?.[0];
          setPreview(null); setAttested(false); setIssues([]); setReceipt(null); setError("");
          if (file && (!/\.csv$/i.test(file.name) || file.size > MAX_IMPORT_BYTES)) {
            setUpload(null); setError("ต้องเป็นไฟล์ .csv ไม่เกิน 256 KiB"); return;
          }
          setUpload(file ? { file, key: crypto.randomUUID() } : null);
        }} />
        <button className="btn-blue rounded-lg px-3 py-2 disabled:opacity-50" type="button" disabled={!upload} onClick={() => void send("preview")}>ตรวจไฟล์ก่อนนำเข้า</button>
      </fieldset>
      {busy && <p role="status">กำลังดำเนินการ…</p>}
      {error && <p role="alert" className="text-rose-700">{error}</p>}
      {issues.length > 0 && <div role="alert" className="text-rose-700"><p>ไม่นำเข้าทั้งชุด กรุณาแก้ไฟล์แล้วเลือกใหม่</p>
        <ul className="max-h-48 overflow-auto">{issues.map(({ line, code }, index) => <li key={`${line}-${code}-${index}`}>{line ? `บรรทัด ${line}: ` : ""}{messages[code] ?? "ข้อมูลไม่ถูกต้อง"}</li>)}</ul>
      </div>}
      {receipt && <p role="status">ชุด {receipt.batchId} · นำเข้าแล้ว {receipt.count} รายการ · รายรับ {money(receipt.incomeSatang)} บาท · รายจ่าย {money(receipt.expenseSatang)} บาท</p>}
      {preview && <div className="space-y-3">
        <p>ผ่านการตรวจ {preview.rows.length} รายการ · ยังไม่ได้บันทึก</p>
        <div className="max-h-72 overflow-auto"><table className="w-full text-left text-xs">
          <thead><tr>{["บรรทัด", "รหัสต้นทาง", "วันที่", "ประเภท", "หมวด", "บาท", "หมายเหตุ"].map(label => <th key={label} scope="col" className="px-2 py-1">{label}</th>)}</tr></thead>
          <tbody>{preview.rows.map(row => <tr key={row.line} className="border-t">
            {[row.line, row.ref, row.date, row.type, row.category, money(row.amountSatang), row.note].map((v, i) => <td key={i} className="px-2 py-1 break-words">{v}</td>)}
          </tr>)}</tbody>
        </table></div>
        <label className="flex items-start gap-2"><input type="checkbox" checked={attested} disabled={busy || uncertain} onChange={event => setAttested(event.currentTarget.checked)} />
          ยืนยันว่าตรวจเทียบต้นทางแล้ว ไม่ใช่รายการแพ็กเกจ/เจ้าหน้าที่/คืนเงิน และยังไม่เคยบันทึกในบัญชี</label>
        <button className="btn-blue rounded-lg px-3 py-2 disabled:opacity-50" type="button" disabled={!attested || busy} onClick={() => void send("commit")}>
          {uncertain ? "ลองยืนยันชุดเดิมอีกครั้ง" : "ยืนยันนำเข้าทั้งชุด"}
        </button>
      </div>}
    </div>
  </details>;
}
