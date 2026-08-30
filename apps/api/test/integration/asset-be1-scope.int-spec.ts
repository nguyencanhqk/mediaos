/**
 * S11-ASSET-BE-1 — deny-path + cross-tenant + MASKING của module ASSET (SPEC-13 §11/§13.6/§18 · API-14 §6).
 * Đường THẬT: JwtAuthGuard → PermissionGuard → controller → service (data-scope + masking ở service) →
 * repository (withTenant + company_id) → RLS/FORCE. KHÔNG mock permission, KHÔNG super-admin (tautology).
 *
 * QUY ƯỚC MÃ LỖI CỦA ASSET (KHÁC GOAL): trong tenant nhưng NGOÀI scope ⇒ **404** (không 403 — 403 xác nhận
 * tồn tại); chéo tenant ⇒ 404; thiếu cặp quyền ⇒ 403 (PermissionGuard).
 *
 * Mỗi ca DENY có ca ALLOW đối chứng (memory `deny-cases-vacuous-without-allow-case`).
 * GATE CỨNG `hasDb && LANE_DB` — chỉ chạy trên DB cô lập lane.
 */

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
const LOGIN_PW = "Passw0rd!asset1";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

/** 11 cặp §9d @Company (company-admin / asset-manager). */
const ASSET_ALL: PairGrant[] = [
  ["access", "asset", "Own"],
  ["view", "asset", "Company"],
  ["create", "asset", "Company"],
  ["update", "asset", "Company"],
  ["delete", "asset", "Company"],
  ["assign", "asset", "Company"],
  ["revoke", "asset", "Company"],
  ["dispose", "asset", "Company"],
  ["manage", "asset-category", "Company"],
  ["manage", "asset-maintenance", "Company"],
  ["manage", "asset-inventory", "Company"],
];
const ASSET_EMPLOYEE: PairGrant[] = [
  ["access", "asset", "Own"],
  ["view", "asset", "Own"],
];
const ASSET_MANAGER_DEPT: PairGrant[] = [
  ["access", "asset", "Own"],
  ["view", "asset", "Department"],
];

describe.skipIf(!hasLaneDb)(
  "S11-ASSET-BE-1 data-scope + masking + cross-tenant (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let ouSales = "";
    let ouMkt = "";
    let caUser = "";
    let mgrUser = "";
    let e1User = "";
    let e2User = "";
    let outUser = "";
    let cbUser = "";
    let e1Emp = "";
    let e2Emp = "";
    let outEmp = "";
    let tCa = "";
    let tMgr = "";
    let tE1 = "";
    let tE2 = "";
    let tOut = "";
    let tCb = "";

    let catId = "";
    let catSpareId = "";
    let a1 = ""; // giao e1 → thu hồi → giao e2 (Sales)
    let a2 = ""; // giao out (Marketing)
    let a3 = ""; // In Stock
    let bCatId = "";
    let bAsset = "";

    async function seedOrgUnit(companyId: string, name: string): Promise<string> {
      const r = await direct.query(
        "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
        [companyId, name],
      );
      return r.rows[0].id as string;
    }

    async function seedEmp(
      companyId: string,
      userId: string,
      orgUnitId: string | null,
      code: string,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, employee_code)
       VALUES ($1,$2,$3,'active',$4) RETURNING id`,
        [companyId, userId, orgUnitId, code],
      );
      return r.rows[0].id as string;
    }

    async function grantPairs(
      companyId: string,
      userId: string,
      label: string,
      pairs: PairGrant[],
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `asset-${label}-${userId.slice(0, 8)}`);
      for (const [action, resource, scope] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resource, false);
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(direct, userId, roleId, companyId);
    }

    async function login(slug: string, email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    const http = () => request(app.getHttpServer());
    const get = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
    const post = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
    const patch = (t: string, u: string) => http().patch(u).set("Authorization", `Bearer ${t}`);
    const del = (t: string, u: string) => http().delete(u).set("Authorization", `Bearer ${t}`);

    async function createAsset(
      t: string,
      categoryId: string,
      name: string,
      extra: Record<string, unknown> = {},
    ) {
      const res = await post(t, "/assets").send({
        categoryId,
        name,
        purchasePrice: 45000000,
        supplier: "Apple VN",
        purchaseDate: "2026-01-15",
        ...extra,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.id as string;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "asset1a");
      B = await seedCompany(direct, "asset1b");
      companyIds.push(A.companyId, B.companyId);

      ouSales = await seedOrgUnit(A.companyId, "Kinh doanh");
      ouMkt = await seedOrgUnit(A.companyId, "Marketing");

      const mk = (name: string) => seedUser(direct, A.companyId, `${name}@${A.slug}.test`, hash);
      caUser = await mk("ca");
      mgrUser = await mk("mgr");
      e1User = await mk("e1");
      e2User = await mk("e2");
      outUser = await mk("out");
      cbUser = await seedUser(direct, B.companyId, `cb@${B.slug}.test`, hash);
      await direct.query("UPDATE users SET full_name = $2 WHERE id = $1", [e1User, "Nhân viên E1"]);
      await direct.query("UPDATE users SET full_name = $2 WHERE id = $1", [e2User, "Nhân viên E2"]);
      await direct.query("UPDATE users SET full_name = $2 WHERE id = $1", [
        outUser,
        "Nhân viên OUT",
      ]);

      await seedEmp(A.companyId, caUser, ouSales, "NV-CA");
      await seedEmp(A.companyId, mgrUser, ouSales, "NV-MGR");
      e1Emp = await seedEmp(A.companyId, e1User, ouSales, "NV-E1");
      e2Emp = await seedEmp(A.companyId, e2User, ouSales, "NV-E2");
      outEmp = await seedEmp(A.companyId, outUser, ouMkt, "NV-OUT");

      await grantPairs(A.companyId, caUser, "ca", ASSET_ALL);
      await grantPairs(A.companyId, mgrUser, "mgr", ASSET_MANAGER_DEPT);
      await grantPairs(A.companyId, e1User, "e1", ASSET_EMPLOYEE);
      await grantPairs(A.companyId, e2User, "e2", ASSET_EMPLOYEE);
      await grantPairs(A.companyId, outUser, "out", ASSET_EMPLOYEE);
      await grantPairs(B.companyId, cbUser, "cb", ASSET_ALL);

      tCa = await login(A.slug, `ca@${A.slug}.test`);
      tMgr = await login(A.slug, `mgr@${A.slug}.test`);
      tE1 = await login(A.slug, `e1@${A.slug}.test`);
      tE2 = await login(A.slug, `e2@${A.slug}.test`);
      tOut = await login(A.slug, `out@${A.slug}.test`);
      tCb = await login(B.slug, `cb@${B.slug}.test`);

      // Fixture qua API THẬT (ca @Company) — counter tạo cùng loại.
      const cat = await post(tCa, "/asset-categories").send({
        code: "LAPTOP",
        name: "Laptop",
        codePrefix: "LT",
      });
      expect(cat.status, JSON.stringify(cat.body)).toBe(201);
      catId = cat.body.data.id;
      const spare = await post(tCa, "/asset-categories").send({
        code: "SPARE",
        name: "Dự phòng",
        codePrefix: "SP",
      });
      catSpareId = spare.body.data.id;
      a1 = await createAsset(tCa, catId, "MacBook A1", { serialNumber: "SN-A1" });
      a2 = await createAsset(tCa, catId, "MacBook A2", { serialNumber: "SN-A2" });
      a3 = await createAsset(tCa, catId, "MacBook A3 (kho)");

      const bcat = await post(tCb, "/asset-categories").send({
        code: "LAPTOP",
        name: "Laptop B",
        codePrefix: "LT",
      });
      expect(bcat.status).toBe(201);
      bCatId = bcat.body.data.id;
      bAsset = await createAsset(tCb, bCatId, "Laptop của B");

      // a1 → e1 → thu hồi → e2 ; a2 → out
      expect((await post(tCa, `/assets/${a1}/assign`).send({ employeeId: e1Emp })).status).toBe(
        201,
      );
      expect(
        (await post(tCa, `/assets/${a1}/revoke`).send({ returnCondition: "Good" })).status,
      ).toBe(201);
      expect((await post(tCa, `/assets/${a1}/assign`).send({ employeeId: e2Emp })).status).toBe(
        201,
      );
      expect((await post(tCa, `/assets/${a2}/assign`).send({ employeeId: outEmp })).status).toBe(
        201,
      );
    }, 120_000);

    afterAll(async () => {
      if (direct) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ── A. Deny-path 403 (thiếu cặp) + ALLOW đối chứng ─────────────────────────

    describe("A. thiếu cặp quyền ⇒ 403 (e1 chỉ có view@Own); ca có cặp ⇒ qua", () => {
      const denies: Array<[string, (t: string) => request.Test, Record<string, unknown>]> = [
        [
          "POST /asset-categories",
          (t) => post(t, "/asset-categories"),
          { code: "X", name: "X", codePrefix: "XX" },
        ],
        [
          "PATCH /asset-categories/:id",
          (t) => patch(t, `/asset-categories/${catId}`),
          { name: "Y" },
        ],
        ["DELETE /asset-categories/:id", (t) => del(t, `/asset-categories/${catSpareId}`), {}],
        ["POST /assets", (t) => post(t, "/assets"), { categoryId: catId, name: "Z" }],
        ["PATCH /assets/:id", (t) => patch(t, `/assets/${a3}`), { name: "Z2" }],
        ["DELETE /assets/:id", (t) => del(t, `/assets/${a3}`), {}],
        ["POST /assets/:id/assign", (t) => post(t, `/assets/${a3}/assign`), { employeeId: e1Emp }],
        [
          "POST /assets/:id/revoke",
          (t) => post(t, `/assets/${a1}/revoke`),
          { returnCondition: "Good" },
        ],
        [
          "POST /assets/:id/maintenances",
          (t) => post(t, `/assets/${a3}/maintenances`),
          { reason: "r" },
        ],
        [
          "POST /assets/:id/dispose",
          (t) => post(t, `/assets/${a3}/dispose`),
          { kind: "Lost", reason: "mất" },
        ],
        ["POST /assets/:id/recover", (t) => post(t, `/assets/${a3}/recover`), { reason: "thấy" }],
        ["POST /asset-inventories", (t) => post(t, "/asset-inventories"), { name: "KK" }],
      ];
      it.each(denies)("%s ⇒ 403 cho e1", async (_label, mk, body) => {
        const res = await mk(tE1).send(body);
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("ALLOW đối chứng: ca tạo/sửa loại, tạo/sửa hồ sơ, mở đợt kiểm kê", async () => {
        const c = await post(tCa, "/asset-categories").send({
          code: "MON",
          name: "Màn hình",
          codePrefix: "MH",
        });
        expect(c.status, JSON.stringify(c.body)).toBe(201);
        expect(
          (await patch(tCa, `/asset-categories/${c.body.data.id}`).send({ name: "Màn hình 2" }))
            .status,
        ).toBe(200);
        const p = await patch(tCa, `/assets/${a3}`).send({ location: "Kho tầng 3" });
        expect(p.status, JSON.stringify(p.body)).toBe(200);
        expect(p.body.data.location).toBe("Kho tầng 3");
      });

      it("không có cặp nào (user mới) ⇒ 403 cả GET /assets", async () => {
        const hash = await new PasswordService().hash(LOGIN_PW);
        await seedUser(direct, A.companyId, `noperm@${A.slug}.test`, hash);
        const t = await login(A.slug, `noperm@${A.slug}.test`);
        expect((await get(t, "/assets")).status).toBe(403);
        expect((await get(t, "/me/assets")).status).toBe(403);
      });
    });

    // ── B. Cross-tenant ⇒ 404 (kể cả actor @Company) ───────────────────────────

    describe("B. chéo tenant ⇒ 404 mọi đường", () => {
      it("cb (B, @Company) đọc/sửa/cấp phát tài sản của A ⇒ 404", async () => {
        expect((await get(tCb, `/assets/${a1}`)).status).toBe(404);
        expect((await get(tCb, `/assets/${a1}/assignments`)).status).toBe(404);
        expect((await get(tCb, `/assets/${a1}/maintenances`)).status).toBe(404);
        expect((await patch(tCb, `/assets/${a3}`).send({ name: "hack" })).status).toBe(404);
        expect((await del(tCb, `/assets/${a3}`)).status).toBe(404);
        expect((await post(tCb, `/assets/${a3}/assign`).send({ employeeId: e1Emp })).status).toBe(
          404,
        );
        expect((await post(tCb, `/assets/${a3}/maintenances`).send({ reason: "r" })).status).toBe(
          404,
        );
        expect(
          (await post(tCb, `/assets/${a3}/dispose`).send({ kind: "Lost", reason: "mất" })).status,
        ).toBe(404);
        expect((await patch(tCb, `/asset-categories/${catId}`).send({ name: "hack" })).status).toBe(
          404,
        );
        expect((await del(tCb, `/asset-categories/${catSpareId}`)).status).toBe(404);
      });

      it("tham chiếu chéo tenant trong body ⇒ 404 (categoryId của A khi cb tạo; employeeId của A khi cb cấp)", async () => {
        const r1 = await post(tCb, "/assets").send({ categoryId: catId, name: "x" });
        expect(r1.status, JSON.stringify(r1.body)).toBe(404);
        const r2 = await post(tCb, `/assets/${bAsset}/assign`).send({ employeeId: e1Emp });
        expect(r2.status, JSON.stringify(r2.body)).toBe(404);
        expect(r2.body.error.code).toBe("ASSET-ERR-NOT-FOUND");
      });

      it("ALLOW đối chứng: cb thấy tài sản của B; ca KHÔNG thấy tài sản của B trong danh sách", async () => {
        expect((await get(tCb, `/assets/${bAsset}`)).status).toBe(200);
        const list = await get(tCa, "/assets");
        expect(list.body.data.map((x: { id: string }) => x.id)).not.toContain(bAsset);
      });
    });

    // ── C. Masking + scope đọc ─────────────────────────────────────────────────

    describe("C. scope Own/Department/Company + masking tài chính & danh tính", () => {
      it("Company (ca): chi tiết có purchasePrice/supplier + currentHolder", async () => {
        const res = await get(tCa, `/assets/${a1}`);
        expect(res.status).toBe(200);
        expect(res.body.data.purchasePrice).toBe(45000000);
        expect(res.body.data.supplier).toBe("Apple VN");
        expect(res.body.data.currentHolder).toMatchObject({
          employeeId: e2Emp,
          fullName: "Nhân viên E2",
        });
        expect(res.body.data.counts.assignments).toBe(2);
      });

      it("Own (e2 đang giữ): 200, VẮNG KHOÁ purchasePrice/supplier, currentHolder = chính mình", async () => {
        const res = await get(tE2, `/assets/${a1}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect("purchasePrice" in res.body.data).toBe(false);
        expect("supplier" in res.body.data).toBe(false);
        expect(res.body.data.currentHolder).toMatchObject({ employeeId: e2Emp });
      });

      it("Own (e1 người giữ CŨ): vẫn thấy tài sản (lịch sử) nhưng VẮNG currentHolder + counts chỉ đếm lượt của mình", async () => {
        const res = await get(tE1, `/assets/${a1}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect("currentHolder" in res.body.data).toBe(false);
        expect(res.body.data.counts.assignments).toBe(1);
        const hist = await get(tE1, `/assets/${a1}/assignments`);
        expect(hist.body.data).toHaveLength(1);
        expect(hist.body.data[0].employeeId).toBe(e1Emp);
        expect(hist.body.data[0].status).toBe("Returned");
      });

      it("Own (out, chưa từng giữ a1) ⇒ 404 (không 403); tài sản In Stock ⇒ 404 cho mọi Own", async () => {
        expect((await get(tOut, `/assets/${a1}`)).status).toBe(404);
        expect((await get(tE1, `/assets/${a3}`)).status).toBe(404);
        expect((await get(tE2, `/assets/${a3}`)).status).toBe(404);
      });

      it("Department (mgr Sales): thấy a1 (holder e2 Sales) không giá, KHÔNG thấy a2 (holder Mkt) và a3 (kho)", async () => {
        const r1 = await get(tMgr, `/assets/${a1}`);
        expect(r1.status, JSON.stringify(r1.body)).toBe(200);
        expect("purchasePrice" in r1.body.data).toBe(false);
        expect(r1.body.data.currentHolder).toMatchObject({
          employeeId: e2Emp,
          fullName: "Nhân viên E2",
        });
        expect((await get(tMgr, `/assets/${a2}`)).status).toBe(404);
        expect((await get(tMgr, `/assets/${a3}`)).status).toBe(404);
        const list = await get(tMgr, "/assets");
        expect(list.body.data.map((x: { id: string }) => x.id)).toEqual([a1]);
        const hist = await get(tMgr, `/assets/${a1}/assignments`);
        expect(hist.body.data).toHaveLength(2); // e1 + e2 đều Sales
      });

      it("danh sách theo scope: ca 3 · e1 1 (lịch sử) · out 1 · e2 1; summary đếm trên tập của mình", async () => {
        const ids = async (t: string) =>
          (await get(t, "/assets?per_page=50")).body.data.map((x: { id: string }) => x.id).sort();
        expect(await ids(tCa)).toEqual([a1, a2, a3].sort());
        expect(await ids(tE1)).toEqual([a1]);
        expect(await ids(tE2)).toEqual([a1]);
        expect(await ids(tOut)).toEqual([a2]);
        const sCa = await get(tCa, "/assets/summary");
        expect(sCa.body.data.byStatus).toMatchObject({ Assigned: 2, "In Stock": 1 });
        const sE1 = await get(tE1, "/assets/summary");
        expect(sE1.body.data.byStatus).toMatchObject({ Assigned: 1, "In Stock": 0 });
      });

      it("holderEmployeeId là oracle — Own/Department ngoài scope ⇒ RỖNG; Company/trong scope ⇒ có", async () => {
        const q = (t: string, emp: string) => get(t, `/assets?holderEmployeeId=${emp}`);
        expect((await q(tE1, e2Emp)).body.data).toEqual([]); // e1 dò e2
        expect((await q(tMgr, outEmp)).body.data).toEqual([]); // mgr Sales dò Mkt
        expect((await q(tMgr, e2Emp)).body.data.map((x: { id: string }) => x.id)).toEqual([a1]);
        expect((await q(tCa, outEmp)).body.data.map((x: { id: string }) => x.id)).toEqual([a2]);
        expect((await q(tE2, e2Emp)).body.data.map((x: { id: string }) => x.id)).toEqual([a1]);
      });

      it("maintenances[].cost chỉ ở Company", async () => {
        const open = await post(tCa, `/assets/${a1}/maintenances`).send({ reason: "Thay pin" });
        expect(open.status, JSON.stringify(open.body)).toBe(201);
        const mid = open.body.data.openMaintenance.id as string;
        const close = await post(tCa, `/assets/${a1}/maintenances/${mid}/close`).send({
          cost: 1200000,
          resultNote: "OK",
        });
        expect(close.status, JSON.stringify(close.body)).toBe(201);
        expect(close.body.data.status).toBe("Assigned"); // còn lượt Active ⇒ về Assigned (dẫn xuất trong SQL)
        const ca = await get(tCa, `/assets/${a1}/maintenances`);
        expect(ca.body.data[0].cost).toBe(1200000);
        const mgr = await get(tMgr, `/assets/${a1}/maintenances`);
        expect(mgr.status).toBe(200);
        expect("cost" in mgr.body.data[0]).toBe(false);
        const e2 = await get(tE2, `/assets/${a1}/maintenances`);
        expect("cost" in e2.body.data[0]).toBe(false);
      });

      it("đợt kiểm kê: Own/Department danh sách RỖNG, chi tiết 404; Company đủ", async () => {
        const open = await post(tCa, "/asset-inventories").send({ name: "Kiểm kê Q3" });
        expect(open.status, JSON.stringify(open.body)).toBe(201);
        const inv = open.body.data.id as string;
        expect((await get(tE1, "/asset-inventories")).body.data).toEqual([]);
        expect((await get(tMgr, "/asset-inventories")).body.data).toEqual([]);
        expect((await get(tE1, `/asset-inventories/${inv}`)).status).toBe(404);
        expect((await get(tMgr, `/asset-inventories/${inv}/items`)).status).toBe(404);
        expect((await get(tCa, `/asset-inventories/${inv}`)).status).toBe(200);
        expect(
          (await get(tCa, "/asset-inventories")).body.data.map((x: { id: string }) => x.id),
        ).toContain(inv);
        expect((await post(tCa, `/asset-inventories/${inv}/close`).send({})).status).toBe(201);
      });
    });

    // ── D. /me/assets ──────────────────────────────────────────────────────────

    describe("D. /me/assets — employee từ token, không tài chính bất kể scope", () => {
      it("e2 thấy a1 (Active) không giá; ?employeeId= bị bỏ qua", async () => {
        const res = await get(tE2, `/me/assets?employeeId=${e1Emp}`);
        expect(res.status).toBe(200);
        expect(res.body.data.map((x: { assetId: string }) => x.assetId)).toEqual([a1]);
        expect("purchasePrice" in res.body.data[0]).toBe(false);
        expect(res.body.pagination.total).toBe(1);
      });

      it("e1: 0 Active; includeReturned=true ⇒ 1 lượt Returned", async () => {
        expect((await get(tE1, "/me/assets")).body.data).toEqual([]);
        const r = await get(tE1, "/me/assets?includeReturned=true");
        expect(r.body.data).toHaveLength(1);
        expect(r.body.data[0].assignmentStatus).toBe("Returned");
      });

      it("ca (@Company) gọi /me/assets ⇒ chỉ của mình (0), không phải toàn công ty", async () => {
        expect((await get(tCa, "/me/assets?includeReturned=true")).body.data).toEqual([]);
      });
    });

    // ── E. includeDeleted + validate biên ──────────────────────────────────────

    describe("E. includeDeleted bỏ qua khi thiếu manage; validate 400 không 500", () => {
      it("ca xoá loại dự phòng; e1 ?includeDeleted=true ⇒ 200 KHÔNG thấy; ca thấy deleted=true", async () => {
        expect((await del(tCa, `/asset-categories/${catSpareId}`)).status).toBe(204);
        const e1 = await get(tE1, "/asset-categories?includeDeleted=true");
        expect(e1.status).toBe(200);
        expect(e1.body.data.map((x: { id: string }) => x.id)).not.toContain(catSpareId);
        const ca = await get(tCa, "/asset-categories?includeDeleted=true");
        const spare = ca.body.data.find((x: { id: string }) => x.id === catSpareId);
        expect(spare?.deleted).toBe(true);
        expect(
          (await get(tCa, "/asset-categories")).body.data.map((x: { id: string }) => x.id),
        ).not.toContain(catSpareId);
      });

      it("chuỗi quá dài ⇒ 400; PATCH có assetCode/status ⇒ 400; PATCH rỗng ⇒ 400; id không UUID ⇒ 400", async () => {
        const long = await post(tCa, "/assets").send({ categoryId: catId, name: "x".repeat(300) });
        expect(long.status).toBe(400);
        expect(long.body.error.code).toBe("VALIDATION-ERR-001");
        expect((await patch(tCa, `/assets/${a3}`).send({ status: "Lost" })).status).toBe(400);
        expect((await patch(tCa, `/assets/${a3}`).send({ assetCode: "TS-XX-0001" })).status).toBe(
          400,
        );
        expect((await patch(tCa, `/assets/${a3}`).send({})).status).toBe(400);
        expect((await get(tCa, "/assets/not-a-uuid")).status).toBe(400);
        expect((await get(tCa, "/assets/summary")).status).toBe(200); // 'summary' không bị nuốt thành :id
      });
    });
  },
);
