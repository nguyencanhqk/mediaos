import { type SidebarItemMeta } from "@mediaos/web-core";
import { pruneUnbuiltScreens } from "./prune-unbuilt";

// ═══════════════════════════════════════════════════════════════════════════
// SOCIAL — sidebar v2 (S16-SOCIAL-FE-1 · D10 · SPEC-16 §9/§11/§14 · UI-07 §34b.6)
// ═══════════════════════════════════════════════════════════════════════════
//
// Khuôn y hệt `PAYROLL_SIDEBAR_V2` (S15-UI-SHELL-1): khai **ĐẦY ĐỦ các mục** của track A (FE-1),
// track B (FE-2/2B/2C) và track C (FE-3), rồi `pruneUnbuiltScreens` (D9) cắt mục chưa có route
// trước khi đăng ký vào `SIDEBAR_REGISTRY`. Mục nào có route sống trong `ROUTE_REGISTRY` thì hiện,
// mục nào chưa thì tự ẩn — WO track B sau chỉ cần thêm route là mục tự xuất hiện, không phải quay
// lại sửa file này lần nữa (đúng lời hứa UI-07 §34b.6: "mục chưa có màn tự ẩn").
//
// Track A (S16-SOCIAL-FE-1 — 3 mục đầu): Bảng tin `/feed` (SOC-SCREEN-001) · Tin tức `/feed/news`
// (SOC-SCREEN-003) · Đã lưu `/feed/saved` (SOC-SCREEN-004).
// Track B (S16-SOCIAL-FE-2/2B/2C — 4 mục sau): Sáng kiến `/feed/ideas` · Bình chọn `/feed/polls` ·
// Vinh danh `/feed/kudos` (FE-2C, owner ký O2 — UI-07 rail trái không liệt kê, chấp nhận lệch) · Nhóm
// `/feed/groups`.
// Track C (S16-SOCIAL-FE-3/3B — màn quản trị, owner ký O2 = a): Kiểm duyệt `/feed/moderation`
// (SOC-SCREEN-010) · Thiết lập huy hiệu `/feed/kudos-badges` (SOC-SCREEN-012).
//
// Gate — HAI khuôn, đừng chép nhầm:
//  · 7 mục track A/B dùng `requiredAnyPermissions: ["view:feed"]` (SPEC-16 §5.2 — chỉ cần vào được
//    module là thấy mục điều hướng; gate CHẶT hơn cho từng hành động nằm BÊN TRONG từng màn, ví dụ
//    «Danh sách đã đọc» của Tin tức đòi `manage:feed-news`). Cặp `view:feed` là cặp THẬT trong seed
//    `0578` — KHÔNG bịa cặp khác (SPEC-16 §11.2: thích/lưu/xem/đọc KHÔNG có cặp riêng, chỉ theo
//    `view:feed` + sở hữu hàng).
//  · Mục track C dùng `requiredPermissions` (ĐỦ-HẾT) với ĐÚNG cặp của route nó trỏ tới. 🔴 Chép khuôn
//    any-of ở trên thành `[view:feed, view:feed-report]` là MỌI nhân viên thấy mục «Kiểm duyệt» (hay
//    «Thiết lập huy hiệu»), bấm vào thì trang cấm (SPEC-16 §14: forbidden = ẩn mục). `social-wiring.spec.ts` (ca W1 · W4) ghim.
// Mọi mục ở đây PHẢI có `requiredPermissions`/`requiredAnyPermissions`, nếu không sẽ lọt ca «không
// quyền nào ⇒ mọi module rỗng» của `sidebar-registry.snapshot.spec.ts` — mục không đòi gì thì luôn
// `allowed: true`.
//
// «Trang cá nhân» (SOC-SCREEN-005, `/feed/profiles/$employeeId` · `/feed/profiles/me`) KHÔNG có mặt
// ở đây: nó không phải một mục điều hướng module-level, mà là link từ thẻ danh tính trong
// `PortalLeftRail` (D11) + 2 mục riêng ở `ME_SIDEBAR` («Bài viết của tôi»/«Đã lưu», W5) — khác PAYROLL,
// vì dữ liệu-của-chính-mình không nằm sau cổng module (`personal-prefs-must-not-sit-behind-permission-gate`).

/** Cấu trúc ĐẦY ĐỦ của sidebar SOCIAL v2 — mục nào chưa có route thì bị cắt lúc đăng ký. */
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

  // ── Track B (S16-SOCIAL-FE-2/2B/2C) ────────────────────────────────────────────────────────────
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
    // SOC-SCREEN-009 — S16-SOCIAL-FE-2C (owner ký O2).
    sidebarKey: "social.kudos",
    moduleCode: "SOCIAL",
    label: "Vinh danh",
    path: "/feed/kudos",
    icon: "award",
    group: "operation",
    order: 55,
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

  // ── Track C (S16-SOCIAL-FE-3) — màn quản trị: cổng ĐỦ-HẾT, y hệt route ──────────────────────────
  {
    // SOC-SCREEN-010 — owner ký O2 = a (UI-07 rail trái không liệt kê, chấp nhận lệch).
    sidebarKey: "social.moderation",
    moduleCode: "SOCIAL",
    label: "Kiểm duyệt",
    path: "/feed/moderation",
    icon: "shield-alert",
    group: "management",
    order: 70,
    requiredPermissions: ["view:feed", "view:feed-report"],
  },
  {
    // SOC-SCREEN-012 — S16-SOCIAL-FE-3B, owner ký O2 = a.
    sidebarKey: "social.kudosBadges",
    moduleCode: "SOCIAL",
    label: "Thiết lập huy hiệu",
    path: "/feed/kudos-badges",
    icon: "settings",
    group: "settings",
    order: 90,
    requiredPermissions: ["view:feed", "manage:feed-kudos"],
  },
];

/**
 * Bản ĐĂNG KÝ = cấu trúc v2 đã cắt mục chưa có màn. Hiện cả 9 mục đều đã có route trong
 * `ROUTE_REGISTRY` nên không mục nào bị cắt; hàm cắt vẫn chạy để một mục khai trước màn (hoặc một
 * `path` gõ sai) tự ẩn thay vì thành link chết.
 */
export const SOCIAL_SIDEBAR: readonly SidebarItemMeta[] = pruneUnbuiltScreens(SOCIAL_SIDEBAR_V2);
