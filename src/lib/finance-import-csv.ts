export const MAX_IMPORT_BYTES = 256 * 1024;
export const MAX_IMPORT_ROWS = 200;
const HEADER = "source_ref,date,type,category,amount,note";
const INCOME = "รายได้อื่น (ไม่ใช่แพ็กเกจ)";
const EXPENSE = ["รายจ่ายประจำเดือน", "อุปกรณ์", "เงินเดือน", "รายจ่ายอื่น", "คอมมิชชัน", "ค่าเสื่อม"];

export const FINANCE_IMPORT_TEMPLATE = `\uFEFF${HEADER}\r\n`;
export const FINANCE_IMPORT_CATEGORIES = { INCOME: [INCOME], EXPENSE };

export type ImportRow = {
  line: number; ref: string; date: string; type: "INCOME" | "EXPENSE";
  category: string; amountSatang: number; note: string;
};
export type ImportIssue = { line: number; code: string };
export type ImportReceipt = { batchId: string; count: number; incomeSatang: number; expenseSatang: number };

// Quoted commas and escaped quotes are allowed; template fields cannot span lines.
function cells(line: string): string[] | null {
  const fields: string[] = [];
  const cell = /"((?:[^"\r\n]|"")*)"|([^",\r\n]*)/y;
  let offset = 0;
  do {
    cell.lastIndex = offset;
    const match = cell.exec(line);
    if (!match || (cell.lastIndex < line.length && line[cell.lastIndex] !== ",")) return null;
    fields.push(match[1] === undefined ? match[2] : match[1].replaceAll('""', '"'));
    offset = cell.lastIndex + 1;
  } while (offset <= line.length);
  return fields;
}

export function parseFinanceImport(csv: string) {
  const rows: ImportRow[] = [];
  const issues: ImportIssue[] = [];
  const [header, ...body] = csv.replace(/^\uFEFF/, "").split(/\r?\n/);
  // Accept the usual final newline, not blank records in the middle.
  if (body.at(-1) === "") body.pop();
  if (cells(header)?.join(",") !== HEADER || cells(header)?.length !== 6) return { rows, issues: [{ line: 1, code: "header" }] };
  if (!body.length || body.length > MAX_IMPORT_ROWS) return { rows, issues: [{ line: 0, code: "row_count" }] };
  const seen = new Set<string>();
  for (const [index, text] of body.entries()) {
    const line = index + 2;
    const values = cells(text)?.map(value => value.trim());
    if (!values || values.length !== 6 || /\p{Cc}/u.test(text)) {
      issues.push({ line, code: "csv" }); continue;
    }
    const [ref, date, type, category, amount, note] = values;
    const invalid = (code: string) => issues.push({ line, code });
    const before = issues.length;
    if (!/^[A-Z0-9][A-Z0-9._-]{0,79}$/.test(ref)) invalid("reference");
    else if (seen.has(ref)) invalid("duplicate_reference");
    else seen.add(ref);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < "2000-01-01" || date > "2100-12-31" ||
        !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) invalid("date");
    if ((type !== "INCOME" && type !== "EXPENSE") || !FINANCE_IMPORT_CATEGORIES[type].includes(category)) invalid("category");
    const [baht, fraction = ""] = amount.split(".");
    const amountSatang = Number(baht) * 100 + Number(fraction.padEnd(2, "0"));
    if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(amount) || amountSatang < 1 || amountSatang > 1_000_000_000) invalid("amount");
    if (!note || [...note].length > 500) invalid("note");
    if (issues.length === before) rows.push({ line, ref, date, type: type as ImportRow["type"], category, amountSatang, note });
  }
  return { rows, issues };
}
