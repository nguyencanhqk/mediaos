import { Injectable } from "@nestjs/common";
import type { PayrollExportQuery } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { PayrollAccessService } from "./payroll-access.service";
import { PayrollCalcRepository } from "./payroll-calc.repository";
import { PayrollPeopleRepository } from "./payroll-people.repository";
import { PayrollPeriodsRepository } from "./payroll-periods.repository";
import {
  payrollDetails,
  payrollNotFound,
  payrollUnprocessable,
  PAYROLL_ERR,
} from "./payroll.errors";
import type { PayrollRequestUser } from "./payroll.types";

/** Trần dòng của một lượt xuất (SPEC-11 §18 · API-18 §5.1). Vượt ⇒ 422 `016`, KHÔNG cắt bớt im lặng. */
export const PAYROLL_EXPORT_MAX_ROWS = 10_000;

/** Cột của file xuất — thứ tự CỐ ĐỊNH, là hợp đồng với người dùng cuối. */
const COLUMNS: ReadonlyArray<{ header: string; width: number }> = [
  { header: "Mã NV", width: 14 },
  { header: "Họ tên", width: 28 },
  { header: "Ngày công chuẩn", width: 16 },
  { header: "Ngày công thực tế", width: 16 },
  { header: "Phép có lương", width: 14 },
  { header: "Phép không lương", width: 16 },
  { header: "Phút trễ/sớm", width: 14 },
  { header: "Lương cơ bản", width: 16 },
  { header: "Phụ cấp", width: 14 },
  { header: "Thưởng", width: 14 },
  { header: "Phạt", width: 14 },
  { header: "Khấu trừ", width: 14 },
  { header: "Điều chỉnh", width: 14 },
  { header: "Lý do điều chỉnh", width: 28 },
  { header: "Tổng thu nhập", width: 16 },
  { header: "Thực nhận", width: 16 },
];

/**
 * S13-PAYROLL-BE-2 — `PAYROLL-API-017`: xuất bảng lương một kỳ ra XLSX.
 *
 * ── ĐÒI **HAI** CẶP QUYỀN 🩹B7 ──
 * `('export','payroll')` **và** `('view-line','payroll-period')` (SPEC-11 §18 · API-18 §5.1). Cặp
 * `export` một mình chỉ nói "được xuất file", không nói "được đọc dòng lương"; file này CHÍNH LÀ dòng
 * lương. Assert cả hai bằng hai lời gọi `resolveActor` TƯỜNG MINH ngay tại đây — census 2 tầng pin
 * site này với **hai** key (`PayrollExportService#export`), đúng tiền lệ `BonusPenaltiesService#decide`.
 *
 * ⓘ Vì sao KHÔNG thêm `resolveActorForExport()` vào `PayrollAccessService`: JSDoc của `resolveActor`
 * cấm "resolve thêm cặp phụ **để biết caller có xem được tiền không**" — tức cấm dựng nhánh mask
 * per-row. Assert đủ cặp của CHÍNH route mình không phải chuyện đó, và làm ngay tại call-site giữ
 * scanner census đọc được hai literal ở đúng nơi chúng có nghĩa.
 *
 * ── BA RÀNG BUỘC CÒN LẠI ──
 *  · **Trần 10.000 dòng** ⇒ 422 `016`. Cắt bớt rồi trả file "đủ" là báo cáo lương THIẾU người, im lặng.
 *  · **Tên người qua `PayrollPeopleRepository`** — điểm chiếu danh tính DUY NHẤT; cấm JOIN thẳng `users`.
 *  · **Audit ĐÚNG MỘT hàng**, payload = kỳ + bộ lọc + số dòng, **không số tiền**, trong CÙNG transaction.
 */
@Injectable()
export class PayrollExportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly periods: PayrollPeriodsRepository,
    private readonly calc: PayrollCalcRepository,
    private readonly people: PayrollPeopleRepository,
    private readonly audit: AuditService,
  ) {}

  async export(
    user: PayrollRequestUser,
    id: string,
    query: PayrollExportQuery,
  ): Promise<{ buffer: Buffer; filename: string }> {
    // Vế ĐỌC DÒNG — thiếu `view-line` ⇒ 403 ngay, chưa chạm DB.
    await this.access.resolveActor(user, "periodLines");
    // Vế XUẤT — actor trả về mang cặp `export:payroll`, dùng cho chiếu danh tính bên dưới.
    const actor = await this.access.resolveActor(user, "periodExport");

    const { rows, names, periodMonth } = await this.db.withTenant(user.companyId, async (tx) => {
      const period = await this.periods.findTx(tx, user.companyId, id);
      if (!period) throw payrollNotFound();
      const all = await this.calc.allLinesForExportTx(tx, user.companyId, id);
      if (all.length > PAYROLL_EXPORT_MAX_ROWS) {
        throw payrollUnprocessable(
          "EXPORT_LIMIT",
          PAYROLL_ERR.EXPORT_LIMIT(all.length, PAYROLL_EXPORT_MAX_ROWS),
          payrollDetails("export-limit", {
            total: all.length,
            max: PAYROLL_EXPORT_MAX_ROWS,
          }),
        );
      }
      const nameMap = await this.people.namesByUserIdsTx(
        tx,
        actor,
        all.map((r) => r.user_id),
      );
      // Lọc `q` áp SAU khi đã bọc cột danh tính: route này KHÔNG phân trang nên lọc-sau an toàn
      // (khác `GET …/lines`, nơi lọc-sau sẽ làm `pagination.total` đếm một tập khác).
      const needle = query.q?.trim().toLowerCase();
      const filtered = needle
        ? all.filter((r) => {
            const p = nameMap.get(r.user_id);
            return (
              (p?.displayName ?? "").toLowerCase().includes(needle) ||
              (p?.employeeCode ?? "").toLowerCase().includes(needle)
            );
          })
        : all;

      await this.audit.record(tx, {
        action: "export",
        objectType: "payroll_period",
        objectId: id,
        actorUserId: user.id,
        before: null,
        // KHÔNG số tiền — chỉ kỳ, bộ lọc và SỐ ĐẾM.
        after: { periodMonth: period.periodMonth, q: query.q ?? null, rows: filtered.length },
      });
      return { rows: filtered, names: nameMap, periodMonth: period.periodMonth };
    });

    // `exceljs` import ĐỘNG — giữ dependency nặng ngoài đường boot (khuôn `HrImportParser`).
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(`Bảng lương ${periodMonth}`);
    sheet.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }));
    sheet.getRow(1).font = { bold: true };
    for (const r of rows) {
      const p = names.get(r.user_id);
      sheet.addRow([
        p?.employeeCode ?? "",
        p?.displayName ?? "",
        Number(r.work_days),
        Number(r.present_days),
        Number(r.paid_leave_days),
        Number(r.unpaid_leave_days),
        Number(r.late_minutes ?? 0),
        Number(r.base_amount),
        Number(r.allowance_amount),
        Number(r.bonus_amount),
        Number(r.penalty_amount),
        Number(r.deduction_amount),
        Number(r.adjustment_amount),
        r.adjustment_reason ?? "",
        Number(r.gross),
        Number(r.net),
      ]);
    }
    const out = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(out as ArrayBuffer),
      filename: `bang-luong-${periodMonth}.xlsx`,
    };
  }
}
