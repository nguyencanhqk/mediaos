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
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_REGISTRY,
  createPermissionChecker,
  filterSidebarItems,
  ROUTE_REGISTRY,
} from "@mediaos/web-core";
import type { SessionContext, SidebarItemMeta, UserPermission } from "@mediaos/web-core";
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

  it("S16-SOCIAL-FE-3: ĐỦ 8 mục V2 đã có màn ⇒ bản đăng ký = V2 («Kiểm duyệt» đứng CUỐI, sau Nhóm)", () => {
    /**
     * Lát B dựng màn cuối cùng (`/feed/groups`) ⇒ ở SOCIAL không còn mục nào để cắt, nên ca này KHÔNG
     * còn chứng minh được `pruneUnbuiltScreens` có cắt thật. Vế «cắt thật» chuyển sang
     * `layouts/workspace/sidebar/prune-unbuilt.spec.ts` (mục giả trỏ đường chưa dựng — plan FE-2B D19).
     */
    // Thứ tự VIẾT TAY. «Kiểm duyệt» sai một ký tự ở `path` là `pruneUnbuiltScreens` cắt nó IM LẶNG
    // (plan B3) ⇒ mảng dưới còn 7 khoá và ca này đỏ.
    expect(SOCIAL_SIDEBAR_V2).toHaveLength(8);
    expect(SOCIAL_SIDEBAR.map((i) => i.sidebarKey)).toEqual([
      "social.feed",
      "social.news",
      "social.saved",
      "social.ideas",
      "social.polls",
      "social.kudos",
      "social.groups",
      "social.moderation",
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

describe("C20 / R1 / R2 / R3 — cổng quyền của 12 route SOCIAL (6 FE-1 + 2 FE-2 lát A + 2 FE-2B + 1 FE-2C + 1 FE-3)", () => {
  it("đủ 12 route và KHÔNG route nào `isPublic`", () => {
    expect(SOCIAL_ROUTES).toHaveLength(12);
    expect(SOCIAL_ROUTES.filter((r) => r.isPublic)).toEqual([]);
  });

  it("MỌI route SOCIAL đòi `view:feed`", () => {
    for (const r of SOCIAL_ROUTES) {
      expect(r.requiredPermissions, `route ${r.routeKey} thiếu requiredPermissions`).toContain(
        "view:feed",
      );
    }
  });

  it("cả 12 khai `layout: MODULE_PORTAL` — nhánh này KHÔNG còn trơ (plan D3)", () => {
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

  it("chỉ 8 route danh sách hiện trên sidebar; route động (chi tiết bài/nhóm) và `me` thì không", () => {
    const inSidebar = SOCIAL_ROUTES.filter((r) => r.showInSidebar).map((r) => r.routeKey);
    expect(inSidebar.sort()).toEqual([
      "social.feed",
      "social.groups",
      "social.ideas",
      "social.kudos",
      "social.moderation",
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

  it("R3 — `/feed/kudos` = SOC-SCREEN-009, gate ĐÚNG `view:feed` (cặp kudos gác TRONG composer)", () => {
    const byKey = new Map(SOCIAL_ROUTES.map((r) => [r.routeKey, r]));
    expect(byKey.get("social.kudos")).toMatchObject({
      path: "/feed/kudos",
      screenCode: "SOC-SCREEN-009",
      requiredPermissions: ["view:feed"],
      layout: "MODULE_PORTAL",
      showInSidebar: true,
    });
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

describe("W4 — mục rail «Kiểm duyệt» theo quyền (hành vi của `filterSidebarItems`)", () => {
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

  it("ALLOW — `view:feed` + `view:feed-report` ⇒ 7 mục cũ + «Kiểm duyệt»", () => {
    expect(visibleKeys(["view:feed", "view:feed-report"])).toEqual([
      ...OLD_RAIL_KEYS,
      "social.moderation",
    ]);
  });

  it("DENY — chỉ `view:feed` (nhân viên thường) ⇒ ĐÚNG 7 mục cũ, không có «Kiểm duyệt»", () => {
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
});

describe("W3 — `router.tsx` nối ĐÚNG meta và lắp route vào cây (đọc NGUỒN)", () => {
  /**
   * `path` và `getMeta("…")` trong `router.tsx` là hai literal RỜI: route `/feed/moderation` dựng bằng
   * meta của màn khác thì gác bằng cổng của màn khác — không ca render nào thấy (plan B26). Kho không có
   * spec dựng cây route thật ⇒ đọc nguồn, theo khuôn `asset-wiring.spec.ts`.
   */
  const routerSrc = fs
    .readFileSync(path.resolve(__dirname, "../../router.tsx"), "utf8")
    .replaceAll("\r\n", "\n");
  const tree = routerSrc.slice(routerSrc.indexOf("rootRoute.addChildren(["));

  /** Mọi khối `const X = createRoute({ … });` của nguồn: tên hằng + thân. */
  const routeBlocks = [
    ...routerSrc.matchAll(/const (\w+) = createRoute\(\{\n([\s\S]*?)\n\}\);/g),
  ].map((m) => ({ name: m[1] ?? "", body: m[2] ?? "" }));
  const blocksWith = (needle: string) => routeBlocks.filter((b) => b.body.includes(needle));
  const inTree = (name: string): boolean => name !== "" && tree.includes(`\n  ${name},\n`);

  it("đối chứng cho phép đo: route `/feed/kudos` có sẵn đọc ra đúng tên + meta + có trong cây", () => {
    // Regex đọc nguồn mà trượt thì các ca dưới đỏ vì LÝ DO KHÁC; ca này tách hai chuyện đó ra.
    const blocks = blocksWith('path: "/feed/kudos",');
    expect(blocks.map((b) => b.name)).toEqual(["feedKudosRoute"]);
    expect(blocks[0]?.body).toContain("buildModuleRouteContent(feedKudosMeta,");
    expect(inTree("feedKudosRoute")).toBe(true);
    expect(inTree("khongCoRouteNay")).toBe(false);
  });

  it('đúng MỘT khối có `path: "/feed/moderation"`, dựng bằng `getMeta("social.moderation")` + validator của màn', () => {
    const blocks = blocksWith('path: "/feed/moderation",');
    expect(blocks).toHaveLength(1);
    const body = blocks[0]?.body ?? "";

    const metaVar = /buildModuleRouteContent\((\w+), "SOCIAL", <ModerationPage \/>\)/.exec(
      body,
    )?.[1];
    // `toMatch` trên `undefined` ném TypeError và nuốt mất thông điệp viết tay ⇒ hỏi «có không» trước.
    expect(
      metaVar,
      "khối route không dựng <ModerationPage /> qua buildModuleRouteContent",
    ).toBeDefined();
    expect(metaVar).toMatch(/^\w+$/);
    expect(routerSrc).toContain(`const ${metaVar} = getMeta("social.moderation");`);
    expect(body).toContain("beforeLoad: authGuard,");
    expect(body).toContain("validateSearch: validateModerationRouteSearch,");
  });

  it("hằng lazy `ModerationPage` nạp ĐÚNG module của màn Kiểm duyệt (không phải màn khác đội tên)", () => {
    /**
     * `<ModerationPage />` trong khối route chỉ là TÊN HẰNG: hằng đó `React.lazy` nạp module nào là
     * literal thứ ba, rời hai literal kia. Nạp nhầm `groups/GroupsPage` thì `/feed/moderation` vẽ màn
     * Nhóm sau đúng cổng của màn Kiểm duyệt — kiểu hợp lệ nên tsc không thấy, và ca cổng G1 import thẳng
     * component nên cũng không thấy (kiểm toán nhóm C, AUD-C-01).
     */
    const lazyBody =
      /const ModerationPage = React\.lazy\(\(\) =>\n([\s\S]*?)\n\);/.exec(routerSrc)?.[1] ?? "";
    expect(lazyBody, "không đọc được khối `const ModerationPage = React.lazy(…)`").not.toBe("");
    expect(lazyBody).toContain('import("@/routes/social/moderation/ModerationPage")');
    expect(lazyBody).toContain("default: m.ModerationPage,");
    // Đối chứng cho phép đo: cùng regex đọc khối của màn Nhóm ra đúng module của nó.
    const groupsBody =
      /const GroupsPage = React\.lazy\(\(\) =>\n([\s\S]*?)\n\);/.exec(routerSrc)?.[1] ?? "";
    expect(groupsBody).toContain('import("@/routes/social/groups/GroupsPage")');
  });

  it("route `/feed/moderation` CÓ trong `rootRoute.addChildren([…])`", () => {
    const name = blocksWith('path: "/feed/moderation",')[0]?.name ?? "";
    expect(inTree(name), `route '${name}' chưa được lắp vào cây`).toBe(true);
  });

  it("route chuyển hướng `/social/reports` dựng từ hằng CÓ TÊN và CÓ trong cây", () => {
    const blocks = blocksWith("path: LEGACY_SOCIAL_REPORTS_REDIRECT.path,");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.body).toContain(
      "beforeLoad: legacyRedirectBeforeLoad(LEGACY_SOCIAL_REPORTS_REDIRECT),",
    );
    const name = blocks[0]?.name ?? "";
    expect(inTree(name), `route '${name}' chưa được lắp vào cây`).toBe(true);
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
