/**
 * S10-AUTH-STEPUP-1 — mã lỗi + action audit của đường step-up (DECISIONS-09 §6 điểm 3 và 10).
 *
 * Tách khỏi service để cổng test, int-spec và (về sau) FE cùng đọc MỘT chuỗi — không ai gõ lại literal.
 */

/**
 * Mã lỗi `AUTH-ERR-*`. `AllExceptionsFilter` ưu tiên `payload.code` (all-exceptions.filter.ts:88-92) nên
 * ba mã dưới đi thẳng ra client, KHÔNG rơi về mã suy từ status (`RESOURCE-ERR-CONFLICT`…).
 *
 * ĐẺ MÃ MỚI LÀ BẮT BUỘC, KHÔNG PHẢI LƯỜI TRA CỨU: đo `docs/spec/**` + `docs/API Design/**` không có slug
 * nào cho "chưa bật 2FA". Mã gần nhất `TWO_FACTOR_SETUP_REQUIRED` mang nghĩa KHÁC — "công ty/vai trò ÉP
 * bạn enroll" — dùng lại sẽ nói dối FE ở công ty không ép 2FA.
 */
export const STEP_UP_ERROR_CODES = {
  /**
   * 409. Chưa enroll TOTP ⇒ không có đường nào để xác thực lại. KHÔNG 403 câm (đó là KI-065), KHÔNG 500.
   */
  TWO_FACTOR_REQUIRED: "AUTH-ERR-STEP-UP-2FA-REQUIRED",
  /**
   * 400 — KHÔNG 401. `packages/web-core/src/lib/api-client.ts:405` bắt 401 của request đã-auth rồi
   * refresh + REPLAY request đúng một lần ⇒ một lần gõ sai sẽ tiêu HAI lượt rate-limit và ghi HAI hàng
   * audit, ngay tại endpoint vốn là oracle TOTP.
   */
  INVALID_CODE: "AUTH-ERR-STEP-UP-INVALID-CODE",
  /** 400. Cặp `(action, resourceType)` ngoài `REVEAL_CLASS_PAIRS` — hôm nay là MỌI cặp (registry rỗng). */
  PAIR_NOT_ALLOWED: "AUTH-ERR-STEP-UP-PAIR-NOT-ALLOWED",
} as const;

/**
 * `audit_logs.action` — tiền tố module `auth.` như mọi action của AuthModule (`auth.2fa_verified`…).
 * KHÔNG dùng `step_up_granted` trần: action không mang module sẽ trôi khỏi mọi bộ lọc theo module.
 *
 * `objectType` dùng `"auth"` — ĐÃ có trong `AUDIT_OBJECT_TYPES` và trong CHECK của `audit_logs` ⇒ WO này
 * KHÔNG chạm CHECK, KHÔNG migration (`audit-check-union-parse-anchor-trap`).
 */
export const STEP_UP_AUDIT_ACTIONS = {
  /** Cấp cửa sổ thành công — `result_status = 'Success'`. */
  GRANTED: "auth.step_up_granted",
  /** Gõ sai mã (kể cả replay marker) — `result_status = 'Failure'`. */
  FAILED: "auth.step_up_failed",
  /** Từ chối TRƯỚC khi verify (cặp ngoài registry · bucket khoá · chưa enroll) — `'Denied'`. */
  DENIED: "auth.step_up_denied",
} as const;
