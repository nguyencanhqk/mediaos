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
]);

/** Bảng route HTTP → key — fixture của census, phủ ĐỦ 19 route Nhóm A (API-19 §5.1). */
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
    expect(socialRoutes.length, "app boot phải thấy 19 route SOCIAL Nhóm A").toBe(19);
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

  it("Nhóm A — companyFloor BẬT cho toàn bộ 19 route (tập false RỖNG có chủ ý)", () => {
    // Seed 0578 cấp mọi cặp `feed-*` ở scope Company cho 4 vai canonical, TRỪ ĐÚNG MỘT dòng:
    // ['manager','view','feed-report','Department'] — và `view:feed-report` thuộc BE-1B.
    const notFloored = Object.entries(SOCIAL_ROUTE_PAIRS)
      .filter(([, p]) => !p.companyFloor)
      .map(([k]) => k);
    expect(notFloored).toEqual([]);
  });
});
