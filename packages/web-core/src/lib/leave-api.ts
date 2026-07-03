import { z } from "zod";
import {
  leaveTypeViewSchema,
  leaveBalanceViewSchema,
  leaveRequestDetailViewSchema,
  leaveRequestListResponseSchema,
  leaveManagementListResponseSchema,
  leaveCalculateResponseSchema,
  leaveCalendarResponseSchema,
  leaveTypeAdminViewSchema,
  leavePolicyViewSchema,
  leaveBalanceAdminViewSchema,
  leaveBalanceTransactionViewSchema,
  // S3-FE-LEAVE-6 — báo cáo tổng hợp nghỉ + audit log LEAVE (reuse audit contract của foundation).
  leaveReportResponseSchema,
  auditLogListResponseSchema,
  type LeaveReportQuery,
  type LeaveReportResponse,
  type AuditLogQuery,
  type AuditLogListResponse,
  type LeaveTypeView,
  type LeaveBalanceView,
  type LeaveRequestDetailView,
  type LeaveRequestListResponse,
  type LeaveRequestListQuery,
  type LeaveManagementListResponse,
  type PendingLeaveRequestListQuery,
  type LeaveCalculateRequest,
  type LeaveCalculateResponse,
  type CreateLeaveRequestDraft,
  type UpdateLeaveRequestDraft,
  type LeaveCalendarQuery,
  type LeaveCalendarResponse,
  type LeaveTypeAdminView,
  type CreateLeaveTypeAdminRequest,
  type UpdateLeaveTypeAdminRequest,
  type LeavePolicyView,
  type LeavePolicyListQuery,
  type CreateLeavePolicyRequest,
  type UpdateLeavePolicyRequest,
  type LeaveBalanceAdminView,
  type LeaveBalanceAdminListQuery,
  type LeaveBalanceTransactionView,
  type AdjustLeaveBalanceRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * LEAVE API client — S3-FE-LEAVE-1.
 * Tất cả endpoint cần Bearer (apiFetch gắn tự động).
 * company_id được resolve bởi server từ auth context — client KHÔNG tự truyền.
 * Masking là việc của server — client chỉ render những gì nhận được.
 */
export const leaveApi = {
  // ── Loại nghỉ ──────────────────────────────────────────────────────────────

  /**
   * GET /leave/types — danh sách loại nghỉ active, sorted.
   * Permission: view:leave-type (granted to all canonical roles).
   */
  listTypes: (): Promise<LeaveTypeView[]> => apiFetch("/leave/types", z.array(leaveTypeViewSchema)),

  // ── Số dư phép của tôi ────────────────────────────────────────────────────

  /**
   * GET /leave/me/balances — số dư phép của user hiện tại, theo năm.
   * Permission: view-own:leave-balance.
   * periodYear mặc định = năm hiện tại (server resolve).
   */
  getMyBalances: (params?: { periodYear?: number }): Promise<LeaveBalanceView[]> => {
    const qs = buildQueryString(params ?? {});
    return apiFetch(`/leave/me/balances${qs}`, z.array(leaveBalanceViewSchema));
  },

  // ── Đơn nghỉ của tôi ──────────────────────────────────────────────────────

  /**
   * GET /leave/me/requests — danh sách đơn nghỉ của user hiện tại (phân trang + lọc).
   * Permission: view-own:leave.
   */
  listMyRequests: (query?: Partial<LeaveRequestListQuery>): Promise<LeaveRequestListResponse> => {
    const qs = buildQueryString(query ?? {});
    return apiFetch(`/leave/me/requests${qs}`, leaveRequestListResponseSchema);
  },

  /**
   * GET /leave/me/requests/:id — chi tiết 1 đơn nghỉ của tôi (gồm days[] + approvals[]).
   * Permission: view-own:leave.
   */
  getMyRequest: (id: string): Promise<LeaveRequestDetailView> =>
    apiFetch(`/leave/me/requests/${id}`, leaveRequestDetailViewSchema),

  // ── Tạo / cập nhật / gửi / hủy đơn nháp ─────────────────────────────────

  /**
   * POST /leave/requests — tạo đơn nháp (status='Draft').
   * submitNow=true trong body ⇒ server submit ngay (Draft→Pending trong cùng tx).
   * Permission: create:leave.
   */
  createDraft: (body: CreateLeaveRequestDraft): Promise<LeaveRequestDetailView> =>
    apiFetch("/leave/requests", leaveRequestDetailViewSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * PATCH /leave/requests/:id — sửa đơn nháp (chỉ khi status='Draft').
   * Permission: update-draft:leave.
   */
  updateDraft: (id: string, body: UpdateLeaveRequestDraft): Promise<LeaveRequestDetailView> =>
    apiFetch(`/leave/requests/${id}`, leaveRequestDetailViewSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /**
   * POST /leave/requests/:id/submit — chuyển Draft → Pending.
   * Permission: submit:leave.
   */
  submitRequest: (id: string, note?: string): Promise<LeaveRequestDetailView> =>
    apiFetch(`/leave/requests/${id}/submit`, leaveRequestDetailViewSchema, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  /**
   * POST /leave/requests/:id/cancel — hủy đơn (Draft|Pending → Cancelled).
   * Permission: cancel-own:leave. Server release pending_days reservation nếu có.
   */
  cancelRequest: (id: string, cancelReason?: string): Promise<LeaveRequestDetailView> =>
    apiFetch(`/leave/requests/${id}/cancel`, leaveRequestDetailViewSchema, {
      method: "POST",
      body: JSON.stringify({ cancelReason }),
    }),

  // ── Preview tính ngày nghỉ ────────────────────────────────────────────────

  /**
   * POST /leave/requests/calculate — preview số ngày/giờ + balance TRƯỚC/SAU.
   * KHÔNG ghi gì — chỉ tính toán. Hiển thị trong form trước khi submit.
   * Permission: create:leave.
   */
  calculate: (body: LeaveCalculateRequest): Promise<LeaveCalculateResponse> =>
    apiFetch("/leave/requests/calculate", leaveCalculateResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Quản lý / phê duyệt (HR·manager) — S3-FE-LEAVE-2 ──────────────────────
  // Cổng SERVER: GET /leave/requests = view:leave (SENSITIVE, scope Team/Company do server áp);
  // approve = approve:leave; reject = reject:leave (SENSITIVE). Client chỉ chọn endpoint + validate.

  /**
   * GET /leave/requests — danh sách đơn nghỉ cho HR/manager duyệt (mặc định status='Pending').
   * Permission: view:leave (đọc chéo, server scope Team/Company). Phân trang + lọc.
   * company_id resolve từ auth context — client KHÔNG truyền.
   */
  listRequests: (
    query?: Partial<PendingLeaveRequestListQuery>,
  ): Promise<LeaveManagementListResponse> => {
    const qs = buildQueryString(query ?? {});
    return apiFetch(`/leave/requests${qs}`, leaveManagementListResponseSchema);
  },

  /**
   * POST /leave/requests/:id/approve — duyệt đơn Pending → Approved. note tuỳ chọn.
   * Permission: approve:leave. Actor/companyId server-authoritative (client note bị Zod strip khác).
   */
  approveRequest: (id: string, note?: string): Promise<LeaveRequestDetailView> =>
    apiFetch(`/leave/requests/${id}/approve`, leaveRequestDetailViewSchema, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  /**
   * POST /leave/requests/:id/reject — từ chối đơn Pending → Rejected. reason BẮT BUỘC (min1,max2000).
   * Permission: reject:leave (SENSITIVE). Validate lý do rỗng là việc form + Zod contract phía page.
   */
  rejectRequest: (id: string, reason: string): Promise<LeaveRequestDetailView> =>
    apiFetch(`/leave/requests/${id}/reject`, leaveRequestDetailViewSchema, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  // ── Lịch nghỉ (S3-FE-LEAVE-4) ─────────────────────────────────────────────
  // Cổng SERVER 2 tầng (xem apps/api/src/leave/leave.controller.ts listCalendar):
  //   coarse = view-own:leave-calendar (mọi role có Own); THẬT = view-own/view-team/view-company theo
  //   `scope` query — thiếu quyền cho scope yêu cầu → 403. Client CHỈ chọn scope, KHÔNG tự lọc dữ liệu.
  // MASK: `reason` chỉ có ở dòng của chính người gọi — mọi dòng khác LUÔN null (server quyết định).

  /**
   * GET /leave/calendar?scope=own|team|company&from&to — lịch nghỉ theo phạm vi (own/team/company).
   * Permission: view-own:leave-calendar (coarse) + view-{scope}:leave-calendar (thật, server-side).
   */
  getCalendar: (query: LeaveCalendarQuery): Promise<LeaveCalendarResponse> => {
    const qs = buildQueryString(query);
    return apiFetch(`/leave/calendar${qs}`, leaveCalendarResponseSchema);
  },

  // ── Admin: loại nghỉ (S3-FE-LEAVE-5 · LEAVE-SCREEN-010) ──────────────────
  // Cổng SERVER: view:leave-type (đọc, KHÔNG sensitive) · create/update/delete:leave-type (SENSITIVE,
  // Company-scope hr/company-admin — mig 0455). Client chỉ chọn endpoint + validate response.

  /**
   * GET /leave/types — nguồn ĐỌC DUY NHẤT hiện có cho màn quản trị Loại nghỉ. Validate qua
   * `leaveTypeViewSchema` (schema THẬT server trả cho route này — KHÔNG có `allowNegativeBalance`, BE
   * chưa có endpoint list riêng cho mặt admin/S3-LEAVE-BE-4) rồi map thêm `allowNegativeBalance: null`
   * để khớp shape `LeaveTypeAdminView` (admin create/update TRẢ field này).
   * HẠN CHẾ ĐÃ BIẾT (BE gap): route chỉ trả loại ĐANG active (findActiveTypesTx) — loại inactive sẽ
   * KHÔNG hiện trong danh sách quản trị cho tới khi BE bổ sung endpoint list-admin riêng.
   */
  listTypesAdmin: (): Promise<LeaveTypeAdminView[]> =>
    apiFetch("/leave/types", z.array(leaveTypeViewSchema)).then((rows) =>
      rows.map((r) => ({ ...r, allowNegativeBalance: null })),
    ),

  /** POST /leave/admin/types — tạo loại nghỉ (đủ field cấu hình). Permission: create:leave-type. */
  createTypeAdmin: (body: CreateLeaveTypeAdminRequest): Promise<LeaveTypeAdminView> =>
    apiFetch("/leave/admin/types", leaveTypeAdminViewSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /leave/admin/types/:id — sửa loại nghỉ. Permission: update:leave-type. code immutable. */
  updateTypeAdmin: (id: string, body: UpdateLeaveTypeAdminRequest): Promise<LeaveTypeAdminView> =>
    apiFetch(`/leave/admin/types/${id}`, leaveTypeAdminViewSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /**
   * POST /leave/admin/types/:id/delete — vô hiệu hoá (soft-delete, KHÔNG xóa cứng). Permission:
   * delete:leave-type. Server trả envelope data:null (HttpCode 200, KHÔNG 204) → validate `z.null()`.
   */
  deleteTypeAdmin: (id: string): Promise<void> =>
    apiFetch(`/leave/admin/types/${id}/delete`, z.null(), { method: "POST" }).then(() => undefined),

  // ── Admin: chính sách nghỉ phép (S3-FE-LEAVE-5 · LEAVE-SCREEN-011) ────────
  // Cổng SERVER: view/create/update/delete:leave-policy — CẢ 4 đều SENSITIVE (Company-scope, mig 0455).

  /** GET /leave/admin/policies — danh sách chính sách nghỉ. Permission: view:leave-policy. */
  listPolicies: (query?: Partial<LeavePolicyListQuery>): Promise<LeavePolicyView[]> => {
    const qs = buildQueryString(query ?? {});
    return apiFetch(`/leave/admin/policies${qs}`, z.array(leavePolicyViewSchema));
  },

  /** POST /leave/admin/policies — tạo chính sách. Permission: create:leave-policy. */
  createPolicy: (body: CreateLeavePolicyRequest): Promise<LeavePolicyView> =>
    apiFetch("/leave/admin/policies", leavePolicyViewSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /leave/admin/policies/:id — cập nhật chính sách. Permission: update:leave-policy. */
  updatePolicy: (id: string, body: UpdateLeavePolicyRequest): Promise<LeavePolicyView> =>
    apiFetch(`/leave/admin/policies/${id}`, leavePolicyViewSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /**
   * POST /leave/admin/policies/:id/delete — xoá mềm chính sách. Permission: delete:leave-policy.
   * Server trả envelope data:null (HttpCode 200) → validate `z.null()`.
   */
  deletePolicy: (id: string): Promise<void> =>
    apiFetch(`/leave/admin/policies/${id}/delete`, z.null(), { method: "POST" }).then(
      () => undefined,
    ),

  // ── Admin: số dư phép (HR) — S3-FE-LEAVE-5 · LEAVE-SCREEN-012/013 ─────────
  // Cổng SERVER: view/view-transaction/adjust:leave-balance — CẢ 3 đều SENSITIVE (Company-scope, mig 0455).

  /** GET /leave/admin/balances — số dư phép theo employee/loại/năm. Permission: view:leave-balance. */
  listBalancesAdmin: (
    query?: Partial<LeaveBalanceAdminListQuery>,
  ): Promise<LeaveBalanceAdminView[]> => {
    const qs = buildQueryString(query ?? {});
    return apiFetch(`/leave/admin/balances${qs}`, z.array(leaveBalanceAdminViewSchema));
  },

  /**
   * GET /leave/balances/:id/transactions — ledger append-only (route canonical, API-05 §12.8, khớp
   * FRONTEND sitemap /leave/balances/:balanceId/transactions). Permission: view-transaction:leave-balance.
   */
  listBalanceTransactions: (balanceId: string): Promise<LeaveBalanceTransactionView[]> =>
    apiFetch(
      `/leave/balances/${balanceId}/transactions`,
      z.array(leaveBalanceTransactionViewSchema),
    ),

  /**
   * POST /leave/admin/balances/:id/adjust — điều chỉnh số dư QUA LEDGER (amountDays +/-, reason bắt buộc).
   * Permission: adjust:leave-balance. Server LUÔN ghi 1 dòng leave_balance_transactions kèm UPDATE — KHÔNG
   * endpoint nào khác sửa total_days trực tiếp (bất biến #2 — audit/ledger append-only).
   */
  adjustBalance: (
    balanceId: string,
    body: AdjustLeaveBalanceRequest,
  ): Promise<LeaveBalanceAdminView> =>
    apiFetch(`/leave/admin/balances/${balanceId}/adjust`, leaveBalanceAdminViewSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Báo cáo tổng hợp nghỉ phép (S3-LEAVE-BE-6 · LEAVE-SCREEN-013) — S3-FE-LEAVE-6 ────────
  // Cổng SERVER: export:leave (SENSITIVE, Company-scope — CHỈ hr/company-admin, mig 0455; manager
  // KHÔNG có grant). GET /leave/reports trả JSON tổng hợp per-employee (KHÔNG file CSV/export). Client
  // chỉ chọn endpoint + validate; company_id resolve từ auth context — client KHÔNG truyền.

  /** GET /leave/reports — tổng hợp nghỉ ĐÃ duyệt theo kỳ [fromDate,toDate]. Permission: export:leave. */
  getLeaveReport: (query: LeaveReportQuery): Promise<LeaveReportResponse> => {
    const qs = buildQueryString(query);
    return apiFetch(`/leave/reports${qs}`, leaveReportResponseSchema);
  },

  // ── Audit log LEAVE (S3-LEAVE-BE-6 · LEAVE-SCREEN-014A) — S3-FE-LEAVE-6 ──────────────────
  // Route/guard RIÊNG của LEAVE (KHÔNG dùng chung foundation /foundation/audit-logs) — cặp
  // view:leave-audit-log (SENSITIVE, Company-scope hr/company-admin mig 0455), server bound thêm vào
  // object-type allowlist của LEAVE. Field before/after/oldValues/newValues ĐÃ redact ở server
  // (AuditMaskerService, bất biến #3) — client CHỈ render field top-level nhận được.

  /**
   * GET /leave/audit-logs — viewer audit RIÊNG của LEAVE. Reuse AuditLogQuery/AuditLogListResponse
   * (KHÔNG contract mới). Permission: view:leave-audit-log (SENSITIVE).
   */
  listLeaveAuditLogs: (query?: Partial<AuditLogQuery>): Promise<AuditLogListResponse> => {
    const qs = buildQueryString(query ?? {});
    return apiFetch(`/leave/audit-logs${qs}`, auditLogListResponseSchema);
  },
};
