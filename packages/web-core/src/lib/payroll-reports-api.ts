import {
  payrollOverviewSchema,
  type PayrollOverviewDto,
  type PayrollOverviewQuery,
  payrollOverviewRemindersSchema,
  type PayrollOverviewRemindersDto,
  payrollReportCatalogSchema,
  type PayrollReportCatalogItemDto,
  payrollReportDataSchema,
  type PayrollReportDataDto,
  type PayrollReportCode,
  type PayrollReportQuery,
  type PayrollReportExportQuery,
  payslipPdfDto,
  type PayslipPdfDto,
  payslipPdfBatchDto,
  type PayslipPdfBatchDto,
  type PayslipPdfBatchRequest,
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
 * S15-PAYROLL-FE-4 — client track D (PAYROLL-API-078..085): Tổng quan · Lời nhắc · 7 báo cáo · PDF phiếu lương.
 *
 * Tách file khỏi `payroll-api.ts` và **spread vào `payrollApi`** ở đó (khuôn `payroll-disbursement-api.ts`) —
 * consumer gọi `payrollApi.getOverview(...)`, test mock MỘT object. Không import ngược `payroll-api.ts`
 * (vòng import).
 *
 * Luật riêng track D:
 *  - **078 · 079 · 081 · 082 ghi audit MỖI LƯỢT** (SPEC-11 §18.1 D) và server KHÔNG cache ⇒ caller `enabled`
 *    query theo khối ĐANG hiện + đủ tham số bắt buộc; đừng gọi 081 với bộ lọc dở dang «để xem thử».
 *  - **080 là metadata** (không số, không audit) và chỉ trả báo cáo caller mở được ⇒ FE dựng danh mục TỪ ĐÂY,
 *    không hard-code 7 mã.
 *  - 081 trả envelope phân trang mà `data` là OBJECT (`columns · rows · totals`), không phải mảng ⇒ vẫn đi
 *    `apiFetchPaginated` để giữ `pagination`.
 *  - **083–085 trả signed-URL TTL ngắn** (`url` + `expiresAt`): dùng NGAY, KHÔNG lưu vào cache/state lâu dài
 *    — caller gọi bằng mutation, không bằng query. 085 **không** `@Idempotent()` (owner O-8) và là
 *    lấy-hoặc-tạo: gọi lại chính là hỏi trạng thái lô.
 */
export const payrollReportsApi = {
  /** GET /payroll/overview (078) — 6 khối Tổng quan. Khối `budget` VẮNG khoá khi thiếu `view:payroll-budget`. */
  getOverview: (query?: Partial<PayrollOverviewQuery>): Promise<PayrollOverviewDto> =>
    apiFetch(`/payroll/overview${buildQueryString(query ?? {})}`, payrollOverviewSchema),

  /** GET /payroll/overview/reminders (079) — chỉ SỐ ĐẾM, không tên người, không tiền. */
  getOverviewReminders: (): Promise<PayrollOverviewRemindersDto> =>
    apiFetch(`/payroll/overview/reminders`, payrollOverviewRemindersSchema),

  /** GET /payroll/reports (080) — danh mục báo cáo caller MỞ ĐƯỢC (mảng trần, không phân trang). */
  listReports: (): Promise<PayrollReportCatalogItemDto[]> =>
    apiFetch(`/payroll/reports`, payrollReportCatalogSchema),

  /** GET /payroll/reports/:code (081) — dữ liệu + `totals` trên CẢ bộ lọc; > 50.000 dòng ⇒ 422 `031`. */
  getReport: (
    code: PayrollReportCode,
    query?: Partial<PayrollReportQuery>,
  ): Promise<PaginatedResult<PayrollReportDataDto>> =>
    apiFetchPaginated(
      `/payroll/reports/${code}${buildQueryString(query ?? {})}`,
      payrollReportDataSchema,
    ),

  /** GET /payroll/reports/:code/export (082) — XLSX, thêm cặp `export:payroll`. Không phân trang. */
  exportReport: (
    code: PayrollReportCode,
    query?: Partial<PayrollReportExportQuery>,
  ): Promise<ApiBlobResult> =>
    apiFetchBlob(`/payroll/reports/${code}/export${buildQueryString(query ?? {})}`),

  /** GET /payslips/:id/pdf (083) — phiếu NGƯỜI KHÁC; BE assert `view-payslip:payslip` **+** `export:payroll`. */
  getPayslipPdf: (id: string): Promise<PayslipPdfDto> =>
    apiFetch(`/payslips/${id}/pdf`, payslipPdfDto),

  /** GET /me/payslips/:id/pdf (084) — Own; cùng bộ lọc kỳ đã phát hành với 031/032; phiếu người khác ⇒ 404. */
  getMyPayslipPdf: (id: string): Promise<PayslipPdfDto> =>
    apiFetch(`/me/payslips/${id}/pdf`, payslipPdfDto),

  /**
   * POST /payroll-periods/:id/payslips/pdf-batch (085) — lấy-hoặc-tạo lô ZIP của CHÍNH caller cho kỳ đó.
   * `202` + `Pending` khi đang sinh; `200` + `Uploaded`/`Failed` khi xong. `retry:true` bỏ lô `Failed` gần nhất.
   */
  requestPayslipPdfBatch: (
    periodId: string,
    body: PayslipPdfBatchRequest = {},
  ): Promise<PayslipPdfBatchDto> =>
    apiFetch(`/payroll-periods/${periodId}/payslips/pdf-batch`, payslipPdfBatchDto, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
