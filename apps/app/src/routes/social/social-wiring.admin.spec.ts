/**
 * S16-SOCIAL-FE-3 / FE-3B — ca **W1** · **W4**: nối dây BA màn quản trị SOCIAL (`SOC-SCREEN-010` Kiểm duyệt ·
 * `SOC-SCREEN-012` Thiết lập huy hiệu · `SOC-SCREEN-011` Thống kê tương tác) — route và mục rail khai CÙNG một
 * cổng đủ-hết (W1), và `filterSidebarItems` ẩn / hiện mục rail đúng theo quyền (W4).
 *
 * Tách từ `social-wiring.spec.ts` ở S16-SOCIAL-FE-3C (finding AUD-SPEC400) — tách THUẦN, không đổi ca nào. Cùng họ:
 *  · `social-wiring.spec.ts` — registry + sidebar chung (C20 · R1 · R2 · R3 · C22 · S16-SOCIAL-FBPOST-1);
 *  · `social-wiring.router.spec.ts` — W3 (`router.tsx` nối đúng meta + route có trong cây, đọc NGUỒN).
 * Cổng đo trên đường dựng thật của router (G1 · G5 · G6) ở `admin/admin-route-gates.<màn>.spec.tsx`.
 */
import { describe, expect, it } from "vitest";
import { createPermissionChecker, filterSidebarItems, ROUTE_REGISTRY } from "@mediaos/web-core";
import type { SessionContext, UserPermission } from "@mediaos/web-core";
import { SOCIAL_SIDEBAR, SOCIAL_SIDEBAR_V2 } from "@/layouts/workspace/sidebar-registry";

const SOCIAL_ROUTES = ROUTE_REGISTRY.filter((r) => r.moduleCode === "SOCIAL");

// ---------------------------------------------------------------------------
// S16-SOCIAL-FE-3 (L2) — nối dây màn Kiểm duyệt `SOC-SCREEN-010` (plan D2 · D3 · ca W1 · W3 · W4)
// ---------------------------------------------------------------------------

/** Cặp của LỜI GỌI ĐẦU TIÊN của màn (028 gác `view:feed-report`) + cặp vào module. Viết tay. */
const MODERATION_GATE = ["view:feed", "view:feed-report"];

const OLD_RAIL_KEYS = [
  "social.feed",
  "social.news",
  "social.saved",
  "social.ideas",
  "social.polls",
  "social.kudos",
  "social.groups",
];

describe("W1 — `social.moderation`: route và mục rail khai CÙNG một cổng đủ-hết", () => {
  const route = SOCIAL_ROUTES.find((r) => r.routeKey === "social.moderation");
  const item = SOCIAL_SIDEBAR_V2.find((i) => i.sidebarKey === "social.moderation");

  it("route = `/feed/moderation` · SOC-SCREEN-010 · order 103 · đòi ĐỦ `view:feed` + `view:feed-report`", () => {
    expect(route).toMatchObject({
      path: "/feed/moderation",
      screenCode: "SOC-SCREEN-010",
      layout: "MODULE_PORTAL",
      order: 103,
      showInSidebar: true,
    });
    expect(route?.requiredPermissions).toEqual(MODERATION_GATE);
    // any-of ở route = vào được bằng MỘT trong hai cặp; phạm vi (Department) thì 028 tự xét.
    expect(route?.requiredAnyPermissions).toBeUndefined();
    expect(route?.requiredScopes).toBeUndefined();
  });

  it("mục rail trỏ ĐÚNG path của route, nhóm `management`, order 70, icon `shield-alert`", () => {
    expect(item).toMatchObject({
      moduleCode: "SOCIAL",
      label: "Kiểm duyệt",
      path: "/feed/moderation",
      group: "management",
      order: 70,
      icon: "shield-alert",
    });
    expect(item?.path).toBe(route?.path);
  });

  it("mục rail khai `requiredPermissions` Y HỆT route và KHÔNG khai `requiredAnyPermissions`", () => {
    // Chép khuôn any-of của 7 mục cũ (`[view:feed, view:feed-report]`) là MỌI nhân viên thấy mục
    // «Kiểm duyệt», bấm vào thì 403 (plan B2 · B25).
    expect(item?.requiredPermissions).toEqual(MODERATION_GATE);
    expect(item?.requiredPermissions).toEqual(route?.requiredPermissions);
    expect(item?.requiredAnyPermissions).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// S16-SOCIAL-FE-3B (L4) — nối dây màn Thiết lập huy hiệu `SOC-SCREEN-012` (plan D2 · D3 · ca W1 · W3 · W4)
// ---------------------------------------------------------------------------

/** Cặp của LỜI GỌI ĐẦU TIÊN của màn (056 gác `manage:feed-kudos`) + cặp vào module. Viết tay. */
const KUDOS_BADGES_GATE = ["view:feed", "manage:feed-kudos"];

describe("W1 — `social.kudosBadges`: route và mục rail khai CÙNG một cổng đủ-hết", () => {
  const route = SOCIAL_ROUTES.find((r) => r.routeKey === "social.kudosBadges");
  const item = SOCIAL_SIDEBAR_V2.find((i) => i.sidebarKey === "social.kudosBadges");

  it("route = `/feed/kudos-badges` · SOC-SCREEN-012 · order 105 · đòi ĐỦ `view:feed` + `manage:feed-kudos`", () => {
    expect(route).toMatchObject({
      path: "/feed/kudos-badges",
      screenCode: "SOC-SCREEN-012",
      layout: "MODULE_PORTAL",
      titleKey: "routeTitle.socialKudosBadges",
      order: 105,
      showInSidebar: true,
    });
    expect(route?.requiredPermissions).toEqual(KUDOS_BADGES_GATE);
    expect(route?.requiredAnyPermissions).toBeUndefined();
    expect(route?.requiredScopes).toBeUndefined();
  });

  it("đường dẫn KHÔNG nằm dưới `/feed/kudos/` — nếu có, luật «active» theo tiền tố làm «Vinh danh» sáng cùng lúc", () => {
    expect(route?.path).toBeDefined();
    expect(route?.path.startsWith("/feed/kudos/")).toBe(false);
  });

  it("mục rail trỏ ĐÚNG path của route, nhóm `settings`, order 90, icon `settings`", () => {
    expect(item).toMatchObject({
      moduleCode: "SOCIAL",
      label: "Thiết lập huy hiệu",
      path: "/feed/kudos-badges",
      group: "settings",
      order: 90,
      icon: "settings",
    });
    expect(item?.path).toBe(route?.path);
  });

  it("mục rail khai `requiredPermissions` Y HỆT route và KHÔNG khai `requiredAnyPermissions`", () => {
    // Chép khuôn any-of của 7 mục cũ là MỌI nhân viên thấy mục «Thiết lập huy hiệu», bấm vào thì trang
    // cấm (plan B2 · B25).
    expect(item?.requiredPermissions).toEqual(KUDOS_BADGES_GATE);
    expect(item?.requiredPermissions).toEqual(route?.requiredPermissions);
    expect(item?.requiredAnyPermissions).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// S16-SOCIAL-FE-3B (L5) — nối dây màn Thống kê tương tác `SOC-SCREEN-011` (plan D2 · D3 · ca W1 · W3 · W4)
// ---------------------------------------------------------------------------

/** Cặp của LỜI GỌI ĐẦU TIÊN của màn (052 gác `view:feed-report`) + cặp vào module. Viết tay. */
const STATS_GATE = ["view:feed", "view:feed-report"];

describe("W1 — `social.stats`: route và mục rail khai CÙNG một cổng đủ-hết", () => {
  const route = SOCIAL_ROUTES.find((r) => r.routeKey === "social.stats");
  const item = SOCIAL_SIDEBAR_V2.find((i) => i.sidebarKey === "social.stats");

  it("route = `/feed/stats` · SOC-SCREEN-011 · order 104 · đòi ĐỦ `view:feed` + `view:feed-report`", () => {
    expect(route).toMatchObject({
      path: "/feed/stats",
      screenCode: "SOC-SCREEN-011",
      layout: "MODULE_PORTAL",
      titleKey: "routeTitle.socialStats",
      order: 104,
      showInSidebar: true,
    });
    expect(route?.requiredPermissions).toEqual(STATS_GATE);
    expect(route?.requiredAnyPermissions).toBeUndefined();
    // Phạm vi đơn vị do 052 tự xét (ngoài phạm vi ⇒ 403 mang mã riêng, màn có lối «Bỏ lọc đơn vị»).
    expect(route?.requiredScopes).toBeUndefined();
  });

  it("mục rail trỏ ĐÚNG path của route, nhóm `report`, order 80, icon `bar-chart-3`", () => {
    expect(item).toMatchObject({
      moduleCode: "SOCIAL",
      label: "Thống kê tương tác",
      path: "/feed/stats",
      group: "report",
      order: 80,
      icon: "bar-chart-3",
    });
    expect(item?.path).toBe(route?.path);
  });

  it("mục rail khai `requiredPermissions` Y HỆT route và KHÔNG khai `requiredAnyPermissions`", () => {
    // Chép khuôn any-of của 7 mục cũ là MỌI nhân viên thấy mục «Thống kê tương tác», bấm vào thì trang
    // cấm (plan B2 · B25).
    expect(item?.requiredPermissions).toEqual(STATS_GATE);
    expect(item?.requiredPermissions).toEqual(route?.requiredPermissions);
    expect(item?.requiredAnyPermissions).toBeUndefined();
  });
});

describe("W4 — mục rail quản trị theo quyền (hành vi của `filterSidebarItems`)", () => {
  const SESSION: SessionContext = {
    status: "authenticated",
    user: null,
    company: null,
    modules: [{ moduleCode: "SOCIAL", status: "active" }],
  };

  function visibleKeys(pairs: readonly string[]): string[] {
    const granted: UserPermission[] = pairs.map((permission) => ({
      permission,
      scopes: ["Company"],
    }));
    return filterSidebarItems(SOCIAL_SIDEBAR, createPermissionChecker(granted), SESSION).map(
      (i) => i.sidebarKey,
    );
  }

  it("ALLOW — `view:feed` + `view:feed-report` (manager) ⇒ 7 mục cũ + «Kiểm duyệt» + «Thống kê tương tác»", () => {
    expect(visibleKeys(["view:feed", "view:feed-report"])).toEqual([
      ...OLD_RAIL_KEYS,
      "social.moderation",
      "social.stats",
    ]);
  });

  it("DENY — chỉ `view:feed` (nhân viên thường) ⇒ ĐÚNG 7 mục cũ, không có mục quản trị nào", () => {
    expect(visibleKeys(["view:feed"])).toEqual(OLD_RAIL_KEYS);
  });

  it("DENY — có `manage:feed-report` + `manage:feed-post` nhưng thiếu `view:feed-report` ⇒ không suy manage ⇒ view", () => {
    expect(visibleKeys(["view:feed", "manage:feed-report", "manage:feed-post"])).toEqual(
      OLD_RAIL_KEYS,
    );
  });

  it("DENY — chỉ `view:feed-report`, thiếu `view:feed` ⇒ không mục nào", () => {
    expect(visibleKeys(["view:feed-report"])).toEqual([]);
  });

  it("ALLOW — `view:feed` + `manage:feed-kudos` ⇒ 7 mục cũ + «Thiết lập huy hiệu» (KHÔNG có «Kiểm duyệt» / «Thống kê tương tác»)", () => {
    expect(visibleKeys(["view:feed", "manage:feed-kudos"])).toEqual([
      ...OLD_RAIL_KEYS,
      "social.kudosBadges",
    ]);
  });

  it("ALLOW — đủ cả ba cặp (HR / company-admin) ⇒ 7 mục cũ + «Kiểm duyệt» + «Thống kê tương tác» + «Thiết lập huy hiệu», đúng thứ tự", () => {
    expect(visibleKeys(["view:feed", "view:feed-report", "manage:feed-kudos"])).toEqual([
      ...OLD_RAIL_KEYS,
      "social.moderation",
      "social.stats",
      "social.kudosBadges",
    ]);
  });

  it("DENY — chỉ `manage:feed-kudos`, thiếu `view:feed` ⇒ không mục nào", () => {
    expect(visibleKeys(["manage:feed-kudos"])).toEqual([]);
  });

  it("DENY — chỉ wildcard `*:*` ⇒ không mục nào (khớp đúng-bằng)", () => {
    expect(visibleKeys(["*:*"])).toEqual([]);
  });
});
