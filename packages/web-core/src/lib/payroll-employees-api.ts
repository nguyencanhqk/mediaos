import { z } from "zod";
import {
  payrollEmployeeListItemSchema,
  type PayrollEmployeeListItemDto,
  type PayrollEmployeeListQuery,
  payrollEmployeeDetailSchema,
  type PayrollEmployeeDetailDto,
  payrollEmployeeSettingsSchema,
  type PayrollEmployeeSettingsDto,
  type PutPayrollEmployeeSettingsRequest,
  payrollDependentSchema,
  type PayrollDependentDto,
  type CreatePayrollDependentRequest,
  type UpdatePayrollDependentRequest,
  payrollEmployeeWriteResultSchema,
  type PayrollEmployeeWriteResultDto,
  payrollTimesheetRowSchema,
  type PayrollTimesheetRowDto,
  type PayrollTimesheetQuery,
  salaryComponentDtoSchema,
  type SalaryComponentDto,
  type SalaryComponentListQuery,
} from "@mediaos/contracts";
import { apiFetch, apiFetchPaginated, type PaginatedResult } from "./api-client";
import { buildQueryString } from "./api-params";
import { idempotencyKeyFor } from "./api-idempotency";

/**
 * S15-PAYROLL-FE-1 — client track A v2 (PAYROLL-API-036..043) + catalog 044 (cho picker `items[]`).
 * Tách file khỏi `payroll-api.ts` (đã ~370 dòng) và **spread vào `payrollApi`** ở đó — consumer vẫn gọi
 * `payrollApi.listEmployees(...)`, test vẫn mock MỘT object.
 *
 * Ba luật của `payroll-api.ts` (L1 không siết mask ở client · L2 list đi `apiFetchPaginated` · L3 khoá
 * idempotency suy từ nội dung) áp nguyên. Thêm **hai luật riêng của track A** vì đây là nơi PII mới đi qua:
 *
 * **L4 — KHÔNG có khoá `bankAccountNumber` trên đường ĐỌC, và KHÔNG log/echo payload GHI.** DTO 038 chỉ
 * mang `bankAccountLast4` (contracts luật 1). Route GHI 039/041/042 trả `{id, warnings}` — 0 khoá PII
 * (contracts luật 2) ⇒ caller tải lại qua 038/040, không vá cache từ kết quả mutation.
 *
 * **L5 — Khoá idempotency của 039/041 là `idempotencyKeyFor(scope, {userId, ...body})` (BĂM), KHÔNG
 * `payrollIdempotencyKey` (nối chuỗi).** Payload chở số TK / họ tên NPT; nối chuỗi là ghi PII vào header +
 * bảng idempotency. Hash64 giữ đúng luật «cùng nội dung ⇒ cùng khoá» mà không lộ nội dung. `userId` PHẢI
 * nằm trong payload băm — thiếu nó thì ghi cùng thiết lập cho hai người là trùng khoá (memory
 * `idempotency-key-must-be-content-derived`).
 */
export const payrollEmployeesApi = {
  // ── Nhân sự hưởng lương (036/037) ────────────────────────────────────────────────────────────

  /** GET /payroll/employees — chiếu HR bó hẹp (`view:payroll-employee`, SENSITIVE). CÓ phân trang. */
  listEmployees: (
    query?: Partial<PayrollEmployeeListQuery>,
  ): Promise<PaginatedResult<PayrollEmployeeListItemDto[]>> =>
    apiFetchPaginated(
      `/payroll/employees${buildQueryString(query ?? {})}`,
      z.array(payrollEmployeeListItemSchema),
    ),

  /** GET /payroll/employees/:userId — tab «Thông tin chung»; `taxCode` chỉ có khi thêm `view:salary-profile`. */
  getEmployee: (userId: string): Promise<PayrollEmployeeDetailDto> =>
    apiFetch(`/payroll/employees/${userId}`, payrollEmployeeDetailSchema),

  // ── Thiết lập BH · công đoàn · TK ngân hàng (038/039) ────────────────────────────────────────

  /** GET …/settings — hàng có thể CHƯA tồn tại ⇒ mọi trường nullable, vẫn 200. */
  getEmployeeSettings: (userId: string): Promise<PayrollEmployeeSettingsDto> =>
    apiFetch(`/payroll/employees/${userId}/settings`, payrollEmployeeSettingsSchema),

  /**
   * PUT …/settings — upsert MERGE từng phần (`manage:payroll-employee`, @Idempotent). Khoá không mang PII
   * (L5). Trả envelope 0 khoá PII — tải lại 038 sau khi xong.
   */
  putEmployeeSettings: (
    userId: string,
    body: PutPayrollEmployeeSettingsRequest,
  ): Promise<PayrollEmployeeWriteResultDto> =>
    apiFetch(
      `/payroll/employees/${userId}/settings`,
      payrollEmployeeWriteResultSchema,
      { method: "PUT", body: JSON.stringify(body) },
      { idempotencyKey: idempotencyKeyFor("payroll:put-employee-settings", { userId, ...body }) },
    ),

  // ── Người phụ thuộc (040/041/042) ────────────────────────────────────────────────────────────

  /** GET …/dependents — mảng TRẦN (không phân trang: NPT của một người đếm trên đầu ngón tay). */
  listDependents: (userId: string): Promise<PayrollDependentDto[]> =>
    apiFetch(`/payroll/employees/${userId}/dependents`, z.array(payrollDependentSchema)),

  /** POST …/dependents (@Idempotent, khoá băm — L5); chồng lấp ⇒ 409 `dependent-overlap`. */
  createDependent: (
    userId: string,
    body: CreatePayrollDependentRequest,
  ): Promise<PayrollEmployeeWriteResultDto> =>
    apiFetch(
      `/payroll/employees/${userId}/dependents`,
      payrollEmployeeWriteResultSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey: idempotencyKeyFor("payroll:create-dependent", { userId, ...body }) },
    ),

  /**
   * PATCH /payroll/dependents/:id — sửa HOẶC xoá mềm (`{delete:true}`). KHÔNG lồng dưới `:userId` — có chủ
   * đích (SPEC-11 §15.1): server resolve người TỪ HÀNG, không từ URL.
   */
  updateDependent: (
    dependentId: string,
    body: UpdatePayrollDependentRequest,
  ): Promise<PayrollEmployeeWriteResultDto> =>
    apiFetch(`/payroll/dependents/${dependentId}`, payrollEmployeeWriteResultSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // ── Bảng công tổng hợp kỳ (043) ──────────────────────────────────────────────────────────────

  /**
   * GET /payroll-periods/:id/timesheet — số NGÀY + số PHÚT, **không số tiền**; gác `view-line` (cặp của
   * KỲ). ⚠️ Literal path `timesheet` — KHÔNG phải `/me/attendance-summary` của ME.
   */
  getPeriodTimesheet: (
    periodId: string,
    query?: Partial<PayrollTimesheetQuery>,
  ): Promise<PaginatedResult<PayrollTimesheetRowDto[]>> =>
    apiFetchPaginated(
      `/payroll-periods/${periodId}/timesheet${buildQueryString(query ?? {})}`,
      z.array(payrollTimesheetRowSchema),
    ),

  // ── Catalog thành phần lương (044) — chỉ để chọn mã cho `items[]` ────────────────────────────

  /**
   * GET /payroll/salary-components (`view:salary-component`, SENSITIVE). Query 044 KHÔNG lọc được
   * `valueType` — caller lọc `profile_item` ở client (`use-salary-components-catalog.ts`).
   */
  listSalaryComponents: (
    query?: Partial<SalaryComponentListQuery>,
  ): Promise<PaginatedResult<SalaryComponentDto[]>> =>
    apiFetchPaginated(
      `/payroll/salary-components${buildQueryString(query ?? {})}`,
      z.array(salaryComponentDtoSchema),
    ),
};
