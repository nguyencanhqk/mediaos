/**
 * S11-ASSET-QA-1 — BIÊN của `@Idempotent()` trên đường ASSET (SPEC-13 §12 · §21 hàng "Idempotent
 * (interceptor chung)"), phần `asset-be1-noti-idempotency.int-spec.ts` CHƯA đo:
 *
 *   · `INVALID_KEY`  — khoá quá dài ⇒ 409, KHÔNG chạy nghiệp vụ (0 lượt sinh ra);
 *   · `IN_PROGRESS`  — bấm-đúp khi request đầu CHƯA xong ⇒ 409 IN_PROGRESS (không phải ASSET-ERR-001);
 *   · KHÔNG phát lại CHÉO — cùng chuỗi khoá nhưng khác **người gọi** / khác **công ty** ⇒ mỗi bên chạy
 *     nghiệp vụ của mình. Đây là BẤT BIẾN #1 đi qua đường CACHE: khoá của interceptor băm
 *     `companyId + userId + method + path + key`, thiếu một vế là hai người đọc được phản hồi của nhau;
 *   · lỗi ⇒ NHẢ khoá — request hỏng không được "đóng băng" khoá, retry cùng khoá phải chạy THẬT lại.
 *
 * Spec BE-1 đã phủ: replay đúng envelope + header `Idempotency-Replayed`, và `KEY_REUSED` (cùng khoá,
 * payload khác). Không lặp lại ở đây.
 *
 * GATE CỨNG `hasDb && LANE_DB`. Store idempotency dùng Valkey THẬT (khoá băm có companyId của tenant
 * dựng-rồi-xoá ⇒ không giẫm môi trường khác dù Valkey dùng chung — memory
 * `valkey-shared-across-all-envs-no-channel-prefix`).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  IDEMPOTENCY_ERROR_CODES,
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
} from "@mediaos/contracts";
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
const LOGIN_PW = "Passw0rd!assetqa2";

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

describe.skipIf(!hasLaneDb)("S11-ASSET-QA-1 idempotency — biên + cô lập chủ thể", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let tA1 = ""; // công ty A, người gọi #1
  let tA2 = ""; // công ty A, người gọi #2
  let tB1 = ""; // công ty B
  let catA = "";
  let catB = "";
  let empA1 = "";
  let empA2 = "";
  let empB1 = "";

  const http = () => request(app.getHttpServer());
  const post = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
  const code = (r: request.Response) => r.body?.error?.code as string | undefined;

  async function grantAll(companyId: string, userId: string, label: string) {
    const roleId = await seedRole(direct, companyId, `assetqa2-${label}`);
    for (const [action, resource, scope] of ASSET_ALL) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function seedEmp(companyId: string, userId: string, empCode: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, status, employee_code)
       VALUES ($1,$2,'active',$3) RETURNING id`,
      [companyId, userId, empCode],
    );
    return r.rows[0].id as string;
  }

  async function login(slug: string, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function newAsset(t: string, categoryId: string, name: string): Promise<string> {
    const res = await post(t, "/assets").send({ categoryId, name });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function activeCount(assetId: string): Promise<number> {
    const r = await direct.query(
      "SELECT count(*)::int AS n FROM asset_assignments WHERE asset_id = $1 AND status = 'Active'",
      [assetId],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "assetqa2a");
    B = await seedCompany(direct, "assetqa2b");
    companyIds.push(A.companyId, B.companyId);

    const a1 = await seedUser(direct, A.companyId, `a1@${A.slug}.test`, hash);
    const a2 = await seedUser(direct, A.companyId, `a2@${A.slug}.test`, hash);
    const b1 = await seedUser(direct, B.companyId, `b1@${B.slug}.test`, hash);
    empA1 = await seedEmp(A.companyId, a1, "NV-A1");
    empA2 = await seedEmp(A.companyId, a2, "NV-A2");
    empB1 = await seedEmp(B.companyId, b1, "NV-B1");
    await grantAll(A.companyId, a1, "a1");
    await grantAll(A.companyId, a2, "a2");
    await grantAll(B.companyId, b1, "b1");
    tA1 = await login(A.slug, `a1@${A.slug}.test`);
    tA2 = await login(A.slug, `a2@${A.slug}.test`);
    tB1 = await login(B.slug, `b1@${B.slug}.test`);

    const ca = await post(tA1, "/asset-categories").send({
      code: "LAPTOP",
      name: "Laptop",
      codePrefix: "LT",
    });
    expect(ca.status, JSON.stringify(ca.body)).toBe(201);
    catA = ca.body.data.id;
    const cb = await post(tB1, "/asset-categories").send({
      code: "LAPTOP",
      name: "Laptop B",
      codePrefix: "LT",
    });
    expect(cb.status, JSON.stringify(cb.body)).toBe(201);
    catB = cb.body.data.id;
  }, 180_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  it("khoá quá dài ⇒ 409 INVALID_KEY và KHÔNG chạy nghiệp vụ (0 lượt)", async () => {
    const asset = await newAsset(tA1, catA, "IDEM-INVALID");
    const res = await post(tA1, `/assets/${asset}/assign`)
      .set(IDEMPOTENCY_HEADER, "k".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1))
      .send({ employeeId: empA1 });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(code(res)).toBe(IDEMPOTENCY_ERROR_CODES.INVALID_KEY);
    // Vế QUAN TRỌNG: chặn ở interceptor ⇒ handler chưa từng chạy.
    expect(await activeCount(asset)).toBe(0);

    // ALLOW đối chứng: đúng khoá dài tối đa (biên = hợp lệ) ⇒ chạy bình thường.
    const ok = await post(tA1, `/assets/${asset}/assign`)
      .set(IDEMPOTENCY_HEADER, "k".repeat(IDEMPOTENCY_KEY_MAX_LENGTH))
      .send({ employeeId: empA1 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await activeCount(asset)).toBe(1);
  });

  /**
   * TẤT ĐỊNH, KHÔNG ĐUA. Bắn hai request song song rồi `if (loser) … else …` là một ca **có thể không
   * bao giờ chạy nhánh mình định đo**: nếu request đầu xong trước, nhánh IN_PROGRESS im lặng biến mất
   * và lưới vẫn xanh (họ lỗi `deny-cases-vacuous-without-allow-case`).
   *
   * Cách ép: giữ **khoá hàng** trên `assets` bằng một transaction của pool owner. Handler assign mở tx
   * rồi `SELECT … FOR UPDATE` (`lockOrNotFoundTx`) ⇒ request #1 đứng lại NGAY TRONG handler, sau khi
   * interceptor đã ghi khoá idempotency. Request #2 vì thế CHẮC CHẮN gặp trạng thái in-flight.
   */
  it("bấm-đúp khi request đầu CHƯA xong ⇒ 409 IN_PROGRESS (không phải ASSET-ERR-001) và chỉ 1 lượt", async () => {
    const asset = await newAsset(tA1, catA, "IDEM-INFLIGHT");
    const key = `qa1-inflight-${asset}`;
    const fire = () =>
      post(tA1, `/assets/${asset}/assign`).set(IDEMPOTENCY_HEADER, key).send({ employeeId: empA1 });

    const locker = await direct.connect();
    let first: request.Response | null = null;
    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM assets WHERE id = $1 FOR UPDATE", [asset]);

      // #1 chạy vào handler rồi TREO ở FOR UPDATE (không await).
      const p1 = fire().then(
        (r) => (first = r),
        // Socket có thể bị đóng sớm khi #2 trả về trước (supertest chia sẻ server) — nghiệp vụ vẫn
        // chạy tiếp phía server, nên trạng thái được nghiệm bằng DB ở dưới, không bằng phản hồi này.
        () => null,
      );
      await new Promise((r) => setTimeout(r, 250)); // đủ để #1 qua interceptor + kẹt ở khoá hàng

      const r2 = await fire();
      expect(r2.status, JSON.stringify(r2.body)).toBe(409);
      expect(code(r2)).toBe(IDEMPOTENCY_ERROR_CODES.IN_PROGRESS);

      await locker.query("ROLLBACK");
      await p1;
    } finally {
      locker.release();
    }

    // #1 vẫn đi tới đích sau khi khoá được nhả ⇒ ĐÚNG một lượt, không mất và không nhân đôi.
    expect(await activeCount(asset)).toBe(1);
    if (first) expect((first as request.Response).status).toBe(201);
  });

  it("CÙNG chuỗi khoá, KHÁC người gọi trong cùng công ty ⇒ không phát lại chéo", async () => {
    const asset1 = await newAsset(tA1, catA, "IDEM-USER-1");
    const asset2 = await newAsset(tA1, catA, "IDEM-USER-2");
    const key = "qa1-shared-key-across-users";

    const r1 = await post(tA1, `/assets/${asset1}/assign`)
      .set(IDEMPOTENCY_HEADER, key)
      .send({ employeeId: empA1 });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);

    const r2 = await post(tA2, `/assets/${asset2}/assign`)
      .set(IDEMPOTENCY_HEADER, key)
      .send({ employeeId: empA2 });
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    expect(r2.headers["idempotency-replayed"]).toBeUndefined();
    expect(r2.body.data.id).not.toBe(r1.body.data.id);
    expect(await activeCount(asset1)).toBe(1);
    expect(await activeCount(asset2)).toBe(1);
  });

  it("CÙNG chuỗi khoá, KHÁC công ty ⇒ không phát lại chéo (BẤT BIẾN #1 qua đường cache)", async () => {
    const assetA = await newAsset(tA1, catA, "IDEM-CO-A");
    const assetB = await newAsset(tB1, catB, "IDEM-CO-B");
    const key = "qa1-shared-key-across-companies";

    const ra = await post(tA1, `/assets/${assetA}/assign`)
      .set(IDEMPOTENCY_HEADER, key)
      .send({ employeeId: empA1 });
    expect(ra.status, JSON.stringify(ra.body)).toBe(201);

    const rb = await post(tB1, `/assets/${assetB}/assign`)
      .set(IDEMPOTENCY_HEADER, key)
      .send({ employeeId: empB1 });
    expect(rb.status, JSON.stringify(rb.body)).toBe(201);
    expect(rb.headers["idempotency-replayed"]).toBeUndefined();
    // Phản hồi của B phải là dữ liệu của B — không phải bản sao envelope của A.
    expect(rb.body.data.id).not.toBe(ra.body.data.id);
    expect(rb.body.data.assetId ?? rb.body.data.asset?.id ?? assetB).not.toBe(assetA);
    expect(await activeCount(assetA)).toBe(1);
    expect(await activeCount(assetB)).toBe(1);
  });

  it("handler LỖI ⇒ nhả khoá: retry CÙNG khoá + CÙNG payload chạy thật lại (không phát lại lỗi đã cache)", async () => {
    const asset = await newAsset(tA1, catA, "IDEM-RELEASE");
    const key = `qa1-release-${asset}`;
    const ghostEmployee = "00000000-0000-4000-8000-0000000000ff";

    const bad1 = await post(tA1, `/assets/${asset}/assign`)
      .set(IDEMPOTENCY_HEADER, key)
      .send({ employeeId: ghostEmployee });
    expect(bad1.status, JSON.stringify(bad1.body)).toBe(404);

    const bad2 = await post(tA1, `/assets/${asset}/assign`)
      .set(IDEMPOTENCY_HEADER, key)
      .send({ employeeId: ghostEmployee });
    expect(bad2.status).toBe(404);
    // Lỗi KHÔNG được cache ⇒ lần 2 là lần chạy THẬT, không mang header phát lại.
    expect(bad2.headers["idempotency-replayed"]).toBeUndefined();

    // Và khoá vẫn dùng được cho payload… KHÁC ⇒ đúng KEY_REUSED (không phải "khoá chết").
    const reuse = await post(tA1, `/assets/${asset}/assign`)
      .set(IDEMPOTENCY_HEADER, key)
      .send({ employeeId: empA1 });
    expect([201, 409]).toContain(reuse.status);
    if (reuse.status === 409) expect(code(reuse)).toBe(IDEMPOTENCY_ERROR_CODES.KEY_REUSED);
  });
});
