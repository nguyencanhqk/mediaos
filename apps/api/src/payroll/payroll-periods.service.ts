import { Injectable } from "@nestjs/common";
import type {
  CreatePayrollPeriodRequest,
  PayrollAttendancePeriodPickerQuery,
  PayrollPeriodListQuery,
  PayrollPeriodStatus,
  PayrollReadinessDto,
  PayrollReadinessWarningDto,
  PayrollWriteResultDto,
  UpdatePayrollPeriodRequest,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { paginated, toPagination } from "../common/pagination";
import { PayrollAccessService } from "./payroll-access.service";
import { PayrollInputsRepository } from "./payroll-inputs.repository";
import { PayrollPeopleRepository } from "./payroll-people.repository";
import { PayrollPeriodsRepository } from "./payroll-periods.repository";
import { assertPeriodTransition, nextStatus } from "./payroll-fsm";
import { mapPayrollPgError, payrollNotFound, PAYROLL_ERR, payrollConflict } from "./payroll.errors";
import { toPayrollPeriodDto } from "./payroll.mapper";
import { payrollOffset, type PayrollRequestUser } from "./payroll.types";
import { SalaryProfilesRepository } from "./salary-profiles.repository";

/**
 * S13-PAYROLL-BE-1 — kỳ lương `PAYROLL-API-001..006` + picker kỳ công `035`.
 *
 * Mỗi method mở bằng `access.resolveActor(user, <routeKey>)` — **tầng guard THỨ HAI**, độc lập với
 * decorator route; deny ở đó để lại ZERO side-effect vì nó chạy TRƯỚC khi mở transaction.
 *
 * Mọi hành động chạm trạng thái đi ba bước, không tắt bước nào (SPEC-11 §13.1):
 *   `lockForUpdateTx` (row-lock) → `assertPeriodTransition` → `applyTransitionTx` (ghi status + RESET).
 */
@Injectable()
export class PayrollPeriodsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly repo: PayrollPeriodsRepository,
    private readonly salaries: SalaryProfilesRepository,
    private readonly inputs: PayrollInputsRepository,
    private readonly people: PayrollPeopleRepository,
    private readonly audit: AuditService,
  ) {}

  /** 001 — danh sách kỳ. **KHÔNG số tiền nào**, kể cả tổng (SPEC-11 §11.1). */
  async list(user: PayrollRequestUser, query: PayrollPeriodListQuery) {
    await this.access.resolveActor(user, "periodList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const filter = {
        status: query.status as PayrollPeriodStatus[] | undefined,
        periodMonth: query.periodMonth,
        from: query.from,
        to: query.to,
      };
      const [rows, total] = await Promise.all([
        this.repo.listTx(
          tx,
          user.companyId,
          filter,
          query.per_page,
          payrollOffset(query.page, query.per_page),
        ),
        this.repo.countTx(tx, user.companyId, filter),
      ]);
      return paginated(
        rows.map(toPayrollPeriodDto),
        toPagination(total, query.page, query.per_page),
      );
    });
  }

  /** 002 — tạo kỳ. Trùng tháng ⇒ 409 `008` (chốt cuối `payroll_periods_company_month_uq`). */
  async create(user: PayrollRequestUser, dto: CreatePayrollPeriodRequest) {
    await this.access.resolveActor(user, "periodCreate");
    return this.db.withTenant(user.companyId, async (tx) => {
      if (dto.attendancePeriodId) {
        await this.assertAttendancePeriod(tx, user.companyId, dto.attendancePeriodId);
      }
      let row;
      try {
        row = await this.repo.createTx(
          tx,
          user.companyId,
          {
            periodMonth: dto.periodMonth,
            attendancePeriodId: dto.attendancePeriodId ?? null,
            note: dto.note ?? null,
          },
          user.id,
        );
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      await this.audit.record(tx, {
        action: "create",
        objectType: "payroll_period",
        objectId: row.id,
        actorUserId: user.id,
        before: null,
        // KHÔNG số tiền trong audit (bất biến #3).
        after: { periodMonth: row.periodMonth, status: row.status },
      });
      return toPayrollPeriodDto(row);
    });
  }

  /** 003 — chi tiết kỳ + vết duyệt. **Không số tiền.** */
  async get(user: PayrollRequestUser, id: string) {
    await this.access.resolveActor(user, "periodDetail");
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findTx(tx, user.companyId, id);
      if (!row) throw payrollNotFound();
      return toPayrollPeriodDto(row);
    });
  }

  /**
   * 004 — gắn/đổi kỳ công + ghi chú. Chỉ khi `Draft`/`CollectingData` (khác ⇒ 409 `001`).
   *
   * Zod đã cấm `attendancePeriodId: null` (contracts) — không có đường gỡ về NULL, vì
   * `payroll_periods_calculated_needs_attendance_check` chỉ cấm NULL từ `Calculated` trở đi nên DB
   * KHÔNG chặn giúp ở hai trạng thái đầu, và `PAYROLL-API-007` sẽ mất nguồn kiểm "kỳ công đã locked".
   */
  async update(user: PayrollRequestUser, id: string, dto: UpdatePayrollPeriodRequest) {
    await this.access.resolveActor(user, "periodUpdate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.repo.lockForUpdateTx(tx, user.companyId, id);
      if (!before) throw payrollNotFound();
      const status = before.status as PayrollPeriodStatus;
      if (status !== "Draft" && status !== "CollectingData") {
        throw payrollConflict("PERIOD_TRANSITION", PAYROLL_ERR.PERIOD_TRANSITION(status, status));
      }
      if (dto.attendancePeriodId) {
        await this.assertAttendancePeriod(tx, user.companyId, dto.attendancePeriodId);
      }
      const row = await this.repo.updateTx(
        tx,
        user.companyId,
        id,
        {
          ...(dto.attendancePeriodId !== undefined
            ? { attendancePeriodId: dto.attendancePeriodId }
            : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
        user.id,
      );
      if (!row) throw payrollNotFound();
      await this.audit.record(tx, {
        action: "update",
        objectType: "payroll_period",
        objectId: row.id,
        actorUserId: user.id,
        before: {
          attendancePeriodId: before.attendancePeriodId,
          noteSet: before.note !== null,
        },
        after: { attendancePeriodId: row.attendancePeriodId, noteSet: row.note !== null },
      });
      return toPayrollPeriodDto(row);
    });
  }

  /**
   * 005 — `collect`: `Draft → CollectingData`, hoặc **gom lại TẠI CHỖ** ở `CollectingData`
   * (SPEC-11 §13.1 bảng — đây là đường duy nhất làm mới cảnh báo sau khi dữ liệu công/phép đổi).
   *
   * Envelope **KHÔNG có khoá tiền nào**: `affectedLines` = số nhân sự ĐỦ ĐIỀU KIỆN (có hồ sơ lương
   * hiệu lực), `warnings` = mảng CHUỖI tóm tắt. Để route ghi trả `gross`/`net` là mở cửa sau cho vai
   * có `calculate` mà không có `view-line`.
   */
  async collect(user: PayrollRequestUser, id: string): Promise<PayrollWriteResultDto> {
    await this.access.resolveActor(user, "periodCollect");
    return this.db.withTenant(user.companyId, async (tx) => {
      const period = await this.repo.lockForUpdateTx(tx, user.companyId, id);
      if (!period) throw payrollNotFound();
      const from = period.status as PayrollPeriodStatus;
      const to = nextStatus(from, "collect");
      // `to === null` ⇒ ô cấm; để `assertPeriodTransition` ném đúng 409 001 kèm from/to.
      assertPeriodTransition(from, to ?? from, "collect");
      const summary = await this.readinessTx(tx, user.companyId, period.periodMonth);
      const row = await this.repo.applyTransitionTx(
        tx,
        user.companyId,
        id,
        to as PayrollPeriodStatus,
        "collect",
        user.id,
      );
      if (!row) throw payrollNotFound();
      await this.audit.record(tx, {
        action: "collect",
        objectType: "payroll_period",
        objectId: row.id,
        actorUserId: user.id,
        before: { status: from },
        after: {
          status: row.status,
          eligibleCount: summary.eligibleCount,
          warningCount: summary.warnings.length,
        },
      });
      return {
        id: row.id,
        status: row.status as PayrollPeriodStatus,
        affectedLines: summary.eligibleCount,
        warnings: PayrollPeriodsService.summarizeWarnings(summary.warnings),
      };
    });
  }

  /**
   * 006 — cảnh báo dữ liệu thiếu (PAYROLL-FUNC-005). Cảnh báo là **MỀM**: không chặn `calculate`;
   * chỉ `eligibleCount = 0` mới làm `calculate` trả 422 `009` (BE-2).
   */
  async readiness(user: PayrollRequestUser, id: string): Promise<PayrollReadinessDto> {
    const actor = await this.access.resolveActor(user, "periodReadiness");
    return this.db.withTenant(user.companyId, async (tx) => {
      const period = await this.repo.findTx(tx, user.companyId, id);
      if (!period) throw payrollNotFound();
      const base = await this.readinessTx(tx, user.companyId, period.periodMonth);
      const names = await this.people.namesByUserIdsTx(
        tx,
        actor,
        base.warnings.map((w) => w.userId),
      );
      return {
        eligibleCount: base.eligibleCount,
        warnings: base.warnings.map((w) => ({
          userId: w.userId,
          fullName: names.get(w.userId)?.displayName ?? null,
          kind: w.kind,
        })),
      };
    });
  }

  /** 035 — picker kỳ công (trường bó hẹp, qua repository chiếu). */
  async pickAttendancePeriods(user: PayrollRequestUser, query: PayrollAttendancePeriodPickerQuery) {
    await this.access.resolveActor(user, "pickerAttendancePeriods");
    return this.db.withTenant(user.companyId, (tx) =>
      this.repo.pickAttendancePeriodsTx(tx, user.companyId, query.status, query.limit),
    );
  }

  // ── nội bộ ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Lõi dùng chung của `collect` (005) và `readiness` (006) — MỘT định nghĩa "đủ điều kiện".
   *
   * Ngày mốc = **ngày cuối kỳ** (SPEC-11 §13.4 bước 5): bản lương hiệu lực tại thời điểm kỳ.
   * `missing-salary-profile` xét trên **mọi nhân sự còn sống**, không chỉ người có bản ghi công —
   * người mới vào chưa chấm công ngày nào vẫn phải hiện cảnh báo.
   */
  private async readinessTx(tx: TenantTx, companyId: string, periodMonth: string) {
    const lastDay = PayrollPeriodsService.lastDayOf(periodMonth);
    const [aliveIds, effective, inputs] = await Promise.all([
      this.people.aliveUserIdsTx(tx, companyId),
      this.salaries.effectiveByUserTx(tx, companyId, lastDay),
      this.inputs.computeInputsTx(tx, companyId, periodMonth),
    ]);
    const presentByUser = new Map(inputs.rows.map((r) => [r.userId, r.presentDays]));
    const warnings: Omit<PayrollReadinessWarningDto, "fullName">[] = [];
    for (const userId of aliveIds) {
      if (!effective.has(userId)) {
        warnings.push({ userId, kind: "missing-salary-profile" });
        continue;
      }
      if ((presentByUser.get(userId) ?? 0) === 0) {
        warnings.push({ userId, kind: "missing-attendance" });
      }
    }
    // `eligibleCount` chỉ đếm người CÒN SỐNG có hồ sơ lương hiệu lực — hồ sơ của người đã nghỉ việc
    // (user xoá mềm) không được tính vào tập tính lương.
    const eligibleCount = aliveIds.filter((id) => effective.has(id)).length;
    return { eligibleCount, warnings };
  }

  /** `warnings` của route GHI là mảng CHUỖI (mirror `payrollWriteResultSchema`) — gộp theo loại. */
  private static summarizeWarnings(
    warnings: readonly { kind: PayrollReadinessWarningDto["kind"] }[],
  ): string[] {
    const counts = new Map<string, number>();
    for (const w of warnings) counts.set(w.kind, (counts.get(w.kind) ?? 0) + 1);
    return [...counts.entries()].map(([kind, n]) => `${kind}: ${n}`);
  }

  /** Ngày cuối tháng của `YYYY-MM` — tính bằng UTC (UTC-at-rest, không mượn TZ của máy chạy). */
  static lastDayOf(periodMonth: string): string {
    const [y, m] = periodMonth.split("-").map(Number);
    // Ngày 0 của tháng kế = ngày cuối tháng này.
    const d = new Date(Date.UTC(y, m, 0));
    return d.toISOString().slice(0, 10);
  }

  private async assertAttendancePeriod(
    tx: TenantTx,
    companyId: string,
    attendancePeriodId: string,
  ) {
    const ok = await this.repo.attendancePeriodExistsTx(tx, companyId, attendancePeriodId);
    // Sentinel 404 — không lộ oracle "kỳ công này có tồn tại ở tenant khác không".
    if (!ok) throw payrollNotFound();
  }
}
