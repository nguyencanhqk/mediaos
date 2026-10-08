/**
 * S16-SOCIAL-FE-3 / FE-3B — ca **W3**: `router.tsx` nối ĐÚNG meta cho ba route quản trị SOCIAL (`/feed/moderation` ·
 * `/feed/kudos-badges` · `/feed/stats`) + route chuyển hướng `/social/reports`, và lắp chúng vào cây route — đo
 * bằng cách đọc NGUỒN `router.tsx` (lý do ở docblock của describe bên dưới).
 *
 * Tách từ `social-wiring.spec.ts` ở S16-SOCIAL-FE-3C (finding AUD-SPEC400) — tách THUẦN, không đổi ca nào. Cùng họ:
 *  · `social-wiring.spec.ts` — registry + sidebar chung (C20 · R1 · R2 · R3 · C22 · S16-SOCIAL-FBPOST-1);
 *  · `social-wiring.admin.spec.ts` — W1 (route ↔ mục rail khai CÙNG cổng) · W4 (mục rail theo quyền).
 * Cổng đo trên đường dựng thật của router (G1 · G5 · G6) ở `admin/admin-route-gates.<màn>.spec.tsx`.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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

  it('đúng MỘT khối có `path: "/feed/kudos-badges"`, dựng bằng `getMeta("social.kudosBadges")` + validator của màn', () => {
    const blocks = blocksWith('path: "/feed/kudos-badges",');
    expect(blocks).toHaveLength(1);
    const body = blocks[0]?.body ?? "";

    const metaVar = /buildModuleRouteContent\((\w+), "SOCIAL", <BadgeSettingsPage \/>\)/.exec(
      body,
    )?.[1];
    expect(
      metaVar,
      "khối route không dựng <BadgeSettingsPage /> qua buildModuleRouteContent",
    ).toBeDefined();
    expect(metaVar).toMatch(/^\w+$/);
    expect(routerSrc).toContain(`const ${metaVar} = getMeta("social.kudosBadges");`);
    expect(body).toContain("beforeLoad: authGuard,");
    expect(body).toContain("validateSearch: validateBadgeRouteSearch,");
  });

  it("hằng lazy `BadgeSettingsPage` nạp ĐÚNG module của màn Thiết lập huy hiệu", () => {
    const lazyBody =
      /const BadgeSettingsPage = React\.lazy\(\(\) =>\n([\s\S]*?)\n\);/.exec(routerSrc)?.[1] ?? "";
    expect(lazyBody, "không đọc được khối `const BadgeSettingsPage = React.lazy(…)`").not.toBe("");
    expect(lazyBody).toContain('import("@/routes/social/badges/BadgeSettingsPage")');
    expect(lazyBody).toContain("default: m.BadgeSettingsPage,");
  });

  it("route `/feed/kudos-badges` CÓ trong `rootRoute.addChildren([…])`", () => {
    const blocks = blocksWith('path: "/feed/kudos-badges",');
    expect(blocks).toHaveLength(1);
    const name = blocks[0]?.name ?? "";
    expect(inTree(name), `route '${name}' chưa được lắp vào cây`).toBe(true);
  });

  it('đúng MỘT khối có `path: "/feed/stats"`, dựng bằng `getMeta("social.stats")` + validator của màn', () => {
    const blocks = blocksWith('path: "/feed/stats",');
    expect(blocks).toHaveLength(1);
    const body = blocks[0]?.body ?? "";

    const metaVar = /buildModuleRouteContent\((\w+), "SOCIAL", <StatsPage \/>\)/.exec(body)?.[1];
    expect(
      metaVar,
      "khối route không dựng <StatsPage /> qua buildModuleRouteContent",
    ).toBeDefined();
    expect(metaVar).toMatch(/^\w+$/);
    expect(routerSrc).toContain(`const ${metaVar} = getMeta("social.stats");`);
    expect(body).toContain("beforeLoad: authGuard,");
    expect(body).toContain("validateSearch: validateStatsRouteSearch,");
  });

  it("hằng lazy `StatsPage` nạp ĐÚNG module của màn Thống kê tương tác", () => {
    const lazyBody =
      /const StatsPage = React\.lazy\(\(\) =>\n([\s\S]*?)\n\);/.exec(routerSrc)?.[1] ?? "";
    expect(lazyBody, "không đọc được khối `const StatsPage = React.lazy(…)`").not.toBe("");
    expect(lazyBody).toContain('import("@/routes/social/stats/StatsPage")');
    expect(lazyBody).toContain("default: m.StatsPage,");
  });

  it("route `/feed/stats` CÓ trong `rootRoute.addChildren([…])`", () => {
    const blocks = blocksWith('path: "/feed/stats",');
    expect(blocks).toHaveLength(1);
    const name = blocks[0]?.name ?? "";
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
