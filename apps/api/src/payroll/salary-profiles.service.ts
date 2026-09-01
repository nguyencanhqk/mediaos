import { Injectable } from "@nestjs/common";
import type {
  CreateSalaryProfileRequest,
  PayrollPeoplePickerQuery,
  SalaryProfileListQuery,
  UpdateSalaryProfileRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { paginated, toPagination } from "../common/pagination";
import { PayrollAccessService } from "./payroll-access.service";
import { PayrollPeopleRepository } from "./payroll-people.repository";
import { mapPayrollPgError, payrollNotFound } from "./payroll.errors";
import { toSalaryProfileDto, toSalaryProfileListItem } from "./payroll.mapper";
import { payrollOffset, type PayrollRequestUser } from "./payroll.types";
import { SalaryProfilesRepository } from "./salary-profiles.repository";

/**
 * S13-PAYROLL-BE-1 — hồ sơ lương `PAYROLL-API-019..022` + danh bạ `034`.
 *
 * ⚠️ **AUDIT LƯỢT ĐỌC ATOMIC** (SPEC-11 §18 — khuôn `hr-read.service`): `019` và `021` ghi `audit_logs`
 * **trong CÙNG transaction** với lượt đọc ⇒ rollback thì 0 hàng audit, không có lượt đọc nào không để
 * lại vết. Đây là 2 trong 7 đường đọc phải ghi audit; 5 đường còn lại (`lines` · `summary` · `payslips`
 * · `payslips/:id` · `export`) thuộc BE-2.
 *
 * Payload audit **KHÔNG chứa số tiền** — kể cả `before/after` của PATCH: ghi tên trường đã đổi
 * (`changedFields`), không ghi giá trị.
 */
@Injectable()
export class SalaryProfilesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly repo: SalaryProfilesRepository,
    private readonly people: PayrollPeopleRepository,
    private readonly audit: AuditService,
  ) {}

  /** 019 — danh sách + **audit lượt đọc**. */
  async list(user: PayrollRequestUser, query: SalaryProfileListQuery) {
    const actor = await this.access.resolveActor(user, "salaryProfileList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const filter = { userId: query.userId, effectiveOn: query.effectiveOn };
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
        objectType: "salary_profile",
        actorUserId: user.id,
        before: null,
        after: { filter, rows: rows.length },
      });
      return paginated(
        rows.map((r) => toSalaryProfileListItem(r, actor)),
        toPagination(total, query.page, query.per_page),
      );
    });
  }

  /** 020 — tạo phiên bản. Trùng `(user, effectiveDate)` ⇒ 409 `014` (chốt cuối unique partial). */
  async create(user: PayrollRequestUser, dto: CreateSalaryProfileRequest) {
    const actor = await this.access.resolveActor(user, "salaryProfileCreate");
    return this.db.withTenant(user.companyId, async (tx) => {
      let row;
      try {
        row = await this.repo.createTx(
          tx,
          user.companyId,
          {
            userId: dto.userId,
            effectiveDate: dto.effectiveDate,
            baseSalary: dto.baseSalary,
            allowances: dto.allowances,
            note: dto.note ?? null,
          },
          user.id,
        );
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      await this.audit.record(tx, {
        action: "create",
        objectType: "salary_profile",
        objectId: row.id,
        actorUserId: user.id,
        before: null,
        // KHÔNG `baseSalary`/`allowances` — audit không mang số tiền (SPEC-11 §18).
        after: { userId: row.userId, effectiveDate: String(row.effectiveDate) },
      });
      return toSalaryProfileDto(row, actor);
    });
  }

  /** 021 — chi tiết + **audit lượt đọc**. */
  async get(user: PayrollRequestUser, id: string) {
    const actor = await this.access.resolveActor(user, "salaryProfileDetail");
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findTx(tx, user.companyId, id);
      if (!row) throw payrollNotFound();
      await this.audit.record(tx, {
        action: "read",
        objectType: "salary_profile",
        objectId: row.id,
        actorUserId: user.id,
        before: null,
        after: { userId: row.userId, effectiveDate: String(row.effectiveDate) },
      });
      return toSalaryProfileDto(row, actor);
    });
  }

  /**
   * 022 — sửa **hoặc** xoá mềm (`{ delete: true }`). Không đụng phiếu lương đã phát hành: `payslips`
   * giữ `salary_profile_id` + snapshot ĐÓNG BĂNG của chính nó, nên sửa ở đây không hồi tố số cũ.
   */
  async update(user: PayrollRequestUser, id: string, dto: UpdateSalaryProfileRequest) {
    const actor = await this.access.resolveActor(user, "salaryProfileUpdate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.repo.findTx(tx, user.companyId, id);
      if (!before) throw payrollNotFound();

      if (dto.delete === true) {
        const row = await this.repo.softDeleteTx(tx, user.companyId, id, user.id);
        if (!row) throw payrollNotFound();
        await this.audit.record(tx, {
          action: "delete",
          objectType: "salary_profile",
          objectId: row.id,
          actorUserId: user.id,
          before: { userId: before.userId, effectiveDate: String(before.effectiveDate) },
          after: null,
        });
        return toSalaryProfileDto(row, actor);
      }

      const changedFields: string[] = [];
      if (dto.effectiveDate !== undefined) changedFields.push("effectiveDate");
      if (dto.baseSalary !== undefined) changedFields.push("baseSalary");
      if (dto.allowances !== undefined) changedFields.push("allowances");
      if (dto.note !== undefined) changedFields.push("note");

      let row;
      try {
        row = await this.repo.updateTx(
          tx,
          user.companyId,
          id,
          {
            ...(dto.effectiveDate !== undefined ? { effectiveDate: dto.effectiveDate } : {}),
            ...(dto.baseSalary !== undefined ? { baseSalary: dto.baseSalary } : {}),
            ...(dto.allowances !== undefined ? { allowances: dto.allowances } : {}),
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
        objectType: "salary_profile",
        objectId: row.id,
        actorUserId: user.id,
        // Tên trường, KHÔNG giá trị — `changedFields` là mức chi tiết tối đa audit lương được mang.
        before: { userId: before.userId, effectiveDate: String(before.effectiveDate) },
        after: { effectiveDate: String(row.effectiveDate), changedFields },
      });
      return toSalaryProfileDto(row, actor);
    });
  }

  /**
   * 034 — danh bạ chọn nhân sự. Gác bằng `('view','salary-profile')`: §11.1 bảo đảm **mọi vai giữ
   * `('manage','bonus-penalty')` đều giữ cặp này** (migration verify fail-loud), nên màn thưởng/phạt
   * không chết vì thiếu danh bạ. `payroll-officer` giữ 0 cặp HR ⇒ KHÔNG dùng API-03 được.
   */
  async pickPeople(user: PayrollRequestUser, query: PayrollPeoplePickerQuery) {
    const actor = await this.access.resolveActor(user, "pickerPeople");
    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.people.pickPeopleTx(tx, actor, query.q, query.limit);
      return rows.map((p) => ({
        userId: p.userId,
        fullName: p.displayName,
        employeeCode: p.employeeCode,
      }));
    });
  }
}
