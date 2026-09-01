import { Injectable } from "@nestjs/common";
import type {
  ApproveBonusPenaltyRequest,
  BonusPenaltyListQuery,
  BonusPenaltyStatus,
  CreateBonusPenaltyRequest,
  RejectBonusPenaltyRequest,
  UpdateBonusPenaltyRequest,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { paginated, toPagination } from "../common/pagination";
import type { BonusPenalty } from "../db/schema/payroll";
import { PayrollAccessService } from "./payroll-access.service";
import { BonusPenaltiesRepository } from "./bonus-penalties.repository";
import { mapPayrollPgError, payrollConflict, payrollNotFound, PAYROLL_ERR } from "./payroll.errors";
import { toBonusPenaltyDto } from "./payroll.mapper";
import { payrollOffset, type PayrollRequestUser } from "./payroll.types";

/**
 * S13-PAYROLL-BE-1 — thưởng/phạt `PAYROLL-API-023..028` (FSM SPEC-11 §13.3).
 *
 * `Pending → Approved | Rejected`; hai đích **TERMINAL**. Sửa nội dung chỉ khi `Pending`; `Rejected`
 * bắt buộc `decision_note` (Zod ép — mirror CHECK); **người quyết định ≠ người tạo** (⇒ `012`).
 * Hàng đã consume vào một kỳ lương thì khoá sửa/xoá (⇒ `013`).
 *
 * ⚠️ **Tiền-kiểm 011/013 dưới `FOR UPDATE`, KHÔNG dựa trigger để phân loại lỗi.** Trigger
 * `enforce_bonus_penalty_freeze` (`0564`) `RAISE … USING ERRCODE='check_violation'` mà **không kèm
 * `USING CONSTRAINT`** ⇒ `err.constraint` rỗng ⇒ không phân biệt được nhánh (A)–(E). Nếu để trigger
 * quyết thì mọi vi phạm về một mã duy nhất — hoặc tệ hơn, 500 ở vùng đỏ. Trigger còn giá trị đúng một
 * việc: chốt cuối cho RACE (map ở `mapPayrollPgError`).
 */
@Injectable()
export class BonusPenaltiesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly repo: BonusPenaltiesRepository,
    private readonly audit: AuditService,
  ) {}

  /** 023 — danh sách. */
  async list(user: PayrollRequestUser, query: BonusPenaltyListQuery) {
    const actor = await this.access.resolveActor(user, "bonusPenaltyList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const filter = {
        userId: query.userId,
        status: query.status as BonusPenaltyStatus[] | undefined,
        periodMonth: query.periodMonth,
        kind: query.kind,
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
        rows.map((r) => toBonusPenaltyDto(r, actor)),
        toPagination(total, query.page, query.per_page),
      );
    });
  }

  /** 024 — tạo (luôn vào `Pending`). */
  async create(user: PayrollRequestUser, dto: CreateBonusPenaltyRequest) {
    const actor = await this.access.resolveActor(user, "bonusPenaltyCreate");
    return this.db.withTenant(user.companyId, async (tx) => {
      let row;
      try {
        row = await this.repo.createTx(tx, user.companyId, dto, user.id);
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      await this.audit.record(tx, {
        action: "create",
        objectType: "bonus_penalty",
        objectId: row.id,
        actorUserId: user.id,
        before: null,
        // KHÔNG `amount` — audit lương không mang số tiền (SPEC-11 §18).
        after: {
          userId: row.userId,
          kind: row.kind,
          periodMonth: row.periodMonth,
          status: row.status,
        },
      });
      return toBonusPenaltyDto(row, actor);
    });
  }

  /** 025 — chi tiết. */
  async get(user: PayrollRequestUser, id: string) {
    const actor = await this.access.resolveActor(user, "bonusPenaltyDetail");
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findTx(tx, user.companyId, id);
      if (!row) throw payrollNotFound();
      return toBonusPenaltyDto(row, actor);
    });
  }

  /** 026 — sửa **hoặc** xoá mềm; cả hai chỉ hợp lệ khi còn `Pending` và chưa consume. */
  async update(user: PayrollRequestUser, id: string, dto: UpdateBonusPenaltyRequest) {
    const actor = await this.access.resolveActor(user, "bonusPenaltyUpdate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.lockPendingUnconsumed(tx, user.companyId, id);

      if (dto.delete === true) {
        const row = await this.repo.softDeleteTx(tx, user.companyId, id, user.id);
        if (!row) throw payrollNotFound();
        await this.audit.record(tx, {
          action: "delete",
          objectType: "bonus_penalty",
          objectId: row.id,
          actorUserId: user.id,
          before: { userId: before.userId, kind: before.kind, periodMonth: before.periodMonth },
          after: null,
        });
        return toBonusPenaltyDto(row, actor);
      }

      const changedFields = (["kind", "amount", "periodMonth", "reason"] as const).filter(
        (k) => dto[k] !== undefined,
      );
      let row;
      try {
        row = await this.repo.updateTx(
          tx,
          user.companyId,
          id,
          {
            ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
            ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
            ...(dto.periodMonth !== undefined ? { periodMonth: dto.periodMonth } : {}),
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
        objectType: "bonus_penalty",
        objectId: row.id,
        actorUserId: user.id,
        before: { status: before.status, periodMonth: before.periodMonth },
        // Tên trường, KHÔNG giá trị.
        after: { status: row.status, periodMonth: row.periodMonth, changedFields },
      });
      return toBonusPenaltyDto(row, actor);
    });
  }

  /** 027 — duyệt. Tự duyệt hàng do chính mình tạo ⇒ 409 `012` (segregation of duties). */
  async approve(user: PayrollRequestUser, id: string, dto: ApproveBonusPenaltyRequest) {
    return this.decide(user, id, "Approved", dto.decisionNote ?? null);
  }

  /** 028 — từ chối; `decisionNote` **BẮT BUỘC** (Zod mirror CHECK `..._reject_note_check`). */
  async reject(user: PayrollRequestUser, id: string, dto: RejectBonusPenaltyRequest) {
    return this.decide(user, id, "Rejected", dto.decisionNote);
  }

  // ── nội bộ ──────────────────────────────────────────────────────────────────────────────────

  private async decide(
    user: PayrollRequestUser,
    id: string,
    status: "Approved" | "Rejected",
    decisionNote: string | null,
  ) {
    const routeKey = status === "Approved" ? "bonusPenaltyApprove" : "bonusPenaltyReject";
    const actor = await this.access.resolveActor(user, routeKey);
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.lockPendingUnconsumed(tx, user.companyId, id);
      if (before.createdBy === user.id) {
        throw payrollConflict("BONUS_SELF_APPROVAL", PAYROLL_ERR.BONUS_SELF_APPROVAL, [
          { field: "kind", message: "self-approval", rule: "payroll" },
        ]);
      }
      let row;
      try {
        // Câu này CHỈ ghi status/decided_*/decision_note — nhánh (D) của trigger chặn "vừa duyệt vừa
        // sửa tiền", và lỗi đó về dạng 23514 KHÔNG TÊN nên không map lại được thành mã đúng.
        row = await this.repo.decideTx(tx, user.companyId, id, status, decisionNote, user.id);
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      if (!row) throw payrollNotFound();
      await this.audit.record(tx, {
        action: status === "Approved" ? "approve" : "reject",
        objectType: "bonus_penalty",
        objectId: row.id,
        actorUserId: user.id,
        before: { status: before.status },
        after: { status: row.status, periodMonth: row.periodMonth },
      });
      return toBonusPenaltyDto(row, actor);
    });
  }

  /**
   * Khoá hàng rồi tiền-kiểm HAI điều kiện theo đúng thứ tự SPEC-11 §13.3:
   *  · đã consume vào một kỳ ⇒ **013** (kiểm TRƯỚC — hàng đã consume luôn là `Approved`, nếu kiểm
   *    `Pending` trước thì mọi hàng đã consume sẽ trả nhầm **011**);
   *  · không còn `Pending` ⇒ **011**.
   */
  private async lockPendingUnconsumed(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<BonusPenalty> {
    const row = await this.repo.lockForUpdateTx(tx, companyId, id);
    if (!row) throw payrollNotFound();
    if (row.payrollPeriodId !== null) {
      throw payrollConflict("BONUS_ALREADY_CONSUMED", PAYROLL_ERR.BONUS_ALREADY_CONSUMED, [
        { field: "kind", message: "already-consumed", rule: "payroll" },
      ]);
    }
    if ((row.status as BonusPenaltyStatus) !== "Pending") {
      throw payrollConflict("BONUS_NOT_PENDING", PAYROLL_ERR.BONUS_NOT_PENDING, [
        { field: "kind", message: "not-pending", rule: "payroll" },
      ]);
    }
    return row;
  }
}
