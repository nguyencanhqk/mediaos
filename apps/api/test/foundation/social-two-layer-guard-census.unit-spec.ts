import fs from "node:fs";
import path from "node:path";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import {
  SOCIAL_MODERATION_FIELD_PAIRS,
  SOCIAL_POST_TYPE_PAIRS,
  SOCIAL_ROUTE_PAIRS,
  type SocialRouteKey,
} from "../../src/social/social-route-pairs.const";
import { collectRoutes, type RouteInfo } from "./route-census";

/**
 * S16-SOCIAL-BE-1 — CENSUS 2 TẦNG cho SOCIAL (khuôn `recruit-two-layer-guard-census.unit-spec.ts`).
 *
 * CẢ HAI tầng so với CÙNG MỘT nguồn sự thật `SOCIAL_ROUTE_PAIRS` — KHÔNG so tầng-với-tầng (hai tầng
 * cùng sai vẫn "khớp nhau"):
 *   • Tầng 1 (decorator): metadata `@RequirePermission` đọc từ APP ĐÃ BOOT qua `collectRoutes`.
 *   • Tầng 2 (service): quét TS AST tìm `resolveActor(<expr>, "<key>")`, pin `Class#method` ↔ key.
 *
 * VÀ — phần riêng của SOCIAL — đẳng thức `tier1IsFloor` (plan §2 D17): tập route có cờ đó phải BẰNG
 * ĐÚNG tập route có bảng cặp-theo-payload. Đo bằng một nguồn ĐỘC LẬP với chính cờ, nên nó không phải
 * tautology.
 *
 * KHÔNG cần Postgres — boot + metadata + đọc file.
 */

const SRC_SOCIAL = path.join(__dirname, "..", "..", "src", "social");

const SOCIAL_CONTROLLERS = new Set([
  "SocialPostsController",
  "SocialReactionsController",
  "SocialCommentsController",
  // S16-SOCIAL-BE-1B — 3 controller Nhóm B (`social-b.controllers.ts`).
  "SocialNewsController",
  "SocialDiscoveryController",
  "SocialReportsController",
  // 🔴 S16-SOCIAL-BE-2A — `Set` này là DANH SÁCH TRẮNG: controller không có tên ở đây thì 10 route
  // của nó VÔ HÌNH với census, và cả bốn assert dưới vẫn XANH (fail-open IM LẶNG). Thêm controller
  // SOCIAL mới ⇒ thêm MỘT dòng ở đây, cùng commit.
  "SocialGroupsController",
]);

/** Bảng route HTTP → key — fixture census, phủ ĐỦ 39 route (19 A + 10 B + 10 NHÓM, API-19 §5.1). */
const ROUTE_TO_KEY: ReadonlyArray<{ method: string; path: string; key: SocialRouteKey }> = [
  { method: "GET", path: "/api/v1/social/saved", key: "savedList" },
  { method: "GET", path: "/api/v1/social/feed", key: "feedList" },
  { method: "POST", path: "/api/v1/social/posts", key: "postCreate" },
  { method: "GET", path: "/api/v1/social/posts/:post_id", key: "postDetail" },
  { method: "PATCH", path: "/api/v1/social/posts/:post_id", key: "postUpdate" },
  { method: "DELETE", path: "/api/v1/social/posts/:post_id", key: "postDelete" },
  { method: "PATCH", path: "/api/v1/social/posts/:post_id/moderation", key: "postModerate" },
  { method: "POST", path: "/api/v1/social/posts/:post_id/view", key: "postView" },
  { method: "POST", path: "/api/v1/social/posts/:post_id/save", key: "postSave" },
  { method: "DELETE", path: "/api/v1/social/posts/:post_id/save", key: "postUnsave" },
  { method: "PUT", path: "/api/v1/social/posts/:post_id/reaction", key: "postReactionPut" },
  { method: "DELETE", path: "/api/v1/social/posts/:post_id/reaction", key: "postReactionDelete" },
  { method: "GET", path: "/api/v1/social/posts/:post_id/reactions", key: "postReactionList" },
  { method: "GET", path: "/api/v1/social/posts/:post_id/comments", key: "commentList" },
  { method: "POST", path: "/api/v1/social/posts/:post_id/comments", key: "commentCreate" },
  { method: "PATCH", path: "/api/v1/social/comments/:comment_id", key: "commentUpdate" },
  { method: "DELETE", path: "/api/v1/social/comments/:comment_id", key: "commentDelete" },
  {
    method: "PUT",
    path: "/api/v1/social/comments/:comment_id/reaction",
    key: "commentReactionPut",
  },
  {
    method: "DELETE",
    path: "/api/v1/social/comments/:comment_id/reaction",
    key: "commentReactionDelete",
  },
  // ── S16-SOCIAL-BE-1B — Nhóm B (`SOCIAL-API-020..029`) ──
  { method: "GET", path: "/api/v1/social/news", key: "newsList" },
  { method: "POST", path: "/api/v1/social/posts/:post_id/ack", key: "postAck" },
  { method: "GET", path: "/api/v1/social/posts/:post_id/acks", key: "postAcksList" },
  { method: "GET", path: "/api/v1/social/search", key: "search" },
  { method: "GET", path: "/api/v1/social/tags", key: "tagsList" },
  { method: "GET", path: "/api/v1/social/birthdays", key: "birthdays" },
  { method: "GET", path: "/api/v1/social/profiles/:employee_id/posts", key: "profilePosts" },
  { method: "POST", path: "/api/v1/social/reports", key: "reportCreate" },
  { method: "GET", path: "/api/v1/social/reports", key: "reportsList" },
  { method: "PATCH", path: "/api/v1/social/reports/:report_id", key: "reportResolve" },
  // ── S16-SOCIAL-BE-2A — NHÓM (`SOCIAL-API-030..039`) ──
  { method: "GET", path: "/api/v1/social/groups", key: "groupsList" },
  { method: "POST", path: "/api/v1/social/groups", key: "groupCreate" },
  { method: "GET", path: "/api/v1/social/groups/:group_id", key: "groupGet" },
  { method: "PATCH", path: "/api/v1/social/groups/:group_id", key: "groupUpdate" },
  { method: "DELETE", path: "/api/v1/social/groups/:group_id", key: "groupDelete" },
  { method: "POST", path: "/api/v1/social/groups/:group_id/join", key: "groupJoin" },
  { method: "POST", path: "/api/v1/social/groups/:group_id/leave", key: "groupLeave" },
  { method: "GET", path: "/api/v1/social/groups/:group_id/members", key: "groupMembersList" },
  {
    method: "PATCH",
    path: "/api/v1/social/groups/:group_id/members/:user_id",
    key: "groupMemberDecide",
  },
  {
    method: "DELETE",
    path: "/api/v1/social/groups/:group_id/members/:user_id",
    key: "groupMemberRemove",
  },
];

/**
 * Sổ pin `Class#method` ↔ key — đổi handler/key là ĐỎ, phải sửa CÓ CHỦ ĐÍCH qua FULL gate.
 *
 * "Key xuất hiện ít nhất một lần" là chưa đủ: một handler assert nhầm key của route KHÁC cùng cặp
 * vẫn xanh. Map này pin ĐÚNG HANDLER dùng ĐÚNG KEY.
 */
const SERVICE_SITE_TO_KEYS: Readonly<Record<string, readonly string[]>> = {
  "SocialPostsService#list": ["feedList"],
  "SocialPostsService#listSaved": ["savedList"],
  "SocialPostsService#get": ["postDetail"],
  "SocialPostsService#create": ["postCreate"],
  "SocialPostsService#update": ["postUpdate"],
  "SocialPostsService#remove": ["postDelete"],
  "SocialPostsService#recordView": ["postView"],
  "SocialPostsService#save": ["postSave"],
  "SocialPostsService#unsave": ["postUnsave"],
  "SocialPostsModerationService#moderate": ["postModerate"],
  "SocialCommentsService#list": ["commentList"],
  "SocialCommentsService#create": ["commentCreate"],
  "SocialCommentsService#update": ["commentUpdate"],
  "SocialCommentsService#remove": ["commentDelete"],
  // Bốn method mỏng, MỖI cái một key literal — thân dùng chung nằm ở putWith/removeWith (không gọi
  // resolveActor). Ternary chọn key sẽ làm census MÙ với đúng bốn route này.
  "SocialReactionsService#putOnPost": ["postReactionPut"],
  "SocialReactionsService#putOnComment": ["commentReactionPut"],
  "SocialReactionsService#removeOnPost": ["postReactionDelete"],
  "SocialReactionsService#removeOnComment": ["commentReactionDelete"],
  "SocialReactionsService#listReactors": ["postReactionList"],
  // ── S16-SOCIAL-BE-1B — 10 handler Nhóm B, mỗi handler MỘT key literal ──
  "SocialNewsService#list": ["newsList"],
  "SocialNewsService#ack": ["postAck"],
  "SocialNewsService#listAcks": ["postAcksList"],
  "SocialDiscoveryService#search": ["search"],
  "SocialDiscoveryService#listTags": ["tagsList"],
  "SocialDiscoveryService#profilePosts": ["profilePosts"],
  "SocialDiscoveryService#birthdays": ["birthdays"],
  "SocialReportsService#create": ["reportCreate"],
  "SocialReportsService#list": ["reportsList"],
  "SocialReportsService#resolve": ["reportResolve"],
  // ── S16-SOCIAL-BE-2A — 10 handler NHÓM, mỗi handler MỘT key literal ──
  "SocialGroupsService#list": ["groupsList"],
  "SocialGroupsService#create": ["groupCreate"],
  "SocialGroupsService#get": ["groupGet"],
  "SocialGroupsService#update": ["groupUpdate"],
  "SocialGroupsService#remove": ["groupDelete"],
  "SocialGroupsService#join": ["groupJoin"],
  "SocialGroupsService#leave": ["groupLeave"],
  "SocialGroupsService#listMembers": ["groupMembersList"],
  "SocialGroupsService#decideMember": ["groupMemberDecide"],
  "SocialGroupsService#removeMember": ["groupMemberRemove"],
};

/** Mọi literal `resolveActor(<expr>, "<key>")` trong `social/**.ts`, kèm `Class#method` bao quanh. */
function serviceResolveActorCalls(): Array<{ site: string; key: string }> {
  const calls: Array<{ site: string; key: string }> = [];
  for (const file of fs.readdirSync(SRC_SOCIAL)) {
    if (!file.endsWith(".ts") || file.endsWith(".spec.ts")) continue;
    const text = fs.readFileSync(path.join(SRC_SOCIAL, file), "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const visit = (node: ts.Node, cls: string, method: string): void => {
      let nextCls = cls;
      let nextMethod = method;
      if (ts.isClassDeclaration(node) && node.name) nextCls = node.name.text;
      if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) nextMethod = node.name.text;
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "resolveActor" &&
        node.arguments.length === 2 &&
        ts.isStringLiteral(node.arguments[1])
      ) {
        calls.push({ site: `${nextCls}#${nextMethod}`, key: node.arguments[1].text });
      }
      ts.forEachChild(node, (c) => visit(c, nextCls, nextMethod));
    };
    visit(sf, "?", "?");
  }
  return calls;
}

/** Tên lớp có tham chiếu tới cờ cặp-KHÁC `canManageNews` — tín hiệu AST của một nhánh tầng-2. */
function classesReferencingManageNews(): Set<string> {
  const out = new Set<string>();
  for (const file of fs.readdirSync(SRC_SOCIAL)) {
    if (!file.endsWith(".ts") || file.endsWith(".spec.ts")) continue;
    const text = fs.readFileSync(path.join(SRC_SOCIAL, file), "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const visit = (node: ts.Node, cls: string): void => {
      const nextCls = ts.isClassDeclaration(node) && node.name ? node.name.text : cls;
      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === "canManageNews" &&
        nextCls !== "?"
      ) {
        out.add(nextCls);
      }
      ts.forEachChild(node, (c) => visit(c, nextCls));
    };
    visit(sf, "?");
  }
  return out;
}

describe("SOCIAL census 2 tầng — decorator + service so với SOCIAL_ROUTE_PAIRS", () => {
  let app: INestApplication;
  let socialRoutes: RouteInfo[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    socialRoutes = collectRoutes(app).filter((r) => SOCIAL_CONTROLLERS.has(r.controller));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it("bảng fixture phủ ĐÚNG tập route SOCIAL đã boot — không thiếu, không thừa", () => {
    // Chốt chặn xanh-RỖNG: scanner/boot hỏng ⇒ 0 route ⇒ mọi assert dưới vô nghĩa.
    expect(
      socialRoutes.length,
      "app boot phải thấy 39 route SOCIAL (19 Nhóm A + 10 Nhóm B + 10 NHÓM)",
    ).toBe(39);
    const seen = new Set(socialRoutes.map((r) => `${r.httpMethod} ${r.path}`));
    const expected = new Set(ROUTE_TO_KEY.map((r) => `${r.method} ${r.path}`));
    expect(
      [...seen].filter((k) => !expected.has(k)),
      "route SOCIAL mọc ngoài bảng census",
    ).toEqual([]);
    expect(
      [...expected].filter((k) => !seen.has(k)),
      "bảng census khai route mà app không có",
    ).toEqual([]);
  });

  it("TẦNG 1 — mỗi route mang ĐÚNG cặp của SOCIAL_ROUTE_PAIRS[key]", () => {
    const mismatches: string[] = [];
    for (const { method, path: p, key } of ROUTE_TO_KEY) {
      const route = socialRoutes.find((r) => r.httpMethod === method && r.path === p);
      if (!route) {
        mismatches.push(`${method} ${p}: KHÔNG thấy route`);
        continue;
      }
      const pair = SOCIAL_ROUTE_PAIRS[key];
      // `RouteInfo.permission` là CHUỖI "action:resourceType" (route-census.ts:61), không phải object.
      const got = route.permission;
      const want = `${pair.action}:${pair.resourceType}`;
      if (got !== want) mismatches.push(`${method} ${p}: decorator=${got} ≠ bảng=${want}`);
    }
    expect(mismatches).toEqual([]);
  });

  it("TẦNG 1 — MỌI route SOCIAL đều CÓ decorator (guard fail-closed, không route trần)", () => {
    const naked = socialRoutes
      .filter((r) => !r.hasPermission)
      .map((r) => `${r.httpMethod} ${r.path}`);
    expect(naked).toEqual([]);
  });

  it("TẦNG 2 — mỗi handler service assert ĐÚNG key của nó (sổ pin site↔key)", () => {
    const calls = serviceResolveActorCalls();
    // Neo chống-xanh-rỗng: AST hỏng / đổi tên method ⇒ 0 call ⇒ mọi assert dưới vô nghĩa.
    expect(calls.length, "phải tìm thấy lời gọi resolveActor trong social/**").toBeGreaterThan(0);

    const bySite = new Map<string, string[]>();
    for (const c of calls) bySite.set(c.site, [...(bySite.get(c.site) ?? []), c.key]);

    const problems: string[] = [];
    for (const [site, keys] of Object.entries(SERVICE_SITE_TO_KEYS)) {
      const got = (bySite.get(site) ?? []).sort();
      const want = [...keys].sort();
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        problems.push(`${site}: gọi [${got}] ≠ pin [${want}]`);
      }
    }
    for (const site of bySite.keys()) {
      if (!(site in SERVICE_SITE_TO_KEYS)) {
        problems.push(`${site}: gọi resolveActor nhưng KHÔNG có trong sổ pin`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("TẦNG 2 — mọi key của bảng hằng được assert ở tầng service ít nhất một lần", () => {
    const used = new Set(serviceResolveActorCalls().map((c) => c.key));
    const missing = Object.keys(SOCIAL_ROUTE_PAIRS).filter((k) => !used.has(k));
    expect(missing, "key có trong bảng nhưng KHÔNG route nào assert ở service").toEqual([]);
  });

  /**
   * ĐẲNG THỨC `tier1IsFloor` (plan §2 D17) — đo bằng nguồn ĐỘC LẬP với chính cờ.
   *
   * `toEqual` chứ KHÔNG `toContain`: thiếu một route là bỏ sót gap thật; thừa một route là gắn nhãn
   * "gate lỏng" cho route vốn đủ chặt, và lần review sau sẽ đi tìm một lỗ không tồn tại.
   */
  it("D17 — tập tier1IsFloor BẰNG ĐÚNG tập route có bảng cặp-theo-payload", () => {
    const flagged = Object.entries(SOCIAL_ROUTE_PAIRS)
      .filter(([, p]) => p.tier1IsFloor)
      .map(([k]) => k)
      .sort();

    // Nguồn độc lập: route nào có một bảng ánh xạ "nội dung request → cặp quyền".
    const payloadDependent: string[] = [];
    if (Object.values(SOCIAL_POST_TYPE_PAIRS).some((v) => v !== null)) {
      payloadDependent.push("postCreate");
    }
    if (
      Object.values(SOCIAL_MODERATION_FIELD_PAIRS).some(
        (v) => v.resourceType !== SOCIAL_ROUTE_PAIRS.postModerate.resourceType,
      )
    ) {
      payloadDependent.push("postModerate");
    }
    payloadDependent.sort();

    // Neo chống-xanh-rỗng ở CẢ HAI vế (plan §7 mục 3b): hai tập rỗng cũng `toEqual` nhau.
    expect(flagged.length, "phải có route tier1IsFloor thật").toBeGreaterThan(0);
    expect(payloadDependent.length, "phải có route cặp-theo-payload thật").toBeGreaterThan(0);
    expect(flagged).toEqual(payloadDependent);
  });

  it("D17 — chỉ hai service của route floor mới đụng cờ cặp-KHÁC `canManageNews`", () => {
    const classes = [...classesReferencingManageNews()].sort();
    // `SocialAccessService` dựng cờ (resolveActor) nên đương nhiên có mặt; hai service kia TIÊU THỤ
    // nó, và chúng phải là ĐÚNG hai service phục vụ `002`/`006`.
    // `SocialAccessService` KHÔNG có mặt và đó là ĐÚNG: nó DỰNG cờ (gán trong object literal của
    // `resolveActor`), không ĐỌC nó qua `x.canManageNews`. Tập dưới đây vì vậy là tập người TIÊU THỤ
    // cờ — và nó phải là ĐÚNG hai service phục vụ `002`/`006`, không hơn.
    expect(classes).toEqual(["SocialPostsModerationService", "SocialPostsService"]);
  });

  it("cả 14 cặp feed-* đều is_sensitive=false trong bảng hằng (mirror catalog 0578)", () => {
    // Hàng rào chống "vá" wildcard `*:*` bằng cách bật cờ ở TypeScript: cờ ở đây phải mirror catalog
    // DB, và đổi catalog là ĐỔI SPEC (phá SOC-DEC-004) — việc của một WO có chữ ký owner.
    const sensitive = Object.entries(SOCIAL_ROUTE_PAIRS)
      .filter(([, p]) => p.isSensitive)
      .map(([k]) => k);
    expect(sensitive).toEqual([]);
  });

  /**
   * ⟲ **S16-SOCIAL-BE-1B đổi khẳng định này** (trước: tập `false` RỖNG cho 19 route Nhóm A).
   *
   * Seed `0578` cấp mọi cặp `feed-*` ở scope Company cho 4 vai canonical, TRỪ ĐÚNG MỘT dòng:
   * `['manager','view','feed-report','Department']` — cặp của route `028`. BE-1B mở đúng route đó,
   * nên tập `companyFloor:false` nay có ĐÚNG MỘT phần tử.
   *
   * `toEqual` một danh sách ĐÓNG chứ không `toBeLessThanOrEqual(1)`: tắt sàn Company là thao tác
   * nguy hiểm nhất của bảng hằng này (nó mở cho MỌI scope resolve được, kể cả `Own`/`Team`), nên mỗi
   * lần thêm một route như vậy phải là một sửa đổi CÓ CHỦ ĐÍCH đi qua FULL gate.
   */
  it("companyFloor tắt ở ĐÚNG MỘT route — `reportsList` (028), không hơn", () => {
    const notFloored = Object.entries(SOCIAL_ROUTE_PAIRS)
      .filter(([, p]) => !p.companyFloor)
      .map(([k]) => k)
      .sort();
    expect(notFloored).toEqual(["reportsList"]);
  });

  /**
   * C2-c (plan §5.1) — **mọi route tắt sàn Company PHẢI khai `dataScope`**.
   *
   * Đây là vế máy-kiểm-được của lời hứa "route này có ép phạm vi hẹp TRONG SQL". Không có nó, tắt
   * `companyFloor` là một thao tác im lặng: decorator vẫn trông y hệt, census vẫn xanh, và cái duy
   * nhất còn gác phạm vi là một `if` nào đó trong repository mà không cổng nào nhìn thấy.
   *
   * Vế NGƯỢC LẠI cũng assert: route CÓ sàn Company thì `dataScope` phải `undefined` — khai một phạm
   * vi hẹp bên cạnh một sàn rộng là hai câu trả lời cho cùng một câu hỏi, và người đọc sau sẽ tin
   * câu sai.
   */
  it("C2-c — companyFloor:false ⇒ dataScope xác định; companyFloor:true ⇒ dataScope undefined", () => {
    const missing: string[] = [];
    const spurious: string[] = [];
    for (const [key, p] of Object.entries(SOCIAL_ROUTE_PAIRS)) {
      if (!p.companyFloor && p.dataScope === undefined) missing.push(key);
      if (p.companyFloor && p.dataScope !== undefined) spurious.push(key);
    }
    expect(missing, "route tắt sàn Company mà KHÔNG khai dataScope").toEqual([]);
    expect(spurious, "route có sàn Company mà vẫn khai dataScope").toEqual([]);
    // Neo chống-xanh-rỗng: phải tồn tại ÍT NHẤT một route tắt sàn, nếu không hai assert trên là
    // hai vòng lặp chạy trên tập rỗng.
    expect(Object.values(SOCIAL_ROUTE_PAIRS).filter((p) => !p.companyFloor).length).toBeGreaterThan(
      0,
    );
    expect(SOCIAL_ROUTE_PAIRS.reportsList.dataScope).toBe("Department");
  });

  /**
   * C2-b (plan §5.1) — KHÔNG route nào của Nhóm B đặt `tier1IsFloor`.
   *
   * API-19 §5.1 không có route nào của `020..029` rẽ cặp quyền theo NỘI DUNG request (khác `002`
   * theo `type` và `006` theo TRƯỜNG). Assert tập RỖNG chứ không bỏ qua: nếu một ngày ai đó đặt cờ
   * đó ở đây mà không kèm bảng cặp-theo-payload, đẳng thức D17 ở trên sẽ đỏ — ca này chỉ nói ĐỎ ở
   * đâu.
   */
  it("C2-b — 10 route Nhóm B không route nào tier1IsFloor", () => {
    const groupB = [
      "newsList",
      "postAck",
      "postAcksList",
      "search",
      "tagsList",
      "profilePosts",
      "birthdays",
      "reportCreate",
      "reportsList",
      "reportResolve",
    ] as const;
    expect(groupB.length, "danh sách Nhóm B phải đủ 10 route").toBe(10);
    const flagged = groupB.filter((k) => SOCIAL_ROUTE_PAIRS[k].tier1IsFloor);
    expect(flagged).toEqual([]);
  });
});
