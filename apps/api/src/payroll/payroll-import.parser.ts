import { Injectable } from "@nestjs/common";
import { payrollDetails, payrollUnprocessable, PAYROLL_ERR } from "./payroll.errors";

export type PayrollImportFileKind = "xlsx" | "csv";

/**
 * S15-PAYROLL-BE-4 — parser tệp import của `PAYROLL-API-076` (khuôn `HrImportParser`, CHÉP nhỏ ≤ 80 dòng thay vì
 * import `EmployeesModule` — không kéo cạnh module HR vào PAYROLL). Cả hai engine LAZY-import (`exceljs` MIT ·
 * `csv-parse`); ra ma trận chuỗi KỂ CẢ header (hàng 0). Tệp hỏng ⇒ 422 030 `import-invalid` `{reason:'parse'}`,
 * không bao giờ 500 thô.
 */
@Injectable()
export class PayrollImportParser {
  async parse(buffer: Buffer, kind: PayrollImportFileKind): Promise<string[][]> {
    return kind === "xlsx" ? this.parseXlsx(buffer) : this.parseCsv(buffer);
  }

  private async parseCsv(buffer: Buffer): Promise<string[][]> {
    const { parse } = await import("csv-parse/sync");
    try {
      return parse(buffer, {
        columns: false,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
      }) as string[][];
    } catch {
      throw PayrollImportParser.invalid("parse");
    }
  }

  private async parseXlsx(buffer: Buffer): Promise<string[][]> {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } catch {
      throw PayrollImportParser.invalid("parse");
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw PayrollImportParser.invalid("no-worksheet");
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cells[colNumber - 1] = PayrollImportParser.cellToString(cell.value);
      });
      rows.push(Array.from(cells, (c) => c ?? ""));
    });
    return rows;
  }

  /** Chuẩn hoá ô exceljs → chuỗi trim; số giữ nguyên dạng số (`500000` → "500000"); rich-text/công thức lấy text. */
  private static cellToString(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === "object") {
      const obj = value as {
        text?: unknown;
        result?: unknown;
        richText?: Array<{ text?: string }>;
      };
      if (Array.isArray(obj.richText))
        return obj.richText
          .map((r) => r.text ?? "")
          .join("")
          .trim();
      if (obj.text !== undefined) return String(obj.text).trim();
      if (obj.result !== undefined) return String(obj.result).trim();
      return "";
    }
    return String(value).trim();
  }

  static invalid(reason: string) {
    return payrollUnprocessable(
      "IMPORT_INVALID",
      PAYROLL_ERR.IMPORT_INVALID,
      payrollDetails("import-invalid", { reason }),
    );
  }
}
