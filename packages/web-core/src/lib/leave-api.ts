import { z } from "zod";
import {
  leaveTypeViewSchema,
  leaveBalanceViewSchema,
  leaveRequestDetailViewSchema,
  leaveRequestListResponseSchema,
  leaveCalculateResponseSchema,
  type LeaveTypeView,
  type LeaveBalanceView,
  type LeaveRequestDetailView,
  type LeaveRequestListResponse,
  type LeaveRequestListQuery,
  type LeaveCalculateRequest,
  type LeaveCalculateResponse,
  type CreateLeaveRequestDraft,
  type UpdateLeaveRequestDraft,
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
};
