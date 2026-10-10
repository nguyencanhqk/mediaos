/**
 * S16-SOCIAL-QA-1 (L1) — MA TRẬN «THIẾU ĐÚNG MỘT CẶP» trên 59 route SOCIAL
 * (plan `docs/plans/S16-SOCIAL-QA-1.md` §4-L1, D2 · D3 · D5 · D19).
 *
 *   QA1-M-K-1        khói của bảng route + bộ gieo (chạy TRƯỚC — hai helper đóng băng sau lát này)
 *   QA1-M-A-001…059  đủ 15 cặp @Company  ⇒ đúng mã thành công của từng route
 *   QA1-M-U-001…059  không token          ⇒ 401
 *   QA1-M-P-<cặp>    thiếu ĐÚNG cặp của decorator ⇒ 403 tầng 1 trên mọi route cặp đó gác (12 cặp)
 *   QA1-M-F-001…059  đủ cặp nhưng @Department ⇒ 403 sàn scope (046 mang mã riêng; 028 · 052 · 053 ⇒ 200)
 *   QA1-M-C-1…4      kiểm đủ: bảng tay == route đang chạy == cặp ở decorator == bảng hằng sản phẩm
 *
 * Mỗi vế từ chối đứng cạnh vế cho phép của CÙNG request: M-A là song sinh của M-U · M-P · M-F.
 * Bảng route là bảng TAY viết từ tài liệu (`test/helpers/social-qa1-routes.ts`); hằng sản phẩm chỉ
 * xuất hiện ở nhóm M-C để ĐỐI CHIẾU.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOCIAL_ROUTE_PAIRS } from "../../src/social/social-route-pairs.const";
import { SOCIAL_ERR } from "../../src/social/social.errors";
import { collectRoutes, type RouteInfo } from "../foundation/route-census";
import { hasDb } from "../helpers/integration-db";
import {
  EMPLOYEE_FEED_PAIRS,
  FEED_PAIRS,
  bootQa1World,
  expectGuardDenied,
  expectScopeFloorDenied,
  expectSocial,
  expectUnauthenticated,
  type FeedPair,
  type Qa1Actor,
  type Qa1Res,
  type Qa1Scope,
  type Qa1World,
} from "../helpers/social-qa1-kit";
import {
  QA1_ONE_SHOT_CODES,
  QA1_ROUTES,
  callQa1Route,
  qa1Route,
  type Qa1Route,
  type Qa1Slice,
} from "../helpers/social-qa1-routes";
import { ensureQa1FileDoorEnv, seedQa1Slice } from "../helpers/social-qa1-seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 180_000;

/**
 * Số route mỗi cặp gác ở DECORATOR — bảng TAY theo API-19 §5.1 (42 route `view:feed` + 17 route của
 * 11 cặp khác; ba cặp `create:feed-poll` · `create:feed-idea` · `manage:feed-group` chỉ kiểm ở tầng 2).
 */
const ROUTES_PER_PAIR: Readonly<Partial<Record<FeedPair, number>>> = {
  "view:feed": 42,
  "create:feed-post": 1,
  "create:feed-comment": 1,
  "create:feed-kudos": 1,
  "create:feed-group": 1,
  "manage:feed-news": 1,
  "manage:feed-post": 1,
  "manage:feed-kudos": 4,
  "manage:feed-report": 1,
  "approve:feed-idea": 1,
  "view:feed-report": 3,
  "restore:feed-post": 2,
};
const DECORATOR_PAIRS = Object.keys(ROUTES_PER_PAIR) as FeedPair[];

/** Ba route KHÔNG có sàn Company (API-19 §5.1: «manager `Department`») — grant @Department vẫn đọc được. */
const NO_COMPANY_FLOOR: ReadonlySet<string> = new Set(["028", "052", "053"]);
/** Route duy nhất mà từ chối ở tầng 2 mang mã riêng của module thay cho thông điệp sàn scope. */
const IDEA_REVIEW_CODE = "046";

const each = QA1_ROUTES.map((r) => [r.code, `${r.method} ${r.template}`, r] as const);
const dump = (res: Qa1Res): string => `${res.status} ${JSON.stringify(res.body)}`;

describe.skipIf(!hasLaneDb)("S16-SOCIAL-QA-1 · L1 · ma trận cặp quyền 59 route (DB cô lập)", () => {
  let w: Qa1World;
  let priv: Qa1Actor;
  let full: Qa1Actor;
  let dept: Qa1Actor;
  let fullSlice: Qa1Slice;
  /** Lát chỉ dùng cho các vế TỪ CHỐI (không ai được cho phép ghi lên nó). */
  let denySlice: Qa1Slice;
  const minusOne = new Map<FeedPair, Qa1Actor>();

  beforeAll(async () => {
    ensureQa1FileDoorEnv();
    w = await bootQa1World("qa1pairs");
    priv = await w.actor(w.A, "priv", { pairs: FEED_PAIRS });
    full = await w.actor(w.A, "full", { pairs: FEED_PAIRS });
    fullSlice = await seedQa1Slice(w, w.A, full, { privileged: priv });

    const denyOwner = await w.actor(w.A, "denyowner", { pairs: EMPLOYEE_FEED_PAIRS });
    denySlice = await seedQa1Slice(w, w.A, denyOwner, { privileged: priv });

    for (const pair of DECORATOR_PAIRS) {
      const label = `minus${pair.replace(/[^a-z]/g, "")}`;
      minusOne.set(
        pair,
        await w.actor(w.A, label, { pairs: FEED_PAIRS.filter((p) => p !== pair) }),
      );
    }
    const scopes: Partial<Record<FeedPair, Qa1Scope>> = {};
    for (const pair of FEED_PAIRS) scopes[pair] = "Department";
    dept = await w.actor(w.A, "dept", { pairs: FEED_PAIRS, scopes });
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await w?.close();
  });

  // ══════════════ K — khói của bảng + bộ gieo (trước khi đóng băng) ══════════════

  it("QA1-M-K-1 · lát gieo bởi người chỉ giữ 7 cặp của nhân viên đủ khoá cho cả 59 route và dùng được", async () => {
    const emp = await w.actor(w.A, "emp", { pairs: EMPLOYEE_FEED_PAIRS });
    const slice = await seedQa1Slice(w, w.A, emp, { privileged: priv });

    expect(QA1_ROUTES).toHaveLength(59);
    expect(QA1_ROUTES.map((r) => r.code)).toEqual(
      Array.from({ length: 59 }, (_, i) => String(i + 1).padStart(3, "0")),
    );
    for (const route of QA1_ROUTES) {
      const path = route.path(slice);
      expect(path, route.code).not.toMatch(/undefined|null|:[a-z_]+/);
      expect(JSON.stringify(route.body?.(slice) ?? {}), route.code).not.toMatch(/undefined|null/);
    }
    for (const code of QA1_ONE_SHOT_CODES) expect(qa1Route(code).code).toBe(code);

    // Dùng được THẬT: người giữ 7 cặp đi hết bảng — route có cặp tầng 1 thuộc 7 cặp ⇒ đúng mã thành
    // công trên dữ liệu của chính mình; route còn lại ⇒ từ chối ở tầng 1.
    const held: ReadonlySet<string> = new Set(EMPLOYEE_FEED_PAIRS);
    let allowed = 0;
    for (const route of QA1_ROUTES) {
      const res = await callQa1Route(w, route, slice, emp.token);
      if (held.has(route.pair)) {
        expect(res.status, `${route.code} ${route.template}: ${dump(res)}`).toBe(route.ok);
        allowed += 1;
      } else {
        expectGuardDenied(res, `${route.code} ${route.template}`);
      }
    }
    expect(allowed).toBe(46);
  });

  // ══════════════ A — vế CHO PHÉP: đủ 15 cặp @Company ══════════════

  describe("A · đủ 15 cặp ở scope Company ⇒ đúng mã thành công", () => {
    it.each(each)("QA1-M-A-%s · %s", async (_code, _name, route) => {
      const res = await callQa1Route(w, route, fullSlice, full.token);
      expect(res.status, `${route.code}: ${dump(res)}`).toBe(route.ok);
    });
  });

  // ══════════════ U — không token ══════════════

  describe("U · không token ⇒ 401", () => {
    it.each(each)("QA1-M-U-%s · %s", async (_code, _name, route) => {
      expectUnauthenticated(await callQa1Route(w, route, denySlice, null), route.code);
    });
  });

  // ══════════════ P — thiếu ĐÚNG một cặp ══════════════

  describe("P · thiếu đúng cặp của decorator ⇒ 403 tầng 1 trên mọi route cặp đó gác", () => {
    it("QA1-M-P-neo · số route mỗi cặp khớp bảng tay, cộng lại đủ 59", () => {
      const counted: Partial<Record<FeedPair, number>> = {};
      for (const r of QA1_ROUTES) counted[r.pair] = (counted[r.pair] ?? 0) + 1;
      expect(counted).toEqual(ROUTES_PER_PAIR);
      expect(DECORATOR_PAIRS).toHaveLength(12);
      expect(Object.values(ROUTES_PER_PAIR).reduce((a, b) => a + b, 0)).toBe(59);
    });

    it.each(DECORATOR_PAIRS)("QA1-M-P-%s", async (pair) => {
      const actor = minusOne.get(pair);
      if (!actor) throw new Error(`thiếu actor cho ${pair}`);
      const routes = QA1_ROUTES.filter((r) => r.pair === pair);
      expect(routes, pair).toHaveLength(ROUTES_PER_PAIR[pair] ?? -1);

      // Đối chứng: chính actor này vẫn gọi được một route do cặp KHÁC gác (không phải tài khoản hỏng).
      const control = qa1Route(pair === "view:feed" ? "059" : "001");
      expect(control.pair).not.toBe(pair);
      const controlRes = await callQa1Route(w, control, denySlice, actor.token);
      expect(controlRes.status, `đối chứng ${control.code}: ${dump(controlRes)}`).toBe(control.ok);

      for (const route of routes) {
        expectGuardDenied(
          await callQa1Route(w, route, denySlice, actor.token),
          `thiếu ${pair} · ${route.code} ${route.template}`,
        );
      }
    });
  });

  // ══════════════ F — sàn scope ══════════════

  describe("F · đủ 15 cặp nhưng ở scope Department", () => {
    it("QA1-M-F-neo · ba route không sàn Company và route mang mã riêng đều có trong bảng", () => {
      for (const code of [...NO_COMPANY_FLOOR, IDEA_REVIEW_CODE]) {
        expect(qa1Route(code).code).toBe(code);
      }
      expect([...NO_COMPANY_FLOOR].map((c) => qa1Route(c).pair)).toEqual([
        "view:feed-report",
        "view:feed-report",
        "view:feed-report",
      ]);
    });

    it.each(each)("QA1-M-F-%s · %s", async (code, _name, route) => {
      const res = await callQa1Route(w, route, denySlice, dept.token);
      if (NO_COMPANY_FLOOR.has(code)) {
        expect(res.status, `${code}: ${dump(res)}`).toBe(route.ok);
      } else if (code === IDEA_REVIEW_CODE) {
        expectSocial(
          res,
          403,
          SOCIAL_ERR.IDEA_APPROVE_REQUIRED,
          SOCIAL_ERROR_CODES.IDEA_APPROVE_REQUIRED,
        );
      } else {
        expectScopeFloorDenied(res, `${code} ${route.template}`);
      }
    });
  });

  // ══════════════ C — kiểm đủ: bảng tay ↔ route đang chạy ↔ bảng hằng ══════════════

  describe("C · kiểm đủ", () => {
    const signature = (r: Qa1Route): string => `${r.method} /api/v1${r.template}`;
    const runtime = () =>
      collectRoutes(w.app).filter(
        (r) =>
          r.path.startsWith("/api/v1/social/") ||
          r.path.startsWith("/api/v1/recycle-bin/feed-posts"),
      );

    it("QA1-M-C-1 · tập route đang chạy dưới hai tiền tố SOCIAL bằng đúng tập của bảng tay (59)", () => {
      const live: string[] = runtime().map((r) => `${r.httpMethod} ${r.path}`);
      expect(live).toHaveLength(59);
      expect([...live].sort()).toEqual(QA1_ROUTES.map(signature).sort());
      expect(new Set(QA1_ROUTES.map(signature)).size).toBe(59);
    });

    it("QA1-M-C-2 · cặp ở decorator lúc chạy của từng route bằng cặp trong bảng tay", () => {
      const live = new Map<string, RouteInfo>(
        runtime().map((r) => [`${r.httpMethod} ${r.path}`, r] as const),
      );
      const mismatched: string[] = [];
      for (const route of QA1_ROUTES) {
        const info = live.get(signature(route));
        if (info?.permission !== route.pair || info.isPublic) {
          mismatched.push(
            `${route.code} ${signature(route)}: bảng ${route.pair} ≠ decorator ${String(info?.permission)}`,
          );
        }
      }
      expect(mismatched).toEqual([]);
    });

    it("QA1-M-C-3 · tập khoá của bảng tay bằng tập khoá của bảng hằng sản phẩm", () => {
      expect(QA1_ROUTES.map((r) => r.key).sort()).toEqual(Object.keys(SOCIAL_ROUTE_PAIRS).sort());
    });

    it("QA1-M-C-4 · neo: cặp của từng khoá trong bảng hằng sản phẩm bằng cặp trong bảng tay", () => {
      const fromProduct = QA1_ROUTES.map((r) => {
        const p = SOCIAL_ROUTE_PAIRS[r.key];
        return `${r.code} ${p.action}:${p.resourceType}`;
      });
      expect(fromProduct).toEqual(QA1_ROUTES.map((r) => `${r.code} ${r.pair}`));
    });
  });
});
