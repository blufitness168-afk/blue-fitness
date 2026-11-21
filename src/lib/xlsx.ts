import "server-only";

export const XLSX_MAX_ROWS = 10_000;
export const XLSX_MAX_BYTES = 16 * 1024 * 1024;
export class XlsxLimitError extends Error {}

function xml(value: string) {
  // OOXML escape sequences must remain literal; reject invalid XML characters.
  return value.replace(/_x[0-9a-f]{4}_/gi, (s) => `_x005F_${s.slice(1)}`)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = Buffer.from(path), data = Buffer.from(text);
    if (offset + data.length > XLSX_MAX_BYTES) throw new XlsxLimitError("ไฟล์เกิน 16 MiB กรุณาลดช่วงตัวกรอง");
    const checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(33, 14);
    entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, name); offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(local.length / 3, 8); end.writeUInt16LE(local.length / 3, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  if (offset + directory.length + end.length > XLSX_MAX_BYTES) throw new XlsxLimitError("ไฟล์เกิน 16 MiB กรุณาลดช่วงตัวกรอง");
  return new Uint8Array(Buffer.concat([...local, directory, end]));
}

function sanitizeSheetName(name: string) {
  const cleaned = name
    .replace(/[\u0000-\u001f\[\]:*?/\\]/g, "")
    .trim()
    .slice(0, 31);
  return cleaned || "Sheet1";
}

/** Text is always inlineStr, never a formula, hyperlink or external relationship. */
export function createXlsx(rows: (string | number)[][], sheetName = "Finance"): Uint8Array<ArrayBuffer> {
  if (rows.length > XLSX_MAX_ROWS + 1) throw new XlsxLimitError("เกิน 10,000 รายการ กรุณาลดช่วงตัวกรอง");
  const safeSheetName = xml(sanitizeSheetName(sheetName));
  const maxCols = Math.max(1, ...rows.map((row) => row.length));
  if (maxCols > 26) throw new XlsxLimitError("Too many columns");
  const lastCol = String.fromCharCode(64 + maxCols);
  let size = 0;
  const sheetRows = rows.map((row, index) => {
    if (row.length > 26) throw new XlsxLimitError("Too many columns");
    const cells = row.map((value, column) => {
      const ref = `${String.fromCharCode(65 + column)}${index + 1}`;
      if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error("Invalid numeric cell");
        return `<c r="${ref}"><v>${value}</v></c>`;
      }
      if (value.length > 32767) throw new XlsxLimitError("ข้อความยาวเกินขีดจำกัด Excel");
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("");
    const result = `<row r="${index + 1}">${cells}</row>`;
    size += Buffer.byteLength(result);
    if (size > XLSX_MAX_BYTES - 4096) throw new XlsxLimitError("ไฟล์เกิน 16 MiB กรุณาลดช่วงตัวกรอง");
    return result;
  }).join("");
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  return zip({
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeSheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${ns}"><dimension ref="A1:${lastCol}${Math.max(rows.length, 1)}"/><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}
