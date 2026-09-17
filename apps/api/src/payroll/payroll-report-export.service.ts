import { Injectable } from "@nestjs/common";
import type { PayrollReportCode, PayrollReportExportQuery } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { PayrollAccessService } from "./payroll-access.service";
import { xlsxSafe } from "./payroll-payment-export.service";
import type { ReportCell } from "./payroll-reports.mapper";
import { PAYROLL_REPORTS } from "./payroll-reports.registry";
import { PayrollReportsService, type CheckedReportFilter } from "./payroll-reports.service";
import type { PayrollRequestUser } from "./payroll.types";

const MONEY_FMT = "#,##0";
const PCT_FMT = "0.00";

/**
 * S15-PAYROLL-BE-5 — `PAYROLL-API-082`: xuất một báo cáo ra XLSX (SPEC-11 §15.1 · §18.1 B hàng 16).
 *
 * ── CỔNG (plan D-9, khuôn 071 nhiều cặp) ──
 * Decorator `view:payroll-report`; service assert TƯỜNG MINH ở đầu `export()`: `reportExport` (cặp báo cáo + sàn) ·
 * `periodExport` (`export:payroll` — «được xuất tệp» không nói «được đọc báo cáo», và ngược lại) · cặp NGUỒN của báo
 * cáo (owner O-2). Thiếu cặp nào ⇒ 403 TRƯỚC khi chạm DB.
 *
 * ── NỘI DUNG ──
 * CÙNG `collectTx` với 081 (không trang): trần 50.000 ⇒ 422 `031` trước khi đọc; ô văn bản qua `xlsxSafe` (chống
 * formula-injection); hàng tổng CHỈ khi báo cáo có cột cộng được (hoặc tổng riêng của `budget-status`).
 * Audit `export` ĐÚNG MỘT hàng trong cùng transaction, payload không tiền.
 */
@Injectable()
export class PayrollReportExportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly reports: PayrollReportsService,
    private readonly audit: AuditService,
  ) {}

  async export(
    user: PayrollRequestUser,
    code: PayrollReportCode,
    query: PayrollReportExportQuery,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const actor = await this.access.resolveActor(user, "reportExport");
    await this.access.resolveActor(user, "periodExport");
    const def = PAYROLL_REPORTS[code];
    if (def.sourceRouteKey !== null) await this.access.resolveActor(user, def.sourceRouteKey);
    const filter = PayrollReportsService.checkFilter(def, query);

    const collected = await this.db.withTenant(user.companyId, async (tx) => {
      const result = await this.reports.collectTx(tx, actor, def, filter, null);
      await this.audit.record(tx, {
        action: "export",
        objectType: "payroll_report",
        actorUserId: user.id,
        before: null,
        after: { reportCode: code, filters: filter, rowCount: result.total, format: "xlsx" },
      });
      return result;
    });

    // `exceljs` import ĐỘNG — giữ dependency nặng ngoài đường boot (khuôn 017/071).
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(def.sheetName);
    sheet.columns = def.columns.map((c) => ({ header: c.header, width: c.width }));
    sheet.getRow(1).font = { bold: true };
    def.columns.forEach((c, i) => {
      const col = sheet.getColumn(i + 1);
      if (c.type === "money") col.numFmt = MONEY_FMT;
      if (c.type === "percent") col.numFmt = PCT_FMT;
    });
    for (const row of collected.rows) {
      sheet.addRow(def.columns.map((c) => PayrollReportExportService.cell(row[c.key])));
    }
    const totalKeys = def.columns.filter((c) => c.key in collected.totals);
    if (totalKeys.length > 0) {
      const totalRow = sheet.addRow(
        def.columns.map((c, i) => (i === 0 ? "Tổng cộng" : (collected.totals[c.key] ?? null))),
      );
      totalRow.font = { bold: true };
    }
    const out = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(out as ArrayBuffer),
      filename: `${def.filePrefix}-${PayrollReportExportService.suffix(filter)}.xlsx`,
    };
  }

  private static cell(v: ReportCell | undefined): string | number | null {
    if (v === undefined || v === null) return null;
    return typeof v === "string" ? xlsxSafe(v) : v;
  }

  /** Hậu tố tên tệp từ bộ lọc — chỉ tháng/năm (không id, không tên người). */
  private static suffix(filter: CheckedReportFilter): string {
    if (filter.fiscalYear !== undefined) return String(filter.fiscalYear);
    if (filter.fromMonth && filter.toMonth) return `${filter.fromMonth}_${filter.toMonth}`;
    return "tat-ca";
  }
}
