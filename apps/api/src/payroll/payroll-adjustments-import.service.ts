import { Injectable } from "@nestjs/common";
import type { ErrorDetail, PayrollPeriodStatus, PayrollWriteResultDto } from "@mediaos/contracts";
import { PAYROLL_ADJUSTMENT_IMPORT_MAX_BYTES } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { PayrollAccessService } from "./payroll-access.service";
import {
  ADJUSTMENT_IMPORT_COLUMNS,
  parseAdjustmentMatrix,
  type AdjustmentRowError,
  type ParsedAdjustmentRow,
} from "./payroll-adjustments-import.columns";
import { PayrollAdjustmentImportRepository } from "./payroll-adjustments-import.repository";
import { PayrollImportParser, type PayrollImportFileKind } from "./payroll-import.parser";
import { PayrollPeriodsRepository } from "./payroll-periods.repository";
import {
  mapPayrollPgError,
  payrollConflict,
  payrollDetails,
  payrollNotFound,
  payrollUnprocessable,
  PAYROLL_ERR,
} from "./payroll.errors";
import type { PayrollRequestUser } from "./payroll.types";

/** Kỳ còn nhận khoản nhập (D-7): từ `Reviewing` trở đi khoản sẽ KHÔNG BAO GIỜ được gộp ⇒ 409 003 `period-frozen`. */
const IMPORT_OPEN_STATUSES: ReadonlySet<string> = new Set([
  "Draft",
  "CollectingData",
  "Calculated",
]);
/** Số lỗi dòng tối đa đưa vào `details[]` (tránh phản hồi vài nghìn dòng); phần còn lại gói ở `errorRows`. */
const MAX_ROW_ERRORS_IN_DETAILS = 50;

const CSV_MIMES: ReadonlySet<string> = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "text/plain",
]);
const XLSX_MIMES: ReadonlySet<string> = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
  "application/zip",
  "application/vnd.ms-excel",
]);

/** Hình dạng multer file mà service cần (tập con của `Express.Multer.File`). */
export interface PayrollImportUpload {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer: Buffer;
}

/**
 * S15-PAYROLL-BE-4 — `PAYROLL-API-076` import thu nhập/khấu trừ khác → `bonus_penalties` **`Pending`** (vẫn qua duyệt 027) +
 * `077` tệp mẫu XLSX sinh từ CHÍNH `ADJUSTMENT_IMPORT_COLUMNS` (khuôn `HrEmployeeImportService`).
 *
 * · **`dryRun` mặc định TRUE** (đường an toàn): validate + resolve, 0 ghi, 0 audit.
 * · **TOÀN TỆP HOẶC KHÔNG DÒNG NÀO** (SPEC-11 §12.1 hàng 030): bất kỳ lỗi dòng nào ⇒ 422 030 + `details[] {field:"row:<n>"}`
 *   + **0 hàng ghi** — khác HR import (partial-success). Kind ưu tiên `import-unknown-user` nếu có ít nhất một, ngược lại
 *   `import-invalid`.
 * · `Kỳ` trong tệp phải bằng `period_month` của kỳ trong URL (chống nộp nhầm tệp); kỳ ∉ {Draft, CollectingData, Calculated}
 *   ⇒ 409 003 `period-frozen` (khoản sẽ không bao giờ được gộp).
 * · 🔴 Message lỗi dòng KHÔNG BAO GIỜ lặp lại số tiền; audit `import` chỉ `{fileName, rowCount, dryRun:false}`.
 */
@Injectable()
export class PayrollAdjustmentImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly periods: PayrollPeriodsRepository,
    private readonly repo: PayrollAdjustmentImportRepository,
    private readonly parser: PayrollImportParser,
    private readonly audit: AuditService,
  ) {}

  async import(
    user: PayrollRequestUser,
    periodId: string,
    file: PayrollImportUpload | undefined,
    dryRun: boolean,
  ): Promise<PayrollWriteResultDto> {
    await this.access.resolveActor(user, "importAdjustments");
    const kind = PayrollAdjustmentImportService.resolveFileKind(file);
    const fileName = PayrollAdjustmentImportService.safeFileName(file);
    const matrix = await this.parser.parse(file!.buffer, kind);

    return this.db.withTenant(user.companyId, async (tx) => {
      const period = await this.periods.findTx(tx, user.companyId, periodId);
      if (!period) throw payrollNotFound();
      if (!IMPORT_OPEN_STATUSES.has(period.status)) {
        throw payrollConflict(
          "PERIOD_FROZEN",
          PAYROLL_ERR.PERIOD_FROZEN_IMPORT,
          payrollDetails("period-frozen", { periodStatus: period.status }),
        );
      }

      const parsed = parseAdjustmentMatrix(matrix, period.periodMonth);
      if (parsed.kind === "header-mismatch") throw PayrollImportParser.invalid("header");
      if (parsed.kind === "empty") throw PayrollImportParser.invalid("no-data-rows");
      if (parsed.kind === "too-large") throw PayrollImportParser.tooLarge();

      const codes = [...new Set(parsed.rows.map((r) => r.employeeCode.toLowerCase()))];
      const userByCode = await this.repo.resolveEmployeeCodesTx(tx, user.companyId, codes);
      const rowErrors: AdjustmentRowError[] = [...parsed.rowErrors];
      const resolved: Array<ParsedAdjustmentRow & { userId: string }> = [];
      let unknownUsers = 0;
      for (const r of parsed.rows) {
        const userId = userByCode.get(r.employeeCode.toLowerCase());
        if (!userId) {
          unknownUsers += 1;
          rowErrors.push({ row: r.row, message: "Mã NV không có trong công ty" });
          continue;
        }
        resolved.push({ ...r, userId });
      }
      if (rowErrors.length > 0) {
        throw PayrollAdjustmentImportService.rowErrorsToHttp(rowErrors, unknownUsers > 0);
      }

      const warnings: string[] = [];
      const dup = await this.repo.countPendingDuplicatesTx(
        tx,
        user.companyId,
        period.periodMonth,
        resolved,
      );
      if (dup > 0) warnings.push(`possible-duplicate:${dup}`);

      if (dryRun) {
        return {
          id: period.id,
          status: period.status as PayrollPeriodStatus,
          affectedLines: resolved.length,
          warnings: ["dry-run", ...warnings],
        };
      }

      let written: number;
      try {
        written = await this.repo.insertPendingTx(
          tx,
          user.companyId,
          period.periodMonth,
          resolved,
          user.id,
        );
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      await this.audit.record(tx, {
        action: "import",
        objectType: "payroll_period",
        objectId: period.id,
        actorUserId: user.id,
        before: null,
        // KHÔNG số tiền — tên tệp + số dòng.
        after: { fileName, rowCount: written, dryRun: false },
      });
      return {
        id: period.id,
        status: period.status as PayrollPeriodStatus,
        affectedLines: written,
        warnings,
      };
    });
  }

  /** 077 — tệp mẫu XLSX: header + 1 dòng ví dụ, từ CHÍNH hằng cột (tệp mẫu tĩnh ở FE sẽ trôi khỏi parser). 0 audit. */
  async template(user: PayrollRequestUser): Promise<{ buffer: Buffer; filename: string }> {
    await this.access.resolveActor(user, "importTemplate");
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Thu nhap khau tru");
    sheet.columns = ADJUSTMENT_IMPORT_COLUMNS.map((c) => ({ header: c.header, width: 22 }));
    sheet.getRow(1).font = { bold: true };
    sheet.addRow(ADJUSTMENT_IMPORT_COLUMNS.map((c) => c.example));
    const out = await workbook.xlsx.writeBuffer();
    return { buffer: Buffer.from(out as ArrayBuffer), filename: "mau-thu-nhap-khau-tru.xlsx" };
  }

  // ── nội bộ ──────────────────────────────────────────────────────────────────────────────────

  /** Vắng/rỗng/> 5MB/sai ext·MIME ⇒ 422 030 `import-invalid` `{reason}` (một mã cho FE; parser ⇒ `parse`). */
  private static resolveFileKind(file: PayrollImportUpload | undefined): PayrollImportFileKind {
    if (!file || !file.buffer || file.buffer.length === 0)
      throw PayrollImportParser.invalid("no-file");
    const size = file.size ?? file.buffer.length;
    if (size > PAYROLL_ADJUSTMENT_IMPORT_MAX_BYTES)
      throw PayrollImportParser.invalid("file-too-large");
    const name = (file.originalname ?? "").toLowerCase();
    const dot = name.lastIndexOf(".");
    const ext = dot >= 0 ? name.slice(dot) : "";
    const mime = (file.mimetype ?? "").toLowerCase();
    if (ext === ".csv") {
      if (!CSV_MIMES.has(mime)) throw PayrollImportParser.invalid("file-type");
      return "csv";
    }
    if (ext === ".xlsx") {
      if (!XLSX_MIMES.has(mime)) throw PayrollImportParser.invalid("file-type");
      return "xlsx";
    }
    throw PayrollImportParser.invalid("file-type");
  }

  private static safeFileName(file: PayrollImportUpload | undefined): string {
    const raw = (file?.originalname ?? "import").replace(/[^\w.\-À-ɏḀ-ỿ ]/g, "_");
    return raw.slice(0, 120);
  }

  private static rowErrorsToHttp(rowErrors: AdjustmentRowError[], hasUnknownUser: boolean) {
    const sorted = [...rowErrors].sort((a, b) => a.row - b.row);
    const details: ErrorDetail[] = sorted
      .slice(0, MAX_ROW_ERRORS_IN_DETAILS)
      .map((e) => ({ field: `row:${e.row}`, message: e.message, rule: "payroll" }));
    details.push({ field: "errorRows", message: String(sorted.length), rule: "payroll" });
    return hasUnknownUser
      ? payrollUnprocessable("IMPORT_INVALID", PAYROLL_ERR.IMPORT_UNKNOWN_USER, [
          ...payrollDetails("import-unknown-user"),
          ...details,
        ])
      : payrollUnprocessable("IMPORT_INVALID", PAYROLL_ERR.IMPORT_INVALID, [
          ...payrollDetails("import-invalid", { reason: "rows" }),
          ...details,
        ]);
  }
}
