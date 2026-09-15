import { Injectable } from "@nestjs/common";
import type {
  CreatePayrollBudgetRequest,
  PayrollBudgetListQuery,
  PayrollBudgetWriteResultDto,
  UpdatePayrollBudgetRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import type { PayrollBudget } from "../db/schema/payroll-disbursement";
import { AuditService } from "../events/audit.service";
import { PayrollAccessService } from "./payroll-access.service";
import { PayrollBudgetsRepository } from "./payroll-budgets.repository";
import { toPayrollBudgetDto } from "./payroll-disbursement.mapper";
import { PayrollTemplatesRepository } from "./payroll-templates.repository";
import { mapPayrollPgError, payrollNotFound } from "./payroll.errors";
import type { PayrollRequestUser } from "./payroll.types";

/**
 * S15-PAYROLL-BE-4 — ngân sách lương `PAYROLL-API-073..075` (SPEC-11 §15.1 · DB-13 §14.4).
 *
 * 073 kèm «thực hiện» tính LÚC GỌI (D-4, ở repository); SÀN scope Company (`resolveActor`). 074: `orgUnitId` phải là đơn vị
 * SỐNG của công ty (`orgUnitLiveTx` tái dùng của `PayrollTemplatesRepository` — FK composite chặn khác tenant nhưng không
 * chặn xoá mềm) ⇒ 404; trùng `(năm, đơn vị)` ⇒ 409 029 từ UNIQUE (kể cả bẫy NULL). 075: sửa/xoá mềm dưới `FOR UPDATE`.
 * Route GHI trả `{ id, warnings }` — 0 khoá tiền; audit KHÔNG mang `plannedAmount`.
 */
@Injectable()
export class PayrollBudgetsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly repo: PayrollBudgetsRepository,
    private readonly templates: PayrollTemplatesRepository,
    private readonly audit: AuditService,
  ) {}

  /** 073 — `fiscalYear` vắng ⇒ năm hiện tại (UTC). Audit lượt đọc `{fiscalYear, orgUnitId, rowCount}`. */
  async list(user: PayrollRequestUser, query: PayrollBudgetListQuery) {
    const actor = await this.access.resolveActor(user, "budgetList");
    const fiscalYear = query.fiscalYear ?? new Date().getUTCFullYear();
    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.listTx(tx, user.companyId, fiscalYear, query.orgUnitId);
      await this.audit.record(tx, {
        action: "read",
        objectType: "payroll_budget",
        actorUserId: user.id,
        before: null,
        after: { fiscalYear, orgUnitId: query.orgUnitId ?? null, rowCount: rows.length },
      });
      return rows.map((r) => toPayrollBudgetDto(r, actor));
    });
  }

  /** 074 — tạo; đơn vị chọn phải sống ⇒ 404; trùng ⇒ 409 029. */
  async create(
    user: PayrollRequestUser,
    dto: CreatePayrollBudgetRequest,
  ): Promise<PayrollBudgetWriteResultDto> {
    await this.access.resolveActor(user, "budgetCreate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const orgUnitId = dto.orgUnitId ?? null;
      if (
        orgUnitId !== null &&
        !(await this.templates.orgUnitLiveTx(tx, user.companyId, orgUnitId))
      ) {
        throw payrollNotFound();
      }
      let row: PayrollBudget;
      try {
        row = await this.repo.createTx(
          tx,
          user.companyId,
          {
            fiscalYear: dto.fiscalYear,
            orgUnitId,
            plannedAmount: dto.plannedAmount,
            note: dto.note ?? null,
          },
          user.id,
        );
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      await this.audit.record(tx, {
        action: "create",
        objectType: "payroll_budget",
        objectId: row.id,
        actorUserId: user.id,
        before: null,
        // KHÔNG `plannedAmount` — audit lương không mang số tiền.
        after: { fiscalYear: row.fiscalYear, orgUnitId: row.orgUnitId },
      });
      return { id: row.id, warnings: [] };
    });
  }

  /** 075 — sửa `plannedAmount`/`note` hoặc xoá mềm (`delete:true`). */
  async update(
    user: PayrollRequestUser,
    id: string,
    dto: UpdatePayrollBudgetRequest,
  ): Promise<PayrollBudgetWriteResultDto> {
    await this.access.resolveActor(user, "budgetUpdate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.repo.lockForUpdateTx(tx, user.companyId, id);
      if (!before) throw payrollNotFound();
      const summary = (b: PayrollBudget) => ({ fiscalYear: b.fiscalYear, orgUnitId: b.orgUnitId });

      if (dto.delete === true) {
        const row = await this.repo.softDeleteTx(tx, user.companyId, id, user.id);
        if (!row) throw payrollNotFound();
        await this.audit.record(tx, {
          action: "delete",
          objectType: "payroll_budget",
          objectId: id,
          actorUserId: user.id,
          before: summary(before),
          after: null,
        });
        return { id, warnings: [] };
      }

      const changedFields = (["plannedAmount", "note"] as const).filter(
        (k) => dto[k] !== undefined,
      );
      let row: PayrollBudget | null;
      try {
        row = await this.repo.updateTx(
          tx,
          user.companyId,
          id,
          {
            ...(dto.plannedAmount !== undefined ? { plannedAmount: dto.plannedAmount } : {}),
            ...(dto.note !== undefined ? { note: dto.note } : {}),
          },
          user.id,
        );
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      if (!row) throw payrollNotFound();
      await this.audit.record(tx, {
        action: "update",
        objectType: "payroll_budget",
        objectId: id,
        actorUserId: user.id,
        before: summary(before),
        // Tên trường, KHÔNG giá trị.
        after: { ...summary(row), changedFields },
      });
      return { id, warnings: [] };
    });
  }
}
