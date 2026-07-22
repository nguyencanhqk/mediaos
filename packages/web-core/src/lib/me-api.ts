import { z } from "zod";
import {
  meOverviewSchema,
  type MeOverview,
  meAttendanceSectionSchema,
  type MeAttendanceSection,
  meLeaveSectionSchema,
  type MeLeaveSection,
  meTaskSectionSchema,
  type MeTaskSection,
  meNotificationSectionSchema,
  type MeNotificationSection,
  mePreferencesSchema,
  type MePreferences,
  type MePreferencesAppearancePatch,
  meSecurityActivityItemSchema,
  type MeSecurityActivityItem,
  meAvatarSchema,
  type MeAvatar,
  meAvatarUploadUrlResponseSchema,
  meCurrentAvatarSchema,
  type MeCurrentAvatar,
  confirmUploadResponseSchema,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { DEFAULT_UPLOAD_MIME, putBytesToStorage } from "./storage-upload";
import { buildQueryString } from "./api-params";

// S5-BRAND-FE-1: putBytesToStorage + DEFAULT_UPLOAD_MIME chuyển sang storage-upload.ts (dùng chung với
// branding-api). Hành vi GIỮ NGUYÊN — cùng Content-Type khớp presign + credentials:'omit' + ném-không-nuốt.

/**
 * Query GET /me/security/activity — CHỈ phân trang + khoảng thời gian (whitelist tường minh). CỐ Ý
 * KHÔNG có user_id/employee_id: owner resolve 100% từ token, client KHÔNG được chỉ định chủ sở hữu
 * (chống IDOR, SPEC-09 §14.4). Ngày = chuỗi ISO (BE z.coerce.date() ở meSecurityActivityQuerySchema).
 */
export interface MeSecurityActivityQueryParams {
  page?: number;
  per_page?: number;
  from_date?: string;
  to_date?: string;
}

/**
 * S5-ME-FE-1/FE-3 — ME API client (Personal Hub, SPEC-09 §14.2/§15.2 / API-11 §5). Mirror BE `MeController`
 * + `MePreferencesController` (apps/api/src/me/me.controller.ts · me-preferences.controller.ts): mọi route
 * đọc/ghi own-scope, resolve user 100% từ token — client KHÔNG gửi user_id/employee_id (chống IDOR, §14.4).
 * `getIdentity` (GET /me) để lại — chưa có consumer thật (tránh code chết — YAGNI).
 *
 * MASKING là việc của SERVER: response ĐÃ mask theo module nguồn — client chỉ render field nhận được
 * (BẤT BIẾN CLAUDE.md §2/§5). Mọi response validate Zod ở ranh giới — lỗi shape ném ngay, KHÔNG âm thầm
 * render dữ liệu sai.
 */
export const meApi = {
  /** GET /me/overview — identity + 5 section-envelope (hr/attendance/leave/task/notification), fail-soft. */
  getOverview: (): Promise<MeOverview> => apiFetch("/me/overview", meOverviewSchema),

  /** GET /me/attendance-summary — chấm công hôm nay (own), section-envelope riêng (§13). ME-SCREEN-009. */
  getAttendanceSummary: (): Promise<MeAttendanceSection> =>
    apiFetch("/me/attendance-summary", meAttendanceSectionSchema),

  /** GET /me/leave-summary — số dư phép + đơn đang chờ (own), section-envelope riêng. ME-SCREEN-010. */
  getLeaveSummary: (): Promise<MeLeaveSection> =>
    apiFetch("/me/leave-summary", meLeaveSectionSchema),

  /** GET /me/task-summary — roll-up đếm task (own), section-envelope riêng. ME-SCREEN-011. */
  getTaskSummary: (): Promise<MeTaskSection> => apiFetch("/me/task-summary", meTaskSectionSchema),

  /** GET /me/notification-summary — đếm thông báo chưa đọc (own), section-envelope riêng. ME-SCREEN-012. */
  getNotificationSummary: (): Promise<MeNotificationSection> =>
    apiFetch("/me/notification-summary", meNotificationSectionSchema),

  /** GET /me/preferences — snapshot preference hiện tại (own, mọi field nullable = kế thừa default). */
  getPreferences: (): Promise<MePreferences> => apiFetch("/me/preferences", mePreferencesSchema),

  /**
   * PATCH /me/preferences/appearance — subset giao diện (theme/locale/timezone/format/density). ME-SCREEN-014.
   * `null` = revert-to-inherit, `undefined` (field vắng) = không đụng cột — xem mePreferencesAppearanceShape.
   */
  patchAppearance: (patch: MePreferencesAppearancePatch): Promise<MePreferences> =>
    apiFetch("/me/preferences/appearance", mePreferencesSchema, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  /**
   * GET /me/security/activity — hoạt động bảo mật CỦA CHÍNH user (login_logs + user_security_events hợp
   * nhất, ĐÃ mask). ME-SCREEN-008 (S5-ME-BE-3). Owner resolve 100% từ token — client CHỈ gửi phân trang
   * + khoảng thời gian, TUYỆT ĐỐI KHÔNG user_id/employee_id (chống IDOR §14.4). Whitelist tường minh 4
   * param (KHÔNG spread query) ⇒ owner-param caller cố chèn bị LOẠI im lặng ngay tầng client.
   *
   * Response parse `z.array(meSecurityActivityItemSchema)` — apiFetch/unwrapEnvelope CHỈ trả field `data`
   * (mảng), block `pagination` sibling BỊ BỎ (giới hạn đã biết, mirror myNotificationApi.list /
   * fileAccessLogApi.list): tổng số trang KHÔNG khả dụng ở client ⇒ page dùng heuristic full-page cho
   * has-next. Shape sai → ném ngay (không âm thầm render dữ liệu bảo mật sai).
   */
  getSecurityActivity: (
    query?: MeSecurityActivityQueryParams,
  ): Promise<MeSecurityActivityItem[]> => {
    // WHITELIST tường minh — chỉ 4 param phân trang/thời gian. KHÔNG spread `query` (owner-param
    // user_id/employee_id caller cố chèn bị loại — owner 100% từ token, §14.4).
    const safeQuery: Record<string, unknown> = {};
    if (query?.page !== undefined) safeQuery.page = query.page;
    if (query?.per_page !== undefined) safeQuery.per_page = query.per_page;
    if (query?.from_date !== undefined) safeQuery.from_date = query.from_date;
    if (query?.to_date !== undefined) safeQuery.to_date = query.to_date;
    return apiFetch(
      `/me/security/activity${buildQueryString(safeQuery)}`,
      z.array(meSecurityActivityItemSchema),
    );
  },

  // ── S5-ME-FE-4 — Avatar own-scope (S5-ME-BE-4) ──────────────────────────────────────────────
  //
  // Đường ME own-scope: KHÔNG cần *:foundation-file (đóng "Nợ để lại" S5-ME-BE-2). Owner resolve 100% từ
  // token — client KHÔNG gửi user_id/employee_id (chống IDOR §14.4).

  /** GET /me/avatar — avatar hiện tại đã ký (TTL-ngắn) hoặc null (fail-soft: chưa có / không tải được). */
  getAvatar: (): Promise<MeCurrentAvatar> => apiFetch("/me/avatar", meCurrentAvatarSchema),

  /** DELETE /me/avatar — gỡ avatar hiện có (204, idempotent). */
  removeAvatar: (): Promise<void> => apiFetch("/me/avatar", z.void(), { method: "DELETE" }),

  /**
   * Upload + gắn avatar own-scope — 4 pha (S5-ME-BE-4). Bất kỳ pha nào lỗi → ném NGAY, KHÔNG âm thầm bỏ pha
   * sau (silent-failure):
   *   (1) POST /me/avatar/upload-url — đăng ký file ảnh Private owned-by-token + presigned-PUT.
   *   (2) PUT bytes trực tiếp lên storage (Content-Type khớp declaredMimeType).
   *   (3) POST /me/avatar/confirm — verify size/tồn tại + checksum server-side (flip Pending→Uploaded).
   *   (4) POST /me/avatar — gắn avatar (thay avatar cũ nếu có) → trả downloadUrl TƯƠI để hiển thị ngay.
   */
  uploadAvatar: async (file: File): Promise<MeAvatar> => {
    const declaredMimeType = file.type || DEFAULT_UPLOAD_MIME;
    const reg = await apiFetch("/me/avatar/upload-url", meAvatarUploadUrlResponseSchema, {
      method: "POST",
      body: JSON.stringify({ originalName: file.name, declaredMimeType, sizeBytes: file.size }),
    });
    await putBytesToStorage(reg.uploadUrl, file, declaredMimeType);
    await apiFetch("/me/avatar/confirm", confirmUploadResponseSchema, {
      method: "POST",
      body: JSON.stringify({ fileId: reg.fileId }),
    });
    return apiFetch("/me/avatar", meAvatarSchema, {
      method: "POST",
      body: JSON.stringify({ fileId: reg.fileId }),
    });
  },
};
