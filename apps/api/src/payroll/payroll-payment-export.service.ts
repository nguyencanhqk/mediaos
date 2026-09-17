import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { PayrollAccessService } from "./payroll-access.service";
import { PAYROLL_EXPORT_MAX_ROWS } from "./payroll-export.service";
import { PayrollPaymentBatchesRepository } from "./payroll-payment-batches.repository";
import { PayrollPeopleRepository } from "./payroll-people.repository";
import {
  payrollDetails,
  payrollNotFound,
  payrollUnprocessable,
  PAYROLL_ERR,
} from "./payroll.errors";
import type { PayrollRequestUser } from "./payroll.types";

/** 7 cột CỐ ĐỊNH của tệp UNC (plan D-6) — hợp đồng với cổng ngân hàng, không tuỳ biến theo công ty ở v2. */
export const UNC_COLUMNS: ReadonlyArray<{ header: string; width: number }> = [
  { header: "STT", width: 6 },
  { header: "Mã NV", width: 14 },
  { header: "Họ tên", width: 28 },
  { header: "Số tài khoản", width: 20 },
  { header: "Ngân hàng", width: 18 },
  { header: "Số tiền", width: 16 },
  { header: "Nội dung", width: 28 },
];

/**
 * Chống formula injection (QA-1): ô văn bản bắt đầu bằng `= + - @` được tiền tố `'` để Excel/LibreOffice hiển thị như
 * chữ. Tên người/tên ngân hàng là dữ liệu người dùng nhập — không tin.
 */
export function xlsxSafe(s: string): string {
  // S15-PAYROLL-BE-5 (security-review LOW): thêm TAB/CR đầu chuỗi — OWASP CSV-injection coi chúng cùng lớp với `= + - @`.
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/**
 * S15-PAYROLL-BE-4 — `PAYROLL-API-071`: tệp UNC XLSX của một đợt chi trả (khuôn `PayrollExportService`).
 *
 * 🔴 **ĐƯỜNG DUY NHẤT số tài khoản ĐẦY ĐỦ rời server** (SPEC-11 §3.12) và tệp mang `net` từng người ⇒ gác **BA cặp**,
 * assert CẢ BA ở ĐẦU `export()` bằng ba lời gọi `resolveActor` TƯỜNG MINH (thiếu cặp nào ⇒ 403 TRƯỚC khi chạm DB;
 * census 2 tầng pin site `PayrollPaymentExportService#export` với ba key): `batchExport` (`manage:payment-batch`) +
 * `periodExport` (`export:payroll` — luật «export đòi cả hai cặp» §11.1) + `payslipList` (`view-payslip:payslip` — vế ĐỌC
 * tiền, tệp lấy net từ `payslip_id`). Gác một cặp GHI như bản nháp = role chỉ có `manage` tải được payload nhạy cảm nhất
 * hệ thống (bài học RECRUIT H5).
 *
 * Trần 10.000 dòng ⇒ 422 016 (không cắt bớt im lặng). Audit ĐÚNG MỘT hàng `read` `{rowCount, format}` — KHÔNG TK, KHÔNG
 * tiền — trong CÙNG tx với lượt đọc (reveal + audit atomic). Tên tệp `unc-<code>.xlsx` (mã đợt không phải PII).
 * `bank_name_snapshot` không có chi nhánh (DB-13 §14.3 — cột snapshot chỉ 3, plan §3.8).
 */
@Injectable()
export class PayrollPaymentExportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly batches: PayrollPaymentBatchesRepository,
    private readonly people: PayrollPeopleRepository,
    private readonly audit: AuditService,
  ) {}

  async export(
    user: PayrollRequestUser,
    batchId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    // BA cặp — thứ tự cố định; actor dùng cho chiếu danh tính là actor của cặp ĐỌC PHIẾU (vế tiền).
    await this.access.resolveActor(user, "batchExport");
    await this.access.resolveActor(user, "periodExport");
    const actor = await this.access.resolveActor(user, "payslipList");

    const { batch, rows, names } = await this.db.withTenant(user.companyId, async (tx) => {
      const found = await this.batches.findWithStatsTx(tx, user.companyId, batchId);
      if (!found) throw payrollNotFound();
      const lines = await this.batches.linesForExportTx(tx, user.companyId, batchId);
      if (lines.length > PAYROLL_EXPORT_MAX_ROWS) {
        throw payrollUnprocessable(
          "EXPORT_LIMIT",
          PAYROLL_ERR.EXPORT_LIMIT(lines.length, PAYROLL_EXPORT_MAX_ROWS),
          payrollDetails("export-limit", { total: lines.length, max: PAYROLL_EXPORT_MAX_ROWS }),
        );
      }
      const nameMap = await this.people.namesByUserIdsTx(
        tx,
        actor,
        lines.map((l) => l.user_id),
      );
      await this.audit.record(tx, {
        action: "read",
        objectType: "payroll_payment_batch",
        objectId: batchId,
        actorUserId: user.id,
        before: null,
        // KHÔNG số TK, KHÔNG tiền — chỉ số đếm + định dạng.
        after: { rowCount: lines.length, format: "xlsx" },
      });
      return { batch: found, rows: lines, names: nameMap };
    });

    let buffer: Buffer;
    try {
      buffer = await this.buildUncBuffer(batch, rows, names);
    } catch (err) {
      // silent-failure-hunter BE-4 #4 (vá ở BE-4B): audit `read` đã commit trong tx ở trên (chọn «không bao giờ thiếu
      // audit»), nhưng KHÔNG tệp nào rời server. Để lại dấu vết server-side — chỉ id đợt + số dòng, KHÔNG TK/tiền — rồi
      // ném tiếp cho filter (500 sạch; filter tự log stack).
      Logger.error(
        `PAYROLL-API-071: audit 'read' đã ghi cho đợt ${batchId} (${rows.length} dòng) nhưng sinh tệp UNC thất bại — không có tệp rời server`,
        PayrollPaymentExportService.name,
      );
      throw err;
    }
    return { buffer, filename: `unc-${batch.code}.xlsx` };
  }

  /** Dựng workbook UNC — tách riêng để đo được nhánh «ném SAU audit» ở unit và giữ `export` gọn. */
  private async buildUncBuffer(
    batch: NonNullable<Awaited<ReturnType<PayrollPaymentBatchesRepository["findWithStatsTx"]>>>,
    rows: Awaited<ReturnType<PayrollPaymentBatchesRepository["linesForExportTx"]>>,
    names: Awaited<ReturnType<PayrollPeopleRepository["namesByUserIdsTx"]>>,
  ): Promise<Buffer> {
    // `exceljs` import ĐỘNG — ngoài tx, ngoài đường boot.
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(`UNC ${batch.code}`);
    sheet.columns = UNC_COLUMNS.map((c) => ({ header: c.header, width: c.width }));
    sheet.getRow(1).font = { bold: true };
    rows.forEach((r, i) => {
      const p = names.get(r.user_id);
      const code = p?.employeeCode ?? "";
      sheet.addRow([
        i + 1,
        xlsxSafe(code),
        xlsxSafe(p?.displayName ?? ""),
        // Số TK là chuỗi (giữ số 0 đầu); `cash` ⇒ rỗng. CŨNG qua `xlsxSafe`: `bankAccountNumber` (039) là
        // `z.string()` không giới hạn charset ⇒ officer hồ sơ lương có thể gieo `=HYPERLINK(...)` vào snapshot
        // (security-reviewer BE-4 M1). Số TK thật không bao giờ bắt đầu bằng `= + - @` nên không đổi dữ liệu hợp lệ.
        xlsxSafe(r.bank_account_snapshot ?? ""),
        xlsxSafe(r.bank_name_snapshot ?? ""),
        Number(r.net),
        // Nội dung ASCII cho cổng ngân hàng: `Luong <YYYY-MM> <mã NV>`.
        `Luong ${batch.periodMonth} ${code}`.replace(/[^\x20-\x7E]/g, ""),
      ]);
    });
    const out = await workbook.xlsx.writeBuffer();
    return Buffer.from(out as ArrayBuffer);
  }
}
