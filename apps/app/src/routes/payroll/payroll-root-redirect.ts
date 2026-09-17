import type { SidebarItemMeta } from "@mediaos/web-core";

/**
 * S15-PAYROLL-FE-4 — `/payroll` là PAY-SCREEN-015 «Tổng quan» (SPEC-11 §9.1). Người KHÔNG giữ
 * `('view','payroll-report')` vào `/payroll` phải được **chuyển hướng tới màn đầu tiên họ mở được**, không thấy
 * trang 403 — kế toán chỉ lập kỳ lương vẫn bấm «Tiền lương» mà vào thẳng việc của mình.
 *
 * Hàm THUẦN (router chỉ tiêm `isAllowed`) để ca test không phải dựng store quyền.
 */

/** Đường dẫn các mục CÓ `path` theo đúng thứ tự hiển thị: sắp theo `order` từng cấp, cha trước con. */
export function sidebarLeafPaths(items: readonly SidebarItemMeta[]): string[] {
  return [...items]
    .sort((a, b) => a.order - b.order)
    .flatMap((item) => [
      ...(item.path !== undefined ? [item.path] : []),
      ...sidebarLeafPaths(item.children ?? []),
    ]);
}

/**
 * Lá đầu tiên (khác `exclude`) mà `isAllowed` cho qua; không lá nào ⇒ `null` (router giữ trang 403 như cũ —
 * không đẩy người dùng vòng vòng). `exclude` bắt buộc để không bao giờ tự chuyển hướng về chính `/payroll`.
 */
export function pickFirstAllowedPath(
  paths: readonly string[],
  isAllowed: (path: string) => boolean,
  exclude: string,
): string | null {
  for (const p of paths) {
    if (p !== exclude && isAllowed(p)) return p;
  }
  return null;
}
