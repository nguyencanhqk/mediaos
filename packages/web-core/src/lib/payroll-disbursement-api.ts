import { z } from "zod";
import {
  payrollAdvanceSchema,
  type PayrollAdvanceDto,
  type PayrollAdvanceListQuery,
  type MePayrollAdvanceListQuery,
  type CreatePayrollAdvanceRequest,
  type UpdatePayrollAdvanceRequest,
  type ApprovePayrollAdvanceRequest,
  type RejectPayrollAdvanceRequest,
  payrollAdvanceWriteResultSchema,
  type PayrollAdvanceWriteResultDto,
  paymentBatchSchema,
  type PaymentBatchDto,
  type PaymentBatchListQuery,
  type CreatePaymentBatchRequest,
  type UpdatePaymentBatchRequest,
  paymentBatchWriteResultSchema,
  type PaymentBatchWriteResultDto,
  paymentLineSchema,
  type PaymentLineDto,
  type PaymentLineListQuery,
  type CompletePaymentBatchRequest,
  completePaymentBatchResultSchema,
  type CompletePaymentBatchResultDto,
  payrollBudgetSchema,
  type PayrollBudgetDto,
  type PayrollBudgetListQuery,
  type CreatePayrollBudgetRequest,
  type UpdatePayrollBudgetRequest,
  payrollBudgetWriteResultSchema,
  type PayrollBudgetWriteResultDto,
  payrollWriteResultSchema,
  type PayrollWriteResultDto,
} from "@mediaos/contracts";
import {
  apiFetch,
  apiFetchPaginated,
  apiFetchBlob,
  apiFetchMultipart,
  type PaginatedResult,
  type ApiBlobResult,
} from "./api-client";
import { buildQueryString } from "./api-params";
import { idempotencyKeyFor } from "./api-idempotency";

/**
 * S15-PAYROLL-FE-3 — client track C (PAYROLL-API-059..077): tạm ứng · đợt chi trả + dòng chi ·
 * ngân sách lương · import thu nhập/khấu trừ khác.
 *
 * Tách file khỏi `payroll-api.ts` (đã ~379 dòng) và **spread vào `payrollApi`** ở đó — consumer vẫn gọi
 * `payrollApi.listAdvances(...)`, test vẫn mock MỘT object (cùng khuôn `payroll-employees-api.ts`).
 *
 * ⚠️ **KHÔNG import `payrollIdempotencyKey` từ `payroll-api.ts`** — file đó import file NÀY để spread,
 * nên lấy ngược lại là vòng import. Mọi khoá ở đây dùng `idempotencyKeyFor` (băm), vừa tránh vòng vừa
 * đúng L5 (payload track C chở TIỀN và lý do tự do — nối chuỗi là ghi số tiền vào header + bảng
 * idempotency).
 *
 * Ba luật của `payroll-api.ts` áp NGUYÊN (L1 không siết mask ở client · L2 list đi `apiFetchPaginated` ·
 * L3 khoá idempotency suy từ NỘI DUNG), cộng hai luật riêng của track C:
 *
 * **L6 — KHÔNG có khoá số tài khoản trên đường ĐỌC.** DTO dòng chi (070) chỉ mang `bankAccountLast4`
 * (SPEC-11 §18.1 A); số đầy đủ **chỉ** rời server qua tệp UNC của 071. Body 067/069 `.strict()` và
 * **không có trường tài khoản nào** — snapshot sinh Ở SERVER từ `payroll_employee_settings`; gửi
 * `bankAccountNumber` lên là 400.
 *
 * **L7 — 059 là route `.strict()` đầu tiên của repo.** Khoá lọc gõ sai (`user_id`, `userid`, hay một
 * khoá `sort` chưa có trong schema) ⇒ **400**, không bị bỏ im lặng. Trước đây lỗi này trả DANH SÁCH
 * TOÀN CÔNG TY kèm `amount` trong khi người gọi tưởng đã lọc theo một người. Muốn thêm cột sắp xếp ⇒
 * sửa `payrollAdvanceListQuerySchema` ở contracts, **không** nới `.strict()`.
 *
 * ── Route nào audit lượt ĐỌC (SPEC-11 §18.1 B) ───────────────────────────────────────────────────
 * **059 · 061 · 066 · 068 · 070 · 071 · 073 ghi `audit_logs` MỖI LƯỢT.** Caller phải `enabled` query
 * theo khối ĐANG hiện, không chỉ theo quyền — mở một tab ẩn là một hàng audit «đã xem tiền» không hề
 * xảy ra (bẫy đã ăn ở FE-1). **065 KHÔNG audit** (tự xem của mình).
 */
export const payrollDisbursementApi = {
  // ── Tạm ứng — PAYROLL-API-059..065 ───────────────────────────────────────────────────────────

  /**
   * GET /payroll/advances (`view:payroll-advance`, SENSITIVE; **CÓ audit lượt đọc**).
   * Query `.strict()` — chỉ `userId` · `status[]` · `deductPeriodMonth` · `page` · `per_page` (L7).
   */
  listAdvances: (
    query?: Partial<PayrollAdvanceListQuery>,
  ): Promise<PaginatedResult<PayrollAdvanceDto[]>> =>
    apiFetchPaginated(
      `/payroll/advances${buildQueryString(query ?? {})}`,
      z.array(payrollAdvanceSchema),
    ),

  /**
   * POST /payroll/advances (`manage:payroll-advance`, @Idempotent). Luôn tạo ở `Pending`;
   * `created_by` lấy từ JWT — **KHÔNG** gửi lên (`.strict()` ⇒ 400). Kỳ đích đã tính ⇒ 409 `026`.
   */
  createAdvance: (body: CreatePayrollAdvanceRequest): Promise<PayrollAdvanceWriteResultDto> =>
    apiFetch(
      "/payroll/advances",
      payrollAdvanceWriteResultSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey: idempotencyKeyFor("payroll:create-advance", body) },
    ),

  /** GET /payroll/advances/:id (**CÓ audit lượt đọc**). */
  getAdvance: (id: string): Promise<PayrollAdvanceDto> =>
    apiFetch(`/payroll/advances/${id}`, payrollAdvanceSchema),

  /**
   * PATCH /payroll/advances/:id — sửa **hoặc** xoá mềm (`{delete:true}`). Chỉ khi `Pending` và chưa
   * khấu trừ ⇒ 409 `025`. KHÔNG @Idempotent ở BE.
   */
  updateAdvance: (
    id: string,
    body: UpdatePayrollAdvanceRequest,
  ): Promise<PayrollAdvanceWriteResultDto> =>
    apiFetch(`/payroll/advances/${id}`, payrollAdvanceWriteResultSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /**
   * POST /payroll/advances/:id/approve (`approve:payroll-advance`). `note` tuỳ chọn.
   *
   * ⚠️ `warnings` có thể mang `recalculate-required` — kỳ đích đang `Calculated`, khoản vừa duyệt CHƯA
   * nằm trong phiếu đã tính. Đừng nuốt: đó là tín hiệu phải tính lại kỳ.
   */
  approveAdvance: (
    id: string,
    body: ApprovePayrollAdvanceRequest,
  ): Promise<PayrollAdvanceWriteResultDto> =>
    apiFetch(`/payroll/advances/${id}/approve`, payrollAdvanceWriteResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** POST /payroll/advances/:id/reject — `note` **BẮT BUỘC** (mirror CHECK `reject_note_check`). */
  rejectAdvance: (
    id: string,
    body: RejectPayrollAdvanceRequest,
  ): Promise<PayrollAdvanceWriteResultDto> =>
    apiFetch(`/payroll/advances/${id}/reject`, payrollAdvanceWriteResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * GET /me/payroll-advances — «Tạm ứng của tôi» (`view-own:payroll-advance`). Scope **Own**: không có
   * `userId` trong query, chủ thể là chính caller. Chưa có khoản ⇒ danh sách **RỖNG, không lỗi**.
   * **KHÔNG audit lượt đọc** — tự xem của mình không phải sự kiện an ninh.
   */
  listMyAdvances: (
    query?: Partial<MePayrollAdvanceListQuery>,
  ): Promise<PaginatedResult<PayrollAdvanceDto[]>> =>
    apiFetchPaginated(
      `/me/payroll-advances${buildQueryString(query ?? {})}`,
      z.array(payrollAdvanceSchema),
    ),

  // ── Đợt chi trả + dòng chi — PAYROLL-API-066..072 ────────────────────────────────────────────

  /** GET /payroll/payment-batches (`view:payment-batch`; **CÓ audit lượt đọc**). */
  listPaymentBatches: (
    query?: Partial<PaymentBatchListQuery>,
  ): Promise<PaginatedResult<PaymentBatchDto[]>> =>
    apiFetchPaginated(
      `/payroll/payment-batches${buildQueryString(query ?? {})}`,
      z.array(paymentBatchSchema),
    ),

  /**
   * POST /payroll/payment-batches (`manage:payment-batch`, @Idempotent) — lập đợt từ kỳ **`Published`**
   * (khác ⇒ 409 `027 period-not-published`). `userIds` vắng ⇒ server tự nạp mọi phiếu chưa có dòng sống.
   *
   * ⚠️ `warnings` dạng `no-bank-account:<n>` · `zero-net:<n>` · `no-eligible-payees` là **số ĐẾM**, không
   * phải tiền — hiện thẳng cho người dùng. `no-eligible-payees` ⇒ đợt vẫn tạo nhưng 072 sẽ chặn `batch-empty`.
   */
  createPaymentBatch: (body: CreatePaymentBatchRequest): Promise<PaymentBatchWriteResultDto> =>
    apiFetch(
      "/payroll/payment-batches",
      paymentBatchWriteResultSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey: idempotencyKeyFor("payroll:create-payment-batch", body) },
    ),

  /** GET /payroll/payment-batches/:id (**CÓ audit lượt đọc**). */
  getPaymentBatch: (id: string): Promise<PaymentBatchDto> =>
    apiFetch(`/payroll/payment-batches/${id}`, paymentBatchSchema),

  /**
   * PATCH /payroll/payment-batches/:id — chỉ khi `Draft`/`Ready`.
   *
   * ⚠️ `status` dùng enum **RIÊNG** `Draft|Ready`: `Completed` chỉ tới được qua 072 (luật PHỦ +
   * four-eyes + `completed_by/at`). Gửi `Completed` ở đây là lách TOÀN BỘ cổng 072 ⇒ 400.
   * `removeUserIds` chỉ gỡ được dòng CHƯA chi (dòng đã `paid_at` ⇒ 409 `line-already-paid`, không gỡ dòng nào).
   */
  updatePaymentBatch: (
    id: string,
    body: UpdatePaymentBatchRequest,
  ): Promise<PaymentBatchWriteResultDto> =>
    apiFetch(`/payroll/payment-batches/${id}`, paymentBatchWriteResultSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /**
   * GET /payroll/payment-batches/:id/lines (**CÓ audit lượt đọc**) — `bankAccountLast4` only (L6).
   * Caller PHẢI `enabled` theo khối đang hiện: mỗi lượt gọi là một hàng audit «đã xem dòng chi».
   */
  listPaymentLines: (
    id: string,
    query?: Partial<PaymentLineListQuery>,
  ): Promise<PaginatedResult<PaymentLineDto[]>> =>
    apiFetchPaginated(
      `/payroll/payment-batches/${id}/lines${buildQueryString(query ?? {})}`,
      z.array(paymentLineSchema),
    ),

  /**
   * GET /payroll/payment-batches/:id/export — tệp UNC XLSX (**CÓ audit lượt xuất**).
   *
   * 🔴 Đây là đường DUY NHẤT số tài khoản đầy đủ rời server. BE assert **BA cặp**
   * (`manage:payment-batch` + `export:payroll` + `view-payslip:payslip`) ⇒ FE phải gate nút tải bằng
   * CẢ BA (`useCanExact`), nếu không là mời người dùng ăn 403.
   */
  exportPaymentBatch: (id: string): Promise<ApiBlobResult> =>
    apiFetchBlob(`/payroll/payment-batches/${id}/export`),

  /**
   * POST /payroll/payment-batches/:id/complete (@Idempotent, **200**).
   *
   * `confirmAllPaid: true` ghi `paid_at` cho MỌI dòng chưa chi trong CÙNG tx rồi mới kiểm — không tick
   * mà còn dòng chưa chi ⇒ 409 `batch-incomplete`. Đợt 0 dòng sống ⇒ 409 `batch-empty`.
   * `periodStatus` trả về là trạng thái kỳ SAU lượt này: `Paid` khi lượt này làm PHỦ ĐỦ kỳ, `Published`
   * khi chưa (luật PHỦ — **KHÔNG** phải lỗi).
   */
  completePaymentBatch: (
    id: string,
    body: CompletePaymentBatchRequest,
  ): Promise<CompletePaymentBatchResultDto> =>
    apiFetch(
      `/payroll/payment-batches/${id}/complete`,
      completePaymentBatchResultSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey: idempotencyKeyFor("payroll:complete-payment-batch", { id, ...body }) },
    ),

  // ── Ngân sách lương — PAYROLL-API-073..075 ───────────────────────────────────────────────────

  /**
   * GET /payroll/budgets (`view:payroll-budget`; **CÓ audit lượt đọc**).
   *
   * ⚠️ Trả **MẢNG TRẦN**, KHÔNG phân trang (≤ vài chục hàng/năm — query không có `page`/`per_page`).
   * Dùng `apiFetch` chứ không `apiFetchPaginated`: bọc nhầm là Zod-parse đỏ ngay.
   * `actualAmount`/`variance` server tính LÚC GỌI (không lưu) — FE **không tự trừ**.
   */
  listPayrollBudgets: (query?: Partial<PayrollBudgetListQuery>): Promise<PayrollBudgetDto[]> =>
    apiFetch(`/payroll/budgets${buildQueryString(query ?? {})}`, z.array(payrollBudgetSchema)),

  /** POST /payroll/budgets (@Idempotent) — trùng `(năm, đơn vị)` ⇒ 409 `029 budget-exists`. */
  createPayrollBudget: (body: CreatePayrollBudgetRequest): Promise<PayrollBudgetWriteResultDto> =>
    apiFetch(
      "/payroll/budgets",
      payrollBudgetWriteResultSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey: idempotencyKeyFor("payroll:create-budget", body) },
    ),

  /**
   * PATCH /payroll/budgets/:id — sửa `plannedAmount`/`note` hoặc xoá mềm (`{delete:true}`).
   * `fiscalYear`/`orgUnitId` KHÔNG đổi được (tạo hàng mới).
   */
  updatePayrollBudget: (
    id: string,
    body: UpdatePayrollBudgetRequest,
  ): Promise<PayrollBudgetWriteResultDto> =>
    apiFetch(`/payroll/budgets/${id}`, payrollBudgetWriteResultSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // ── Import thu nhập/khấu trừ khác — PAYROLL-API-076..077 ─────────────────────────────────────

  /**
   * POST /payroll-periods/:id/import-adjustments — multipart field `file`.
   *
   * ⚠️ **KHÔNG gửi `Idempotency-Key`** — CỐ Ý, mirror quyết định của BE: interceptor idempotency chạy
   * TRƯỚC `FileInterceptor` và băm `request.body`, mà body multipart lúc đó RỖNG ⇒ vân tay hằng số, mù
   * nội dung tệp ⇒ cùng khoá + tệp KHÁC sẽ phát lại phản hồi của tệp #1 và **im lặng bỏ tệp #2**.
   * Chống nạp trùng là `warnings: possible-duplicate:<n>` + cổng duyệt thưởng/phạt.
   *
   * ⚠️ **Toàn tệp hoặc không dòng nào.** Thành công trả `PayrollWriteResultDto` — `affectedLines` là số
   * dòng (dryRun: sẽ ghi / thật: đã ghi), `warnings` mang `dry-run` khi xem trước. Dòng lỗi KHÔNG về ở
   * đường thành công: chúng ném **422** với `details[]` gồm các phần tử `field:"row:<n>"` (tối đa 50) +
   * `field:"errorRows"` mang TỔNG số dòng lỗi. Caller bóc bằng `parseKindError(...).fields`.
   */
  importPeriodAdjustments: (
    periodId: string,
    file: File,
    dryRun: boolean,
  ): Promise<PayrollWriteResultDto> => {
    const formData = new FormData();
    formData.append("file", file);
    return apiFetchMultipart(
      `/payroll-periods/${periodId}/import-adjustments${buildQueryString({ dryRun })}`,
      payrollWriteResultSchema,
      formData,
    );
  },

  /** GET /payroll/imports/adjustments-template — tệp mẫu XLSX sinh từ CHÍNH khuôn cột của 076 (0 audit). */
  downloadAdjustmentImportTemplate: (): Promise<ApiBlobResult> =>
    apiFetchBlob("/payroll/imports/adjustments-template"),
};
