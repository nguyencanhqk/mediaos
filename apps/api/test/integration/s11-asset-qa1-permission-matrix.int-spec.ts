/**
 * S11-ASSET-QA-1 — MA TRẬN QUYỀN PER-PAIR của ASSET (SPEC-13 §11 · §21 hàng "Deny-path (RED trước)").
 *
 * VÌ SAO CÓ FILE NÀY KHI `asset-be1-scope.int-spec.ts` ĐÃ CÓ MỤC DENY.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * Mục A của spec BE-1 dựng MỘT chủ thể thiếu GẦN HẾT quyền (e1 chỉ có `view@Own`) rồi bắn vào 12
 * endpoint ghi ⇒ 403. Ca đó chứng minh "thiếu quyền thì bị chặn", nhưng KHÔNG chứng minh **route được
 * gác bằng ĐÚNG cặp**: nếu `POST /assets/:id/dispose` lỡ khai `@RequirePermission("update","asset")`,
 * e1 vẫn 403 (nó thiếu cả hai) ⇒ lưới xanh trong khi cặp đã lệch. Cùng họ lỗi với
 * `same-builder-twice-makes-unit-spec-vacuous`: một chủ thể thiếu-nhiều biến mọi ô deny thành cùng
 * một phép đo.
 *
 * PHÉP ĐO Ở ĐÂY = A/B **CÙNG MỘT REQUEST**, chỉ đổi CHỦ THỂ:
 *   · `full`   giữ đủ 11 cặp @Company;
 *   · `no-<P>` giữ 10 cặp, THIẾU ĐÚNG cặp P.
 * Với mỗi route: `no-<P>` (P = cặp route khai) ⇒ **403**, `full` ⇒ **KHÔNG 403**. Hai vế chạy cùng
 * URL + cùng body ⇒ chênh lệch duy nhất là cặp quyền. Khai sai cặp trên route ⇒ ĐỎ ngay: chủ thể
 * thiếu-cặp-thật vẫn qua được (không 403), còn ô của cặp bị khai nhầm thì 403 sai chỗ.
 *
 * CHỦ THỂ = role DỰNG TRONG TEST, KHÔNG super-admin (`superadmin-not-a-canonical-role`: SA có `*:*`
 * nên mọi ca deny thành tautology).
 *
 * KHÔNG GÂY TÁC DỤNG PHỤ: route ghi bắn vào UUID **không tồn tại** hoặc body rỗng ⇒ qua guard rồi
 * dừng ở pipe/service (400/404), không đổi dữ liệu. Guard chạy TRƯỚC pipe (Nest: guards → interceptors
 * → pipes) nên vế 403 không phụ thuộc body có hợp lệ hay không — đó cũng là lý do A/B dùng chung body.
 *
 * GATE CỨNG `hasDb && LANE_DB` — chỉ chạy trên DB cô lập lane (CLAUDE.md §9.5).
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = "Passw0rd!assetqa1";

/** Khoá cặp quyền dạng "action:resource" — dùng làm nhãn chủ thể `no-<khoá>`. */
type PairKey =
  | "view:asset"
  | "create:asset"
  | "update:asset"
  | "delete:asset"
  | "assign:asset"
  | "revoke:asset"
  | "dispose:asset"
  | "manage:asset-category"
  | "manage:asset-maintenance"
  | "manage:asset-inventory";

/**
 * 11 cặp §9d. `access:asset` là cổng NAV (SPEC-13 §11) — không route nào khai nó, nên nó không có
 * chủ thể `no-` riêng; ca chứng minh "nav-only" nằm ở mục D.
 */
const ACCESS_PAIR: [string, string] = ["access", "asset"];
const ROUTE_PAIRS: PairKey[] = [
  "view:asset",
  "create:asset",
  "update:asset",
  "delete:asset",
  "assign:asset",
  "revoke:asset",
  "dispose:asset",
  "manage:asset-category",
  "manage:asset-maintenance",
  "manage:asset-inventory",
];

describe.skipIf(!hasLaneDb)("S11-ASSET-QA-1 ma trận quyền per-pair (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  /** token của chủ thể đủ 11 cặp. */
  let tFull = "";
  /** token theo cặp BỊ THIẾU. */
  const tMissing = new Map<PairKey, string>();

  // Fixture đọc (chỉ dùng cho route GET — ALLOW đối chứng phải là 200 thật, không chỉ "khác 403").
  let catId = "";
  let assetId = "";
  let inventoryId = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const get = (t: string, u: string) => auth(t)(http().get(u));
  const post = (t: string, u: string) => auth(t)(http().post(u));
  const patch = (t: string, u: string) => auth(t)(http().patch(u));
  const del = (t: string, u: string) => auth(t)(http().delete(u));

  async function grantPairs(userId: string, label: string, pairs: Array<[string, string]>) {
    const roleId = await seedRole(direct, A.companyId, `assetqa-${label}`);
    for (const [action, resource] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      // access = cổng nav ⇒ Own theo §9d; các cặp còn lại @Company để scope không làm nhiễu phép đo quyền.
      const scope = action === "access" ? "Own" : "Company";
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, A.companyId);
  }

  async function login(email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "assetqa1");
    companyIds.push(A.companyId);

    const allPairs: Array<[string, string]> = [
      ACCESS_PAIR,
      ...ROUTE_PAIRS.map((k) => k.split(":") as [string, string]),
    ];

    const fullUser = await seedUser(direct, A.companyId, `full@${A.slug}.test`, hash);
    await grantPairs(fullUser, "full", allPairs);
    tFull = await login(`full@${A.slug}.test`);

    for (const missing of ROUTE_PAIRS) {
      const slug = missing.replace(":", "-");
      const email = `no-${slug}@${A.slug}.test`;
      const uid = await seedUser(direct, A.companyId, email, hash);
      await grantPairs(
        uid,
        `no-${slug}`,
        allPairs.filter(([a, r]) => `${a}:${r}` !== missing),
      );
      tMissing.set(missing, await login(email));
    }

    // Fixture qua API THẬT bằng chủ thể đủ quyền (không seed thẳng DB → giữ FK/counter đúng đường).
    const cat = await post(tFull, "/asset-categories").send({
      code: "LAPTOP",
      name: "Laptop",
      codePrefix: "LT",
    });
    expect(cat.status, JSON.stringify(cat.body)).toBe(201);
    catId = cat.body.data.id;

    const asset = await post(tFull, "/assets").send({ categoryId: catId, name: "MacBook QA" });
    expect(asset.status, JSON.stringify(asset.body)).toBe(201);
    assetId = asset.body.data.id;

    const inv = await post(tFull, "/asset-inventories").send({ name: "Kiểm kê QA" });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    inventoryId = inv.body.data.id;
  }, 180_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  /**
   * Bảng route ⇔ cặp. PHẢI phủ ĐỦ 22 route của 4 controller ASSET; mục C đối chiếu số lượng với
   * `@RequirePermission` đọc từ source để route thứ 23 mọc lên KHÔNG lọt lưới (khuôn
   * `route-census-runtime-gate`).
   *
   * `read: true` ⇒ ALLOW đối chứng đòi ĐÚNG 200 (đường đọc không được rơi vào 4xx khác vì lý do khác).
   * Route ghi bắn vào id ngẫu nhiên / body rỗng: qua guard rồi 400/404 — chứng minh guard đã cho đi
   * mà KHÔNG đổi dữ liệu.
   */
  type Row = {
    label: string;
    pair: PairKey;
    read?: boolean;
    exec: (t: string) => request.Test;
  };
  const ghost = () => randomUUID();

  const rows = (): Row[] => [
    // ── view:asset (10 route đọc, kể cả /me/assets — SPEC-13 §11 dùng CHÍNH cặp đọc, không tách cặp)
    { label: "GET /assets", pair: "view:asset", read: true, exec: (t) => get(t, "/assets") },
    {
      label: "GET /assets/summary",
      pair: "view:asset",
      read: true,
      exec: (t) => get(t, "/assets/summary"),
    },
    {
      label: "GET /assets/:id",
      pair: "view:asset",
      read: true,
      exec: (t) => get(t, `/assets/${assetId}`),
    },
    {
      label: "GET /assets/:id/assignments",
      pair: "view:asset",
      read: true,
      exec: (t) => get(t, `/assets/${assetId}/assignments`),
    },
    {
      label: "GET /assets/:id/maintenances",
      pair: "view:asset",
      read: true,
      exec: (t) => get(t, `/assets/${assetId}/maintenances`),
    },
    {
      label: "GET /asset-categories",
      pair: "view:asset",
      read: true,
      exec: (t) => get(t, "/asset-categories"),
    },
    {
      label: "GET /asset-inventories",
      pair: "view:asset",
      read: true,
      exec: (t) => get(t, "/asset-inventories"),
    },
    {
      label: "GET /asset-inventories/:id",
      pair: "view:asset",
      read: true,
      exec: (t) => get(t, `/asset-inventories/${inventoryId}`),
    },
    {
      label: "GET /asset-inventories/:id/items",
      pair: "view:asset",
      read: true,
      exec: (t) => get(t, `/asset-inventories/${inventoryId}/items`),
    },
    { label: "GET /me/assets", pair: "view:asset", read: true, exec: (t) => get(t, "/me/assets") },

    // ── ghi: mỗi cặp một nhóm route
    { label: "POST /assets", pair: "create:asset", exec: (t) => post(t, "/assets").send({}) },
    {
      label: "PATCH /assets/:id",
      pair: "update:asset",
      exec: (t) => patch(t, `/assets/${ghost()}`).send({}),
    },
    {
      label: "DELETE /assets/:id",
      pair: "delete:asset",
      exec: (t) => del(t, `/assets/${ghost()}`),
    },
    {
      label: "POST /assets/:id/assign",
      pair: "assign:asset",
      exec: (t) => post(t, `/assets/${ghost()}/assign`).send({ employeeId: ghost() }),
    },
    {
      label: "POST /assets/:id/revoke",
      pair: "revoke:asset",
      exec: (t) => post(t, `/assets/${ghost()}/revoke`).send({ returnCondition: "Good" }),
    },
    {
      label: "POST /assets/:id/dispose",
      pair: "dispose:asset",
      exec: (t) =>
        post(t, `/assets/${ghost()}/dispose`).send({ kind: "Disposed", reason: "thanh lý QA" }),
    },
    {
      label: "POST /assets/:id/recover",
      pair: "dispose:asset",
      exec: (t) => post(t, `/assets/${ghost()}/recover`).send({ reason: "tìm thấy lại" }),
    },
    {
      label: "POST /asset-categories",
      pair: "manage:asset-category",
      exec: (t) => post(t, "/asset-categories").send({}),
    },
    {
      label: "PATCH /asset-categories/:id",
      pair: "manage:asset-category",
      exec: (t) => patch(t, `/asset-categories/${ghost()}`).send({ name: "Đổi tên QA" }),
    },
    {
      label: "DELETE /asset-categories/:id",
      pair: "manage:asset-category",
      exec: (t) => del(t, `/asset-categories/${ghost()}`),
    },
    {
      label: "POST /assets/:id/maintenances",
      pair: "manage:asset-maintenance",
      exec: (t) => post(t, `/assets/${ghost()}/maintenances`).send({ reason: "bảo trì QA" }),
    },
    {
      label: "POST /assets/:id/maintenances/:mid/close",
      pair: "manage:asset-maintenance",
      exec: (t) => post(t, `/assets/${ghost()}/maintenances/${ghost()}/close`).send({}),
    },
    {
      label: "POST /asset-inventories",
      pair: "manage:asset-inventory",
      exec: (t) => post(t, "/asset-inventories").send({}),
    },
    {
      label: "PATCH /asset-inventories/:id/items/:itemId",
      pair: "manage:asset-inventory",
      exec: (t) => patch(t, `/asset-inventories/${ghost()}/items/${ghost()}`).send({}),
    },
    {
      label: "POST /asset-inventories/:id/items/bulk-mark",
      pair: "manage:asset-inventory",
      exec: (t) => post(t, `/asset-inventories/${ghost()}/items/bulk-mark`).send({}),
    },
    {
      label: "POST /asset-inventories/:id/close",
      pair: "manage:asset-inventory",
      exec: (t) => post(t, `/asset-inventories/${ghost()}/close`).send({}),
    },
  ];

  // ── A. DENY: chủ thể thiếu ĐÚNG một cặp ⇒ 403 trên mọi route khai cặp đó ───────────────────────

  describe("A. thiếu ĐÚNG một cặp ⇒ 403 trên đúng nhóm route của cặp đó", () => {
    it.each(rows().map((r) => [r.label, r.pair] as const))(
      "%s ⇒ 403 cho chủ thể thiếu %s",
      async (label, pair) => {
        const row = rows().find((r) => r.label === label)!;
        const token = tMissing.get(pair)!;
        const res = await row.exec(token);
        expect(res.status, `${label} | ${JSON.stringify(res.body)}`).toBe(403);
      },
    );
  });

  // ── B. ALLOW đối chứng: CÙNG request, chủ thể đủ 11 cặp ⇒ KHÔNG 403 ────────────────────────────
  //
  // Không có mục này thì mọi ô ở A đều xanh-rỗng: một route hỏng/không tồn tại cũng "403" nếu guard
  // chặn vì lý do khác (memory `deny-cases-vacuous-without-allow-case`).

  describe("B. ALLOW đối chứng cùng request ⇒ KHÔNG 403 (đọc = đúng 200)", () => {
    it.each(rows().map((r) => [r.label] as const))(
      "%s ⇒ không 403 cho chủ thể đủ quyền",
      async (label) => {
        const row = rows().find((r) => r.label === label)!;
        const res = await row.exec(tFull);
        expect(res.status, `${label} | ${JSON.stringify(res.body)}`).not.toBe(403);
        if (row.read) expect(res.status, `${label} | ${JSON.stringify(res.body)}`).toBe(200);
      },
    );

    it("chủ thể thiếu-một-cặp KHÔNG bị hỏng toàn cục: vẫn dùng được route của cặp khác", async () => {
      // Chứng minh 403 ở A đến từ ĐÚNG cặp thiếu, không phải "user này hỏng/không có quyền gì".
      for (const [pair, token] of tMissing) {
        // Thiếu `view` ⇒ đối chứng bằng một route GHI; các chủ thể còn lại đối chứng bằng GET /assets.
        const res =
          pair === "view:asset"
            ? await post(token, "/assets").send({})
            : await get(token, "/assets");
        expect(res.status, `no-${pair} | ${JSON.stringify(res.body)}`).not.toBe(403);
      }
    });
  });

  // ── C. Census: bảng trên phải phủ ĐỦ route có @RequirePermission của module ────────────────────

  describe("C. census — không route ASSET nào nằm ngoài ma trận", () => {
    it("mỗi @RequirePermission trong src/assets/*.controller.ts có ít nhất một hàng ma trận", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const dir = path.join(__dirname, "..", "..", "src", "assets");
      const declared = new Map<string, number>();
      for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".controller.ts"))) {
        const src = fs
          .readFileSync(path.join(dir, f), "utf8")
          // bỏ comment: `@RequirePermission` nhắc trong docblock KHÔNG phải route thật.
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        for (const m of src.matchAll(/@RequirePermission\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g)) {
          const key = `${m[1]}:${m[2]}`;
          declared.set(key, (declared.get(key) ?? 0) + 1);
        }
      }
      const covered = new Map<string, number>();
      for (const r of rows()) covered.set(r.pair, (covered.get(r.pair) ?? 0) + 1);

      expect(
        [...declared.keys()].sort(),
        "cặp quyền khai trên controller ≠ cặp có trong ma trận",
      ).toEqual([...covered.keys()].sort());
      for (const [pair, n] of declared) {
        expect(
          covered.get(pair),
          `cặp ${pair}: ${n} route khai nhưng ma trận chỉ có ${covered.get(pair)}`,
        ).toBe(n);
      }
      // Tổng route ASSET (22, S11-ASSET-BE-1) — số neo để route mới không lọt im lặng.
      expect([...declared.values()].reduce((a, b) => a + b, 0)).toBe(rows().length);
    });

    /**
     * ĐO ĐƯỢC BẰNG THÍ NGHIỆM ĐỘT BIẾN (S11-ASSET-QA-1): ASSET gác cặp ở **HAI TẦNG** —
     * `@RequirePermission` trên controller VÀ `access.assertCan(user, action, resource)` trong service
     * (defense-in-depth có chủ ý: service còn được gọi từ job, không qua guard).
     *
     * Hệ quả cho phép đo: đổi **một** tầng thì đường HTTP vẫn 403 (tầng kia chặn) ⇒ mục A/B **không
     * nhìn thấy** lệch một-tầng. Thí nghiệm thật: đổi decorator `dispose` → `update` mà giữ nguyên
     * service ⇒ 55 ca A/B vẫn XANH, chỉ census đỏ; đổi CẢ HAI ⇒ mục A đỏ (ca dispose trả 404).
     * Vì vậy hai tầng phải được đối chiếu TĨNH ở đây, nếu không lệch một-tầng sẽ trôi im lặng cho tới
     * ngày ai đó gọi service từ job và mất hẳn tầng guard.
     */
    it("cặp ở service `assertCan` KHỚP ĐÚNG tập cặp khai trên route (chống lệch một-tầng)", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const dir = path.join(__dirname, "..", "..", "src", "assets");
      const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

      const declared = new Set<string>();
      for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".controller.ts"))) {
        const src = strip(fs.readFileSync(path.join(dir, f), "utf8"));
        for (const m of src.matchAll(/@RequirePermission\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g))
          declared.add(`${m[1]}:${m[2]}`);
      }

      const asserted = new Set<string>();
      for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".service.ts"))) {
        // asset-access.service.ts ĐỊNH NGHĨA assertCan (tham số động), không phải nơi GỌI với cặp cố định.
        if (f === "asset-access.service.ts") continue;
        const src = strip(fs.readFileSync(path.join(dir, f), "utf8"));
        for (const m of src.matchAll(/assertCan\(\s*\w+\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g))
          asserted.add(`${m[1]}:${m[2]}`);
      }

      expect(
        [...asserted].sort(),
        "tầng service và tầng controller phải gác CÙNG một tập cặp",
      ).toEqual([...declared].sort());
    });
  });

  // ── D. `access:asset` là cổng NAV, KHÔNG gác API ───────────────────────────────────────────────

  describe("D. access:asset = cổng nav (SPEC-13 §11), không phải cổng API", () => {
    it("thiếu access nhưng có view ⇒ GET /assets vẫn 200 (nav do FE gác); thiếu view ⇒ 403", async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `no-access@${A.slug}.test`;
      const uid = await seedUser(direct, A.companyId, email, hash);
      await grantPairs(
        uid,
        "no-access",
        ROUTE_PAIRS.map((k) => k.split(":") as [string, string]),
      );
      const t = await login(email);
      const res = await get(t, "/assets");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // Vế đối: cổng THẬT của đường đọc là `view` — đã đo ở mục A, nhắc lại ở đây để cặp nav/API không lẫn.
      expect((await get(tMissing.get("view:asset")!, "/assets")).status).toBe(403);
    });
  });
});
