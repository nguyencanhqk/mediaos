import type { ValueProvider } from "@nestjs/common";

/**
 * S10-AUTH-STEPUP-1 · D3 — REGISTRY cặp `(action, resourceType)` được phép MINT cửa sổ step-up.
 * Nguồn sự thật: `docs/DECISIONS/DECISIONS-09_Security_Policy_Reauth_And_Object_Grant.md` §6 điểm (4)+(5).
 *
 * ─── VÌ SAO RỖNG, VÀ VÌ SAO RỖNG LÀ ĐÚNG ────────────────────────────────────────────────────────
 * `permission.decide.ts` tính `needsObjectGrant = objectGrantRequired ?? (isSensitive && requiresReauth)`
 * ⇒ chỉ cần gõ thêm `requiresReauth: true` vào một `@RequirePermission` là route đó bước vào
 * "reveal-secret class" và đòi ĐỒNG THỜI một object grant lẫn một cửa sổ re-auth còn hạn. Khi chưa cặp
 * nào mintable, route đó **403 VĨNH VIỄN, im lặng** — đúng cách `PATCH /settings/security-policy` chết
 * câm từ 2026-07 tới 14/08/2026 (KI-065).
 *
 * Vì thế danh sách này khởi tạo RỖNG **có chủ đích**: `POST /auth/step-up` tồn tại nhưng hôm nay luôn trả
 * 400 `AUTH-ERR-STEP-UP-PAIR-NOT-ALLOWED`. Đó KHÔNG phải lỗi cần "vá cho chạy" — đó là cổng chống tái
 * diễn: chừng nào chưa ai thêm cặp vào đây thì không route sản phẩm nào được phép khai `requiresReauth`,
 * và cổng `reauth-reachability.e2e-spec.ts` sẽ ĐỎ nếu có ai thử.
 *
 * ─── THÊM MỘT CẶP = QUYẾT ĐỊNH BẢO MẬT (ba điều kiện, đủ CẢ BA — §6 điểm 5) ─────────────────────
 *   (a) route tiêu thụ có ĐÚNG segment `:id` (PermissionGuard chỉ đọc `req.params?.id`; `:fileId`,
 *       `:userId`… KHÔNG cứu được);
 *   (b) `@UseGuards(ReauthGuard, PermissionGuard)` — ĐÚNG THỨ TỰ, cùng một tầng (§6 điểm 8);
 *   (c) có đường cấp `object_permissions` THẬT trỏ vào chính `resourceId` đó (qua nghiệp vụ, không
 *       phải INSERT tay).
 * Thiếu bất kỳ điều nào ⇒ route hỏng ĐÚNG CHIỀU AN TOÀN nhưng CÂM — tức là lại đúng cái bẫy trên.
 *
 * ─── MỘT NGUỒN, HAI ĐẦU ĐỌC ─────────────────────────────────────────────────────────────────────
 * `StepUpService` đọc qua DI token (mở đường cho int-spec `overrideProvider(...).useValue([cặp test])`
 * mà KHÔNG nới const thật); cổng test import CHÍNH const này. Provider dưới đây giữ `useValue` **là
 * chính đối tượng** — spec so bằng IDENTITY, vì deep-equal cho phép ai đó lặng lẽ fork một bản sao rỗng
 * rồi bồi cặp vào bản sao ấy.
 */
export interface RevealClassPair {
  readonly action: string;
  readonly resourceType: string;
}

/** ⛔ GIỮ RỖNG. Thêm phần tử = phải thoả ba điều kiện §6(5) + mở WO riêng. */
export const REVEAL_CLASS_PAIRS: readonly RevealClassPair[] = [];

/** DI token — string const (không Symbol) để `overrideProvider()` của int-spec dùng thẳng được. */
export const REVEAL_CLASS_PAIRS_TOKEN = "STEP_UP_REVEAL_CLASS_PAIRS";

export const revealClassPairsProvider: ValueProvider<readonly RevealClassPair[]> = {
  provide: REVEAL_CLASS_PAIRS_TOKEN,
  useValue: REVEAL_CLASS_PAIRS,
};

/**
 * Cặp có nằm trong registry không — so khớp CHÍNH XÁC CẢ HAI vế.
 *
 * KHÔNG có ký tự đại diện, KHÔNG so khớp tiền tố: một `startsWith` ở đây biến `employee_salary` thành
 * cửa mở cho mọi `employee_*`. Registry nhỏ (0 phần tử hôm nay) nên quét tuyến tính là đủ.
 */
export function isRevealClassPair(
  pairs: readonly RevealClassPair[],
  action: string,
  resourceType: string,
): boolean {
  return pairs.some((p) => p.action === action && p.resourceType === resourceType);
}
