/**
 * S11-ASSET-QA-1 — mã lỗi §12 CÒN SÓT: **ASSET-ERR-003** (SPEC-13 §21 hàng "Validate: 16 mã lỗi §12,
 * mỗi mã ≥ 1 ca").
 *
 * VÌ SAO 003 CHƯA CÓ CA NÀO SAU S11-ASSET-BE-1. Đường tự nhiên nhất — "thu hồi tài sản đang `In Stock`"
 * — KHÔNG chạm được 003: `assertTransition` chặn trước bằng **001** (chính spec BE-1 ghi chú như vậy ở
 * `asset-be1-fsm.int-spec.ts`). Muốn tới 003 phải ở một trạng thái mà FSM **cho phép** thu hồi nhưng sổ
 * cấp phát lại KHÔNG có hàng `Active`:
 *
 *     In Stock → (mở bảo trì) → Under Maintenance, chưa từng cấp phát → thu hồi
 *       · §13.1: ô `Under Maintenance` × thu hồi `Good`/`Damaged` là ô HỢP LỆ (status giữ nguyên)
 *       · `returnActiveTx` không thấy lượt Active ⇒ 409 **ASSET-ERR-003**
 *
 * Không có ca này thì `conflict(NO_ACTIVE_ASSIGNMENT)` là code CHẾT: xoá nó đi hoặc đổi thành 500 mà
 * toàn bộ lưới vẫn xanh (họ lỗi `tests-can-pin-a-hole-open`, chiều ngược lại).
 *
 * Ca ALLOW đối chứng đi kèm: cùng trạng thái `Under Maintenance` nhưng CÓ lượt Active ⇒ 201 và lượt về
 * `Returned`, status GIỮ NGUYÊN — nếu thiếu, ca 003 ở trên có thể xanh chỉ vì "thu hồi khi bảo trì luôn
 * hỏng" (`deny-cases-vacuous-without-allow-case`).
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
const LOGIN_PW = "Passw0rd!assetqa3";

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

describe.skipIf(!hasLaneDb)("S11-ASSET-QA-1 mã lỗi còn sót — ASSET-ERR-003", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];
  let t = "";
  let catId = "";
  let empId = "";

  const http = () => request(app.getHttpServer());
  const get = (u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
  const post = (u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
  const code = (r: request.Response) => r.body?.error?.code as string | undefined;

  async function newAsset(name: string): Promise<string> {
    const res = await post("/assets").send({ categoryId: catId, name });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  /** Đưa tài sản về `Under Maintenance` bằng ĐƯỜNG THẬT (mở lượt bảo trì). */
  async function openMaintenance(assetId: string): Promise<void> {
    const res = await post(`/assets/${assetId}/maintenances`).send({ reason: "vệ sinh định kỳ" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const detail = await get(`/assets/${assetId}`);
    expect(detail.body.data.status).toBe("Under Maintenance");
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "assetqa3");
    companyIds.push(A.companyId);

    const uid = await seedUser(direct, A.companyId, `qa3@${A.slug}.test`, hash);
    const emp = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, status, employee_code)
       VALUES ($1,$2,'active','NV-QA3') RETURNING id`,
      [A.companyId, uid],
    );
    empId = emp.rows[0].id as string;

    const roleId = await seedRole(direct, A.companyId, "assetqa3-full");
    for (const [action, resource, scope] of ASSET_ALL) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, uid, roleId, A.companyId);

    const login = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email: `qa3@${A.slug}.test`, password: LOGIN_PW });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    t = login.body.data.accessToken;

    const cat = await post("/asset-categories").send({
      code: "LAPTOP",
      name: "Laptop",
      codePrefix: "LT",
    });
    expect(cat.status, JSON.stringify(cat.body)).toBe(201);
    catId = cat.body.data.id;
  }, 180_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  it("Under Maintenance KHÔNG có lượt Active + thu hồi ⇒ 409 ASSET-ERR-003 (không 001, không 500)", async () => {
    const asset = await newAsset("QA3-NO-ACTIVE");
    await openMaintenance(asset);

    const res = await post(`/assets/${asset}/revoke`).send({ returnCondition: "Good" });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(code(res)).toBe("ASSET-ERR-003");

    // Không tác dụng phụ: trạng thái giữ nguyên, lượt bảo trì vẫn mở.
    const detail = await get(`/assets/${asset}`);
    expect(detail.body.data.status).toBe("Under Maintenance");
    const open = await direct.query(
      "SELECT count(*)::int AS n FROM asset_maintenances WHERE asset_id = $1 AND status = 'Open'",
      [asset],
    );
    expect(open.rows[0].n).toBe(1);
  });

  it("ALLOW đối chứng: Under Maintenance CÓ lượt Active + thu hồi ⇒ 201, lượt Returned, status giữ nguyên", async () => {
    const asset = await newAsset("QA3-HAS-ACTIVE");
    const assign = await post(`/assets/${asset}/assign`).send({ employeeId: empId });
    expect(assign.status, JSON.stringify(assign.body)).toBe(201);
    await openMaintenance(asset);

    const res = await post(`/assets/${asset}/revoke`).send({ returnCondition: "Good" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe("Under Maintenance");

    const rows = await direct.query("SELECT status FROM asset_assignments WHERE asset_id = $1", [
      asset,
    ]);
    expect(rows.rows.map((r) => r.status)).toEqual(["Returned"]);
  });
});
