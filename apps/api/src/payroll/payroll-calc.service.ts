import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type {
  AdjustPayrollLineRequest,
  PayrollLineListQuery,
  PayrollPeriodStatus,
  PayrollSummaryDto,
  PayrollWriteResultDto,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { paginated, toPagination } from "../common/pagination";
import { PayrollAccessService } from "./payroll-access.service";
import { PayrollCalcRepository } from "./payroll-calc.repository";
import { PayrollInputsRepository } from "./payroll-inputs.repository";
import { PayrollPeopleRepository } from "./payroll-people.repository";
import { PayrollPeriodsRepository } from "./payroll-periods.repository";
import { PayrollPeriodsService } from "./payroll-periods.service";
import { assertPeriodTransition, resolveActionTarget } from "./payroll-fsm";
import {
  mapPayrollPgError,
  payrollConflict,
  payrollNotFound,
  payrollUnprocessable,
  payrollDetails,
  PAYROLL_ERR,
} from "./payroll.errors";
import { toPayrollLineDto, toPayrollSummaryDto } from "./payroll.mapper";
import { payrollOffset, type PayrollRequestUser, type PayrollUserInputs } from "./payroll.types";
import { SalaryProfilesRepository } from "./salary-profiles.repository";

/** Kỳ từ trạng thái này trở đi là ĐÓNG BĂNG — tính lại / sửa dòng đều 409 `003`. */
const FROZEN_STATUSES: ReadonlySet<string> = new Set<PayrollPeriodStatus>([
  "Approved",
  "Paid",
  "Locked",
]);

/**
 * S13-PAYROLL-BE-2 — máy tính lương `PAYROLL-API-007` · đọc dòng `008` · điều chỉnh tay `009` ·
 * tổng kỳ `018`.
 *
 * Mỗi method mở bằng `access.resolveActor(user, <routeKey>)` — tầng guard THỨ HAI, chạy TRƯỚC khi mở
 * transaction nên deny để lại ZERO side-effect.
 *
 * Mọi hành động chạm trạng thái đi ĐỦ BA BƯỚC (SPEC-11 §13.1), không tắt bước nào:
 *   `lockForUpdateTx` (row-lock) → `assertPeriodTransition` → `applyTransitionTx` (status + RESET vết).
 * 🩹**B10**: `applyTransitionTx` là nơi DUY NHẤT ghi `status`; tự viết `UPDATE … SET status` là mã hoá
 * bảng `TRAIL_RESET` ở chỗ thứ hai ⇒ đường vào `23514` (`approved_pair_check`/`generated_pair_check`).
 */
@Injectable()
export class PayrollCalcService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly periods: PayrollPeriodsRepository,
    private readonly calc: PayrollCalcRepository,
    private readonly inputs: PayrollInputsRepository,
    private readonly salaries: SalaryProfilesRepository,
    private readonly people: PayrollPeopleRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * 007 — `calculate`: `CollectingData → Calculated`, hoặc **tính lại TẠI CHỖ** ở `Calculated`.
   *
   * Envelope **KHÔNG có khoá tiền nào** (`payrollWriteResultSchema`): cặp GHI `calculate` tách khỏi
   * cặp ĐỌC `view-line`; trả `gross`/`net` ở đây là cửa sau cho vai chỉ có `calculate`.
   */
  async calculate(user: PayrollRequestUser, id: string): Promise<PayrollWriteResultDto> {
    await this.access.resolveActor(user, "periodCalculate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const period = await this.periods.lockForUpdateTx(tx, user.companyId, id);
      if (!period) throw payrollNotFound();
      const from = period.status as PayrollPeriodStatus;

      // ⚠️ THỨ TỰ: kiểm đóng băng TRƯỚC FSM. Để `assertPeriodTransition` bắt trước thì kỳ `Approved`
      // trả 001 và mã **003 thành mã CHẾT** — SPEC-11 §12 dành 003 riêng cho "snapshot đã đóng băng".
      if (FROZEN_STATUSES.has(from)) {
        throw payrollConflict(
          "PERIOD_FROZEN",
          PAYROLL_ERR.PERIOD_FROZEN,
          payrollDetails("period-frozen"),
        );
      }
      const to = resolveActionTarget(from, "calculate");
      assertPeriodTransition(from, to, "calculate");

      // Nối ATT — kỳ công phải GẮN và phải `locked` (SPEC-11 §3.5). Hai nguyên nhân, cùng mã 002,
      // KHÁC `kind` để người vận hành biết phải làm gì.
      if (!period.attendancePeriodId) {
        throw payrollConflict(
          "ATTENDANCE_NOT_READY",
          PAYROLL_ERR.ATTENDANCE_PERIOD_MISSING,
          payrollDetails("attendance-period-missing"),
        );
      }
      const attLocked = await PayrollCalcService.attendancePeriodLockedTx(
        tx,
        user.companyId,
        period.attendancePeriodId,
      );
      if (!attLocked) {
        throw payrollConflict(
          "ATTENDANCE_NOT_READY",
          PAYROLL_ERR.ATTENDANCE_NOT_LOCKED,
          payrollDetails("attendance-not-locked"),
        );
      }

      // Bước 5 — NHẢ consume của CHÍNH kỳ này TRƯỚC khi khoá lại tập khoản (cả cặp cột, xem repo).
      await this.calc.releaseConsumedTx(tx, user.companyId, id);

      const lastDay = PayrollPeriodsService.lastDayOf(period.periodMonth);
      const [alive, effective, computed] = await Promise.all([
        // `limit: null` — tính lương là tổng hợp cấp KỲ, phải phủ HẾT công ty (cùng lý do readiness).
        this.people.aliveUserIdsTx(tx, user.companyId, { limit: null }),
        this.salaries.effectiveByUserTx(tx, user.companyId, lastDay),
        this.inputs.computeInputsTx(tx, user.companyId, period.periodMonth),
      ]);

      const eligibleUserIds = alive.userIds.filter((uid) => effective.has(uid));
      if (eligibleUserIds.length === 0) {
        throw payrollUnprocessable(
          "NO_ELIGIBLE_EMPLOYEE",
          PAYROLL_ERR.NO_ELIGIBLE_EMPLOYEE,
          payrollDetails("no-eligible-employee"),
        );
      }
      if (computed.workDays <= 0) {
        // Mẫu số pro-rate = 0 ⇒ mọi phép chia vô nghĩa. Chặn ở đây thay vì để `NULLIF` trả NULL.
        throw payrollUnprocessable(
          "NO_ELIGIBLE_EMPLOYEE",
          PAYROLL_ERR.NO_ELIGIBLE_EMPLOYEE,
          payrollDetails("no-work-days"),
        );
      }

      // Dòng sinh cho **MỌI nhân sự đủ điều kiện**, không chỉ người có bản ghi công/phép.
      // `computeInputsTx` chỉ trả hàng cho người CÓ dữ liệu; lấy nguyên tập đó thì nhân sự có hồ sơ
      // lương mà tháng đó chưa ai chấm công **biến mất khỏi bảng lương** — im lặng, không dòng nào
      // giải thích. Bù 0 cho họ giữ `affectedLines === eligibleCount` (số của `readiness`) và đẩy vấn
      // đề lên chính bảng lương, nơi người duyệt nhìn thấy.
      const byUser = new Map(computed.rows.map((r) => [r.userId, r]));
      const inputRows: PayrollUserInputs[] = eligibleUserIds.map(
        (uid) =>
          byUser.get(uid) ?? {
            userId: uid,
            workDays: computed.workDays,
            presentDays: 0,
            paidLeaveDays: 0,
            unpaidLeaveDays: 0,
            lateMinutes: 0,
          },
      );

      // Bước 7 — khoá tập khoản MỘT LẦN; cùng tập này đi vào SUM (bước 8) và BIND (bước 10).
      const picked = await this.calc.lockPickedBonusPenaltiesTx(
        tx,
        user.companyId,
        period.periodMonth,
        eligibleUserIds,
      );

      try {
        await this.calc.upsertLinesTx(tx, user.companyId, id, {
          lastDay,
          inputs: inputRows,
          snapshotMeta: computed.meta,
          picked,
          actorUserId: user.id,
        });
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      await this.calc.softDeleteStaleLinesTx(tx, user.companyId, id, eligibleUserIds, user.id);
      await this.calc.bindConsumedTx(
        tx,
        user.companyId,
        id,
        picked.map((p) => p.id),
      );

      const row = await this.periods.applyTransitionTx(
        tx,
        user.companyId,
        id,
        to,
        "calculate",
        user.id,
      );
      if (!row) throw payrollNotFound();
      const lineCount = await this.periods.countLiveLinesTx(tx, user.companyId, id);
      await this.audit.record(tx, {
        action: "calculate",
        objectType: "payroll_period",
        objectId: id,
        actorUserId: user.id,
        before: { status: from },
        // KHÔNG số tiền trong audit (SPEC-11 §18) — chỉ trạng thái + số đếm.
        after: { status: row.status, lineCount, consumedBonusPenalties: picked.length },
      });
      return {
        id: row.id,
        status: row.status as PayrollPeriodStatus,
        affectedLines: lineCount,
        warnings: [],
      };
    });
  }

  /** 008 — dòng bảng lương + **audit lượt đọc ATOMIC** (rollback ⇒ 0 hàng audit). */
  async listLines(user: PayrollRequestUser, id: string, query: PayrollLineListQuery) {
    const actor = await this.access.resolveActor(user, "periodLines");
    return this.db.withTenant(user.companyId, async (tx) => {
      const period = await this.periods.findTx(tx, user.companyId, id);
      if (!period) throw payrollNotFound();
      const filter = { userId: query.userId };
      const [rows, total] = await Promise.all([
        this.calc.listLinesTx(
          tx,
          user.companyId,
          id,
          filter,
          query.per_page,
          payrollOffset(query.page, query.per_page),
        ),
        this.calc.countLinesTx(tx, user.companyId, id, filter),
      ]);
      await this.audit.record(tx, {
        action: "read",
        objectType: "payroll_period",
        objectId: id,
        actorUserId: user.id,
        before: null,
        after: { view: "lines", filter, rows: rows.length },
      });
      return paginated(
        rows.map((r) => toPayrollLineDto(r, actor)),
        toPagination(total, query.page, query.per_page),
      );
    });
  }

  /**
   * 009 — điều chỉnh tay MỘT dòng. Envelope là route GHI ⇒ **không khoá tiền nào** (SPEC-11 §21).
   *
   * `net` tính lại **ở SQL** trong chính câu UPDATE (🩹B5): thiếu vế đó thì `generate-payslips` copy
   * `net` CŨ ⇒ phiếu lương sai tiền và đẳng thức `SUM(items) = gross − deduction + adjustment` vỡ.
   */
  async adjustLine(
    user: PayrollRequestUser,
    id: string,
    lineId: string,
    dto: AdjustPayrollLineRequest,
  ): Promise<PayrollWriteResultDto> {
    await this.access.resolveActor(user, "periodAdjustLine");
    return this.db.withTenant(user.companyId, async (tx) => {
      // Row-lock kỳ: SPEC-11 §13.1 liệt kê `adjust-line` trong danh sách hành động phải khoá — nó đọc
      // trạng thái kỳ để quyết định, và một `approve` chen ngang sẽ đóng băng kỳ giữa chừng.
      const period = await this.periods.lockForUpdateTx(tx, user.companyId, id);
      if (!period) throw payrollNotFound();
      const status = period.status as PayrollPeriodStatus;
      if (FROZEN_STATUSES.has(status)) {
        throw payrollConflict(
          "PERIOD_FROZEN",
          PAYROLL_ERR.PERIOD_FROZEN,
          payrollDetails("period-frozen"),
        );
      }
      if (status !== "Calculated") {
        throw payrollConflict(
          "PERIOD_TRANSITION",
          PAYROLL_ERR.ACTION_NOT_APPLICABLE("adjust-line", status),
          payrollDetails("action-not-applicable"),
        );
      }
      let row;
      try {
        row = await this.calc.adjustLineTx(
          tx,
          user.companyId,
          id,
          lineId,
          { amount: dto.adjustmentAmount, reason: dto.adjustmentReason ?? null },
          user.id,
        );
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      if (!row) throw payrollNotFound();
      await this.audit.record(tx, {
        action: "adjust-line",
        objectType: "payroll_period",
        objectId: id,
        actorUserId: user.id,
        before: null,
        // KHÔNG `adjustmentAmount` — audit không mang số tiền, kể cả số người dùng vừa nhập.
        after: { lineId: row.id, userId: row.user_id, reasonSet: row.adjustment_reason !== null },
      });
      // KHÔNG đổi trạng thái kỳ: `adjust-line` không nằm trong 9 action của `TRAIL_RESET`.
      return {
        id: period.id,
        status,
        affectedLines: 1,
        warnings: [],
      };
    });
  }

  /**
   * 018 — tổng chi phí của kỳ MỚI NHẤT + **audit lượt đọc**.
   *
   * Công ty **chưa có kỳ nào** ⇒ **200 với `data: null`**, KHÔNG 404: widget DASH phải phân biệt được
   * «chưa có kỳ» với «không có quyền» (404 sentinel dùng chung cho cả hai nghĩa ở module này).
   */
  async summary(user: PayrollRequestUser): Promise<PayrollSummaryDto | null> {
    const actor = await this.access.resolveActor(user, "periodSummary");
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.calc.latestSummaryTx(tx, user.companyId);
      await this.audit.record(tx, {
        action: "read",
        objectType: "payroll_period",
        objectId: row?.payroll_period_id ?? undefined,
        actorUserId: user.id,
        before: null,
        after: { view: "summary", found: row !== null },
      });
      return row ? toPayrollSummaryDto(row, actor) : null;
    });
  }

  // ── nội bộ ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Kỳ công của kỳ lương này đã `locked` chưa. Đọc thẳng `attendance_periods` (bind `company_id`
   * tường minh) — KHÔNG import AttendanceModule, giữ acyclic; và **không dựng cổng khoá ngược**: kỳ
   * công đã bất biến từ lúc `locked` (trigger `0064` chặn `locked → open`).
   */
  private static async attendancePeriodLockedTx(
    tx: TenantTx,
    companyId: string,
    attendancePeriodId: string,
  ): Promise<boolean> {
    const res = await tx.execute<{ status: string }>(sql`
      select ap.status
        from attendance_periods ap
       where ap.company_id = ${companyId}::uuid
         and ap.id = ${attendancePeriodId}::uuid
       limit 1
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return (list as { status: string }[])[0]?.status === "locked";
  }
}
