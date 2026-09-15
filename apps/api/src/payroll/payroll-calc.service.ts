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
import type { PayrollPeriod, PayrollStatutoryRate } from "../db/schema/payroll";
import { AuditService } from "../events/audit.service";
import { paginated, toPagination } from "../common/pagination";
import { isFormulaError } from "./formula/formula.errors";
import { toStatutoryValues, type StatutoryValues } from "./formula/formula.statutory";
import { PayrollAccessService } from "./payroll-access.service";
import { payrollCatalogSharedLockTx } from "./payroll-catalog.lock";
import { fingerprintOf } from "./payroll-catalog.support";
import {
  PayrollCalcInputsRepository,
  type EffectiveProfileV2,
} from "./payroll-calc-inputs.repository";
import { buildLineWrites, type CalcLineSources } from "./payroll-calc-lines";
import { PayrollCalcRepository } from "./payroll-calc.repository";
import { PayrollInputsRepository } from "./payroll-inputs.repository";
import { PayrollPeopleRepository } from "./payroll-people.repository";
import { PayrollPeriodsRepository } from "./payroll-periods.repository";
import { PayrollPeriodsService } from "./payroll-periods.service";
import { assertPeriodTransition, resolveActionTarget } from "./payroll-fsm";
import { assertUsableTemplateTx, type UsableTemplate } from "./payroll-template-binding";
import { PayrollTemplatesRepository } from "./payroll-templates.repository";
import {
  formulaErrorToHttp,
  mapPayrollPgError,
  payrollConflict,
  payrollNotFound,
  payrollUnprocessable,
  payrollDetails,
  PAYROLL_ERR,
} from "./payroll.errors";
import { toPayrollLineDto, toPayrollSummaryDto } from "./payroll.mapper";
import { payrollOffset, type PayrollRequestUser, type PayrollUserInputs } from "./payroll.types";

/**
 * Kỳ từ trạng thái này trở đi là ĐÓNG BĂNG — tính lại / sửa dòng đều 409 `003`.
 * v2 (mig `0572`): thêm `Published` — thiếu nó thì tính lại kỳ đã phát hành rơi xuống FSM `001`, và `003`
 * thành mã chết cho đúng trạng thái mà nó sinh ra để chặn.
 */
const FROZEN_STATUSES: ReadonlySet<string> = new Set<PayrollPeriodStatus>([
  "Approved",
  "Published",
  "Paid",
  "Locked",
]);

/** Nguồn đọc set-based của một lượt tính (chưa gồm các khoản đã khoá). */
type LineSources = Omit<CalcLineSources, "picked" | "advances"> & {
  readonly meta: Awaited<ReturnType<PayrollInputsRepository["computeInputsTx"]>>["meta"];
};

/**
 * S13-PAYROLL-BE-2 — máy tính lương `PAYROLL-API-007` · đọc dòng `008` · điều chỉnh tay `009` ·
 * tổng kỳ `018`. 🔁 S15-PAYROLL-BE-3: `calculate` v2 — tính theo MẪU của kỳ bằng máy công thức TS (plan §4.3).
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
    private readonly calcInputs: PayrollCalcInputsRepository,
    private readonly templates: PayrollTemplatesRepository,
    private readonly people: PayrollPeopleRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * 007 — `calculate`: `CollectingData → Calculated`, hoặc **tính lại TẠI CHỖ** ở `Calculated`.
   *
   * MỘT transaction, thứ tự CHỐT (plan §4.3 + §0b M1): khoá catalog dùng chung → khoá kỳ → cổng (003 · 001 · 002 ·
   * 023 · 018/019 · 022) → nhả consume → đọc set-based → hiệu tập hợp item hồ sơ (018) → khoá khoản → tính TS
   * (020/021) → ghi một câu → bind → chuyển trạng thái. Lỗi ở BẤT KỲ bước nào ⇒ rollback cả lượt: dòng, consume thưởng/
   * phạt, tạm ứng `Deducted`, trạng thái kỳ giữ NGUYÊN như trước lượt gọi.
   *
   * Envelope **KHÔNG có khoá tiền nào** (`payrollWriteResultSchema`): cặp GHI `calculate` tách khỏi
   * cặp ĐỌC `view-line`; trả `gross`/`net` ở đây là cửa sau cho vai chỉ có `calculate`.
   */
  async calculate(user: PayrollRequestUser, id: string): Promise<PayrollWriteResultDto> {
    await this.access.resolveActor(user, "periodCalculate");
    return this.db.withTenant(user.companyId, async (tx) => {
      // §0b M1 — khoá catalog DÙNG CHUNG TRƯỚC khoá hàng kỳ (writer 045–053/058/seeder giữ độc quyền; đảo là 40P01).
      await payrollCatalogSharedLockTx(tx, user.companyId);
      const period = await this.periods.lockForUpdateTx(tx, user.companyId, id);
      if (!period) throw payrollNotFound();
      const from = period.status as PayrollPeriodStatus;
      const to = await PayrollCalcService.assertCalculableTx(tx, user.companyId, period);
      const usable = await assertUsableTemplateTx(
        tx,
        this.templates,
        user.companyId,
        period.templateId as string,
        "calculate",
      );
      const lastDay = PayrollPeriodsService.lastDayOf(period.periodMonth);
      const { rate, statutory } = await this.statutoryAtTx(tx, user.companyId, lastDay);

      // NHẢ consume của CHÍNH kỳ này — SAU khoá kỳ (trigger (F) 0574 / (E) 0572 đọc kỳ FOR SHARE, plan R6).
      await PayrollCalcService.mapped(async () => {
        await this.calc.releaseConsumedTx(tx, user.companyId, id);
        await this.calc.releaseAdvancesTx(tx, user.companyId, id);
      });
      const src = await this.readLineSourcesTx(tx, user.companyId, period.periodMonth, usable);

      // Khoá tập khoản MỘT LẦN; CÙNG tập đi vào tiền của dòng và vào bind.
      const picked = await this.calc.lockPickedBonusPenaltiesTx(
        tx,
        user.companyId,
        period.periodMonth,
        src.userIds,
      );
      const advances = await this.calc.lockPickedAdvancesTx(
        tx,
        user.companyId,
        period.periodMonth,
        src.userIds,
      );
      const lines = buildLineWrites(
        { usable, formulaSetFingerprint: fingerprintOf(usable.rows), rate, statutory, meta: src.meta },
        { ...src, picked, advances },
      );

      await PayrollCalcService.mapped(() =>
        this.calc.upsertLinesTx(tx, user.companyId, id, lines, user.id),
      );
      await this.calc.softDeleteStaleLinesTx(tx, user.companyId, id, src.userIds, user.id);
      await PayrollCalcService.mapped(async () => {
        await this.calc.bindConsumedTx(tx, user.companyId, id, picked.map((p) => p.id));
        await this.calc.bindAdvancesTx(tx, user.companyId, id, advances.map((a) => a.id));
      });

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
      const unconsumed = await this.calcInputs.unconsumedCountsTx(tx, user.companyId, period.periodMonth);
      await this.audit.record(tx, {
        action: "calculate",
        objectType: "payroll_period",
        objectId: id,
        actorUserId: user.id,
        before: { status: from },
        // KHÔNG số tiền trong audit (SPEC-11 §18) — chỉ trạng thái, số đếm và id.
        after: {
          status: row.status,
          lineCount,
          consumedBonusPenalties: picked.length,
          deductedAdvances: advances.length,
          templateId: usable.template.id,
          statutoryRateId: rate.id,
          netLines: lines.filter((l) => l.grossUpIterations !== null).length,
        },
      });
      return {
        id: row.id,
        status: row.status as PayrollPeriodStatus,
        affectedLines: lineCount,
        // plan §0b m3 — khoản đã duyệt cùng tháng mà lượt tính KHÔNG gắn (người không đủ điều kiện). Chỉ số đếm.
        // security-review BE-3 MEDIUM — O-2 coi NV thiếu hàng `payroll_employee_settings` là «không tham gia BH/công đoàn»;
        // nhập hàng loạt quên settings là cả loạt dòng thiếu BH mà không ai thấy ⇒ báo SỐ ĐẾM (không tiền).
        warnings: [
          ...(src.userIds.some((uid) => !src.participation.has(uid))
            ? [
                `employees-without-settings:${src.userIds.filter((uid) => !src.participation.has(uid)).length}`,
              ]
            : []),
          ...(unconsumed.bonusPenalties > 0
            ? [`unconsumed-bonus-penalties:${unconsumed.bonusPenalties}`]
            : []),
          ...(unconsumed.advances > 0 ? [`unconsumed-advances:${unconsumed.advances}`] : []),
        ],
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
   * Cổng trạng thái của `calculate` trên kỳ ĐÃ KHOÁ: 003 → 001 → 002 (hai kind) → 023 `template-missing`.
   *
   * ⚠️ THỨ TỰ: kiểm đóng băng TRƯỚC FSM. Để `assertPeriodTransition` bắt trước thì kỳ `Approved` trả 001 và mã
   * **003 thành mã CHẾT** — SPEC-11 §12 dành 003 riêng cho "snapshot đã đóng băng".
   */
  private static async assertCalculableTx(
    tx: TenantTx,
    companyId: string,
    period: PayrollPeriod,
  ): Promise<PayrollPeriodStatus> {
    const from = period.status as PayrollPeriodStatus;
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
    if (!(await PayrollCalcService.attendancePeriodLockedTx(tx, companyId, period.attendancePeriodId))) {
      throw payrollConflict(
        "ATTENDANCE_NOT_READY",
        PAYROLL_ERR.ATTENDANCE_NOT_LOCKED,
        payrollDetails("attendance-not-locked"),
      );
    }
    // O-1 (owner 15/09) — kỳ CHƯA gắn mẫu ⇒ 409, KHÔNG rơi ngầm về công thức cũ (SPEC-11 §13.6 H · API-18).
    if (!period.templateId) {
      throw payrollConflict(
        "TEMPLATE_CONFLICT",
        PAYROLL_ERR.TEMPLATE_MISSING,
        payrollDetails("template-missing"),
      );
    }
    return to;
  }

  /**
   * Bản tỉ lệ luật định hiệu lực ngày cuối kỳ (`FOR SHARE`) + dựng `StatutoryValues` (kiểm bậc LẦN NỮA — dữ liệu có
   * thể đã ghi thẳng DB). Thiếu ⇒ 422 022 `statutory-rate-missing`: CẤM tính với tỉ lệ 0 (net = gross im lặng).
   */
  private async statutoryAtTx(
    tx: TenantTx,
    companyId: string,
    lastDay: string,
  ): Promise<{ rate: PayrollStatutoryRate; statutory: StatutoryValues }> {
    const rate = await this.calcInputs.statutoryRateAtTx(tx, companyId, lastDay);
    if (!rate) {
      throw payrollUnprocessable(
        "STATUTORY_RATE_INVALID",
        PAYROLL_ERR.STATUTORY_RATE_MISSING,
        payrollDetails("statutory-rate-missing"),
      );
    }
    try {
      return { rate, statutory: toStatutoryValues(rate) };
    } catch (err) {
      if (isFormulaError(err)) throw formulaErrorToHttp(err);
      throw err;
    }
  }

  /**
   * Đọc set-based MỌI nguồn theo người (plan §4.3 bước 11) + cổng 009 + hiệu tập hợp mã item (bước 12).
   * Dòng sinh cho **MỌI nhân sự đủ điều kiện**, không chỉ người có bản ghi công/phép: bù 0 cho người chưa chấm công
   * giữ `affectedLines === eligibleCount` (số của `readiness`) và đẩy vấn đề lên chính bảng lương, nơi người duyệt
   * nhìn thấy.
   */
  private async readLineSourcesTx(
    tx: TenantTx,
    companyId: string,
    periodMonth: string,
    usable: UsableTemplate,
  ): Promise<LineSources> {
    const lastDay = PayrollPeriodsService.lastDayOf(periodMonth);
    const [alive, profiles, computed] = await Promise.all([
      // `limit: null` — tính lương là tổng hợp cấp KỲ, phải phủ HẾT công ty (cùng lý do readiness).
      this.people.aliveUserIdsTx(tx, companyId, { limit: null }),
      this.calcInputs.effectiveProfilesTx(tx, companyId, lastDay),
      this.inputs.computeInputsTx(tx, companyId, periodMonth),
    ]);

    const userIds = alive.userIds.filter((uid) => profiles.has(uid));
    if (userIds.length === 0) {
      throw payrollUnprocessable(
        "NO_ELIGIBLE_EMPLOYEE",
        PAYROLL_ERR.NO_ELIGIBLE_EMPLOYEE,
        payrollDetails("no-eligible-employee"),
      );
    }
    if (computed.workDays <= 0) {
      // Mẫu số pro-rate = 0 ⇒ mọi phép chia vô nghĩa. Chặn ở đây — engine cũng ném `division-by-zero`.
      throw payrollUnprocessable(
        "NO_ELIGIBLE_EMPLOYEE",
        PAYROLL_ERR.NO_ELIGIBLE_EMPLOYEE,
        payrollDetails("no-work-days"),
      );
    }

    const byUser = new Map(computed.rows.map((r) => [r.userId, r]));
    const inputsByUser = new Map<string, PayrollUserInputs>(
      userIds.map((uid) => [
        uid,
        byUser.get(uid) ?? {
          userId: uid,
          workDays: computed.workDays,
          presentDays: 0,
          paidLeaveDays: 0,
          unpaidLeaveDays: 0,
          lateMinutes: 0,
        },
      ]),
    );
    const [itemsByProfile, participation, dependents] = await Promise.all([
      this.calcInputs.activeItemsByProfileTx(
        tx,
        companyId,
        userIds.map((uid) => (profiles.get(uid) as EffectiveProfileV2).id),
      ),
      this.calcInputs.participationByUserTx(tx, companyId, userIds),
      this.calcInputs.dependentCountsTx(tx, companyId, userIds, `${periodMonth}-01`, lastDay),
    ]);
    PayrollCalcService.assertProfileItemsKnown(usable, userIds, profiles, itemsByProfile);
    return { userIds, inputsByUser, profiles, itemsByProfile, participation, dependents, meta: computed.meta };
  }

  /**
   * Hiệu tập hợp mã item hồ sơ ↔ thành phần `profile_item` của MẪU (nợ silent-failure BE-2 MEDIUM-2): mã lạ (vd
   * `PC_nnn` di sản backfill 0570, hoặc phụ cấp đã gỡ khỏi mẫu) ⇒ 422 018 có tên — KHÔNG âm thầm = 0 (engine
   * `profileItems[code] ?? ZERO`). Người đầu tiên vi phạm (theo thứ tự `userIds` ổn định) được nêu trong `details`.
   */
  private static assertProfileItemsKnown(
    usable: UsableTemplate,
    userIds: readonly string[],
    profiles: ReadonlyMap<string, EffectiveProfileV2>,
    itemsByProfile: ReadonlyMap<string, Readonly<Record<string, string>>>,
  ): void {
    const known = new Set(
      usable.rows.filter((r) => r.valueType === "profile_item").map((r) => r.code),
    );
    for (const userId of userIds) {
      const profile = profiles.get(userId) as EffectiveProfileV2;
      const unknown = Object.keys(itemsByProfile.get(profile.id) ?? {})
        .filter((code) => !known.has(code))
        .sort();
      if (unknown.length > 0) {
        throw payrollUnprocessable(
          "FORMULA_INVALID",
          PAYROLL_ERR.PROFILE_ITEM_UNKNOWN_COMPONENT(unknown.join(", ")),
          payrollDetails("profile-item-unknown-component", {
            userId,
            componentCodes: unknown.join(","),
          }),
        );
      }
    }
  }

  /** Map lỗi PG của các câu GHI (trigger thưởng/phạt/tạm ứng · CHECK dòng) sang 409/422 có mã — không để thành 500. */
  private static async mapped<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw mapPayrollPgError(err) ?? err;
    }
  }

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
