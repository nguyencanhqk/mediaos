import { z } from "zod";
import {
  salaryProfileSchema,
  type SalaryProfileDto,
  salaryProfileListItemSchema,
  type SalaryProfileListItemDto,
  type SalaryProfileListQuery,
  type CreateSalaryProfileRequest,
  type UpdateSalaryProfileRequest,
  payrollPeriodSchema,
  type PayrollPeriodDto,
  type PayrollPeriodListQuery,
  type CreatePayrollPeriodRequest,
  type UpdatePayrollPeriodRequest,
  type RejectPayrollPeriodRequest,
  type ReopenPayrollPeriodRequest,
  payrollWriteResultSchema,
  type PayrollWriteResultDto,
  payrollPeriodLineSchema,
  type PayrollPeriodLineDto,
  type PayrollLineListQuery,
  type AdjustPayrollLineRequest,
  type PayrollExportQuery,
  payrollSummarySchema,
  type PayrollSummaryDto,
  payrollReadinessSchema,
  type PayrollReadinessDto,
  payslipSchema,
  type PayslipDto,
  payslipDetailSchema,
  type PayslipDetailDto,
  type PayslipListQuery,
  type MePayslipListQuery,
  payslipAcknowledgementSchema,
  type PayslipAcknowledgementDto,
  bonusPenaltySchema,
  type BonusPenaltyDto,
  type BonusPenaltyListQuery,
  type CreateBonusPenaltyRequest,
  type UpdateBonusPenaltyRequest,
  type ApproveBonusPenaltyRequest,
  type RejectBonusPenaltyRequest,
  payrollPersonRefSchema,
  type PayrollPersonRefDto,
  type PayrollPeoplePickerQuery,
  payrollAttendancePeriodRefSchema,
  type PayrollAttendancePeriodRefDto,
  type PayrollAttendancePeriodPickerQuery,
} from "@mediaos/contracts";
import {
  apiFetch,
  apiFetchPaginated,
  apiFetchBlob,
  type PaginatedResult,
  type ApiBlobResult,
} from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * S13-PAYROLL-FE-1 — PAYROLL API client (SPEC-11 §15, PAYROLL-API-001..035). MIRROR BE 6 controller:
 * `PayrollPeriodsController` · `SalaryProfilesController` · `BonusPenaltiesController` ·
 * `PayslipsController` · `MePayslipsController` · `PayrollPickersController`.
 *
 * ── BA LUẬT CẤP FILE ──────────────────────────────────────────────────────────────────────────────
 *
 * **L1 — KHÔNG SIẾT LẠI MASKING Ở CLIENT.** Server là nơi strip trường tiền (mask = **vắng khoá**,
 * không `null`, không `0` — SPEC-11 §18). Schema contracts đã khai `.optional()` cho mọi trường tiền;
 * thêm `.nonempty()`/`.default(0)` ở đây là biến "không có quyền" thành "0 đồng" trên màn — đúng lớp
 * lỗi `server-masking-needs-optional-fe-schema`.
 *
 * **L2 — PHÂN TRANG ĐI `apiFetchPaginated`.** 6 route list của PAYROLL (kỳ · dòng · hồ sơ lương ·
 * thưởng/phạt · phiếu · phiếu-của-tôi) trả envelope `{data, pagination}`; dùng `apiFetch` là mất
 * `pagination` im lặng (`apifetch-drops-pagination-bare-array`) ⇒ kỳ 500 người không lật được trang.
 * Ngoại lệ đi `apiFetch`: readiness · summary · 2 picker · mọi chi tiết · mọi route GHI.
 *
 * **L3 — `Idempotency-Key` là tham số BẮT BUỘC, và phải SUY TỪ NỘI DUNG.** Đúng **5** route BE khai
 * `@Idempotent()` (`createPeriod` · `calculate` · `generatePayslips` · `createSalaryProfile` ·
 * `createBonusPenalty`). Khoá phải suy từ payload chứ không phải `crypto.randomUUID()` mỗi lần render
 * (`idempotency-key-must-be-content-derived`) — bấm đúp «Tính lương» với khoá ngẫu nhiên là chạy máy
 * tính lương HAI lần trên cùng kỳ. Caller dùng `payrollIdempotencyKey()` dưới đây.
 *
 * ── Route GHI trả envelope TỐI THIỂU ──
 * `collect`/`calculate`/`adjust-line`/`submit`/`approve`/`reject`/`generate-payslips`/`publish`/
 * `lock`/`reopen` trả `PayrollWriteResultDto` (**0 khoá tiền** — SPEC-11 §21, quyết định thiết kế #3
 * của DOC-1: route GHI không chở tiền, FE tải số qua `GET …/lines` gác bằng cặp ĐỌC `view-line`).
 * Đừng "tiện thể" đọc số từ kết quả mutation — không có số ở đó.
 */

/**
 * Khoá idempotency SUY TỪ NỘI DUNG (`idempotency-key-must-be-content-derived`).
 *
 * Hai lần bấm cùng một hành động trên cùng một đối tượng ⇒ **cùng khoá** ⇒ BE trả lại kết quả lần đầu
 * thay vì chạy lại. Ngược lại, hai kỳ khác nhau (hoặc hai lần tính CỐ Ý sau khi sửa dữ liệu) phải ra
 * khoá khác — nên `salt` nhận mốc do caller quyết (vd `updatedAt` của kỳ), KHÔNG phải `Date.now()`.
 */
export function payrollIdempotencyKey(
  action: string,
  subjectId: string,
  salt?: string | number | null,
): string {
  return ["payroll", action, subjectId, salt ?? "-"].join(":");
}

export const payrollApi = {
  // ── Kỳ lương (PAYROLL-API-001..018) ─────────────────────────────────────────────────────────────

  /** GET /payroll-periods — danh sách kỳ (`view:payroll-period`). KHÔNG chở số tiền nào. */
  listPeriods: (
    query?: Partial<PayrollPeriodListQuery>,
  ): Promise<PaginatedResult<PayrollPeriodDto[]>> =>
    apiFetchPaginated(
      `/payroll-periods${buildQueryString(query ?? {})}`,
      z.array(payrollPeriodSchema),
    ),

  /** POST /payroll-periods — tạo kỳ (`manage:payroll-period`, @Idempotent); trùng tháng ⇒ ERR-008. */
  createPeriod: (
    body: CreatePayrollPeriodRequest,
    idempotencyKey: string,
  ): Promise<PayrollPeriodDto> =>
    apiFetch(
      "/payroll-periods",
      payrollPeriodSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey },
    ),

  /** GET /payroll-periods/:id — chi tiết kỳ (`view:payroll-period`). */
  getPeriod: (id: string): Promise<PayrollPeriodDto> =>
    apiFetch(`/payroll-periods/${id}`, payrollPeriodSchema),

  /** PATCH /payroll-periods/:id — sửa ghi chú/kỳ công (`manage:payroll-period`). */
  updatePeriod: (id: string, body: UpdatePayrollPeriodRequest): Promise<PayrollPeriodDto> =>
    apiFetch(`/payroll-periods/${id}`, payrollPeriodSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** POST /payroll-periods/:id/collect — gom công/phép (`calculate:payroll-period`, SENSITIVE). */
  collectPeriod: (id: string): Promise<PayrollWriteResultDto> =>
    apiFetch(`/payroll-periods/${id}/collect`, payrollWriteResultSchema, { method: "POST" }),

  /**
   * GET /payroll-periods/:id/readiness — cảnh báo dữ liệu thiếu (`calculate:payroll-period`).
   * Cảnh báo là MỀM: chỉ `eligibleCount === 0` mới chặn `calculate` (422 ERR-009).
   */
  getReadiness: (id: string): Promise<PayrollReadinessDto> =>
    apiFetch(`/payroll-periods/${id}/readiness`, payrollReadinessSchema),

  /**
   * GET /payroll-periods/summary — tổng chi phí kỳ GẦN NHẤT (`view-line:payroll-period` + sàn Company).
   * Công ty chưa có kỳ nào ⇒ **200 + `null`** (không 404) để widget phân biệt «chưa có kỳ» với
   * «không có quyền».
   */
  getSummary: (): Promise<PayrollSummaryDto | null> =>
    apiFetch(`/payroll-periods/summary`, payrollSummarySchema.nullable()),

  /** POST /payroll-periods/:id/calculate — máy tính lương (`calculate`, SENSITIVE, @Idempotent). */
  calculatePeriod: (id: string, idempotencyKey: string): Promise<PayrollWriteResultDto> =>
    apiFetch(
      `/payroll-periods/${id}/calculate`,
      payrollWriteResultSchema,
      { method: "POST" },
      { idempotencyKey },
    ),

  /** GET /payroll-periods/:id/lines — bảng lương nháp (`view-line`, SENSITIVE). CÓ phân trang. */
  listLines: (
    id: string,
    query?: Partial<PayrollLineListQuery>,
  ): Promise<PaginatedResult<PayrollPeriodLineDto[]>> =>
    apiFetchPaginated(
      `/payroll-periods/${id}/lines${buildQueryString(query ?? {})}`,
      z.array(payrollPeriodLineSchema),
    ),

  /**
   * GET /payroll-periods/:id/export — XLSX (`export:payroll` **+** `view-line:payroll-period`, §18).
   * Trả BLOB, KHÔNG phân trang; > 10.000 dòng ⇒ 422 ERR-016. Mỗi lượt ghi audit ở BE.
   */
  exportPeriod: (id: string, query?: Partial<PayrollExportQuery>): Promise<ApiBlobResult> =>
    apiFetchBlob(`/payroll-periods/${id}/export${buildQueryString(query ?? {})}`),

  /**
   * PATCH /payroll-periods/:id/lines/:lineId — điều chỉnh tay (`calculate`, SENSITIVE).
   * `adjustmentReason` BẮT BUỘC khi `adjustmentAmount !== 0` (mirror CHECK); `net` tính lại ở SQL.
   */
  adjustLine: (
    id: string,
    lineId: string,
    body: AdjustPayrollLineRequest,
  ): Promise<PayrollWriteResultDto> =>
    apiFetch(`/payroll-periods/${id}/lines/${lineId}`, payrollWriteResultSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** POST /payroll-periods/:id/submit — gửi duyệt (`calculate`); 0 người duyệt ⇒ 422 ERR-017. */
  submitPeriod: (id: string): Promise<PayrollWriteResultDto> =>
    apiFetch(`/payroll-periods/${id}/submit`, payrollWriteResultSchema, { method: "POST" }),

  /** POST /payroll-periods/:id/approve — duyệt (`approve`); four-eyes ⇒ 409 ERR-005. */
  approvePeriod: (id: string): Promise<PayrollWriteResultDto> =>
    apiFetch(`/payroll-periods/${id}/approve`, payrollWriteResultSchema, { method: "POST" }),

  /** POST /payroll-periods/:id/reject — từ chối (`approve`); `reason` BẮT BUỘC. */
  rejectPeriod: (id: string, body: RejectPayrollPeriodRequest): Promise<PayrollWriteResultDto> =>
    apiFetch(`/payroll-periods/${id}/reject`, payrollWriteResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** POST /payroll-periods/:id/generate-payslips — sinh phiếu (`publish`, @Idempotent, tại chỗ). */
  generatePayslips: (id: string, idempotencyKey: string): Promise<PayrollWriteResultDto> =>
    apiFetch(
      `/payroll-periods/${id}/generate-payslips`,
      payrollWriteResultSchema,
      { method: "POST" },
      { idempotencyKey },
    ),

  /** POST /payroll-periods/:id/publish — phát hành (`publish`); chưa sinh phiếu ⇒ 409 ERR-007. */
  publishPeriod: (id: string): Promise<PayrollWriteResultDto> =>
    apiFetch(`/payroll-periods/${id}/publish`, payrollWriteResultSchema, { method: "POST" }),

  /** POST /payroll-periods/:id/lock — khoá kỳ (`manage:payroll-period`, KHÔNG sensitive). */
  lockPeriod: (id: string): Promise<PayrollWriteResultDto> =>
    apiFetch(`/payroll-periods/${id}/lock`, payrollWriteResultSchema, { method: "POST" }),

  /** POST /payroll-periods/:id/reopen — mở lại (`reopen`); đã sinh phiếu ⇒ 409 ERR-004. */
  reopenPeriod: (id: string, body: ReopenPayrollPeriodRequest): Promise<PayrollWriteResultDto> =>
    apiFetch(`/payroll-periods/${id}/reopen`, payrollWriteResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Hồ sơ lương (PAYROLL-API-019..022) ──────────────────────────────────────────────────────────

  /** GET /salary-profiles — danh sách phiên bản (`view:salary-profile`, SENSITIVE). CÓ phân trang. */
  listSalaryProfiles: (
    query?: Partial<SalaryProfileListQuery>,
  ): Promise<PaginatedResult<SalaryProfileListItemDto[]>> =>
    apiFetchPaginated(
      `/salary-profiles${buildQueryString(query ?? {})}`,
      z.array(salaryProfileListItemSchema),
    ),

  /** POST /salary-profiles — tạo phiên bản (`manage`, @Idempotent); trùng ngày ⇒ ERR-014. */
  createSalaryProfile: (
    body: CreateSalaryProfileRequest,
    idempotencyKey: string,
  ): Promise<SalaryProfileDto> =>
    apiFetch(
      "/salary-profiles",
      salaryProfileSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey },
    ),

  /** GET /salary-profiles/:id — chi tiết phiên bản (`view:salary-profile`). */
  getSalaryProfile: (id: string): Promise<SalaryProfileDto> =>
    apiFetch(`/salary-profiles/${id}`, salaryProfileSchema),

  /** PATCH /salary-profiles/:id — sửa; `delete: true` là đường XOÁ MỀM (không có route DELETE). */
  updateSalaryProfile: (id: string, body: UpdateSalaryProfileRequest): Promise<SalaryProfileDto> =>
    apiFetch(`/salary-profiles/${id}`, salaryProfileSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // ── Thưởng/phạt (PAYROLL-API-023..028) ──────────────────────────────────────────────────────────

  /** GET /bonus-penalties — danh sách (`view:bonus-penalty`, SENSITIVE). CÓ phân trang. */
  listBonusPenalties: (
    query?: Partial<BonusPenaltyListQuery>,
  ): Promise<PaginatedResult<BonusPenaltyDto[]>> =>
    apiFetchPaginated(
      `/bonus-penalties${buildQueryString(query ?? {})}`,
      z.array(bonusPenaltySchema),
    ),

  /** POST /bonus-penalties — tạo (`manage`, @Idempotent); `reason` BẮT BUỘC, `amount > 0`. */
  createBonusPenalty: (
    body: CreateBonusPenaltyRequest,
    idempotencyKey: string,
  ): Promise<BonusPenaltyDto> =>
    apiFetch(
      "/bonus-penalties",
      bonusPenaltySchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey },
    ),

  /** GET /bonus-penalties/:id — chi tiết (`view:bonus-penalty`). */
  getBonusPenalty: (id: string): Promise<BonusPenaltyDto> =>
    apiFetch(`/bonus-penalties/${id}`, bonusPenaltySchema),

  /** PATCH /bonus-penalties/:id — sửa khi còn `Pending` & chưa consume; `delete: true` = xoá mềm. */
  updateBonusPenalty: (id: string, body: UpdateBonusPenaltyRequest): Promise<BonusPenaltyDto> =>
    apiFetch(`/bonus-penalties/${id}`, bonusPenaltySchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** POST /bonus-penalties/:id/approve — duyệt (`approve`); tự duyệt ⇒ 409 ERR-012. */
  approveBonusPenalty: (id: string, body: ApproveBonusPenaltyRequest): Promise<BonusPenaltyDto> =>
    apiFetch(`/bonus-penalties/${id}/approve`, bonusPenaltySchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** POST /bonus-penalties/:id/reject — từ chối (`approve`); `decisionNote` BẮT BUỘC (mirror CHECK). */
  rejectBonusPenalty: (id: string, body: RejectBonusPenaltyRequest): Promise<BonusPenaltyDto> =>
    apiFetch(`/bonus-penalties/${id}/reject`, bonusPenaltySchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Phiếu lương quản trị (PAYROLL-API-029..030) ─────────────────────────────────────────────────

  /** GET /payslips — danh sách phiếu (`view-payslip:payslip`, SENSITIVE). CÓ phân trang. */
  listPayslips: (query?: Partial<PayslipListQuery>): Promise<PaginatedResult<PayslipDto[]>> =>
    apiFetchPaginated(`/payslips${buildQueryString(query ?? {})}`, z.array(payslipSchema)),

  /** GET /payslips/:id — chi tiết + breakdown (`view-payslip:payslip`). */
  getPayslip: (id: string): Promise<PayslipDetailDto> =>
    apiFetch(`/payslips/${id}`, payslipDetailSchema),

  // ── «Phiếu lương của tôi» — Own (PAYROLL-API-031..033) ──────────────────────────────────────────

  /**
   * GET /me/payslips — Own (`view-own-payslip:payslip`). Chỉ phiếu của kỳ **ĐÃ phát hành**
   * (`Paid`/`Locked`) — server lọc, FE KHÔNG tự suy.
   */
  listMyPayslips: (query?: Partial<MePayslipListQuery>): Promise<PaginatedResult<PayslipDto[]>> =>
    apiFetchPaginated(`/me/payslips${buildQueryString(query ?? {})}`, z.array(payslipSchema)),

  /** GET /me/payslips/:id — chi tiết phiếu của chính mình (`view-own-payslip:payslip`). */
  getMyPayslip: (id: string): Promise<PayslipDetailDto> =>
    apiFetch(`/me/payslips/${id}`, payslipDetailSchema),

  /**
   * POST /me/payslips/:id/acknowledge — xác nhận đã xem (`acknowledge-own-payslip:payslip`,
   * KHÔNG sensitive — không chở tiền). Xác nhận lần hai ⇒ 409 ERR-015.
   */
  acknowledgeMyPayslip: (id: string): Promise<PayslipAcknowledgementDto> =>
    apiFetch(`/me/payslips/${id}/acknowledge`, payslipAcknowledgementSchema, { method: "POST" }),

  // ── Picker (PAYROLL-API-034..035) ───────────────────────────────────────────────────────────────

  /**
   * GET /payroll/pickers/people — danh bạ chọn nhân sự (`view:salary-profile`).
   * BẮT BUỘC, không phải tiện nghi: `payroll-officer` giữ **0 cặp ngoài PAYROLL** nên không gọi được
   * API HR. Trường bó HẸP — không email/điện thoại (§18).
   */
  pickerPeople: (query?: Partial<PayrollPeoplePickerQuery>): Promise<PayrollPersonRefDto[]> =>
    apiFetch(
      `/payroll/pickers/people${buildQueryString(query ?? {})}`,
      z.array(payrollPersonRefSchema),
    ),

  /**
   * GET /payroll/pickers/attendance-periods — kỳ công để gắn vào kỳ lương (`manage:payroll-period`).
   * Trạng thái là chữ **thường** (`open`/`locked`) — mirror `att_periods_status_check`.
   */
  pickerAttendancePeriods: (
    query?: Partial<PayrollAttendancePeriodPickerQuery>,
  ): Promise<PayrollAttendancePeriodRefDto[]> =>
    apiFetch(
      `/payroll/pickers/attendance-periods${buildQueryString(query ?? {})}`,
      z.array(payrollAttendancePeriodRefSchema),
    ),
};
