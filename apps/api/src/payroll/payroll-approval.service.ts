import { Injectable } from "@nestjs/common";
import type {
  PayrollPeriodStatus,
  PayrollWriteResultDto,
  RejectPayrollPeriodRequest,
  ReopenPayrollPeriodRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PayrollAccessService } from "./payroll-access.service";
import { PayrollApproverReader } from "./payroll-approver.reader";
import { PayrollPeopleRepository } from "./payroll-people.repository";
import { PayrollPeriodsRepository } from "./payroll-periods.repository";
import { assertPeriodTransition, assertReopenAllowed, resolveActionTarget } from "./payroll-fsm";
import {
  mapPayrollPgError,
  payrollConflict,
  payrollDetails,
  payrollNotFound,
  payrollUnprocessable,
  PAYROLL_ERR,
} from "./payroll.errors";
import {
  PAYROLL_ACTOR_FALLBACK,
  PAYROLL_EVENT_PERIOD_APPROVED,
  PAYROLL_EVENT_PERIOD_REJECTED,
  PAYROLL_EVENT_PERIOD_SUBMITTED,
  type PayrollPeriodApprovedPayload,
  type PayrollPeriodRejectedPayload,
  type PayrollPeriodSubmittedPayload,
} from "./payroll-noti.payload";
import type { PayrollActor, PayrollRequestUser } from "./payroll.types";

const isoOf = (v: Date | string | null | undefined): string =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

/**
 * S13-PAYROLL-BE-2 — vòng duyệt bảng lương: `submit` (010) · `approve` (011) · `reject` (012) ·
 * `lock` (015) · `reopen` (016).
 *
 * ── FOUR-EYES BA TẦNG (SPEC-11 §13.1 · PAY-DEC-007), không bỏ tầng nào ──
 *  1. **Quyền** — `('approve','payroll-period')` KHÔNG grant cho `payroll-officer` (seed mig `0565`).
 *  2. **Logic** — `submitted_by === actor` ⇒ 409 `PAYROLL-ERR-005` ở service này, dưới row-lock.
 *  3. **DB** — CHECK `payroll_periods_four_eyes_check` là chốt cuối cho RACE; `mapPayrollPgError`
 *     dịch `23514` về 409 `005` để nó KHÔNG rơi thành 500 ở vùng đỏ.
 *
 * ── CỔNG 422 `017` Ở `submit` ──
 * Trước khi đẩy kỳ sang `Reviewing`, hỏi `PayrollApproverReader` xem có người duyệt hợp lệ nào KHÁC
 * actor không. Rỗng ⇒ 422, kỳ **ở nguyên `Calculated`**. Thiếu cổng này thì công ty một-người-duyệt
 * đẩy kỳ vào `Reviewing` rồi kẹt vĩnh viễn: người duy nhất bấm được `approve` chính là người vừa
 * submit, và tầng 2/3 sẽ chặn họ mãi mãi.
 *
 * ── TRẬT TỰ ĐỌC `submitted_by` ──
 * `reject` xoá `submitted_*` theo `TRAIL_RESET.reject`. Người nhận NOTI-022 **phải đọc vào biến
 * TRƯỚC** `applyTransitionTx`; đọc sau là gửi cho `null` (bridge lọc rỗng ⇒ thông báo biến mất câm).
 */
@Injectable()
export class PayrollApprovalService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly repo: PayrollPeriodsRepository,
    private readonly approvers: PayrollApproverReader,
    private readonly people: PayrollPeopleRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** 010 — gửi duyệt: `Calculated → Reviewing`, + cổng 422 `017`, + NOTI-020. */
  async submit(user: PayrollRequestUser, id: string): Promise<PayrollWriteResultDto> {
    const actor = await this.access.resolveActor(user, "periodSubmit");
    return this.db.withTenant(user.companyId, async (tx) => {
      const period = await this.repo.lockForUpdateTx(tx, user.companyId, id);
      if (!period) throw payrollNotFound();
      const from = period.status as PayrollPeriodStatus;
      const to = resolveActionTarget(from, "submit");
      assertPeriodTransition(from, to, "submit");

      const approverUserIds = await this.approvers.eligibleApproverIdsTx(
        tx,
        user.companyId,
        user.id,
      );
      if (approverUserIds.length === 0) {
        throw payrollUnprocessable(
          "NO_ELIGIBLE_APPROVER",
          PAYROLL_ERR.NO_ELIGIBLE_APPROVER,
          payrollDetails("no-eligible-approver"),
        );
      }

      const row = await this.applyOrMap(tx, user.companyId, id, to, "submit", user.id);
      await this.audit.record(tx, {
        action: "submit",
        objectType: "payroll_period",
        objectId: id,
        actorUserId: user.id,
        before: { status: from },
        after: { status: row.status, approverCount: approverUserIds.length },
      });

      const payload: PayrollPeriodSubmittedPayload = {
        periodId: id,
        actorUserId: user.id,
        // Nửa sau dedupeKey = `submitted_at` của CHÍNH câu UPDATE vừa chạy ⇒ từ chối rồi gửi lại
        // sinh khoá KHÁC ⇒ vẫn báo (engine `DedupeKey` là once-ever, không có bucket thời gian).
        submittedAtIso: isoOf(row.submittedAt),
        approverUserIds,
        actor_name: await this.actorName(tx, actor),
        period_month: period.periodMonth,
        payroll_period_id: id,
      };
      await this.outbox.enqueue(tx, { eventType: PAYROLL_EVENT_PERIOD_SUBMITTED, payload });

      return { id, status: row.status as PayrollPeriodStatus, affectedLines: 0, warnings: [] };
    });
  }

  /** 011 — duyệt: `Reviewing → Approved` (snapshot ĐÓNG BĂNG từ đây), + NOTI-021. */
  async approve(user: PayrollRequestUser, id: string): Promise<PayrollWriteResultDto> {
    const actor = await this.access.resolveActor(user, "periodApprove");
    return this.db.withTenant(user.companyId, async (tx) => {
      const period = await this.repo.lockForUpdateTx(tx, user.companyId, id);
      if (!period) throw payrollNotFound();
      const from = period.status as PayrollPeriodStatus;
      // Tầng 2 của four-eyes — TRƯỚC FSM: người vừa gửi duyệt không tự duyệt được, và thông điệp phải
      // nói đúng lý do đó thay vì "không chuyển được trạng thái".
      if (period.submittedBy && period.submittedBy === user.id) {
        throw payrollConflict("FOUR_EYES", PAYROLL_ERR.FOUR_EYES, payrollDetails("four-eyes"));
      }
      const to = resolveActionTarget(from, "approve");
      assertPeriodTransition(from, to, "approve");

      const submittedBy = period.submittedBy;
      const row = await this.applyOrMap(tx, user.companyId, id, to, "approve", user.id);
      await this.audit.record(tx, {
        action: "approve",
        objectType: "payroll_period",
        objectId: id,
        actorUserId: user.id,
        before: { status: from, submittedBy },
        after: { status: row.status },
      });

      if (submittedBy) {
        const payload: PayrollPeriodApprovedPayload = {
          periodId: id,
          actorUserId: user.id,
          approvedAtIso: isoOf(row.approvedAt),
          recipientUserId: submittedBy,
          actor_name: await this.actorName(tx, actor),
          period_month: period.periodMonth,
          payroll_period_id: id,
        };
        await this.outbox.enqueue(tx, { eventType: PAYROLL_EVENT_PERIOD_APPROVED, payload });
      }
      return { id, status: row.status as PayrollPeriodStatus, affectedLines: 0, warnings: [] };
    });
  }

  /** 012 — từ chối: `Reviewing → Calculated`, lý do BẮT BUỘC (Zod), + NOTI-022. */
  async reject(
    user: PayrollRequestUser,
    id: string,
    dto: RejectPayrollPeriodRequest,
  ): Promise<PayrollWriteResultDto> {
    const actor = await this.access.resolveActor(user, "periodReject");
    return this.db.withTenant(user.companyId, async (tx) => {
      const period = await this.repo.lockForUpdateTx(tx, user.companyId, id);
      if (!period) throw payrollNotFound();
      const from = period.status as PayrollPeriodStatus;
      const to = resolveActionTarget(from, "reject");
      assertPeriodTransition(from, to, "reject");

      // ⚠️ ĐỌC TRƯỚC: `TRAIL_RESET.reject` xoá `submitted_by`/`submitted_at` trong chính câu UPDATE
      // dưới đây. Đọc sau `applyTransitionTx` là gửi thông báo cho `null`.
      const submittedBy = period.submittedBy;
      const row = await this.applyOrMap(tx, user.companyId, id, to, "reject", user.id);
      await this.audit.record(tx, {
        action: "reject",
        objectType: "payroll_period",
        objectId: id,
        actorUserId: user.id,
        before: { status: from, submittedBy },
        // Lý do từ chối KHÔNG phải số tiền nên ghi được; ghi độ dài thay vì nguyên văn là vô nghĩa.
        after: { status: row.status, reason: dto.reason },
      });

      if (submittedBy) {
        const payload: PayrollPeriodRejectedPayload = {
          periodId: id,
          actorUserId: user.id,
          // `reject` KHÔNG có cột `rejected_at` — lấy `updated_at` của chính câu UPDATE làm nửa khoá.
          updatedAtIso: isoOf(row.updatedAt),
          recipientUserId: submittedBy,
          actor_name: await this.actorName(tx, actor),
          period_month: period.periodMonth,
          payroll_period_id: id,
          reason: dto.reason,
        };
        await this.outbox.enqueue(tx, { eventType: PAYROLL_EVENT_PERIOD_REJECTED, payload });
      }
      return { id, status: row.status as PayrollPeriodStatus, affectedLines: 0, warnings: [] };
    });
  }

  /** 015 — khoá kỳ: `Paid → Locked`. `Locked` là TERMINAL TUYỆT ĐỐI — không có đường ra. */
  async lock(user: PayrollRequestUser, id: string): Promise<PayrollWriteResultDto> {
    await this.access.resolveActor(user, "periodLock");
    return this.db.withTenant(user.companyId, async (tx) => {
      const period = await this.repo.lockForUpdateTx(tx, user.companyId, id);
      if (!period) throw payrollNotFound();
      const from = period.status as PayrollPeriodStatus;
      const to = resolveActionTarget(from, "lock");
      assertPeriodTransition(from, to, "lock");
      const row = await this.applyOrMap(tx, user.companyId, id, to, "lock", user.id);
      await this.audit.record(tx, {
        action: "lock",
        objectType: "payroll_period",
        objectId: id,
        actorUserId: user.id,
        before: { status: from },
        after: { status: row.status },
      });
      return { id, status: row.status as PayrollPeriodStatus, affectedLines: 0, warnings: [] };
    });
  }

  /**
   * 016 — mở lại kỳ về `CollectingData`, lý do BẮT BUỘC, cặp quyền RIÊNG `reopen:payroll-period`.
   *
   * `assertReopenAllowed` chạy **ngay sau row-lock, TRƯỚC** `assertPeriodTransition`: nó đọc cờ
   * `payslips_generated_at` trên CHÍNH hàng đang khoá (không đếm bảng `payslips` — bảng khác không
   * được row-lock bảo vệ). Thiếu cổng đó là đường vào trạng thái KHÔNG THOÁT ĐƯỢC: kỳ về
   * `CollectingData` khi đã có phiếu ⇒ mọi `generate-payslips` sau đều 409 vĩnh viễn (phiếu
   * append-only, không xoá được).
   *
   * **KHÔNG NOTI** (SPEC-11 §17 chỉ khai 4 event, reopen không nằm trong đó).
   *
   * **GIỮ NGUYÊN dòng nháp** (plan D8): không xoá mềm. Điều chỉnh tay do đó sống sót qua vòng
   * reopen → calculate lại (nhánh `DO UPDATE` giữ `adjustment_*`), đúng nghiệm thu §20.17.
   */
  async reopen(
    user: PayrollRequestUser,
    id: string,
    dto: ReopenPayrollPeriodRequest,
  ): Promise<PayrollWriteResultDto> {
    await this.access.resolveActor(user, "periodReopen");
    return this.db.withTenant(user.companyId, async (tx) => {
      const period = await this.repo.lockForUpdateTx(tx, user.companyId, id);
      if (!period) throw payrollNotFound();
      assertReopenAllowed({
        status: period.status as PayrollPeriodStatus,
        payslipsGeneratedAt: period.payslipsGeneratedAt,
      });
      const from = period.status as PayrollPeriodStatus;
      const to = resolveActionTarget(from, "reopen");
      assertPeriodTransition(from, to, "reopen");
      const row = await this.applyOrMap(tx, user.companyId, id, to, "reopen", user.id, {
        reopenReason: dto.reason,
      });
      await this.audit.record(tx, {
        action: "reopen",
        objectType: "payroll_period",
        objectId: id,
        actorUserId: user.id,
        before: { status: from },
        after: { status: row.status, reason: dto.reason },
      });
      return { id, status: row.status as PayrollPeriodStatus, affectedLines: 0, warnings: [] };
    });
  }

  // ── nội bộ ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Bọc `applyTransitionTx`: 0 hàng ⇒ 404, `23514` ⇒ mã PAYROLL (four-eyes 005 / cặp vết 001) thay vì
   * 500. **Mọi** action của service này đi qua đây — không nơi nào tự viết `UPDATE … SET status`.
   */
  private async applyOrMap(
    tx: Parameters<PayrollPeriodsRepository["applyTransitionTx"]>[0],
    companyId: string,
    id: string,
    to: PayrollPeriodStatus,
    via: Parameters<PayrollPeriodsRepository["applyTransitionTx"]>[4],
    actorUserId: string,
    extra: Partial<Record<"reopenReason", string>> = {},
  ) {
    let row;
    try {
      row = await this.repo.applyTransitionTx(tx, companyId, id, to, via, actorUserId, extra);
    } catch (err) {
      throw mapPayrollPgError(err) ?? err;
    }
    if (!row) throw payrollNotFound();
    return row;
  }

  /**
   * Tên người thao tác cho template NOTI — qua `PayrollPeopleRepository`, **điểm chiếu danh tính DUY
   * NHẤT** của module (SPEC-11 §18). Không `select users.full_name` ở đây (ratchet identity-projection).
   *
   * NULL ⇒ nhãn trung tính, KHÔNG "Hệ thống": quy một hành động của người cho hệ thống là sai vết.
   */
  private async actorName(
    tx: Parameters<PayrollPeopleRepository["namesByUserIdsTx"]>[0],
    actor: PayrollActor,
  ): Promise<string> {
    const map = await this.people.namesByUserIdsTx(tx, actor, [actor.actorUserId]);
    return map.get(actor.actorUserId)?.displayName ?? PAYROLL_ACTOR_FALLBACK;
  }
}
