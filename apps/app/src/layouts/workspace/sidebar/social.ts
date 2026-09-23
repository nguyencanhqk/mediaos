import { type SidebarItemMeta } from "@mediaos/web-core";
import { pruneUnbuiltScreens } from "./prune-unbuilt";

// ═══════════════════════════════════════════════════════════════════════════
// SOCIAL — sidebar v2 (S16-SOCIAL-FE-1 · D10 · SPEC-16 §9/§11/§14 · UI-07 §34b.6)
// ═══════════════════════════════════════════════════════════════════════════
//
// Khuôn y hệt `PAYROLL_SIDEBAR_V2` (S15-UI-SHELL-1): khai **ĐẦY ĐỦ 6 mục** của CẢ track A (FE-1,
// đang dựng) VÀ track B (FE-2, chưa dựng), rồi `pruneUnbuiltScreens` (D9) cắt mục chưa có route
// trước khi đăng ký vào `SIDEBAR_REGISTRY`. Mục nào có route sống trong `ROUTE_REGISTRY` thì hiện,
// mục nào chưa thì tự ẩn — WO track B sau chỉ cần thêm route là mục tự xuất hiện, không phải quay
// lại sửa file này lần nữa (đúng lời hứa UI-07 §34b.6: "mục chưa có màn tự ẩn").
//
// Track A (S16-SOCIAL-FE-1 — 3 mục đầu): Bảng tin `/feed` (SOC-SCREEN-001) · Tin tức `/feed/news`
// (SOC-SCREEN-003) · Đã lưu `/feed/saved` (SOC-SCREEN-004).
// Track B (S16-SOCIAL-FE-2 — 3 mục sau, CHƯA có route ở WO này): Sáng kiến `/feed/ideas` · Bình chọn
// `/feed/polls` · Nhóm `/feed/groups`.
//
// Gate: TẤT CẢ 6 mục dùng `requiredAnyPermissions: ["view:feed"]` (SPEC-16 §5.2 — chỉ cần vào được
// module là thấy mục điều hướng; gate CHẶT hơn cho từng hành động nằm BÊN TRONG từng màn, ví dụ
// «Danh sách đã đọc» của Tin tức đòi `manage:feed-news`). Cặp `view:feed` là cặp THẬT trong seed
// `0578` — KHÔNG bịa cặp khác (SPEC-16 §11.2: thích/lưu/xem/đọc KHÔNG có cặp riêng, chỉ theo
// `view:feed` + sở hữu hàng). Mọi mục ở đây PHẢI có `requiredPermissions`/`requiredAnyPermissions`,
// nếu không sẽ lọt "Test 3" của `sidebar-registry.snapshot.spec.ts` ("không quyền nào ⇒ mọi module
// rỗng") — mục không đòi gì thì luôn `allowed: true`.
//
// «Trang cá nhân» (SOC-SCREEN-005, `/feed/profiles/$employeeId` · `/feed/profiles/me`) KHÔNG có mặt
// ở đây: nó không phải một mục điều hướng module-level, mà là link từ thẻ danh tính trong
// `PortalLeftRail` (D11) + 2 mục riêng ở `ME_SIDEBAR` («Bài viết của tôi»/«Đã lưu», W5) — khác PAYROLL,
// vì dữ liệu-của-chính-mình không nằm sau cổng module (`personal-prefs-must-not-sit-behind-permission-gate`).

/** Cấu trúc ĐẦY ĐỦ của sidebar SOCIAL v2 — gồm cả mục track B chưa dựng (bị cắt lúc đăng ký). */
export const SOCIAL_SIDEBAR_V2: readonly SidebarItemMeta[] = [
  {
    // SOC-SCREEN-001
    sidebarKey: "social.feed",
    moduleCode: "SOCIAL",
    label: "Bảng tin",
    path: "/feed",
    icon: "rss",
    group: "overview",
    order: 10,
    requiredAnyPermissions: ["view:feed"],
  },
  {
    // SOC-SCREEN-003
    sidebarKey: "social.news",
    moduleCode: "SOCIAL",
    label: "Tin tức",
    path: "/feed/news",
    icon: "megaphone",
    group: "overview",
    order: 20,
    requiredAnyPermissions: ["view:feed"],
  },
  {
    // SOC-SCREEN-004
    sidebarKey: "social.saved",
    moduleCode: "SOCIAL",
    label: "Đã lưu",
    path: "/feed/saved",
    icon: "bookmark",
    group: "overview",
    order: 30,
    requiredAnyPermissions: ["view:feed"],
  },

  // ── Track B (S16-SOCIAL-FE-2) — CHƯA có route ở WO này ⇒ tự ẩn qua pruneUnbuiltScreens ─────────
  {
    sidebarKey: "social.ideas",
    moduleCode: "SOCIAL",
    label: "Sáng kiến",
    path: "/feed/ideas",
    icon: "lightbulb",
    group: "operation",
    order: 40,
    requiredAnyPermissions: ["view:feed"],
  },
  {
    sidebarKey: "social.polls",
    moduleCode: "SOCIAL",
    label: "Bình chọn",
    path: "/feed/polls",
    icon: "vote",
    group: "operation",
    order: 50,
    requiredAnyPermissions: ["view:feed"],
  },
  {
    sidebarKey: "social.groups",
    moduleCode: "SOCIAL",
    label: "Nhóm",
    path: "/feed/groups",
    icon: "users",
    group: "operation",
    order: 60,
    requiredAnyPermissions: ["view:feed"],
  },
];

/**
 * Bản ĐĂNG KÝ = cấu trúc v2 đã cắt mục chưa có màn. Ở S16-SOCIAL-FE-1 chỉ 3 mục track A còn lại (route
 * `/feed*` được đăng ký ở T4); 3 mục track B tự ẩn cho tới khi S16-SOCIAL-FE-2 thêm route tương ứng.
 */
export const SOCIAL_SIDEBAR: readonly SidebarItemMeta[] = pruneUnbuiltScreens(SOCIAL_SIDEBAR_V2);
