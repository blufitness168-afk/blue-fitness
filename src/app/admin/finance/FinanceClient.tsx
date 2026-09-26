"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Pencil, Plus, RotateCcw, Save, X } from "lucide-react";
import AdminDashboardChart, { type ChartDatum, type ChartSeries } from "@/components/AdminDashboardCharts";
import {
  financeCategories,
  reverseFinanceRecord,
  FINANCE_EVENT,
  FINANCE_STORAGE_KEY,
  readFinanceRecords,
  saveFinanceRecord,
  type EditableFinanceInput,
  type FinanceCategory,
  type FinanceRecord,
  type FinanceType,
} from "@/lib/admin-finance";
import { MEMBER_ACCOUNT_EVENT, MEMBER_ACCOUNT_KEY } from "@/lib/member-account";

interface Filters {
  from: string;
  to: string;
  type: "ALL" | FinanceType;
  category: "ALL" | FinanceCategory;
  sort: "NEWEST" | "OLDEST" | "AMOUNT_DESC" | "AMOUNT_ASC";
}

const initialFilters: Filters = {
  from: "2025-10-01",
  to: "2026-09-30",
  type: "ALL",
  category: "ALL",
  sort: "NEWEST",
};

const emptyForm: EditableFinanceInput = {
  date: "2026-09-19",
  type: "INCOME",
  category: "สมัครสมาชิกใหม่",
  amount: 0,
  note: "",
};

const financeSeries: ChartSeries[] = [
  { key: "income", label: "รายได้", color: "#00a86b" },
  { key: "expense", label: "รายจ่าย", color: "#e05545" },
  { key: "net", label: "คงเหลือสุทธิ", color: "#3a728e" },
];

function totals(records: FinanceRecord[]) {
  const income = records.filter((item) => item.type === "INCOME").reduce((sum, item) => sum + item.amount, 0);
  const expense = records.filter((item) => item.type === "EXPENSE").reduce((sum, item) => sum + item.amount, 0);
  return { income, expense, net: income - expense };
}

function money(value: number) {
  return value.toLocaleString("th-TH");
}

function thaiDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function groupChart(records: FinanceRecord[], mode: "month" | "day"): ChartDatum[] {
  const groups = new Map<string, FinanceRecord[]>();
  for (const record of records) {
    const key = mode === "month" ? record.date.slice(0, 7) : record.date;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => {
    const summary = totals(rows);
    return {
      label: mode === "month" ? `${key.slice(5)}/${key.slice(2, 4)}` : `${key.slice(8)}/${key.slice(5, 7)}`,
      values: summary,
    };
  });
}

function csvCell(value: string | number) {
  const text = String(value).replaceAll('"', '""');
  return `"${text}"`;
}

export default function FinancePage() {
  const [records, setRecords] = useState<FinanceRecord[]>([]);
  const [draftFilters, setDraftFilters] = useState<Filters>(initialFilters);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [form, setForm] = useState<EditableFinanceInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [reversalTarget, setReversalTarget] = useState<FinanceRecord | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    try {
      setRecords(readFinanceRecords());
      setError("");
    } catch (cause) {
      setRecords([]);
      setError(cause instanceof Error ? cause.message : "อ่านข้อมูลรายรับ-รายจ่ายไม่สำเร็จ");
    }
  }, []);

  useEffect(() => {
    // Browser-only mock stores are loaded after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const storage = (event: StorageEvent) => {
      if ([null, FINANCE_STORAGE_KEY, MEMBER_ACCOUNT_KEY].includes(event.key)) load();
    };
    window.addEventListener("storage", storage);
    window.addEventListener(FINANCE_EVENT, load);
    window.addEventListener(MEMBER_ACCOUNT_EVENT, load);
    return () => {
      window.removeEventListener("storage", storage);
      window.removeEventListener(FINANCE_EVENT, load);
      window.removeEventListener(MEMBER_ACCOUNT_EVENT, load);
    };
  }, [load]);

  const filtered = useMemo(() => {
    const rows = records.filter((record) =>
      record.date >= filters.from &&
      record.date <= filters.to &&
      (filters.type === "ALL" || record.type === filters.type) &&
      (filters.category === "ALL" || record.category === filters.category),
    );
    return rows.sort((a, b) => {
      if (filters.sort === "OLDEST") return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
      if (filters.sort === "AMOUNT_DESC") return b.amount - a.amount || b.date.localeCompare(a.date);
      if (filters.sort === "AMOUNT_ASC") return a.amount - b.amount || b.date.localeCompare(a.date);
      return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
    });
  }, [records, filters]);

  const cumulative = useMemo(() => totals(records), [records]);
  const current = useMemo(() => totals(filtered), [filtered]);
  const monthlyChart = useMemo(() => groupChart(records, "month").slice(-12), [records]);
  const filterChart = useMemo(() => {
    const rangeDays = Math.ceil((Date.parse(filters.to) - Date.parse(filters.from)) / 86_400_000);
    return groupChart(filtered, rangeDays <= 45 ? "day" : "month");
  }, [filtered, filters]);

  const updateForm = <K extends keyof EditableFinanceInput>(key: K, value: EditableFinanceInput[K]) => {
    setForm((currentForm) => ({ ...currentForm, [key]: value }));
  };

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(undefined);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setNotice("");
    try {
      if (!form.date || !Number.isSafeInteger(form.amount) || form.amount <= 0) throw new Error("กรุณาระบุวันที่และจำนวนเงินมากกว่า 0 บาท");
      saveFinanceRecord(form, editingId);
      setNotice(editingId ? "แก้ไขรายการเรียบร้อย" : "บันทึกรายการเรียบร้อย");
      resetForm();
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึกรายการไม่สำเร็จ");
    }
  };

  const edit = (record: FinanceRecord) => {
    if (record.source !== "MANUAL") return;
    setEditingId(record.id);
    setForm({ date: record.date, type: record.type, category: record.category, amount: record.amount, note: record.note });
    setNotice("");
    document.getElementById("finance-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const reverse = () => {
    if (!reversalTarget) return;
    setError("");
    try {
      reverseFinanceRecord(reversalTarget.id, reversalReason);
      setNotice("ย้อนรายการเรียบร้อย และเก็บรายการเดิมไว้ในประวัติ");
      setReversalTarget(null);
      setReversalReason("");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ย้อนรายการไม่สำเร็จ");
    }
  };

  const exportCsv = () => {
    const header = ["ลำดับ", "วันที่", "ประเภท", "หมวดหมู่", "รหัสสมาชิก", "สมาชิกที่เกี่ยวข้อง", "จำนวนเงิน", "หมายเหตุ"];
    const rows = filtered.map((record, index) => [
      index + 1,
      record.date,
      record.type === "INCOME" ? "รายรับ" : "รายจ่าย",
      record.category,
      record.memberCode ?? "",
      record.memberName ?? "",
      record.amount,
      record.note,
    ]);
    const csv = `\ufeff${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `finance-${filters.from}-${filters.to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const cards = [
    { label: "จำนวนยอดรายได้สะสม", value: cumulative.income, tone: "text-emerald-600" },
    { label: "จำนวนยอดรายจ่ายสะสม", value: cumulative.expense, tone: "text-rose-500" },
    { label: "จำนวนยอดคงเหลือสุทธิสะสม", value: cumulative.net, tone: cumulative.net >= 0 ? "text-blu-slate" : "text-rose-500" },
  ];
  const filteredCards = [
    { label: "รายรับรวม (ตามตัวกรอง)", value: current.income, tone: "text-emerald-600" },
    { label: "รายจ่ายรวม (ตามตัวกรอง)", value: current.expense, tone: "text-rose-500" },
    { label: "คงเหลือสุทธิ (ตามตัวกรอง)", value: current.net, tone: current.net >= 0 ? "text-blu-slate" : "text-rose-500" },
  ];

  return (
    <div className="mx-auto max-w-375 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div><h1 className="text-2xl font-black text-blu-dark">รายรับ - รายจ่าย</h1><p className="mt-1 text-xs text-blu-steel">ระบบการเงินจำลอง เก็บข้อมูลบนเบราว์เซอร์เครื่องนี้</p></div>
        <button type="button" onClick={exportCsv} disabled={!filtered.length} className="btn-blue inline-flex h-10 items-center gap-2 rounded-xl px-4 text-xs disabled:opacity-50"><Download className="h-4 w-4" /> Export CSV</button>
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-600">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">{notice}</div>}

      <section className="rounded-2xl border border-blu-sky/40 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <FilterField label="จากวันที่"><input type="date" value={draftFilters.from} onChange={(event) => setDraftFilters({ ...draftFilters, from: event.target.value })} className="finance-input" /></FilterField>
          <FilterField label="ถึงวันที่"><input type="date" value={draftFilters.to} onChange={(event) => setDraftFilters({ ...draftFilters, to: event.target.value })} className="finance-input" /></FilterField>
          <FilterField label="ประเภท"><select value={draftFilters.type} onChange={(event) => setDraftFilters({ ...draftFilters, type: event.target.value as Filters["type"] })} className="finance-input"><option value="ALL">ทั้งหมด</option><option value="INCOME">รายรับ</option><option value="EXPENSE">รายจ่าย</option></select></FilterField>
          <FilterField label="หมวดหมู่"><select value={draftFilters.category} onChange={(event) => setDraftFilters({ ...draftFilters, category: event.target.value as Filters["category"] })} className="finance-input"><option value="ALL">ทั้งหมด</option>{financeCategories.map((category) => <option key={category}>{category}</option>)}</select></FilterField>
          <FilterField label="เรียงลำดับ"><select value={draftFilters.sort} onChange={(event) => setDraftFilters({ ...draftFilters, sort: event.target.value as Filters["sort"] })} className="finance-input"><option value="NEWEST">วันที่ล่าสุดก่อน</option><option value="OLDEST">วันที่เก่าสุดก่อน</option><option value="AMOUNT_DESC">จำนวนเงินมากก่อน</option><option value="AMOUNT_ASC">จำนวนเงินน้อยก่อน</option></select></FilterField>
          <div className="flex items-end"><button type="button" onClick={() => draftFilters.from <= draftFilters.to ? setFilters(draftFilters) : setError("วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด")} className="btn-blue h-10 w-full rounded-xl px-4 text-xs">กรองข้อมูล</button></div>
        </div>
      </section>

      <SummarySection title="ยอดสะสมทั้งหมด" cards={cards} />
      <SummarySection title="ตามตัวกรองปัจจุบัน" cards={filteredCards} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <AdminDashboardChart title="กราฟ 1 — รายได้ / รายจ่าย / คงเหลือสุทธิ รายเดือน" data={monthlyChart} series={financeSeries} type="bar" valueFormatter={money} />
        <AdminDashboardChart title="กราฟ 2 — รายได้ / รายจ่าย / คงเหลือสุทธิ ตามตัวกรอง" data={filterChart} series={financeSeries} type="line" valueFormatter={money} />
      </div>

      <form id="finance-form" onSubmit={submit} className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-base font-black text-blu-dark">{editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{editingId ? "แก้ไขรายการ" : "บันทึกรายการใหม่"}</h2>{editingId && <button type="button" onClick={resetForm} className="inline-flex items-center gap-1 text-xs font-semibold text-blu-steel"><X className="h-4 w-4" /> ยกเลิกแก้ไข</button>}</div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <FilterField label="วันที่"><input required type="date" value={form.date} onChange={(event) => updateForm("date", event.target.value)} className="finance-input" /></FilterField>
          <FilterField label="ประเภท"><select value={form.type} onChange={(event) => { const type = event.target.value as FinanceType; updateForm("type", type); updateForm("category", type === "INCOME" ? "สมัครสมาชิกใหม่" : "รายจ่ายประจำเดือน"); }} className="finance-input"><option value="INCOME">รายรับ</option><option value="EXPENSE">รายจ่าย</option></select></FilterField>
          <FilterField label="หมวดหมู่"><select value={form.category} onChange={(event) => updateForm("category", event.target.value as FinanceCategory)} className="finance-input">{financeCategories.map((category) => <option key={category}>{category}</option>)}</select></FilterField>
          <FilterField label="จำนวนเงิน (บาท)"><input required type="number" min="1" step="1" value={form.amount || ""} onChange={(event) => updateForm("amount", Number(event.target.value))} className="finance-input" /></FilterField>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
          <FilterField label="หมายเหตุ"><input maxLength={500} value={form.note} onChange={(event) => updateForm("note", event.target.value)} placeholder="รายละเอียดเพิ่มเติม" className="finance-input" /></FilterField>
          <div className="flex items-end"><button type="submit" className="btn-blue inline-flex h-10 items-center justify-center gap-2 rounded-xl px-5 text-xs"><Save className="h-4 w-4" /> {editingId ? "บันทึกการแก้ไข" : "บันทึกรายการ"}</button></div>
        </div>
      </form>

      <section className="overflow-hidden rounded-2xl border border-blu-sky/40 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-blu-sky/30 px-5 py-4"><div><h2 className="text-base font-black text-blu-dark">ประวัติรายรับ-รายจ่าย</h2><p className="mt-1 text-[10px] text-blu-steel">พบ {filtered.length.toLocaleString("th-TH")} รายการ · รายรับจากแพ็กเกจถูกสร้างและป้องกันการแก้ไขอัตโนมัติ</p></div></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-275 text-left text-xs">
            <thead><tr className="bg-blu-ice/60 text-[10px] text-blu-steel">{["ลำดับ", "วันที่", "ประเภท", "หมวดหมู่", "สมาชิกที่เกี่ยวข้อง", "จำนวนเงิน", "หมายเหตุ", "จัดการ"].map((heading) => <th key={heading} className={`px-4 py-3 font-semibold ${heading === "จำนวนเงิน" || heading === "จัดการ" ? "text-right" : ""}`}>{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-blu-sky/20">
              {filtered.map((record, index) => <tr key={record.id} className="hover:bg-blu-ice/30">
                <td className="px-4 py-3 text-blu-steel">{index + 1}</td><td className="whitespace-nowrap px-4 py-3">{thaiDate(record.date)}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${record.type === "INCOME" ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-500"}`}>{record.type === "INCOME" ? "รายรับ" : "รายจ่าย"}</span></td>
                <td className="px-4 py-3 font-semibold">{record.category}{record.source === "MEMBERSHIP" && <span className="ml-1 block text-[9px] font-normal text-blu-steel">อัตโนมัติ</span>}{record.source === "REVERSAL" && <span className="ml-1 block text-[9px] font-normal text-amber-600">ย้อนรายการ</span>}</td>
                <td className="px-4 py-3">{record.memberName ? <><span>{record.memberName}</span><span className="block font-mono text-[9px] text-blu-steel">{record.memberCode}</span></> : "-"}</td>
                <td className={`whitespace-nowrap px-4 py-3 text-right font-black ${record.type === "INCOME" ? "text-emerald-600" : "text-rose-500"}`}>{record.type === "INCOME" ? "+" : "-"}{money(record.amount)} ฿</td>
                <td className="max-w-65 px-4 py-3 text-blu-steel">{record.note || "-"}</td>
                <td className="px-4 py-3"><div className="flex justify-end gap-1">{record.source === "MANUAL" ? <><button type="button" onClick={() => edit(record)} title="แก้ไข" className="rounded-lg p-2 text-blu-slate hover:bg-blu-ice"><Pencil className="h-4 w-4" /></button><button type="button" disabled={records.some((item) => item.reversalOf === record.id)} onClick={() => { setReversalTarget(record); setReversalReason(""); }} title="ย้อนรายการ" className="rounded-lg p-2 text-amber-600 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-25"><RotateCcw className="h-4 w-4" /></button></> : <span className="px-2 py-2 text-[10px] text-blu-steel">ล็อก</span>}</div></td>
              </tr>)}
              {!filtered.length && <tr><td colSpan={8} className="p-10 text-center text-blu-steel">ไม่พบรายการตามตัวกรอง</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {reversalTarget && <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-blu-dark/60 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-blu-steel">ปรับปรุงรายการการเงิน</p><h2 className="mt-1 text-xl font-black text-blu-dark">ย้อนรายการนี้?</h2></div><button type="button" className="rounded-xl p-2 text-blu-steel hover:bg-blu-ice" onClick={() => setReversalTarget(null)} aria-label="ปิดหน้าต่าง"><X className="h-5 w-5" /></button></div><div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm"><p>รายการเดิม: <strong>{reversalTarget.category}</strong></p><p className="mt-1">จำนวน: <strong>{reversalTarget.type === "INCOME" ? "+" : "-"}{money(reversalTarget.amount)} บาท</strong></p><p className="mt-2 text-xs text-amber-800">ระบบจะสร้างรายการฝั่งตรงข้าม และไม่ลบรายการเดิม</p></div><label className="mt-4 block text-xs font-semibold text-blu-steel">เหตุผลที่ย้อนรายการ<textarea required maxLength={500} rows={3} value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} className="finance-input mt-1 h-auto! py-2" placeholder="เช่น บันทึกยอดผิดจำนวน" /></label><div className="mt-5 flex justify-end gap-2"><button type="button" className="btn-blue rounded-xl px-4 py-2 text-xs" onClick={() => setReversalTarget(null)}>ยกเลิก</button><button type="button" className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40" disabled={!reversalReason.trim()} onClick={reverse}>ยืนยันย้อนรายการ</button></div></div></div>}
      <style jsx>{`.finance-input { width: 100%; height: 2.5rem; border: 1px solid color-mix(in srgb, var(--blu-sky) 55%, transparent); border-radius: .75rem; background: white; padding: 0 .75rem; font-size: .75rem; outline: none; } .finance-input:focus { border-color: var(--blu-slate); }`}</style>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="min-w-0 space-y-1.5"><span className="block text-[10px] font-semibold text-blu-steel">{label}</span>{children}</label>;
}

function SummarySection({ title, cards }: { title: string; cards: Array<{ label: string; value: number; tone: string }> }) {
  return <section className="space-y-3"><h2 className="text-base font-black text-blu-dark">{title}</h2><div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{cards.map((card) => <div key={card.label} className="rounded-2xl border border-blu-sky/40 bg-white p-4 shadow-sm"><p className="text-[11px] font-semibold text-blu-steel">{card.label}</p><p className={`mt-2 text-2xl font-black ${card.tone}`}>{money(card.value)} ฿</p></div>)}</div></section>;
}
