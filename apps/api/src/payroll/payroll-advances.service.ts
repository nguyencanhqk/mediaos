import { Injectable } from "@nestjs/common";
import type {
  ApprovePayrollAdvanceRequest,
  CreatePayrollAdvanceRequest,
  MePayrollAdvanceListQuery,
  PayrollAdvanceListQuery,
  PayrollAdvanceStatus,
  PayrollAdvanceWriteResultDto,
  RejectPayrollAdvanceRequest,
  UpdatePayrollAdvanceRequest,
} from "@mediaos/contracts";
import { paginated, toPagination } from "../common/pagination";
import { DatabaseService, type TenantTx } from "../db/db.service";
import type { PayrollAdvance } from "../db/schema/payroll-disbursement";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PayrollAccessService } from "./payroll-access.service";
import { PayrollAdvancesRepository } from "./payroll-advances.repository";
import { toPayrollAdvanceDto } from "./payroll-disbursement.mapper";
import {
  PAYROLL_ACTOR_FALLBACK,
  PAYROLL_EVENT_ADVANCE_APPROVED,
  PAYROLL_EVENT_ADVANCE_REJECTED,
  PAYROLL_EVENT_ADVANCE_SUBMITTED,
  type PayrollAdvanceApprovedPayload,
  type PayrollAdvanceRejectedPayload,
  type PayrollAdvanceSubmittedPayload,
} from "./payroll-noti.payload";
import { PayrollPairHoldersReader } from "./payroll-pair-holders.reader";
import { PayrollPeopleRepository } from "./payroll-people.repository";
import {
  mapPayrollPgError,
  payrollConflict,
  payrollDetails,
  payrollNotFound,
  PAYROLL_ERR,
} from "./payroll.errors";
import { payrollOffset, type PayrollActor, type PayrollRequestUser } from "./payroll.types";

/**
 * Kỳ ĐÍCH còn nhận tạm ứng khi TẠO/SỬA (060/062): SPEC-11 §15.1 hàng 060 nguyên văn «kỳ đích ≥ `Calculated` ⇒ 409 026».
 * Owner lật D-3 ⇒ đổi ở đây (hằng tập trung).
 */
export const ADVANCE_CREATE_OPEN_STATUSES: ReadonlySet<string> = new Set([
  "Draft",
  "CollectingData",
]);
/**
 * Kỳ ĐÍCH còn nhận DUYỆT (063): thêm `Calculated` — lượt tính lại tại chỗ nhặt được khoản (BE-3 nhả/nhặt theo tập
 * `Approved` lúc khoá kỳ); chặn từ `Reviewing` vì snapshot đã đóng băng, khoản sẽ mồ côi vĩnh viễn (chỉ `reopen` cứu).
 * Duyệt khi kỳ đang `Calculated` ⇒ 200 + `warnings ["recalculate-required"]` (plan-review B3).
 */
export const ADVANCE_APPROVE_OPEN_STATUSES: ReadonlySet<string> = new Set([
  "Draft",
  "CollectingData",
  "Calculated",
]);

const isoOf = (v: Date | string | null | undefined): string =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

/**
 * S15-PAYROLL-BE-4 — tạm ứng `PAYROLL-API-059..065` (SPEC-11 §13 · §15.1, khuôn `BonusPenaltiesService`).
 *
 * ── FOUR-EYES HAI VẾ (plan-review B2) ──
 * Người TẠO (`created_by === actor`) **HOẶC người THỤ HƯỞNG** (`user_id === actor`) đều không tự duyệt/từ chối được ⇒
 * 409 025 `self-approval`, tiền-kiểm dưới `FOR UPDATE`. CHECK `payroll_advances_four_eyes_check` chỉ soi `created_by`
 * ⇒ vế thụ hưởng CHỈ có ở đây (đột biến (h) làm ca «thụ hưởng tự duyệt» đỏ).
 *
 * ── 026 THEO KỲ ĐÍCH (D-3) ── `assertTargetPeriodOpen`: SELECT thường (không khoá kỳ) — race với `calculate` tệ nhất
 * là khoản không được nhặt lượt này và hiện `unconsumed-advances`, không sai tiền.
 *
 * ── Envelope route GHI: `{ id, status, warnings }` — 0 khoá tiền (cặp `manage`/`approve` không phải cửa sau đọc tiền).
 * ── 065 Own: `repo.listTx({ userId: actor })` — không hàng ⇒ rỗng; **0 audit** (tự xem của mình, SPEC-11 §18).
 */
@Injectable()
export class PayrollAdvancesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly repo: PayrollAdvancesRepository,
    private readonly holders: PayrollPairHoldersReader,
    private readonly people: PayrollPeopleRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** 059 — danh sách (audit lượt đọc: bộ lọc + số dòng, KHÔNG tiền). */
  async list(user: PayrollRequestUser, query: PayrollAdvanceListQuery) {
    const actor = await this.access.resolveActor(user, "advanceList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const filter = {
        userId: query.userId,
        status: query.status as PayrollAdvanceStatus[] | undefined,
        deductPeriodMonth: query.deductPeriodMonth,
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
      await this.audit.record(tx, {
        action: "read",
        objectType: "payroll_advance",
        actorUserId: user.id,
        before: null,
        after: { filters: filter, rowCount: rows.length },
      });
      return paginated(
        rows.map((r) => toPayrollAdvanceDto(r, actor)),
        toPagination(total, query.page, query.per_page),
      );
    });
  }

  /** 060 — tạo (`Pending`, `created_by` từ JWT) + NOTI-024 tới holders(`approve:payroll-advance`) − actor. */
  async create(
    user: PayrollRequestUser,
    dto: CreatePayrollAdvanceRequest,
  ): Promise<PayrollAdvanceWriteResultDto> {
    const actor = await this.access.resolveActor(user, "advanceCreate");
    return this.db.withTenant(user.companyId, async (tx) => {
      await this.assertTargetPeriodOpen(
        tx,
        user.companyId,
        dto.deductPeriodMonth,
        ADVANCE_CREATE_OPEN_STATUSES,
      );
      let row: PayrollAdvance;
      try {
        row = await this.repo.createTx(tx, user.companyId, dto, user.id);
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      await this.audit.record(tx, {
        action: "create",
        objectType: "payroll_advance",
        objectId: row.id,
        actorUserId: user.id,
        before: null,
        // KHÔNG `amount` — audit lương không mang số tiền (SPEC-11 §18).
        after: { userId: row.userId, deductPeriodMonth: row.deductPeriodMonth, status: row.status },
      });

      const warnings: string[] = [];
      const recipientUserIds = await this.holders.holdersTx(
        tx,
        user.companyId,
        "advanceApprove",
        user.id,
      );
      if (recipientUserIds.length === 0) {
        // Khác 017 ở `submit`: tạm ứng vẫn tạo được (không kẹt FSM) — chỉ cảnh báo, KHÔNG enqueue (registrar ném khi rỗng).
        warnings.push("no-eligible-approver");
      } else {
        const payload: PayrollAdvanceSubmittedPayload = {
          advanceId: row.id,
          actorUserId: user.id,
          recipientUserIds,
          createdAtIso: isoOf(row.createdAt),
          actor_name: await this.actorName(tx, actor),
          deduct_period_month: row.deductPeriodMonth,
          payroll_advance_id: row.id,
        };
        await this.outbox.enqueue(tx, { eventType: PAYROLL_EVENT_ADVANCE_SUBMITTED, payload });
      }
      return { id: row.id, status: row.status as PayrollAdvanceStatus, warnings };
    });
  }

  /** 061 — chi tiết (audit lượt đọc `{}`). */
  async get(user: PayrollRequestUser, id: string) {
    const actor = await this.access.resolveActor(user, "advanceDetail");
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findTx(tx, user.companyId, id);
      if (!row) throw payrollNotFound();
      await this.audit.record(tx, {
        action: "read",
        objectType: "payroll_advance",
        objectId: row.id,
        actorUserId: user.id,
        before: null,
        after: {},
      });
      return toPayrollAdvanceDto(row, actor);
    });
  }

  /** 062 — sửa **hoặc** xoá mềm; chỉ khi `Pending` chưa bind (025 — kiểm «đã khấu trừ» TRƯỚC «không còn Pending»). */
  async update(
    user: PayrollRequestUser,
    id: string,
    dto: UpdatePayrollAdvanceRequest,
  ): Promise<PayrollAdvanceWriteResultDto> {
    await this.access.resolveActor(user, "advanceUpdate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.lockPendingUnbound(tx, user.companyId, id);

      if (dto.delete === true) {
        let row: PayrollAdvance | null;
        try {
          row = await this.repo.softDeleteTx(tx, user.companyId, id, user.id);
        } catch (err) {
          throw mapPayrollPgError(err) ?? err;
        }
        if (!row) throw payrollNotFound();
        await this.audit.record(tx, {
          action: "delete",
          objectType: "payroll_advance",
          objectId: row.id,
          actorUserId: user.id,
          before: {
            userId: before.userId,
            deductPeriodMonth: before.deductPeriodMonth,
            status: before.status,
          },
          after: null,
        });
        return { id: row.id, status: row.status as PayrollAdvanceStatus, warnings: [] };
      }

      if (
        dto.deductPeriodMonth !== undefined &&
        dto.deductPeriodMonth !== before.deductPeriodMonth
      ) {
        await this.assertTargetPeriodOpen(
          tx,
          user.companyId,
          dto.deductPeriodMonth,
          ADVANCE_CREATE_OPEN_STATUSES,
        );
      }
      const changedFields = (["amount", "deductPeriodMonth", "reason"] as const).filter(
        (k) => dto[k] !== undefined,
      );
      let row: PayrollAdvance | null;
      try {
        row = await this.repo.updateTx(
          tx,
          user.companyId,
          id,
          {
            ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
            ...(dto.deductPeriodMonth !== undefined
              ? { deductPeriodMonth: dto.deductPeriodMonth }
              : {}),
            ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
          },
          user.id,
        );
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      if (!row) throw payrollNotFound();
      await this.audit.record(tx, {
        action: "update",
        objectType: "payroll_advance",
        objectId: row.id,
        actorUserId: user.id,
        before: { status: before.status, deductPeriodMonth: before.deductPeriodMonth },
        // Tên trường, KHÔNG giá trị.
        after: { status: row.status, deductPeriodMonth: row.deductPeriodMonth, changedFields },
      });
      return { id: row.id, status: row.status as PayrollAdvanceStatus, warnings: [] };
    });
  }

  /** 063 — duyệt (four-eyes hai vế · 026 theo kỳ đích · B3 `recalculate-required` · NOTI-025). */
  async approve(user: PayrollRequestUser, id: string, dto: ApprovePayrollAdvanceRequest) {
    return this.decide(user, id, "Approved", dto.note ?? null);
  }

  /** 064 — từ chối; `note` BẮT BUỘC (Zod mirror CHECK `reject_note_check`) · NOTI-026. */
  async reject(user: PayrollRequestUser, id: string, dto: RejectPayrollAdvanceRequest) {
    return this.decide(user, id, "Rejected", dto.note);
  }

  /** 065 — «Tạm ứng của tôi» (Own): lọc `user_id = actor` ở SQL; rỗng hợp lệ; **0 audit**. */
  async listMine(user: PayrollRequestUser, query: MePayrollAdvanceListQuery) {
    const actor = await this.access.resolveActor(user, "meAdvanceList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const filter = {
        userId: user.id,
        status: query.status as PayrollAdvanceStatus[] | undefined,
        deductPeriodMonth: query.deductPeriodMonth,
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
        rows.map((r) => toPayrollAdvanceDto(r, actor)),
        toPagination(total, query.page, query.per_page),
      );
    });
  }

  // ── nội bộ ──────────────────────────────────────────────────────────────────────────────────

  private async decide(
    user: PayrollRequestUser,
    id: string,
    status: "Approved" | "Rejected",
    note: string | null,
  ): Promise<PayrollAdvanceWriteResultDto> {
    // Literal điều kiện — census 2 tầng pin site này với HAI key (khuôn `BonusPenaltiesService#decide`).
    const routeKey = status === "Approved" ? "advanceApprove" : "advanceReject";
    const actor = await this.access.resolveActor(user, routeKey);
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.lockPendingUnbound(tx, user.companyId, id);
      // B2 — người TẠO hoặc người THỤ HƯỞNG đều không tự quyết định (CHECK DB chỉ soi created_by).
      if (before.createdBy === user.id || before.userId === user.id) {
        throw payrollConflict(
          "ADVANCE_CONFLICT",
          PAYROLL_ERR.ADVANCE_SELF_APPROVAL,
          payrollDetails("self-approval"),
        );
      }
      const warnings: string[] = [];
      if (status === "Approved") {
        const periodStatus = await this.assertTargetPeriodOpen(
          tx,
          user.companyId,
          before.deductPeriodMonth,
          ADVANCE_APPROVE_OPEN_STATUSES,
        );
        // B3 — kỳ đã tính: chỉ lượt tính LẠI mới nhặt khoản này; không tín hiệu ⇒ officer submit thẳng ⇒ khoản mồ côi.
        if (periodStatus === "Calculated") warnings.push("recalculate-required");
      }
      let row: PayrollAdvance | null;
      try {
        row = await this.repo.decideTx(tx, user.companyId, id, status, note, user.id);
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      if (!row) throw payrollNotFound();
      await this.audit.record(tx, {
        action: status === "Approved" ? "approve" : "reject",
        objectType: "payroll_advance",
        objectId: row.id,
        actorUserId: user.id,
        before: { status: before.status },
        after: { status: row.status, deductPeriodMonth: row.deductPeriodMonth, warnings },
      });

      // C7 — người nhận = uniq[thụ hưởng, người tạo] − actor, lọc null; rỗng ⇒ KHÔNG enqueue (registrar ném khi rỗng).
      const recipientUserIds = [...new Set([row.userId, row.createdBy])].filter(
        (u): u is string => typeof u === "string" && u.length > 0 && u !== user.id,
      );
      if (recipientUserIds.length > 0) {
        const base = {
          advanceId: row.id,
          actorUserId: user.id,
          recipientUserIds,
          decidedAtIso: isoOf(row.decidedAt),
          actor_name: await this.actorName(tx, actor),
          deduct_period_month: row.deductPeriodMonth,
          payroll_advance_id: row.id,
        };
        if (status === "Approved") {
          const payload: PayrollAdvanceApprovedPayload = base;
          await this.outbox.enqueue(tx, { eventType: PAYROLL_EVENT_ADVANCE_APPROVED, payload });
        } else {
          const payload: PayrollAdvanceRejectedPayload = { ...base, reason: note ?? "" };
          await this.outbox.enqueue(tx, { eventType: PAYROLL_EVENT_ADVANCE_REJECTED, payload });
        }
      }
      return { id: row.id, status: row.status as PayrollAdvanceStatus, warnings };
    });
  }

  /**
   * Khoá hàng rồi tiền-kiểm theo thứ tự SPEC-11 §12.1 hàng 025: đã bind kỳ ⇒ `advance-already-deducted` (kiểm TRƯỚC —
   * hàng đã bind luôn `Deducted`, kiểm `Pending` trước thì mọi hàng đã bind trả nhầm `advance-not-pending`); không còn
   * `Pending` ⇒ `advance-not-pending`.
   */
  private async lockPendingUnbound(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<PayrollAdvance> {
    const row = await this.repo.lockForUpdateTx(tx, companyId, id);
    if (!row) throw payrollNotFound();
    if (row.payrollPeriodId !== null) {
      throw payrollConflict(
        "ADVANCE_CONFLICT",
        PAYROLL_ERR.ADVANCE_ALREADY_DEDUCTED,
        payrollDetails("advance-already-deducted"),
      );
    }
    if ((row.status as PayrollAdvanceStatus) !== "Pending") {
      throw payrollConflict(
        "ADVANCE_CONFLICT",
        PAYROLL_ERR.ADVANCE_NOT_PENDING,
        payrollDetails("advance-not-pending"),
      );
    }
    return row;
  }

  /** Kỳ đích tồn tại (sống) và `status ∉ allowed` ⇒ 409 026. Tháng chưa có kỳ ⇒ qua. Trả status để B3 dùng. */
  private async assertTargetPeriodOpen(
    tx: TenantTx,
    companyId: string,
    deductPeriodMonth: string,
    allowed: ReadonlySet<string>,
  ): Promise<string | null> {
    const status = await this.repo.targetPeriodStatusTx(tx, companyId, deductPeriodMonth);
    if (status !== null && !allowed.has(status)) {
      throw payrollConflict(
        "ADVANCE_PERIOD_FROZEN",
        PAYROLL_ERR.ADVANCE_PERIOD_FROZEN,
        payrollDetails("advance-period-frozen", { periodStatus: status }),
      );
    }
    return status;
  }

  private async actorName(tx: TenantTx, actor: PayrollActor): Promise<string> {
    const map = await this.people.namesByUserIdsTx(tx, actor, [actor.actorUserId]);
    return map.get(actor.actorUserId)?.displayName ?? PAYROLL_ACTOR_FALLBACK;
  }
}
