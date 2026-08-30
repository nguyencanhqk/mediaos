/**
 * S11-ASSET-BE-1 — FSM + vòng đời (SPEC-13 §13.1–13.3 · §12): mọi ô ✗ ⇒ 409 ASSET-ERR-001 (trừ Assigned→Disposed =
 * 008), guard 008 theo SỰ TỒN TẠI lượt Active, revoke khi Under Maintenance giữ status, revoke/dispose Lost đóng
 * lượt bảo trì Open, đóng bảo trì dẫn xuất trạng thái trong SQL, 003/004/005/014/015, và RACE 2 request song song
 * ⇒ đúng 1 thắng + 1 4xx (không 500). Đường thật qua HTTP; actor = ca @Company (không super-admin).
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
const LOGIN_PW = "Passw0rd!assetfsm";

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

describe.skipIf(!hasLaneDb)("S11-ASSET-BE-1 FSM + vòng đời (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];
  let tCa = "";
  let catId = "";
  let empActive = "";
  let empResigned = "";

  const http = () => request(app.getHttpServer());
  const get = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
  const post = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
  const del = (t: string, u: string) => http().delete(u).set("Authorization", `Bearer ${t}`);

  const code = (res: request.Response) => res.body?.error?.code as string | undefined;
  const kind = (res: request.Response) =>
    (res.body?.error?.details as Array<{ field: string; message: string }> | null)?.find(
      (d) => d.field === "kind",
    )?.message;

  async function newAsset(name: string): Promise<string> {
    const res = await post(tCa, "/assets").send({ categoryId: catId, name });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }
  const status = async (id: string) => (await get(tCa, `/assets/${id}`)).body.data.status as string;
  const assign = (id: string, emp = empActive) =>
    post(tCa, `/assets/${id}/assign`).send({ employeeId: emp });
  const revoke = (id: string, returnCondition = "Good", returnNote?: string) =>
    post(tCa, `/assets/${id}/revoke`).send({ returnCondition, returnNote });
  const openM = (id: string) =>
    post(tCa, `/assets/${id}/maintenances`).send({ reason: "Bảo trì định kỳ" });
  const closeM = (id: string, mid: string, body: Record<string, unknown> = {}) =>
    post(tCa, `/assets/${id}/maintenances/${mid}/close`).send(body);
  const dispose = (id: string, k: "Disposed" | "Lost") =>
    post(tCa, `/assets/${id}/dispose`).send({ kind: k, reason: "lý do đủ dài" });
  const recover = (id: string) =>
    post(tCa, `/assets/${id}/recover`).send({ reason: "tìm thấy lại" });
  const openId = async (id: string) =>
    (await get(tCa, `/assets/${id}`)).body.data.openMaintenance?.id as string | null;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "assetfsm");
    companyIds.push(A.companyId);
    const ca = await seedUser(direct, A.companyId, `ca@${A.slug}.test`, hash);
    const e1 = await seedUser(direct, A.companyId, `e1@${A.slug}.test`, hash);
    const e2 = await seedUser(direct, A.companyId, `e2@${A.slug}.test`, hash);
    const ou = (
      await direct.query(
        "INSERT INTO org_units (company_id, name, type) VALUES ($1,'Ops','department') RETURNING id",
        [A.companyId],
      )
    ).rows[0].id as string;
    const emp = async (u: string, st: string) =>
      (
        await direct.query(
          "INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status) VALUES ($1,$2,$3,$4) RETURNING id",
          [A.companyId, u, ou, st],
        )
      ).rows[0].id as string;
    await emp(ca, "active");
    empActive = await emp(e1, "active");
    empResigned = await emp(e2, "resigned");
    const roleId = await seedRole(direct, A.companyId, "asset-fsm-ca");
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
    const cat = await post(tCa, "/asset-categories").send({
      code: "PC",
      name: "Máy tính",
      codePrefix: "PC",
    });
    expect(cat.status, JSON.stringify(cat.body)).toBe(201);
    catId = cat.body.data.id;
  }, 120_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  describe("cấp phát / thu hồi (010/011) — 001 · 002 · 003 · 016", () => {
    it("In Stock → Assigned → In Stock; cấp lại khi đang Assigned ⇒ 409 001; thu hồi khi In Stock ⇒ 409", async () => {
      const id = await newAsset("F1");
      const r1 = await assign(id);
      expect(r1.status, JSON.stringify(r1.body)).toBe(201);
      expect(r1.body.data.status).toBe("Assigned");
      const dup = await assign(id);
      expect(dup.status).toBe(409);
      expect(code(dup)).toBe("ASSET-ERR-001");
      const r2 = await revoke(id, "Damaged", "trầy vỏ");
      expect(r2.status).toBe(201);
      expect(r2.body.data.status).toBe("In Stock");
      expect(r2.body.data.conditionNote).toBe("trầy vỏ");
      const r3 = await revoke(id);
      expect(r3.status).toBe(409);
      expect(code(r3)).toBe("ASSET-ERR-001"); // In Stock không có ô revoke ⇒ FSM chặn trước cả 003
    });

    it("nhân viên không thuộc company ⇒ 404 kind employee-not-found; nghỉ việc ⇒ 422 employee-inactive", async () => {
      const id = await newAsset("F2");
      const ghost = await assign(id, "00000000-0000-4000-8000-000000000001");
      expect(ghost.status).toBe(404);
      expect(code(ghost)).toBe("ASSET-ERR-NOT-FOUND");
      const inactive = await assign(id, empResigned);
      expect(inactive.status).toBe(422);
      expect(code(inactive)).toBe("ASSET-ERR-002");
      expect(kind(inactive)).toBe("employee-inactive");
      expect(await status(id)).toBe("In Stock"); // rollback sạch
    });

    it("thu hồi thiếu/sai returnCondition ⇒ 400 (Zod = 016 ở biên)", async () => {
      const id = await newAsset("F3");
      await assign(id);
      expect((await post(tCa, `/assets/${id}/revoke`).send({})).status).toBe(400);
      expect(
        (await post(tCa, `/assets/${id}/revoke`).send({ returnCondition: "Broken" })).status,
      ).toBe(400);
      expect(await status(id)).toBe("Assigned");
    });

    it("thu hồi Lost ⇒ tài sản Lost + status_reason; recover ⇒ In Stock; recover khi không Lost ⇒ 409 001", async () => {
      const id = await newAsset("F4");
      await assign(id);
      const r = await revoke(id, "Lost", "mất ở sân bay");
      expect(r.status).toBe(201);
      expect(r.body.data.status).toBe("Lost");
      expect(r.body.data.statusReason).toBe("mất ở sân bay");
      expect((await assign(id)).status).toBe(409);
      const rec = await recover(id);
      expect(rec.status).toBe(201);
      expect(rec.body.data.status).toBe("In Stock");
      const again = await recover(id);
      expect(again.status).toBe(409);
      expect(code(again)).toBe("ASSET-ERR-001");
    });
  });

  describe("bảo trì (013/014) — 004 · 005 · 014 · dẫn xuất trạng thái", () => {
    it("mở khi Assigned giữ lượt Active; mở lần 2 ⇒ 409 004 (không 001); đóng ⇒ về Assigned (còn lượt)", async () => {
      const id = await newAsset("M1");
      await assign(id);
      const o = await openM(id);
      expect(o.status, JSON.stringify(o.body)).toBe(201);
      expect(o.body.data.status).toBe("Under Maintenance");
      expect(o.body.data.currentHolder?.employeeId).toBe(empActive);
      const o2 = await openM(id);
      expect(o2.status).toBe(409);
      expect(code(o2)).toBe("ASSET-ERR-004");
      const mid = (await openId(id))!;
      const c = await closeM(id, mid, { nextDueDate: "2099-01-01" });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      expect(c.body.data.status).toBe("Assigned");
      expect(c.body.data.nextMaintenanceDue).toBe("2099-01-01");
      expect(c.body.data.openMaintenance).toBeNull();
    });

    it("đóng lượt khi 0 lượt Active ⇒ In Stock; đóng lần 2 ⇒ 409 005 already-closed; lượt lạ ⇒ 404 005 kind", async () => {
      const id = await newAsset("M2");
      const o = await openM(id);
      const mid = (await openId(id))!;
      expect(o.body.data.status).toBe("Under Maintenance");
      const c = await closeM(id, mid);
      expect(c.body.data.status).toBe("In Stock");
      const c2 = await closeM(id, mid);
      expect(c2.status).toBe(409);
      expect(code(c2)).toBe("ASSET-ERR-005");
      expect(kind(c2)).toBe("already-closed");
      const other = await newAsset("M2b");
      const wrong = await closeM(other, mid);
      expect(wrong.status).toBe(404);
      expect(code(wrong)).toBe("ASSET-ERR-NOT-FOUND");
    });

    it("nextDueDate ≤ hôm nay ⇒ 422 014 (lượt vẫn Open)", async () => {
      const id = await newAsset("M3");
      await openM(id);
      const mid = (await openId(id))!;
      const bad = await closeM(id, mid, { nextDueDate: "2020-01-01" });
      expect(bad.status).toBe(422);
      expect(code(bad)).toBe("ASSET-ERR-014");
      expect(await openId(id)).toBe(mid);
    });

    it("thu hồi khi Under Maintenance: Good ⇒ status GIỮ NGUYÊN (lượt → Returned); sau đóng bảo trì ⇒ In Stock", async () => {
      const id = await newAsset("M4");
      await assign(id);
      await openM(id);
      const r = await revoke(id, "Good");
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.data.status).toBe("Under Maintenance");
      expect("currentHolder" in r.body.data).toBe(false);
      const mid = (await openId(id))!;
      const c = await closeM(id, mid);
      expect(c.body.data.status).toBe("In Stock");
    });

    it("thu hồi Lost khi Under Maintenance ⇒ Lost VÀ lượt bảo trì Open tự đóng (recover rồi mở lại được)", async () => {
      const id = await newAsset("M5");
      await assign(id);
      await openM(id);
      const r = await revoke(id, "Lost", "rơi sông");
      expect(r.status).toBe(201);
      expect(r.body.data.status).toBe("Lost");
      expect(r.body.data.openMaintenance).toBeNull();
      const rows = await direct.query("SELECT status FROM asset_maintenances WHERE asset_id = $1", [
        id,
      ]);
      expect(rows.rows.map((x) => x.status)).toEqual(["Closed"]);
      await recover(id);
      const reopen = await openM(id);
      expect(reopen.status, JSON.stringify(reopen.body)).toBe(201); // uq_asset_maintenances_open không còn chiếm
    });
  });

  describe("thanh lý / mất (016) — 008 theo lượt Active, tự đóng sổ, Disposed là cuối", () => {
    it("Assigned + dispose(Disposed) ⇒ 409 008 (không 001); revoke rồi ⇒ Disposed; mọi hành động sau ⇒ 409 001", async () => {
      const id = await newAsset("D1");
      await assign(id);
      const blocked = await dispose(id, "Disposed");
      expect(blocked.status).toBe(409);
      expect(code(blocked)).toBe("ASSET-ERR-008");
      await revoke(id);
      const ok = await dispose(id, "Disposed");
      expect(ok.status).toBe(201);
      expect(ok.body.data.status).toBe("Disposed");
      for (const r of [
        await assign(id),
        await revoke(id),
        await openM(id),
        await dispose(id, "Lost"),
        await recover(id),
      ]) {
        expect(r.status).toBe(409);
        expect(code(r)).toBe("ASSET-ERR-001");
      }
    });

    it("Under Maintenance còn lượt Active + Disposed ⇒ 008; không còn lượt ⇒ Disposed + lượt bảo trì đóng", async () => {
      const id = await newAsset("D2");
      await assign(id);
      await openM(id);
      const blocked = await dispose(id, "Disposed");
      expect(blocked.status).toBe(409);
      expect(code(blocked)).toBe("ASSET-ERR-008");
      await revoke(id, "Good"); // giữ Under Maintenance, không còn Active
      const ok = await dispose(id, "Disposed");
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.data.status).toBe("Disposed");
      expect(ok.body.data.openMaintenance).toBeNull();
    });

    it("Assigned + dispose(Lost) ⇒ Lost, lượt Active tự đóng return_condition=Lost", async () => {
      const id = await newAsset("D3");
      await assign(id);
      const r = await dispose(id, "Lost");
      expect(r.status).toBe(201);
      expect(r.body.data.status).toBe("Lost");
      const hist = await get(tCa, `/assets/${id}/assignments`);
      expect(hist.body.data[0]).toMatchObject({ status: "Returned", returnCondition: "Lost" });
    });

    it("reason < 3 ký tự ⇒ 400 (009 ở biên)", async () => {
      const id = await newAsset("D4");
      expect(
        (await post(tCa, `/assets/${id}/dispose`).send({ kind: "Lost", reason: "ab" })).status,
      ).toBe(400);
      expect(await status(id)).toBe("In Stock");
    });
  });

  describe("audit_logs — mọi mutation có vết, snapshot KHÔNG tiền (BẤT BIẾN #3)", () => {
    const auditRows = async (objectId: string) =>
      (
        await direct.query(
          `SELECT action, object_type AS "objectType", before, after
             FROM audit_logs WHERE company_id = $1 AND object_id = $2 ORDER BY created_at`,
          [A.companyId, objectId],
        )
      ).rows as Array<{
        action: string;
        objectType: string;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
      }>;

    it("assign/revoke(Lost khi bảo trì)/dispose/recover ⇒ đúng object_type + action; after không có purchasePrice; lượt bảo trì đóng ép có vết", async () => {
      const cre = await post(tCa, "/assets").send({
        categoryId: catId,
        name: "AUD",
        purchasePrice: 999,
        supplier: "S",
      });
      const id = cre.body.data.id as string;
      const r1 = await assign(id);
      const assignmentId = (
        await direct.query("SELECT id FROM asset_assignments WHERE asset_id=$1", [id])
      ).rows[0].id as string;
      expect(r1.status).toBe(201);
      await openM(id);
      await revoke(id, "Lost", "mất");
      await recover(id);
      await dispose(id, "Disposed");

      const asset = await auditRows(id);
      expect(asset.map((a) => a.action)).toEqual([
        "AssetCreated",
        "AssetRecovered",
        "AssetDisposed",
      ]);
      expect(asset.every((a) => a.objectType === "asset")).toBe(true);
      for (const a of asset) {
        expect(JSON.stringify(a.after)).not.toContain("purchasePrice");
        expect(JSON.stringify(a.after)).not.toContain("supplier");
      }
      expect(asset[2].after?.status).toBe("Disposed");

      const lot = await auditRows(assignmentId);
      expect(lot.map((a) => `${a.objectType}:${a.action}`)).toEqual([
        "asset_assignment:AssetAssigned",
        "asset_assignment:AssetRevokedLost",
      ]);
      // lượt bảo trì bị đóng ép khi thu hồi Lost ⇒ có vết trong after (gate M4)
      expect(
        (lot[1].after as { closedMaintenance?: { status?: string } }).closedMaintenance?.status,
      ).toBe("Closed");
      const mnt = await direct.query(
        "SELECT count(*)::int AS n FROM audit_logs WHERE company_id=$1 AND object_type='asset_maintenance'",
        [A.companyId],
      );
      expect(mnt.rows[0].n).toBeGreaterThan(0);
    });
  });

  describe("xoá mềm (009) — 015", () => {
    it("In Stock + 0 lịch sử ⇒ 204; có lịch sử ⇒ 409 015; Assigned ⇒ 409 015", async () => {
      const fresh = await newAsset("X1");
      expect((await del(tCa, `/assets/${fresh}`)).status).toBe(204);
      expect((await get(tCa, `/assets/${fresh}`)).status).toBe(404);
      const used = await newAsset("X2");
      await assign(used);
      const r1 = await del(tCa, `/assets/${used}`);
      expect(r1.status).toBe(409);
      expect(code(r1)).toBe("ASSET-ERR-015");
      await revoke(used);
      const r2 = await del(tCa, `/assets/${used}`);
      expect(r2.status).toBe(409);
      expect(kind(r2)).toBe("has-history");
    });
  });

  describe("ngày (014) + serial (011)", () => {
    it("purchaseDate tương lai ⇒ 422; warranty < purchase (PATCH chỉ gửi warranty, hợp nhất với hàng đã lưu) ⇒ 422", async () => {
      const fut = await post(tCa, "/assets").send({
        categoryId: catId,
        name: "N1",
        purchaseDate: "2999-01-01",
      });
      expect(fut.status).toBe(422);
      expect(code(fut)).toBe("ASSET-ERR-014");
      const okRes = await post(tCa, "/assets").send({
        categoryId: catId,
        name: "N2",
        purchaseDate: "2026-01-10",
        warrantyEndDate: "2027-01-10",
      });
      expect(okRes.status).toBe(201);
      const bad = await http()
        .patch(`/assets/${okRes.body.data.id}`)
        .set("Authorization", `Bearer ${tCa}`)
        .send({ warrantyEndDate: "2025-12-31" });
      expect(bad.status).toBe(422);
      expect(code(bad)).toBe("ASSET-ERR-014");
    });

    it("serial trùng ⇒ 409 011 serial-taken (kể cả PATCH)", async () => {
      const s1 = await post(tCa, "/assets").send({
        categoryId: catId,
        name: "S1",
        serialNumber: "DUP-1",
      });
      expect(s1.status).toBe(201);
      const s2 = await post(tCa, "/assets").send({
        categoryId: catId,
        name: "S2",
        serialNumber: "DUP-1",
      });
      expect(s2.status).toBe(409);
      expect(code(s2)).toBe("ASSET-ERR-011");
      expect(kind(s2)).toBe("serial-taken");
      const s3 = await newAsset("S3");
      const p = await http()
        .patch(`/assets/${s3}`)
        .set("Authorization", `Bearer ${tCa}`)
        .send({ serialNumber: "DUP-1" });
      expect(p.status).toBe(409);
      expect(kind(p)).toBe("serial-taken");
    });
  });

  describe("RACE — 2 request song song ⇒ đúng 1 thắng, 1 trả 4xx (không 500)", () => {
    it("2 assign song song cùng tài sản", async () => {
      const id = await newAsset("R1");
      const [x, y] = await Promise.all([assign(id), assign(id)]);
      const statuses = [x.status, y.status].sort();
      expect(statuses, JSON.stringify([x.body, y.body])).toEqual([201, 409]);
      const loser = x.status === 409 ? x : y;
      expect(code(loser)).toBe("ASSET-ERR-001");
      const active = await direct.query(
        "SELECT count(*)::int AS n FROM asset_assignments WHERE asset_id = $1 AND status = 'Active'",
        [id],
      );
      expect(active.rows[0].n).toBe(1);
    });

    it("2 mở bảo trì song song", async () => {
      const id = await newAsset("R2");
      const [x, y] = await Promise.all([openM(id), openM(id)]);
      expect([x.status, y.status].sort()).toEqual([201, 409]);
      const loser = x.status === 409 ? x : y;
      // Tất định: FOR UPDATE rồi mới findOpen ⇒ kẻ thua LUÔN thấy lượt Open ⇒ 004 (không nhận 001 — gate T1).
      expect(code(loser)).toBe("ASSET-ERR-004");
      const open = await direct.query(
        "SELECT count(*)::int AS n FROM asset_maintenances WHERE asset_id = $1 AND status = 'Open'",
        [id],
      );
      expect(open.rows[0].n).toBe(1);
    });

    it("2 mở đợt kiểm kê song song ⇒ 1 đợt Open", async () => {
      const [x, y] = await Promise.all([
        post(tCa, "/asset-inventories").send({ name: "KK-race-1" }),
        post(tCa, "/asset-inventories").send({ name: "KK-race-2" }),
      ]);
      expect([x.status, y.status].sort(), JSON.stringify([x.body, y.body])).toEqual([201, 409]);
      const loser = x.status === 409 ? x : y;
      expect(code(loser)).toBe("ASSET-ERR-006");
      const winner = x.status === 201 ? x : y;
      expect(
        (await post(tCa, `/asset-inventories/${winner.body.data.id}/close`).send({})).status,
      ).toBe(201);
    });
  });
});
