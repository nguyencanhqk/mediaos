import { type NavItem } from "@mediaos/web-core";

/**
 * NAV registry của apps/web — Wave 2 FE-split ĐÃ XONG: mọi nav item nghiệp vụ đã dời sang app riêng
 * (`hr`/`attendance`/`payroll`→apps/people, `work`/`process`/`goals`→apps/studio, `system`→apps/console).
 * apps/web giờ chỉ còn trang chủ launcher rỗng; Wave 3 (FS-cutover) sẽ XOÁ apps/web.
 *
 * Types + danh mục category + helper gom nhóm vẫn đến từ @mediaos/web-core (dùng chung mọi app).
 */
export {
  NAV_CATEGORIES,
  navItemsByCategory,
  type NavCategory,
  type NavItem,
  type NavCategoryMeta,
} from "@mediaos/web-core";

export const NAV_ITEMS: readonly NavItem[] = [];
