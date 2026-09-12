import { Injectable } from "@nestjs/common";
import type {
  CreatePayrollDependentRequest,
  PayrollDependentDto,
  PayrollEmployeeWriteResultDto,
  UpdatePayrollDependentRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { PayrollAccessService } from "./payroll-access.service";
import { PayrollDependentsRepository } from "./payroll-dependents.repository";
import { PayrollEmployeesRepository } from "./payroll-employees.repository";
import {
  mapPayrollPgError,
  payrollConflict,
  payrollDetails,
  payrollNotFound,
  PAYROLL_ERR,
} from "./payroll.errors";
import type { PayrollRequestUser } from "./payroll.types";
import type { PayrollDependent } from "../db/schema/payroll";

/**
 * S15-PAYROLL-BE-1 — `PAYROLL-API-040/041/042`: người phụ thuộc giảm trừ TNCN.
 *
 * **Audit — hai hình dạng KHÁC NHAU, có chủ đích:**
 *   • **040 (ĐỌC)** → `payroll_dependent` / **`userId`** / `{rowCount}` — §18.1 B hàng 4 neo CHA vì một
 *     lượt đọc phủ cả danh sách NPT của một người; neo vào một `id` con thì vết nói sai phạm vi.
 *   • **041/042 (GHI)** → `payroll_dependent` / **`dependentId`** — luật chung đường GHI (SPEC-11 §12.1
 *     cuối: `object_id` là id của CHÍNH đối tượng). Neo `userId` cho đường GHI thì 3 lượt tạo + 1 lượt
 *     xoá mềm để lại **4 hàng audit giống hệt nhau** và không trả lời được "ai xoá NPT nào".
 *
 * 🔴 **042 resolve `userId` TỪ HÀNG, không từ URL** — route cố ý không lồng dưới `:userId` (SPEC-11
 * §15.1): lồng thêm tạo HAI nguồn sự thật cho cùng một phép kiểm quyền (URL nói người A, hàng DB nói
 * người B).
 *
 * **Envelope GHI `{id, warnings}` — 0 khoá PII.** §3.12 chốt "NPT (họ tên · MST NPT) **chỉ với**
 * `('view','payroll-employee')`"; invariant seed `manage ⇒ view` của §11.3 **không phủ**
 * `payroll-employee`, nên một role chỉ có `manage` là có thật — phản hồi GHI không được thành cửa sau.
 */
@Injectable()
export class PayrollDependentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly repo: PayrollDependentsRepository,
    private readonly employees: PayrollEmployeesRepository,
    private readonly audit: AuditService,
  ) {}

  private static toDto(row: PayrollDependent): PayrollDependentDto {
    return {
      id: row.id,
      userId: row.userId,
      fullName: row.fullName,
      relationship: row.relationship as PayrollDependentDto["relationship"],
      dependentTaxCode: row.dependentTaxCode ?? null,
      dateOfBirth: row.dateOfBirth ? String(row.dateOfBirth) : null,
      effectiveFrom: String(row.effectiveFrom),
      effectiveTo: row.effectiveTo ? String(row.effectiveTo) : null,
    };
  }

  private static overlapConflict() {
    return payrollConflict(
      "DEPENDENT_OVERLAP",
      PAYROLL_ERR.DEPENDENT_OVERLAP,
      payrollDetails("dependent-overlap"),
    );
  }

  /** 040 — danh sách NPT + **audit lượt đọc**. */
  async list(user: PayrollRequestUser, userId: string): Promise<PayrollDependentDto[]> {
    await this.access.resolveActor(user, "employeeDependentList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const emp = await this.employees.findTx(tx, user.companyId, userId);
      if (!emp) throw payrollNotFound();
      const rows = await this.repo.listByUserTx(tx, user.companyId, userId);
      await this.audit.record(tx, {
        action: "read",
        objectType: "payroll_dependent",
        objectId: userId,
        actorUserId: user.id,
        before: null,
        // KHÔNG tên NPT, KHÔNG MST — audit đếm, không nhân bản PII sang bảng append-only.
        after: { rowCount: rows.length },
      });
      return rows.map(PayrollDependentsService.toDto);
    });
  }

  /** 041 — thêm NPT. Chồng lấp ⇒ **409 PAYROLL-ERR-032**. */
  async create(
    user: PayrollRequestUser,
    userId: string,
    dto: CreatePayrollDependentRequest,
  ): Promise<PayrollEmployeeWriteResultDto> {
    await this.access.resolveActor(user, "employeeDependentCreate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const emp = await this.employees.findTx(tx, user.companyId, userId);
      if (!emp) throw payrollNotFound();

      // Tiền-kiểm để có thông điệp đọc được; EXCLUDE ở DB là chốt cuối cho RACE (⇒ 23P01 → cùng 409).
      const clash = await this.repo.overlapsTx(
        tx,
        user.companyId,
        userId,
        dto.fullName,
        dto.effectiveFrom,
        dto.effectiveTo ?? null,
      );
      if (clash) throw PayrollDependentsService.overlapConflict();

      let row;
      try {
        row = await this.repo.createTx(
          tx,
          user.companyId,
          userId,
          {
            fullName: dto.fullName,
            relationship: dto.relationship,
            dependentTaxCode: dto.dependentTaxCode ?? null,
            dateOfBirth: dto.dateOfBirth ?? null,
            effectiveFrom: dto.effectiveFrom,
            effectiveTo: dto.effectiveTo ?? null,
          },
          user.id,
        );
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      await this.audit.record(tx, {
        action: "create",
        objectType: "payroll_dependent",
        objectId: row.id,
        actorUserId: user.id,
        before: null,
        after: { userId: row.userId },
      });
      return { id: row.id, warnings: [] };
    });
  }

  /**
   * 042 — sửa **hoặc** xoá mềm (`{delete:true}`).
   *
   * Chồng lấp kiểm trên trạng thái **SAU KHI MERGE** (`fullName`/`effectiveFrom`/`effectiveTo` có thể
   * chỉ gửi một vế, vế kia nằm ở hàng DB) — kiểm trên payload thô là kiểm nhầm đối tượng.
   */
  async update(
    user: PayrollRequestUser,
    id: string,
    dto: UpdatePayrollDependentRequest,
  ): Promise<PayrollEmployeeWriteResultDto> {
    await this.access.resolveActor(user, "dependentUpdate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.repo.findTx(tx, user.companyId, id);
      if (!before) throw payrollNotFound();

      if (dto.delete === true) {
        const row = await this.repo.softDeleteTx(tx, user.companyId, id, user.id);
        if (!row) throw payrollNotFound();
        await this.audit.record(tx, {
          action: "delete",
          objectType: "payroll_dependent",
          objectId: row.id,
          actorUserId: user.id,
          // `userId` đọc TỪ HÀNG (`before`), KHÔNG từ URL — route này không có param đó.
          before: { userId: before.userId },
          after: null,
        });
        return { id: row.id, warnings: [] };
      }

      const merged = {
        fullName: dto.fullName ?? before.fullName,
        effectiveFrom: dto.effectiveFrom ?? String(before.effectiveFrom),
        effectiveTo:
          dto.effectiveTo !== undefined
            ? dto.effectiveTo
            : before.effectiveTo
              ? String(before.effectiveTo)
              : null,
      };
      // CHECK `payroll_dependents_period_check` là lưới cuối; ở đây chặn sớm với thông điệp đọc được.
      if (merged.effectiveTo && merged.effectiveTo < merged.effectiveFrom) {
        throw payrollConflict(
          "DEPENDENT_OVERLAP",
          PAYROLL_ERR.DEPENDENT_OVERLAP,
          payrollDetails("dependent-overlap", { reason: "effective-to-before-from" }),
        );
      }
      const clash = await this.repo.overlapsTx(
        tx,
        user.companyId,
        before.userId,
        merged.fullName,
        merged.effectiveFrom,
        merged.effectiveTo,
        id,
      );
      if (clash) throw PayrollDependentsService.overlapConflict();

      const changedFields = Object.keys(dto).filter((k) => k !== "delete");
      let row;
      try {
        row = await this.repo.updateTx(
          tx,
          user.companyId,
          id,
          {
            ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
            ...(dto.relationship !== undefined ? { relationship: dto.relationship } : {}),
            ...(dto.dependentTaxCode !== undefined
              ? { dependentTaxCode: dto.dependentTaxCode }
              : {}),
            ...(dto.dateOfBirth !== undefined ? { dateOfBirth: dto.dateOfBirth } : {}),
            ...(dto.effectiveFrom !== undefined ? { effectiveFrom: dto.effectiveFrom } : {}),
            ...(dto.effectiveTo !== undefined ? { effectiveTo: dto.effectiveTo } : {}),
          },
          user.id,
        );
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      if (!row) throw payrollNotFound();
      await this.audit.record(tx, {
        action: "update",
        objectType: "payroll_dependent",
        objectId: row.id,
        actorUserId: user.id,
        before: { userId: before.userId },
        // TÊN trường, KHÔNG giá trị — không nhân bản PII vào audit.
        after: { userId: row.userId, changedFields },
      });
      return { id: row.id, warnings: [] };
    });
  }
}
