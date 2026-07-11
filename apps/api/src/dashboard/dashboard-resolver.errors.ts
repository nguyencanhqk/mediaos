/**
 * S4-DASH-BE-1 — mã lỗi nghiệp vụ Dashboard resolver (slug SPEC-07). Surface qua HttpException payload.code
 * (AllExceptionsFilter đọc trực tiếp) — mirror my-notifications.errors.ts / leave LEAVE_ERR.
 *
 * DASHBOARD_NOT_RESOLVED: user qua gate read:dashboard (blanket mọi role, mig 0100) nhưng KHÔNG có bất kỳ
 * cặp view-*:dashboard nào ⇒ không resolve được dashboard type nào (API-08 §11.2 business validation).
 */
export const DASH_ERR = {
  DASHBOARD_NOT_RESOLVED: "DASH-ERR-DASHBOARD_NOT_RESOLVED",
  // ── S4-DASH-BE-2 (APPEND-only) — widget data / cache mã lỗi ─────────────────────────────────────────
  /**
   * SOURCE_MODULE_UNAVAILABLE: module nguồn của 1 widget ném lỗi HẠ TẦNG (KHÔNG phải permission/validation) khi
   * aggregate ⇒ widget trả status=Degraded + error_state (HTTP 200, BACKEND-10 §17.5 + Promise.allSettled).
   * KHÔNG nuốt ForbiddenException/HttpException (403/404/400 propagate — fail-closed, xem runner).
   */
  SOURCE_MODULE_UNAVAILABLE: "DASH-ERR-SOURCE_MODULE_UNAVAILABLE",
  /** NO_EMPLOYEE_LINK: user chưa gắn employee_profiles ⇒ widget scope-theo-nhân-viên không dựng được (fail-loud). */
  NO_EMPLOYEE_LINK: "DASH-ERR-NO_EMPLOYEE_LINK",
  /** VALIDATION: tham số bắt buộc thiếu/sai (vd slug=project-progress thiếu project_id) ⇒ 400 (KHÔNG 500). */
  VALIDATION: "DASH-ERR-VALIDATION",
  /** WIDGET_NOT_FOUND: slug không thuộc catalog 7 widget in-sprint ⇒ 404. */
  WIDGET_NOT_FOUND: "DASH-ERR-WIDGET_NOT_FOUND",
} as const;
