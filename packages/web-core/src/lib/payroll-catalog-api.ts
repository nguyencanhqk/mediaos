import { z } from "zod";
import {
  salaryComponentDetailDtoSchema,
  type SalaryComponentDetailDto,
  type CreateSalaryComponentRequest,
  type UpdateSalaryComponentRequest,
  type ValidateFormulaRequest,
  validateFormulaResultSchema,
  type ValidateFormulaResult,
  payrollTemplateDtoSchema,
  type PayrollTemplateDto,
  type PayrollTemplateListQuery,
  type CreatePayrollTemplateRequest,
  type UpdatePayrollTemplateRequest,
  payrollTemplateDetailDtoSchema,
  type PayrollTemplateDetailDto,
  type PutPayrollTemplateComponentsRequest,
  type PayrollTemplatePreviewRequest,
  payrollTemplatePreviewResultSchema,
  type PayrollTemplatePreviewResult,
  statutoryRateDtoSchema,
  type StatutoryRateDto,
  type StatutoryRateListQuery,
  type CreateStatutoryRateRequest,
  type UpdateStatutoryRateRequest,
  payrollCatalogWriteResultSchema,
  type PayrollCatalogWriteResult,
} from "@mediaos/contracts";
import { apiFetch, apiFetchPaginated, type PaginatedResult } from "./api-client";
import { buildQueryString } from "./api-params";
import { idempotencyKeyFor } from "./api-idempotency";

/**
 * S15-PAYROLL-FE-2 — client track B (PAYROLL-API-045..058): catalog thành phần lương · mẫu bảng lương ·
 * tỉ lệ luật định. 044 (danh sách thành phần) đã có ở `payroll-employees-api.ts` (FE-1) — KHÔNG khai lại.
 *
 * Tách file, **spread vào `payrollApi`** (khuôn FE-1/FE-3). ⚠️ KHÔNG import `payrollIdempotencyKey` từ
 * `payroll-api.ts` (file đó import file này ⇒ vòng import) — khoá dùng `idempotencyKeyFor` (BĂM payload):
 * 056 chở TIỀN (trần đóng, giảm trừ) nên nối chuỗi là ghi số vào header + bảng idempotency.
 *
 * **Route GHI trả `{ id }` — 0 khoá tiền.** Sau mutation invalidate `payrollKeys.catalog.allOf()` rồi ĐỌC LẠI
 * (đổi công thức một thành phần đổi luôn `catalogFormula` + fingerprint của mọi mẫu chứa nó).
 *
 * **048 luôn 200** — `valid:false` + `errors[]` là KẾT QUẢ hợp lệ của một lượt kiểm, không phải lỗi HTTP.
 * **054 không đọc dữ liệu thật** — caller gửi đủ `statutory` (không có `baseWage`/`minRegionWage`) và PHẢI gửi
 * `SYS_WORK_DAYS` (vắng ⇒ 0 ⇒ 422 020 `division-by-zero`).
 *
 * Danh sách 049 · 055 trả envelope phân trang ⇒ `apiFetchPaginated` (L2 của `payroll-api.ts`).
 */
export const payrollCatalogApi = {
  // ── Thành phần lương — 045..048 ─────────────────────────────────────────────────────────────

  /** POST /payroll/salary-components (045, `manage:salary-component`, @Idempotent). */
  createSalaryComponent: (body: CreateSalaryComponentRequest): Promise<PayrollCatalogWriteResult> =>
    apiFetch(
      "/payroll/salary-components",
      payrollCatalogWriteResultSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey: idempotencyKeyFor("payroll:create-salary-component", body) },
    ),

  /** GET /payroll/salary-components/:id (046) — kèm `usedByTemplates`. */
  getSalaryComponent: (id: string): Promise<SalaryComponentDetailDto> =>
    apiFetch(`/payroll/salary-components/${id}`, salaryComponentDetailDtoSchema),

  /**
   * PATCH /payroll/salary-components/:id (047). `{delete:true}` = xoá mềm. Hàng hệ thống chỉ nhận
   * `name`/`sortOrder` (trường khác ⇒ 409 `system-component-immutable`).
   */
  updateSalaryComponent: (
    id: string,
    body: UpdateSalaryComponentRequest,
  ): Promise<PayrollCatalogWriteResult> =>
    apiFetch(`/payroll/salary-components/${id}`, payrollCatalogWriteResultSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** POST /payroll/salary-components/validate-formula (048) — KHÔNG ghi; gác CẶP GHI `manage`. */
  validateFormula: (body: ValidateFormulaRequest): Promise<ValidateFormulaResult> =>
    apiFetch("/payroll/salary-components/validate-formula", validateFormulaResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Mẫu bảng lương — 049..054 ───────────────────────────────────────────────────────────────

  /** GET /payroll/templates (049, `view:payroll-template`). */
  listPayrollTemplates: (
    query?: Partial<PayrollTemplateListQuery>,
  ): Promise<PaginatedResult<PayrollTemplateDto[]>> =>
    apiFetchPaginated(
      `/payroll/templates${buildQueryString(query ?? {})}`,
      z.array(payrollTemplateDtoSchema),
    ),

  /** POST /payroll/templates (050, @Idempotent). */
  createPayrollTemplate: (body: CreatePayrollTemplateRequest): Promise<PayrollCatalogWriteResult> =>
    apiFetch(
      "/payroll/templates",
      payrollCatalogWriteResultSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey: idempotencyKeyFor("payroll:create-template", body) },
    ),

  /** GET /payroll/templates/:id (051) — thành phần + `formulaSetFingerprint`. */
  getPayrollTemplate: (id: string): Promise<PayrollTemplateDetailDto> =>
    apiFetch(`/payroll/templates/${id}`, payrollTemplateDetailDtoSchema),

  /** PATCH /payroll/templates/:id (052) — sửa · ngưng · xoá mềm; đang gắn kỳ ⇒ 409 `template-in-use`. */
  updatePayrollTemplate: (
    id: string,
    body: UpdatePayrollTemplateRequest,
  ): Promise<PayrollCatalogWriteResult> =>
    apiFetch(`/payroll/templates/${id}`, payrollCatalogWriteResultSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** PUT /payroll/templates/:id/components (053) — ĐẶT LẠI TOÀN BỘ trong một lượt. */
  putPayrollTemplateComponents: (
    id: string,
    body: PutPayrollTemplateComponentsRequest,
  ): Promise<PayrollCatalogWriteResult> =>
    apiFetch(`/payroll/templates/${id}/components`, payrollCatalogWriteResultSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  /** POST /payroll/templates/:id/preview (054) — dữ liệu GIẢ, không ghi, không audit. */
  previewPayrollTemplate: (
    id: string,
    body: PayrollTemplatePreviewRequest,
  ): Promise<PayrollTemplatePreviewResult> =>
    apiFetch(`/payroll/templates/${id}/preview`, payrollTemplatePreviewResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Tỉ lệ luật định — 055..058 ──────────────────────────────────────────────────────────────

  /** GET /payroll/statutory-rates (055, `view:statutory-rate`) — `effectiveFrom` giảm dần. */
  listStatutoryRates: (
    query?: Partial<StatutoryRateListQuery>,
  ): Promise<PaginatedResult<StatutoryRateDto[]>> =>
    apiFetchPaginated(
      `/payroll/statutory-rates${buildQueryString(query ?? {})}`,
      z.array(statutoryRateDtoSchema),
    ),

  /** POST /payroll/statutory-rates (056, @Idempotent — khoá BĂM vì payload chở tiền). */
  createStatutoryRate: (body: CreateStatutoryRateRequest): Promise<PayrollCatalogWriteResult> =>
    apiFetch(
      "/payroll/statutory-rates",
      payrollCatalogWriteResultSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey: idempotencyKeyFor("payroll:create-statutory-rate", body) },
    ),

  /** GET /payroll/statutory-rates/:id (057). */
  getStatutoryRate: (id: string): Promise<StatutoryRateDto> =>
    apiFetch(`/payroll/statutory-rates/${id}`, statutoryRateDtoSchema),

  /** PATCH /payroll/statutory-rates/:id (058) — bản đã có kỳ dùng ⇒ 409 `rate-in-use`. */
  updateStatutoryRate: (
    id: string,
    body: UpdateStatutoryRateRequest,
  ): Promise<PayrollCatalogWriteResult> =>
    apiFetch(`/payroll/statutory-rates/${id}`, payrollCatalogWriteResultSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};
