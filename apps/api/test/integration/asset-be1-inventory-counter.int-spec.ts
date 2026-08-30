/**
 * S11-ASSET-BE-1 — kiểm kê (SPEC-13 §13.4 · ASSET-API-018..022) + counter mã tài sản/loại (SPEC-13 §13.5 ·
 * ASSET-API-001..004 · ASSET-ERR-010): ảnh chụp lọc Disposed/Lost, tài sản tạo SAU không vào đợt, đánh dấu
 * đơn/bulk, >200 ⇒ 400, đóng đợt tổng kết = đếm thật (tính trong SQL), đóng 2 lần ⇒ 409 007; counter tạo cùng
 * loại, mã TS-<PREFIX>-0001/0002, prefix-taken kèm categoryId+deleted, restore giữ counter, prefix-locked,
 * has-assets, counter thiếu ⇒ 409 COUNTER-MISSING (không 500).
 *
 * GATE CỨNG `hasDb && LANE_DB`.
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
const LOGIN_PW = "Passw0rd!assetinv";

const ASSET_ALL: Array<[string, string, "Own" | "Company"]> = [
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

describe.skipIf(!hasLaneDb)("S11-ASSET-BE-1 kiểm kê + counter mã (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];
  let tCa = "";
  let emp = "";

  const http = () => request(app.getHttpServer());
  const get = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
  const post = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
  const patch = (t: string, u: string) => http().patch(u).set("Authorization", `Bearer ${t}`);
  const del = (t: string, u: string) => http().delete(u).set("Authorization", `Bearer ${t}`);
  const code = (res: request.Response) => res.body?.error?.code as string | undefined;
  const detail = (res: request.Response, field: string) =>
    (res.body?.error?.details as Array<{ field: string; message: string }> | null)?.find(
      (d) => d.field === field,
    )?.message;

  async function newCategory(codeStr: string, prefix: string) {
    const res = await post(tCa, "/asset-categories").send({
      code: codeStr,
      name: `Loại ${codeStr}`,
      codePrefix: prefix,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }
  async function newAsset(categoryId: string, name: string) {
    const res = await post(tCa, "/assets").send({ categoryId, name });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as { id: string; assetCode: string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "assetinv");
    companyIds.push(A.companyId);
    const ca = await seedUser(direct, A.companyId, `ca@${A.slug}.test`, hash);
    const e1 = await seedUser(direct, A.companyId, `e1@${A.slug}.test`, hash);
    const empOf = async (u: string) =>
      (
        await direct.query(
          "INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,'active') RETURNING id",
          [A.companyId, u],
        )
      ).rows[0].id as string;
    await empOf(ca);
    emp = await empOf(e1);
    const roleId = await seedRole(direct, A.companyId, "asset-inv-ca");
    for (const [a, r, s] of ASSET_ALL) {
      await seedRolePermission(
        direct,
        roleId,
        await seedPermissionCatalog(direct, a, r, false),
        "ALLOW",
        s,
      );
    }
    await seedUserRole(direct, ca, roleId, A.companyId);
    const login = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email: `ca@${A.slug}.test`, password: LOGIN_PW });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    tCa = login.body.data.accessToken;
  }, 120_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  describe("counter + loại (001..004 · 013.5)", () => {
    it("tạo loại ⇒ counter scope Custom tồn tại; 2 tài sản ⇒ TS-LT-0001/0002", async () => {
      const cat = await newCategory("LAPTOP", "LT");
      const c = await direct.query(
        "SELECT prefix, scope_type, current_value FROM sequence_counters WHERE company_id=$1 AND sequence_key='asset_code' AND scope_reference_id=$2",
        [A.companyId, cat],
      );
      expect(c.rows).toHaveLength(1);
      expect(c.rows[0]).toMatchObject({ prefix: "TS-LT-", scope_type: "Custom" });
      const a1 = await newAsset(cat, "L1");
      const a2 = await newAsset(cat, "L2");
      expect(a1.assetCode).toBe("TS-LT-0001");
      expect(a2.assetCode).toBe("TS-LT-0002");
    });

    it("code trùng loại đang sống ⇒ 409 010 code-taken; xoá mềm rồi dùng lại code ⇒ OK (partial unique)", async () => {
      const cat = await newCategory("DUPC", "DC");
      const dup = await post(tCa, "/asset-categories").send({
        code: "DUPC",
        name: "x",
        codePrefix: "DC2",
      });
      expect(dup.status).toBe(409);
      expect(code(dup)).toBe("ASSET-ERR-010");
      expect(detail(dup, "kind")).toBe("code-taken");
      expect((await del(tCa, `/asset-categories/${cat}`)).status).toBe(204);
      const reuse = await post(tCa, "/asset-categories").send({
        code: "DUPC",
        name: "x",
        codePrefix: "DC3",
      });
      expect(reuse.status, JSON.stringify(reuse.body)).toBe(201);
    });

    it("prefix KHÔNG cấp lại kể cả loại đã xoá ⇒ 409 prefix-taken + categoryId + deleted=true; restore ⇒ tiếp counter", async () => {
      const cat = await newCategory("PHONE", "PH");
      await newAsset(cat, "P1");
      expect((await del(tCa, `/asset-categories/${cat}`)).status).toBe(409); // còn tài sản In Stock ⇒ has-assets
      const a = await newAsset(cat, "P2");
      await post(tCa, `/assets/${a.id}/dispose`).send({ kind: "Disposed", reason: "hỏng hẳn" });
      const first = (await get(tCa, `/assets?categoryId=${cat}`)).body.data as Array<{
        id: string;
      }>;
      for (const x of first) {
        const st = (await get(tCa, `/assets/${x.id}`)).body.data.status;
        if (st === "In Stock")
          await post(tCa, `/assets/${x.id}/dispose`).send({
            kind: "Disposed",
            reason: "thanh lý hết",
          });
      }
      expect((await del(tCa, `/asset-categories/${cat}`)).status).toBe(204);

      const taken = await post(tCa, "/asset-categories").send({
        code: "PHONE2",
        name: "x",
        codePrefix: "PH",
      });
      expect(taken.status).toBe(409);
      expect(code(taken)).toBe("ASSET-ERR-010");
      expect(detail(taken, "kind")).toBe("prefix-taken");
      expect(detail(taken, "categoryId")).toBe(cat);
      expect(detail(taken, "deleted")).toBe("true");

      expect(
        (await get(tCa, "/asset-categories")).body.data.map((c: { id: string }) => c.id),
      ).not.toContain(cat);
      expect(
        (await patch(tCa, `/asset-categories/${cat}`).send({ name: "no-restore" })).status,
      ).toBe(404); // id đã xoá chỉ nhận ở restore
      const restored = await patch(tCa, `/asset-categories/${cat}`).send({
        restore: true,
        name: "Điện thoại (khôi phục)",
      });
      expect(restored.status, JSON.stringify(restored.body)).toBe(200);
      expect(restored.body.data.name).toBe("Điện thoại (khôi phục)");
      const a3 = await newAsset(cat, "P3");
      expect(a3.assetCode).toBe("TS-PH-0003"); // counter giữ, không reset
    });

    it("đổi codePrefix khi đã sinh mã ⇒ 409 prefix-locked; chưa sinh mã ⇒ OK + counter đồng bộ prefix", async () => {
      const used = await newCategory("USED", "US");
      await newAsset(used, "U1");
      const locked = await patch(tCa, `/asset-categories/${used}`).send({ codePrefix: "UZ" });
      expect(locked.status).toBe(409);
      expect(detail(locked, "kind")).toBe("prefix-locked");
      const fresh = await newCategory("FRESH", "FR");
      const ok = await patch(tCa, `/asset-categories/${fresh}`).send({ codePrefix: "FX" });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const a = await newAsset(fresh, "F1");
      expect(a.assetCode).toBe("TS-FX-0001");
    });

    it("vô hiệu/xoá loại còn tài sản chưa Disposed/Lost ⇒ 409 has-assets; loại vô hiệu ⇒ tạo hồ sơ 409", async () => {
      const cat = await newCategory("ACT", "AC");
      await newAsset(cat, "A1");
      const off = await patch(tCa, `/asset-categories/${cat}`).send({ isActive: false });
      expect(off.status).toBe(409);
      expect(detail(off, "kind")).toBe("has-assets");
      const empty = await newCategory("EMP", "EM");
      expect(
        (await patch(tCa, `/asset-categories/${empty}`).send({ isActive: false })).status,
      ).toBe(200);
      const blocked = await post(tCa, "/assets").send({ categoryId: empty, name: "x" });
      expect(blocked.status).toBe(409);
      expect(detail(blocked, "kind")).toBe("category-inactive");
    });

    it("counter bị xoá tay ⇒ tạo hồ sơ 409 ASSET-ERR-COUNTER-MISSING (không 500)", async () => {
      const cat = await newCategory("NOCNT", "NC");
      await direct.query(
        "DELETE FROM sequence_counters WHERE company_id=$1 AND scope_reference_id=$2",
        [A.companyId, cat],
      );
      const res = await post(tCa, "/assets").send({ categoryId: cat, name: "x" });
      expect(res.status).toBe(409);
      expect(code(res)).toBe("ASSET-ERR-COUNTER-MISSING");
    });

    it("body sai định dạng ⇒ 400: prefix thường, interval 0, code quá dài", async () => {
      expect(
        (await post(tCa, "/asset-categories").send({ code: "X1", name: "x", codePrefix: "ab" }))
          .status,
      ).toBe(400);
      expect(
        (
          await post(tCa, "/asset-categories").send({
            code: "X2",
            name: "x",
            codePrefix: "AB",
            defaultMaintenanceIntervalDays: 0,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post(tCa, "/asset-categories").send({
            code: "x".repeat(40),
            name: "x",
            codePrefix: "AB",
          })
        ).status,
      ).toBe(400);
    });
  });

  describe("kiểm kê (018..022)", () => {
    it("mở đợt: ảnh chụp lọc Disposed/Lost + expected_holder; tài sản tạo SAU không vào; đánh dấu; đóng tổng kết; đóng 2 lần 409", async () => {
      const cat = await newCategory("KK", "KK");
      const stock = await newAsset(cat, "K-stock");
      const held = await newAsset(cat, "K-held");
      const gone = await newAsset(cat, "K-gone");
      const lost = await newAsset(cat, "K-lost");
      expect((await post(tCa, `/assets/${held.id}/assign`).send({ employeeId: emp })).status).toBe(
        201,
      );
      expect(
        (
          await post(tCa, `/assets/${gone.id}/dispose`).send({
            kind: "Disposed",
            reason: "hỏng hẳn",
          })
        ).status,
      ).toBe(201);
      expect(
        (await post(tCa, `/assets/${lost.id}/dispose`).send({ kind: "Lost", reason: "mất rồi" }))
          .status,
      ).toBe(201);

      const open = await post(tCa, "/asset-inventories").send({
        name: "Kiểm kê KK",
        categoryId: cat,
      });
      expect(open.status, JSON.stringify(open.body)).toBe(201);
      const inv = open.body.data.id as string;
      expect(open.body.data.status).toBe("Open");

      const late = await newAsset(cat, "K-late");
      const items = await get(tCa, `/asset-inventories/${inv}/items?per_page=50`);
      expect(items.status).toBe(200);
      const byAsset = new Map<
        string,
        {
          id: string;
          expectedStatus: string;
          expectedHolderEmployeeId: string | null;
          result: string;
        }
      >(items.body.data.map((x: { assetId: string }) => [x.assetId, x]));
      expect([...byAsset.keys()].sort()).toEqual([stock.id, held.id].sort());
      expect(byAsset.get(held.id)).toMatchObject({
        expectedStatus: "Assigned",
        expectedHolderEmployeeId: emp,
        result: "Not Checked",
      });
      expect(byAsset.get(stock.id)).toMatchObject({
        expectedStatus: "In Stock",
        expectedHolderEmployeeId: null,
      });
      expect(byAsset.has(late.id)).toBe(false);
      expect(byAsset.has(gone.id)).toBe(false);
      expect(byAsset.has(lost.id)).toBe(false);

      const one = await patch(
        tCa,
        `/asset-inventories/${inv}/items/${byAsset.get(stock.id)!.id}`,
      ).send({ result: "Found", note: "ok" });
      expect(one.status, JSON.stringify(one.body)).toBe(204);
      const bulk = await post(tCa, `/asset-inventories/${inv}/items/bulk-mark`).send({
        itemIds: [byAsset.get(held.id)!.id],
        result: "Missing",
      });
      expect(bulk.status, JSON.stringify(bulk.body)).toBe(204);
      const found = await get(tCa, `/asset-inventories/${inv}/items?result=Found`);
      expect(found.body.data).toHaveLength(1);

      // "Not Checked" không thể tự đặt qua API; item lạ ⇒ 404; >200 ⇒ 400
      expect(
        (
          await patch(tCa, `/asset-inventories/${inv}/items/${byAsset.get(stock.id)!.id}`).send({
            result: "Not Checked",
          })
        ).status,
      ).toBe(400);
      const ghost = await post(tCa, `/asset-inventories/${inv}/items/bulk-mark`).send({
        itemIds: ["00000000-0000-4000-8000-0000000000aa"],
        result: "Found",
      });
      expect(ghost.status).toBe(404);
      const tooMany = await post(tCa, `/asset-inventories/${inv}/items/bulk-mark`).send({
        itemIds: Array.from(
          { length: 201 },
          (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        ),
        result: "Found",
      });
      expect(tooMany.status).toBe(400);

      const close = await post(tCa, `/asset-inventories/${inv}/close`).send({ note: "xong" });
      expect(close.status, JSON.stringify(close.body)).toBe(201);
      expect(close.body.data).toMatchObject({
        status: "Closed",
        totalItems: 2,
        foundCount: 1,
        missingCount: 1,
        notCheckedCount: 0,
        note: "xong",
      });
      // KHÔNG đổi trạng thái tài sản Missing
      expect((await get(tCa, `/assets/${held.id}`)).body.data.status).toBe("Assigned");

      const again = await post(tCa, `/asset-inventories/${inv}/close`).send({});
      expect(again.status).toBe(409);
      expect(code(again)).toBe("ASSET-ERR-007");
      const markClosed = await post(tCa, `/asset-inventories/${inv}/items/bulk-mark`).send({
        itemIds: [byAsset.get(stock.id)!.id],
        result: "Found",
      });
      expect(markClosed.status).toBe(409);
      expect(code(markClosed)).toBe("ASSET-ERR-007");

      // 1 đợt Open/company: mở đợt mới sau khi đóng ⇒ OK; mở đợt thứ 2 khi còn Open ⇒ 409 006
      const open2 = await post(tCa, "/asset-inventories").send({ name: "Toàn bộ" });
      expect(open2.status).toBe(201);
      const open3 = await post(tCa, "/asset-inventories").send({ name: "Trùng" });
      expect(open3.status).toBe(409);
      expect(code(open3)).toBe("ASSET-ERR-006");
      expect(
        (await post(tCa, `/asset-inventories/${open2.body.data.id}/close`).send({})).status,
      ).toBe(201);
      const list = await get(tCa, "/asset-inventories?status=Closed&per_page=50");
      expect(list.body.data.map((x: { id: string }) => x.id)).toEqual(
        expect.arrayContaining([inv, open2.body.data.id]),
      );
    });

    it("mở đợt với categoryId ngoài tenant/không tồn tại ⇒ 404", async () => {
      const res = await post(tCa, "/asset-inventories").send({
        name: "x",
        categoryId: "00000000-0000-4000-8000-0000000000bb",
      });
      expect(res.status).toBe(404);
      expect(code(res)).toBe("ASSET-ERR-NOT-FOUND");
    });
  });
});
