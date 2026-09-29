/**
 * S16-SOCIAL-FE-1 — ca **C20**: nối dây điều hướng SOCIAL (chống link chết + chống hở cổng).
 *
 * ┌─ 🔴 VÌ SAO CA NÀY TỒN TẠI, VÀ VÌ SAO NÓ PHẢI PHỦ CẢ `ME_SIDEBAR` ────────────────────────────┐
 * │ `SOCIAL_SIDEBAR` đi qua `pruneUnbuiltScreens`, nên một mục trỏ vào đường chưa dựng sẽ **tự ẩn** │
 * │ — ở đó link chết gần như không xảy ra được.                                                    │
 * │ `ME_SIDEBAR` thì **KHÔNG** đi qua hàm đó (`sidebar-registry.ts` chỉ bọc PAYROLL và SOCIAL).     │
 * │ Hai mục ME mới (`me.feed.mine` → `/feed/profiles/me`, `me.feed.saved` → `/feed/saved`) vì vậy   │
 * │ **không có lưới nào đỡ**: gõ sai một ký tự trong `path` là một mục hiện ra với MỌI người có     │
 * │ `view:feed` và bấm vào thì 404 — không cổng nào khác trong kho bắt được.                        │
 * │ Đó chính là lỗi mà plan-reviewer bắt được ở bản plan đầu (finding #2). Ca này là lưới cho nó.   │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from "vitest";
import { APP_REGISTRY, ROUTE_REGISTRY } from "@mediaos/web-core";
import type { SidebarItemMeta } from "@mediaos/web-core";
import {
  ME_SIDEBAR,
  SOCIAL_SIDEBAR,
  SOCIAL_SIDEBAR_V2,
} from "@/layouts/workspace/sidebar-registry";
import { getSidebarExtension } from "@/layouts/workspace/sidebar-extensions";

const BUILT_PATHS = new Set(ROUTE_REGISTRY.map((r) => r.path));
const SOCIAL_ROUTES = ROUTE_REGISTRY.filter((r) => r.moduleCode === "SOCIAL");

/** Duyệt đệ quy vì `SidebarItemMeta` cho phép `children` (hôm nay SOCIAL phẳng, mai thì chưa chắc). */
function flatten(items: readonly SidebarItemMeta[]): SidebarItemMeta[] {
  return items.flatMap((i) => [i, ...(i.children ? flatten(i.children) : [])]);
}

describe("C20 — mọi mục sidebar SOCIAL trỏ tới route CÓ THẬT", () => {
  it("SOCIAL_SIDEBAR (đã prune) không có mục nào trỏ vào đường chưa dựng", () => {
    const dead = flatten(SOCIAL_SIDEBAR)
      .filter((i) => i.path !== undefined)
      .filter((i) => !BUILT_PATHS.has(i.path!));
    expect(dead.map((i) => `${i.sidebarKey} → ${i.path}`)).toEqual([]);
  });

  it("S16-SOCIAL-FE-2B R2: ĐỦ 6 mục V2 đã có màn ⇒ bản đăng ký = V2 (gồm «Nhóm»)", () => {
    /**
     * Lát B dựng màn cuối cùng (`/feed/groups`) ⇒ ở SOCIAL không còn mục nào để cắt, nên ca này KHÔNG
     * còn chứng minh được `pruneUnbuiltScreens` có cắt thật. Vế «cắt thật» chuyển sang
     * `layouts/workspace/sidebar/prune-unbuilt.spec.ts` (mục giả trỏ đường chưa dựng — plan FE-2B D19).
     */
    expect(SOCIAL_SIDEBAR_V2).toHaveLength(6);
    expect(SOCIAL_SIDEBAR.map((i) => i.sidebarKey)).toEqual([
      "social.feed",
      "social.news",
      "social.saved",
      "social.ideas",
      "social.polls",
      "social.groups",
    ]);
  });
});

describe("C20 — hai mục ME mới KHÔNG được là link chết (không có prune che)", () => {
  const ME_FEED_KEYS = ["me.feed.mine", "me.feed.saved"] as const;

  it.each(ME_FEED_KEYS)("%s có `path` tồn tại trong ROUTE_REGISTRY", (key) => {
    const item = flatten(ME_SIDEBAR).find((i) => i.sidebarKey === key);
    expect(item, `thiếu mục ${key} trong ME_SIDEBAR`).toBeDefined();
    expect(item!.path, `${key} không khai path`).toBeDefined();
    expect(BUILT_PATHS.has(item!.path!), `${key} trỏ tới ${item!.path} — route KHÔNG tồn tại`).toBe(
      true,
    );
  });

  it.each(ME_FEED_KEYS)("%s gác bằng ĐÚNG `view:feed` (không bịa cặp, không bỏ trống)", (key) => {
    const item = flatten(ME_SIDEBAR).find((i) => i.sidebarKey === key)!;
    // Mục không đòi quyền nào sẽ lọt cổng "không quyền nào ⇒ mọi module rỗng" của snapshot spec.
    expect(item.requiredAnyPermissions).toEqual(["view:feed"]);
  });

  it("«Bài viết của tôi» trỏ route TĨNH, KHÔNG phải placeholder động", () => {
    /**
     * `SidebarItemMeta` không có `onClick` nên không thể giải một placeholder lúc bấm; và `"me"`
     * không phải UUID nên không lọt nhánh `$employeeId`. Ghim chuỗi đúng để một lần "dọn cho nhất
     * quán với các mục khác" không lặng lẽ dựng lại link chết.
     */
    const item = flatten(ME_SIDEBAR).find((i) => i.sidebarKey === "me.feed.mine")!;
    expect(item.path).toBe("/feed/profiles/me");
    expect(item.path).not.toContain("$");
  });
});

describe("C20 / R1 / R2 — cổng quyền của 10 route SOCIAL (6 FE-1 + 2 FE-2 lát A + 2 FE-2B lát B)", () => {
  it("đủ 10 route và KHÔNG route nào `isPublic`", () => {
    expect(SOCIAL_ROUTES).toHaveLength(10);
    expect(SOCIAL_ROUTES.filter((r) => r.isPublic)).toEqual([]);
  });

  it("MỌI route SOCIAL đòi `view:feed`", () => {
    for (const r of SOCIAL_ROUTES) {
      expect(r.requiredPermissions, `route ${r.routeKey} thiếu requiredPermissions`).toContain(
        "view:feed",
      );
    }
  });

  it("cả 10 khai `layout: MODULE_PORTAL` — nhánh này KHÔNG còn trơ (plan D3)", () => {
    // `buildModuleRouteContent` dispatch qua `LAYOUT_CONTENT_BUILDERS` (Record vét cạn), nên giá trị
    // này QUYẾT ĐỊNH khung được dựng. Khai nhầm `MODULE_WORKSPACE` ⇒ portal mất hai rail, im lặng.
    for (const r of SOCIAL_ROUTES) {
      expect(r.layout, `route ${r.routeKey} khai layout sai`).toBe("MODULE_PORTAL");
    }
  });

  it("KHÔNG route SOCIAL nào chiếm `/social` (đường SSO fbpost giữ nguyên — plan D1/R11)", () => {
    for (const r of SOCIAL_ROUTES) {
      expect(r.path.startsWith("/feed"), `route ${r.routeKey} phải nằm dưới /feed`).toBe(true);
    }
  });

  it("chỉ 6 route danh sách hiện trên sidebar; route động (chi tiết bài/nhóm) và `me` thì không", () => {
    const inSidebar = SOCIAL_ROUTES.filter((r) => r.showInSidebar).map((r) => r.routeKey);
    expect(inSidebar.sort()).toEqual([
      "social.feed",
      "social.groups",
      "social.ideas",
      "social.news",
      "social.polls",
      "social.saved",
    ]);
  });

  it("R2 — `/feed/groups` + `/feed/groups/$groupId` = SOC-SCREEN-006, gate ĐÚNG `view:feed`", () => {
    // Vế phân quyền thật của nhóm là VAI TRÒ HÀNG (SOC-DEC-006) gác trong màn — nâng gate route lên
    // một cặp `feed-group` là khoá cả màn với người lẽ ra đọc được nhóm public.
    const byKey = new Map(SOCIAL_ROUTES.map((r) => [r.routeKey, r]));
    expect(byKey.get("social.groups")).toMatchObject({
      path: "/feed/groups",
      screenCode: "SOC-SCREEN-006",
      requiredPermissions: ["view:feed"],
      showInSidebar: true,
    });
    expect(byKey.get("social.groupDetail")).toMatchObject({
      path: "/feed/groups/$groupId",
      screenCode: "SOC-SCREEN-006",
      requiredPermissions: ["view:feed"],
    });
    expect(byKey.get("social.groupDetail")?.showInSidebar).toBeFalsy();
  });

  it("R1 — `/feed/polls` = SOC-SCREEN-007, `/feed/ideas` = SOC-SCREEN-008, gate ĐÚNG `view:feed`", () => {
    const byKey = new Map(SOCIAL_ROUTES.map((r) => [r.routeKey, r]));
    expect(byKey.get("social.polls")).toMatchObject({
      path: "/feed/polls",
      screenCode: "SOC-SCREEN-007",
      requiredPermissions: ["view:feed"],
    });
    expect(byKey.get("social.ideas")).toMatchObject({
      path: "/feed/ideas",
      screenCode: "SOC-SCREEN-008",
      requiredPermissions: ["view:feed"],
    });
  });
});

/**
 * C22 — vế FE của cặp ghim `route` ↔ `defaultRoute`.
 *
 * ⚠️ Đây **không** phải phép kiểm chéo gói: `MODULE_APP_METADATA` sống ở `apps/api` và `apps/app`
 * không import được nó. Vế kia nằm ở `apps/api/test/foundation/module-app-metadata-ratchet.unit-spec.ts`
 * — đọc docblock ở đó để biết chính xác cặp ghim này bắt được gì và KHÔNG bắt được gì.
 */
describe("C22 — tile Home SOCIAL (D13: HAI tile, không một)", () => {
  const social = APP_REGISTRY.find((a) => a.appKey === "social");
  const fbpost = APP_REGISTRY.find((a) => a.appKey === "fbpost");

  it("tile `social` trỏ `/feed` và gác bằng `view:feed`", () => {
    expect(social?.defaultRoute).toBe("/feed");
    expect(social?.rootPath).toBe("/feed");
    expect(social?.requiredAnyPermissions).toEqual(["view:feed"]);
  });

  it("tile `fbpost` TỒN TẠI, giữ `/social` + `view:social-post`", () => {
    /**
     * 🔴 Ca này chặn một HỒI QUY cụ thể, không phải một chi tiết trang trí: nếu ai đó "dọn" tile
     * thứ hai đi (nó trông thừa vì cùng `moduleCode: SOCIAL`), người **chỉ** có `view:social-post`
     * sẽ MẤT ô Home — đúng "cửa sổ tile chết" mà `done_when` của `S16-SOCIAL-FBPOST-1` cấm tái tạo.
     */
    expect(fbpost, "tile fbpost bị gỡ — người fbpost-only sẽ mất ô Home").toBeDefined();
    expect(fbpost?.defaultRoute).toBe("/social");
    expect(fbpost?.requiredAnyPermissions).toEqual(["view:social-post"]);
    expect(fbpost?.moduleCode).toBe("SOCIAL");
  });

  it("hai tile KHÁC TÊN (không phải hai ô trùng tên trên Home)", () => {
    expect(social?.nameKey).not.toBe(fbpost?.nameKey);
  });

  it("`order` của APP_REGISTRY vẫn TĂNG DẦN theo vị trí mảng", () => {
    // `registry.spec.ts` đã có ca này, nhưng nhắc lại ở đây vì tile `fbpost` (order 90.5) PHẢI nằm
    // vật lý giữa `social`(90) và `assets`(100) — đẩy xuống cuối mảng là đỏ.
    const orders = APP_REGISTRY.map((a) => a.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});

// ---------------------------------------------------------------------------
// S16-SOCIAL-FBPOST-1 — «Đăng bài Facebook» chuyển từ ô Home → mục rail SOCIAL
// ---------------------------------------------------------------------------

describe("S16-SOCIAL-FBPOST-1 — mục rail đăng ký đúng chỗ", () => {
  it("module SOCIAL CÓ extension sidebar (mục «Đăng bài Facebook» render SAU các group tĩnh)", () => {
    expect(getSidebarExtension("SOCIAL")).toBeTypeOf("function");
  });

  it("KHÔNG thêm mục tĩnh nào vào SOCIAL_SIDEBAR_V2 — liên kết NGOÀI không đi qua <Link>", () => {
    // Nếu ai đó "dọn" mục này thành SidebarItemMeta thì nó thành <Link to="..."> nội bộ ⇒ bấm vào
    // không lấy token SSO, và hai snapshot sidebar-tree.*.txt cũng đổi. Ca này giữ hợp đồng đó.
    expect(SOCIAL_SIDEBAR_V2.some((i) => i.sidebarKey.includes("fbpost"))).toBe(false);
    expect(SOCIAL_SIDEBAR_V2.every((i) => i.path?.startsWith("/feed"))).toBe(true);
  });
});
