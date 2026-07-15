import { BadRequestException, Injectable } from "@nestjs/common";

/**
 * S5-HR-IMPORT-BE-1 — file parsing for HR bulk employee import (SPEC-03 §7). Isolated + injectable so the
 * orchestration service (HrEmployeeImportService) can be unit-tested without loading the heavy `exceljs`
 * dependency. Both parsers LAZY-import their engine inside the method (mirrors the legacy csv lazy-load):
 *   • xlsx  → `exceljs` (MIT, pure-JS — CHỐT 2026-07-13; CẤM SheetJS/xlsx: prototype-pollution/ReDoS
 *             advisories + rời npm registry chính).
 *   • csv   → `csv-parse` (đã có, ^6.2.1).
 *
 * Output is a raw string matrix INCLUDING the header row (row 0). The caller maps data rows to keys by
 * POSITION via IMPORT_COLUMN_ORDER (single source of truth shared with the template) — never trusts the
 * spreadsheet's own header labels, which are human-editable Vietnamese text.
 */
export type ImportFileKind = "xlsx" | "csv";

@Injectable()
export class HrImportParser {
  /** Parse a validated file buffer into a string matrix (rows × cells). Throws 400 on a malformed file. */
  async parse(buffer: Buffer, kind: ImportFileKind): Promise<string[][]> {
    return kind === "xlsx" ? this.parseXlsx(buffer) : this.parseCsv(buffer);
  }

  private async parseCsv(buffer: Buffer): Promise<string[][]> {
    // Lazy-load to avoid top-level import issues in test environments (mirrors the legacy import path).
    const { parse } = await import("csv-parse/sync");
    try {
      return parse(buffer, {
        columns: false, // array-of-arrays; we map by position, not by header label.
        skip_empty_lines: true,
        trim: true,
        bom: true, // strip a UTF-8 BOM (Excel-exported CSVs) so the first header cell is clean.
        relax_column_count: true, // trailing-empty cells vary between rows — don't fail the whole file.
      }) as string[][];
    } catch (err) {
      // A malformed file and a parser bug look identical to the client → 400, never a raw 500.
      throw new BadRequestException(
        `HR-ERR-IMPORT-PARSE: could not read the CSV file (${this.reason(err)})`,
      );
    }
  }

  private async parseXlsx(buffer: Buffer): Promise<string[][]> {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    try {
      // exceljs ships a broken `declare interface Buffer extends ArrayBuffer` that shadows Node's Buffer;
      // its xlsx.load accepts a Node Buffer at runtime, so cast to exceljs's own expected param type
      // (no `any`/ts-ignore — uses the upstream signature).
      await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } catch (err) {
      throw new BadRequestException(
        `HR-ERR-IMPORT-PARSE: could not read the Excel file (${this.reason(err)})`,
      );
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException("HR-ERR-IMPORT-PARSE: the Excel file has no worksheet");
    }
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cells[colNumber - 1] = this.cellToString(cell.value);
      });
      // eachCell(includeEmpty) leaves holes as `undefined` — normalise to "" so position mapping is stable.
      rows.push(Array.from(cells, (c) => c ?? ""));
    });
    return rows;
  }

  /**
   * Normalise an exceljs cell value to a trimmed string. Dates render as ISO `YYYY-MM-DD` (matches the
   * `date` columns + the row schema's isoDate regex); rich-text/hyperlink/formula cells fall back to their
   * display text. Never throws — an unexpected shape stringifies.
   */
  private cellToString(value: unknown): string {
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

  private reason(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
