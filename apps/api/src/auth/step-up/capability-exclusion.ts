/**
 * S14-SEC-CAPWILDCARD-1 — vế `EXCLUDED` của hợp đồng `capabilities` (ADR `DECISIONS-13` §4.1, sửa đổi
 * 23/10/2026 CW-1): MỘT nguồn, đặt cạnh `REVEAL_CLASS_PAIRS` nhưng là const KHÁC.
 *
 * Luật: `capabilities` / `scopes` của `/auth/me` KHÔNG BAO GIỜ chứa cặp có `action` bắt đầu bằng
 * `reveal-` — kể cả khi actor giữ grant EXACT trên cặp đó. Đây là luật theo TIỀN TỐ, không theo danh
 * sách cặp: cặp reveal mới seed theo khuôn `reveal-…` tự rơi vào đây, không phải nhớ append.
 *
 * ─── VÌ SAO CÓ VẾ NÀY ──────────────────────────────────────────────────────────────────────────────
 * Lớp reveal/step-up có cổng nằm ở CALL-SITE (`requiresReauth` / `objectGrantRequired`) hoặc ở service
 * (grant break-glass `active`), không ở cặp trong DB ⇒ phép chiếu tầng công ty không suy ra được nó.
 *   - `reveal-secret:platform-account` — `can()` không bao giờ ALLOW ở tầng công ty (object grant bắt buộc).
 *   - `reveal-break-glass:break-glass` — `can()` CÓ ALLOW ở tầng công ty; cổng thật là grant `active` ở
 *     service. Loại nó khỏi caps là CHỦ ĐÍCH thu hẹp gợi ý UI, không phải hệ quả của `needsObjectGrant`.
 *
 * ─── ĐỌC ĐÚNG CHIỀU ────────────────────────────────────────────────────────────────────────────────
 * (i)  So khớp TIỀN TỐ ở đây là chiều LOẠI (thu hẹp gợi ý UI). Cảnh báo «KHÔNG so khớp tiền tố» ở
 *      `isRevealClassPair` (`reveal-class-pairs.ts`) là chiều MINT cửa sổ step-up (nới) ⇒ không mâu thuẫn.
 * (ii) Action `reveal` KHÔNG gạch nối (khuôn step-up DECISIONS-09) hay `reveal_…` CỐ Ý không khớp luật
 *      runtime: ratchet `capability-exclusion.spec.ts` bắt token `reveal*` rộng hơn ⇒ một action reveal
 *      mới lệch khuôn làm ĐỎ và owner quyết. CẤM tự nới luật runtime để ratchet xanh.
 * (iii) KHÔNG gộp với `EXCLUDED_PAIRS` của `super-admin-bootstrap.service.ts` — đó là loại khỏi GRANT của
 *      super-admin (khái niệm khác); gộp = đổi grant super-admin.
 * (iv) KHÔNG thêm phần tử vào `REVEAL_CLASS_PAIRS` (const đó cố ý rỗng, có WO riêng).
 */
export const CAPABILITY_EXCLUDED_ACTION_PREFIX = "reveal-";

/** `true` ⇔ cặp có `action` này KHÔNG BAO GIỜ được phát vào `capabilities` / `scopes`. */
export function isCapabilityExcluded(action: string): boolean {
  return action.startsWith(CAPABILITY_EXCLUDED_ACTION_PREFIX);
}
