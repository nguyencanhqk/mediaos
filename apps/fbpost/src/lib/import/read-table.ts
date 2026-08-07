import ExcelJS from "exceljs";
import Papa from "papaparse";

/**
 * Doc file CSV hoac Excel thanh mang cac dong dang { tenCot: giaTri }.
 * Ten cot duoc chuan hoa ve chu thuong khong dau de nguoi dung go
 * "Nội dung" hay "noi dung" deu nhan dien duoc.
 */

export type TableRow = Record<string, unknown>;

/** Bo dau tieng Viet va ky tu la de so khop ten cot de dang hon. */
export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim()
    .replace(/[\s._-]+/g, "_");
}

function readCsv(buffer: Buffer): TableRow[] {
  // Bo BOM de cot dau tien khong dinh ky tu la.
  // Viet bang escape \uFEFF thay vi ky tu BOM tho: ky tu tho la "irregular whitespace" duoi mat
  // eslint cua monorepo, va nhin bang mat thi khong phan biet duoc voi chuoi rong.
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const parsed = Papa.parse<TableRow>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
  });
  return parsed.data;
}

async function readXlsx(buffer: Buffer): Promise<TableRow[]> {
  const workbook = new ExcelJS.Workbook();
  // exceljs nhan ArrayBuffer; cat dung vung nho cua Buffer.
  await workbook.xlsx.load(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  );

  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headers: string[] = [];
  const headerRow = sheet.getRow(1);
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = normalizeHeader(String(cell.value ?? ""));
  });

  const rows: TableRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const record: TableRow = {};
    let hasValue = false;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber];
      if (!key) return;

      let value: unknown = cell.value;
      // O cong thuc tra ve object { formula, result }.
      if (value && typeof value === "object" && "result" in value) {
        value = (value as { result: unknown }).result;
      }
      // O hyperlink tra ve object { text, hyperlink }.
      if (value && typeof value === "object" && "text" in value) {
        value = (value as { text: unknown }).text;
      }

      if (value !== null && value !== undefined && String(value).trim() !== "") hasValue = true;
      record[key] = value;
    });

    if (hasValue) rows.push(record);
  });

  return rows;
}

export async function readTable(filename: string, buffer: Buffer): Promise<TableRow[]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return readCsv(buffer);
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return readXlsx(buffer);
  throw new Error("Chỉ hỗ trợ file .csv hoặc .xlsx. File .xls đời cũ cần lưu lại thành .xlsx.");
}
