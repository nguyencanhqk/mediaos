import { Injectable } from "@nestjs/common";
import type {
  PayrollEmployeeSettingsDto,
  PayrollEmployeeWriteResultDto,
  PutPayrollEmployeeSettingsRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { PayrollAccessService } from "./payroll-access.service";
import { PayrollEmployeesRepository } from "./payroll-employees.repository";
import {
  PayrollEmployeeSettingsRepository,
  type PayrollEmployeeSettingsWrite,
} from "./payroll-employee-settings.repository";
import { mapPayrollPgError, payrollNotFound } from "./payroll.errors";
import type { PayrollRequestUser } from "./payroll.types";

/**
 * S15-PAYROLL-BE-1 — `PAYROLL-API-038/039`: thiết lập BH · công đoàn · tài khoản ngân hàng.
 *
 * 🔴 **`bankAccountLast4` là trường DẪN XUẤT do server cắt, KHÔNG phải cột** (SPEC-11 §18.1 A). Lưu
 * thêm một cột 4-số-cuối là nhân đôi nguồn sự thật cho cùng một dữ liệu và mở đường cho hai bên lệch
 * nhau. Khoá `bankAccountNumber` **không bao giờ** có mặt trong DTO của WO này.
 *
 * Audit (§18.1 B hàng 3): `payroll_employee_setting` / **`userId`** — neo theo NHÂN SỰ chứ không theo
 * `id` hàng, vì hàng **có thể chưa tồn tại** lúc đọc (038 trả DTO rỗng-hợp-lệ). Payload **không bao giờ
 * chứa số TK**; đường GHI ghi `changedFields` (TÊN trường, không giá trị) — khuôn `salary-profiles.service`.
 */
@Injectable()
export class PayrollEmployeeSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly repo: PayrollEmployeeSettingsRepository,
    private readonly employees: PayrollEmployeesRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Mask ở MỘT chỗ. `bank_account_number` vào, 4 số cuối ra — và không đường nào khác trong module
   * đọc cột đó để dựng DTO.
   */
  private static toDto(
    userId: string,
    row: { [k: string]: unknown } | null,
  ): PayrollEmployeeSettingsDto {
    const bank = (row?.["bankAccountNumber"] as string | null | undefined) ?? null;
    return {
      userId,
      joinsSocialInsurance: Boolean(row?.["joinsSocialInsurance"] ?? false),
      socialInsuranceNo: (row?.["socialInsuranceNo"] as string | null) ?? null,
      joinsUnion: Boolean(row?.["joinsUnion"] ?? false),
      bankAccountLast4: bank ? bank.slice(-4) : null,
      bankName: (row?.["bankName"] as string | null) ?? null,
      bankBranch: (row?.["bankBranch"] as string | null) ?? null,
      accountHolder: (row?.["accountHolder"] as string | null) ?? null,
    };
  }

  /**
   * 038 — đọc. Nhân sự chưa từng thiết lập ⇒ DTO **giá trị mặc định**, không 404: hàng thiếu là trạng
   * thái HỢP LỆ của một nhân sự mới (1 hàng/nhân sự, sinh ở lần PUT đầu). 404 chỉ dành cho nhân sự
   * không tồn tại/khác tenant — kiểm qua `employees.findTx` để không lộ oracle.
   */
  async get(user: PayrollRequestUser, userId: string): Promise<PayrollEmployeeSettingsDto> {
    await this.access.resolveActor(user, "employeeSettingsGet");
    return this.db.withTenant(user.companyId, async (tx) => {
      const emp = await this.employees.findTx(tx, user.companyId, userId);
      if (!emp) throw payrollNotFound();
      const row = await this.repo.findTx(tx, user.companyId, userId);
      await this.audit.record(tx, {
        action: "read",
        objectType: "payroll_employee_setting",
        objectId: userId,
        actorUserId: user.id,
        before: null,
        // §18.1 B hàng 3 — payload `{}`: KHÔNG số TK, không cả 4 số cuối.
        after: {},
      });
      return PayrollEmployeeSettingsService.toDto(userId, row as Record<string, unknown> | null);
    });
  }

  /**
   * 039 — upsert. Trả **envelope 0 khoá PII** (`{id, warnings}`): một role giữ `manage` mà không giữ
   * `view` KHÔNG có đường hợp lệ nào để đọc lại số TK (SPEC-11 §3.12), nên phản hồi GHI không được là
   * cửa sau. FE tải lại qua 038.
   */
  async upsert(
    user: PayrollRequestUser,
    userId: string,
    dto: PutPayrollEmployeeSettingsRequest,
  ): Promise<PayrollEmployeeWriteResultDto> {
    await this.access.resolveActor(user, "employeeSettingsPut");
    return this.db.withTenant(user.companyId, async (tx) => {
      const emp = await this.employees.findTx(tx, user.companyId, userId);
      if (!emp) throw payrollNotFound();

      const write: PayrollEmployeeSettingsWrite = {
        joinsSocialInsurance: dto.joinsSocialInsurance,
        joinsUnion: dto.joinsUnion,
        ...(dto.socialInsuranceNo !== undefined
          ? { socialInsuranceNo: dto.socialInsuranceNo }
          : {}),
        ...(dto.bankAccountNumber !== undefined
          ? { bankAccountNumber: dto.bankAccountNumber }
          : {}),
        ...(dto.bankName !== undefined ? { bankName: dto.bankName } : {}),
        ...(dto.bankBranch !== undefined ? { bankBranch: dto.bankBranch } : {}),
        ...(dto.accountHolder !== undefined ? { accountHolder: dto.accountHolder } : {}),
      };
      const changedFields = Object.keys(write);

      let row;
      try {
        row = await this.repo.upsertTx(tx, user.companyId, userId, write, user.id);
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      await this.audit.record(tx, {
        action: "update",
        objectType: "payroll_employee_setting",
        objectId: userId,
        actorUserId: user.id,
        before: null,
        // TÊN trường, KHÔNG giá trị — mức chi tiết tối đa audit của bề mặt PII này được mang.
        after: { changedFields },
      });
      return { id: row.id, warnings: [] };
    });
  }
}
