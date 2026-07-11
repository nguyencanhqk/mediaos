/**
 * S4-DASH-BE-3 — mã lỗi nghiệp vụ Dashboard config CRUD (slug SPEC-07 / DASH-API-203). Surface qua
 * HttpException payload.code (AllExceptionsFilter đọc trực tiếp) — mirror dashboard-resolver.errors.ts.
 *
 * NOT_FOUND: PATCH /dashboard/configs/:id với id KHÔNG tồn tại trong tenant hiện tại (RLS ẩn row của
 * company khác ⇒ cross-tenant cũng rơi vào đây) HOẶC đã soft-delete (deleted_at IS NOT NULL). Trả 404
 * (KHÔNG 403) để KHÔNG lộ sự tồn tại của config thuộc tenant khác.
 */
export const DASH_CONFIG_ERR = {
  NOT_FOUND: "DASH-ERR-NOT_FOUND",
} as const;
