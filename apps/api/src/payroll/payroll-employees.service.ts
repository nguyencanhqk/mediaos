import { ForbiddenException, Injectable } from "@nestjs/common";
import type { PayrollEmployeeListQuery } from "@mediaos/contracts";
import { paginated, toPagination } from "../common/pagination";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { PayrollAccessService } from "./payroll-access.service";
import { toPayrollEmployeeDetail, toPayrollEmployeeListItem } from "./payroll-employees.mapper";
import { PayrollEmployeesRepository } from "./payroll-employees.repository";
import { PayrollPeopleRepository } from "./payroll-people.repository";
import { payrollNotFound } from "./payroll.errors";
import { payrollOffset, type PayrollRequestUser } from "./payroll.types";

/**
 * S15-PAYROLL-BE-1 — `PAYROLL-API-036/037`: nhân sự hưởng lương (chiếu HR bó hẹp).
 *
 * ⚠️ **AUDIT LƯỢT ĐỌC ATOMIC** (SPEC-11 §18.1 B hàng 1–2): ghi `audit_logs` **trong CÙNG transaction**
 * với lượt đọc ⇒ rollback thì 0 hàng audit, không lượt đọc nào không để lại vết.
 *
 * `object_type`/`object_id` khai theo **bản đồ ĐÓNG §18.1 B**, không tự chọn:
 *   • 036 → `payroll_employee` / **NULL** (đọc DANH SÁCH) / `{filters, rowCount}`
 *   • 037 → `payroll_employee` / `userId` / `{taxCodeRevealed}`
 * Ghi `object_type` ngoài bản đồ = **CHECK violation ⇒ 500 ngay trên đường đọc**.
 *
 * Payload audit **KHÔNG chứa số tiền và KHÔNG chứa chính PII** — `taxCodeRevealed` là **cờ boolean**
 * ghi lại *quyết định quyền*, không phải mã số thuế. Ghi giá trị MST vào audit là nhân bản PII sang
 * một bảng append-only mà không ai xoá được.
 */
@Injectable()
export class PayrollEmployeesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly repo: PayrollEmployeesRepository,
    private readonly people: PayrollPeopleRepository,
    private readonly audit: AuditService,
  ) {}

  /** 036 — danh sách + **audit lượt đọc**. */
  async list(user: PayrollRequestUser, query: PayrollEmployeeListQuery) {
    const actor = await this.access.resolveActor(user, "employeeList");
    // Cặp PHỤ, cấp TRƯỜNG — resolve NGOÀI `resolveActor` có chủ đích (xem JSDoc `canRevealTaxCode`).
    const canRevealTaxCode = await this.access.canRevealTaxCode(user);
    // S15-PAYROLL-BE-5 §0b B1: lọc theo lương đóng BH là dò LƯƠNG theo người (ghép `q=<mã NV>` ⇒ total 0/1) —
    // `view:payroll-employee` không chở tiền, nên giá trị này đòi thêm `view:salary-profile`@Company.
    if (
      query.insuranceIssue === "salary-out-of-range" &&
      !(await this.access.canResolve(user, "salaryProfileList"))
    ) {
      throw new ForbiddenException(
        "AUTH-ERR-FORBIDDEN: lọc theo lương đóng bảo hiểm cần quyền xem hồ sơ lương (scope Công ty)",
      );
    }
    return this.db.withTenant(user.companyId, async (tx) => {
      const filter = {
        q: query.q,
        orgUnitId: query.orgUnitId,
        hasSalaryProfile: query.hasSalaryProfile,
        insuranceIssue: query.insuranceIssue,
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
      // Tên/mã NV CHỈ qua điểm chiếu danh tính (SPEC-11 §18) — repo trên cố ý không select chúng.
      const names = await this.people.namesByUserIdsTx(
        tx,
        actor,
        rows.map((r) => r.userId),
      );
      await this.audit.record(tx, {
        action: "read",
        objectType: "payroll_employee",
        // §18.1 B hàng 1 — đọc DANH SÁCH ⇒ `object_id` NULL (không có một đối tượng nào để neo).
        actorUserId: user.id,
        before: null,
        after: { filters: filter, rowCount: rows.length },
      });
      return paginated(
        rows.map((r) => toPayrollEmployeeListItem(r, names.get(r.userId), canRevealTaxCode)),
        toPagination(total, query.page, query.per_page),
      );
    });
  }

  /** 037 — chi tiết + **audit lượt đọc** (kèm cờ `taxCodeRevealed`). */
  async get(user: PayrollRequestUser, userId: string) {
    const actor = await this.access.resolveActor(user, "employeeDetail");
    const canRevealTaxCode = await this.access.canRevealTaxCode(user);
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findTx(tx, user.companyId, userId);
      // Sentinel 404 duy nhất: không thuộc company / xoá mềm / không có hồ sơ nhân sự — MỘT phản hồi,
      // không 403 (chống oracle "user này có thật ở đâu đó" — SPEC-11 §12 mã 010).
      if (!row) throw payrollNotFound();
      const names = await this.people.namesByUserIdsTx(tx, actor, [row.userId]);
      await this.audit.record(tx, {
        action: "read",
        objectType: "payroll_employee",
        objectId: row.userId,
        actorUserId: user.id,
        before: null,
        after: { taxCodeRevealed: canRevealTaxCode },
      });
      return toPayrollEmployeeDetail(row, names.get(row.userId), canRevealTaxCode);
    });
  }
}
