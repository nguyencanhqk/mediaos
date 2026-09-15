import { UnprocessableEntityException } from "@nestjs/common";
import { PAYROLL_ADJUSTMENT_IMPORT_MAX_ROWS } from "@mediaos/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PayrollImportParser } from "./payroll-import.parser";

/**
 * S15-PAYROLL-BE-4B (plan BE-4 §11b, security L5) — trần dòng XLSX kiểm bằng `sheet.rowCount` TRƯỚC khi dựng ma trận
 * chuỗi. Cap 5 MB (`resolveFileKind`) chặn tệp to, nhưng XLSX là zip: vài trăm KB nén được hàng triệu ô ⇒ khuôn cũ
 * (`eachRow` → ma trận → `parseAdjustmentMatrix` mới đếm) nhân bản toàn bộ ô thành chuỗi JS rồi mới từ chối. Giờ: quá
 * trần ⇒ 422 `import-too-large` khi CHƯA gọi `eachRow` (đo bằng spy trên prototype worksheet).
 */
const HEADER = ["Mã NV", "Loại", "Số tiền", "Lý do", "Kỳ (YYYY-MM)"];

async function xlsxWithDataRows(rows: number): Promise<Buffer> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("data");
  sheet.addRow(HEADER);
  for (let i = 0; i < rows; i++) sheet.addRow([`NV${i}`, "bonus", 1, "ok", "2028-07"]);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

async function worksheetPrototype(): Promise<{ eachRow: (...a: unknown[]) => unknown }> {
  const ExcelJS = await import("exceljs");
  return Object.getPrototypeOf(new ExcelJS.Workbook().addWorksheet("probe")) as {
    eachRow: (...a: unknown[]) => unknown;
  };
}

function kindOf(e: unknown): string | undefined {
  const body = (e as UnprocessableEntityException).getResponse() as {
    details?: Array<{ field: string; message: string }>;
  };
  return body.details?.find((d) => d.field === "kind")?.message;
}

describe("S15-PAYROLL-BE-4B · PayrollImportParser — trần dòng XLSX đo bằng rowCount TRƯỚC khi đọc ô", () => {
  afterEach(() => vi.restoreAllMocks());

  it(`XLSX ${PAYROLL_ADJUSTMENT_IMPORT_MAX_ROWS + 1} dòng dữ liệu ⇒ 422 import-too-large và eachRow KHÔNG được gọi`, async () => {
    const buffer = await xlsxWithDataRows(PAYROLL_ADJUSTMENT_IMPORT_MAX_ROWS + 1);
    const eachRow = vi.spyOn(await worksheetPrototype(), "eachRow");
    const err = await new PayrollImportParser().parse(buffer, "xlsx").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(kindOf(err)).toBe("import-too-large");
    expect(eachRow).not.toHaveBeenCalled();
  }, 60_000);

  it(`XLSX ĐÚNG trần (${PAYROLL_ADJUSTMENT_IMPORT_MAX_ROWS} dòng) ⇒ ma trận header + N (không từ chối sớm oan)`, async () => {
    const buffer = await xlsxWithDataRows(PAYROLL_ADJUSTMENT_IMPORT_MAX_ROWS);
    const matrix = await new PayrollImportParser().parse(buffer, "xlsx");
    expect(matrix).toHaveLength(PAYROLL_ADJUSTMENT_IMPORT_MAX_ROWS + 1);
    expect(matrix[0]).toEqual(HEADER);
    expect(matrix[1]).toEqual(["NV0", "bonus", "1", "ok", "2028-07"]);
  }, 60_000);

  it("XLSX nhỏ ⇒ ma trận chuỗi (số → chuỗi số); CSV ⇒ cùng hình dạng", async () => {
    const parser = new PayrollImportParser();
    expect(await parser.parse(await xlsxWithDataRows(2), "xlsx")).toEqual([
      HEADER,
      ["NV0", "bonus", "1", "ok", "2028-07"],
      ["NV1", "bonus", "1", "ok", "2028-07"],
    ]);
    const csv = Buffer.from(`${HEADER.join(",")}\nNV0,bonus,1,ok,2028-07\n`, "utf8");
    expect(await parser.parse(csv, "csv")).toEqual([
      HEADER,
      ["NV0", "bonus", "1", "ok", "2028-07"],
    ]);
  });

  it("XLSX hỏng ⇒ 422 import-invalid {reason: parse}, không 500 thô", async () => {
    const err = await new PayrollImportParser().parse(Buffer.from("not a zip"), "xlsx").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(kindOf(err)).toBe("import-invalid");
  });
});
