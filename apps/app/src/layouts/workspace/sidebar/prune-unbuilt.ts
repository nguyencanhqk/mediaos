import { ROUTE_REGISTRY, type SidebarItemMeta } from "@mediaos/web-core";

// ═══════════════════════════════════════════════════════════════════════════
// pruneUnbuiltScreens — dùng CHUNG cho mọi module khai sidebar "đủ trước, xây sau"
// (S15-UI-SHELL-2 PAYROLL · S16-SOCIAL-FE-1 D9)
// ═══════════════════════════════════════════════════════════════════════════
//
// TÁCH ra khỏi `payroll.ts`: SOCIAL là module THỨ HAI cần hàm này — `social.ts` (D10) khai đủ 6 mục
// track A+B rồi cũng cắt mục chưa có route y hệt PAYROLL. Để nguyên hàm trong `payroll.ts` thì
// `social.ts` phải import từ file của MỘT MODULE KHÁC — phụ thuộc chéo vô nghĩa, đọc code sẽ tưởng
// SOCIAL phụ thuộc PAYROLL. Copy nguyên hàm sang `social.ts` thì vi phạm DRY và hai bản chắc chắn
// trôi theo thời gian (một bên sửa, một bên quên).
//
// `payroll.ts` vẫn `export { pruneUnbuiltScreens }` lại (re-export) để đường import công khai cũ
// (`from "./sidebar/payroll"`) không chết; barrel (`sidebar-registry.ts`) đổi sang import THẲNG từ
// file này.

/**
 * Cắt mục CHƯA có màn: lá trỏ tới `path` không có trong `ROUTE_REGISTRY` thì bỏ; hàng đại diện nhóm
 * (không có `path` riêng) mất hết con thì cũng bỏ — một chevron mở ra chỗ trống còn tệ hơn link chết
 * vì nó không báo lỗi gì cả.
 */
export function pruneUnbuiltScreens(items: readonly SidebarItemMeta[]): SidebarItemMeta[] {
  const built = new Set(ROUTE_REGISTRY.map((r) => r.path));
  return items.flatMap((item): SidebarItemMeta[] => {
    const children = item.children ? pruneUnbuiltScreens(item.children) : undefined;
    const selfBuilt = item.path !== undefined && built.has(item.path);
    const hasBuiltChildren = Boolean(children?.length);

    // Không màn của mình, cũng không còn con nào ⇒ không còn gì để dẫn tới.
    if (!selfBuilt && !hasBuiltChildren) return [];

    /**
     * **Node LAI** (có `path` riêng VÀ có con) mà màn của CHÍNH nó chưa dựng, nhưng con thì đã có:
     * HẠ xuống thành hàng đại diện nhóm (bỏ `path`) — KHÔNG vứt cả nhánh.
     *
     * Bản đầu `return []` ngay khi `path` chưa dựng, nên một node lai sẽ nuốt luôn mọi mục con ĐÃ
     * chạy được, **im lặng**: không link chết, không chevron rỗng, cả nhánh chỉ đơn giản biến mất.
     * Nó cũng phá đúng lời hứa của hàm này («WO sau chỉ cần thêm route là mục tự hiện»). Chưa dữ
     * liệu nào chạm phải — `PAYROLL_SIDEBAR_V2` giữ hàng nhóm không `path` và mục lá không con —
     * nhưng kiểu dữ liệu cho phép, và các WO PAYROLL sau chính là nơi hình dạng đó dễ xuất hiện.
     */
    const base = selfBuilt ? item : { ...item, path: undefined };
    return [children ? { ...base, children } : { ...base }];
  });
}
