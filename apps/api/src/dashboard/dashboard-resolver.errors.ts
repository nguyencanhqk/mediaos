/**
 * S4-DASH-BE-1 — mã lỗi nghiệp vụ Dashboard resolver (slug SPEC-07). Surface qua HttpException payload.code
 * (AllExceptionsFilter đọc trực tiếp) — mirror my-notifications.errors.ts / leave LEAVE_ERR.
 *
 * DASHBOARD_NOT_RESOLVED: user qua gate read:dashboard (blanket mọi role, mig 0100) nhưng KHÔNG có bất kỳ
 * cặp view-*:dashboard nào ⇒ không resolve được dashboard type nào (API-08 §11.2 business validation).
 */
export const DASH_ERR = {
  DASHBOARD_NOT_RESOLVED: "DASH-ERR-DASHBOARD_NOT_RESOLVED",
} as const;
