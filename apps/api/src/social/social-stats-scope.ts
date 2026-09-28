import type { DataScope } from "@mediaos/contracts";

/**
 * S16-SOCIAL-BE-3B (plan D5) — phạm vi của thống kê tương tác `052`/`053`/widget, dạng dữ liệu thuần.
 *
 * `all` ⇒ mọi đơn vị + nhóm «chưa gán đơn vị» · `units` ⇒ ĐÚNG các đơn vị này (nhóm `null` bị loại) ·
 * `none` ⇒ không gì cả. Metadata `units` VÀ số liệu dựng từ CÙNG một giá trị trả về — không vị từ thứ hai.
 */
export type StatsScopeFilter =
  | { readonly kind: "all" }
  | { readonly kind: "units"; readonly ids: readonly string[] }
  | { readonly kind: "none" };

/**
 * 🔴 **`switch` VÉT CẠN — khuôn `SocialReportsRepository.scopeCondition`.** Ba route `view:feed-report`
 * tắt `companyFloor` để `manager@Department` lọt qua; tắt rồi thì MỌI scope mà grant resolve ra đều lọt,
 * kể cả `Own`/`Team` — hai giá trị SPEC-16 không định nghĩa cho cặp này. Viết
 * `scope === "Department" ? … : all` là trao số liệu CẢ CÔNG TY cho một grant `@Own` (fail-OPEN, im lặng).
 *
 * `Department` với tập đơn vị RỖNG ⇒ `none` (fail-closed, KHÔNG BAO GIỜ match-all). `Own`/`Team` ⇒ `none`,
 * KHÔNG ném: cấu hình quyền lạ không được biến thành 500 (khuôn ca `N-H3` của `028`).
 */
export function statsScopeFilter(
  scope: DataScope,
  orgUnitIds: readonly string[],
): StatsScopeFilter {
  switch (scope) {
    // N=1 single-tenant: `System` vẫn bị ghim ở CHÍNH tenant hiện tại bởi `company_id` của mọi câu.
    case "System":
    case "Company":
      return { kind: "all" };
    case "Department":
      return orgUnitIds.length > 0 ? { kind: "units", ids: [...orgUnitIds] } : { kind: "none" };
    case "Team":
    case "Own":
      return { kind: "none" };
    default:
      // Giá trị `DataScope` MỚI ⇒ fail-closed. `switch` vét cạn bắt ca đó lúc biên dịch; đây là lưới lúc chạy.
      return { kind: "none" };
  }
}
