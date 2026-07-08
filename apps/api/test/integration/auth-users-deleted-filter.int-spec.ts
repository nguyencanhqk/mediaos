/**
 * S2-AUTH-USEROPS-1 — HTTP int-spec: bộ lọc GET /auth/users?deleted qua PIPE THẬT (regression).
 *
 * BUG gốc (phát hiện 2026-07-08 trên dev-online): tab "Đã xóa" gọi ?deleted=true → 400 ZodValidation
 * "Expected 'true'|'false', received boolean". Nguyên nhân: ZodValidationPipe chạy 2 LẦN (global
 * main.ts:47 + @UsePipes ở AuthUsersController). Schema `deleted` cũ dùng .transform() string→boolean
 * KHÔNG idempotent → lần 2 nhận boolean → enum vỡ. Fix: preprocess nhận CẢ string LẪN boolean (idempotent).
 *
 * Các int-spec khác KHÔNG bắt được vì app test chỉ đăng ký interceptor+filter, THIẾU global pipe → validate
 * 1 lần. Spec NÀY đăng ký `useGlobalPipes(new ZodValidationPipe())` GIỐNG production (main.ts) → tái hiện
 * đường validate-kép thật. Đây là hợp đồng: mọi schema query DTO ở controller có @UsePipes PHẢI idempotent.
 *
 * Gate hasDb && LANE_DB (memory integration-test-lane-db-gate — .env làm hasDb=true → đỏ-giả DB dev chung).
 *
 * Phủ:
 *  P1  GET /auth/users              → 200, CHỈ user LIVE (deletedAt=null); user đã xóa VẮNG.
 *  P2  GET /auth/users?deleted=true → 200 (KHÔNG 400!), CHỈ user đã xóa mềm; user live VẮNG.
 *  P3  GET /auth/users?deleted=false→ 200, = danh sách LIVE (đối xứng P1, chứng minh "false" KHÔNG bị coerce→true).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import request from "supertest";
import { ZodValidationPipe } from "nestjs-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthUserDto } from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const COMPANY_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";
const PASSWORD = ["Passw0rd", "Test", "99"].join("");
const hasLaneDb = hasDb && Boolean(process.env.LANE_DB);
const TAG = randomUUID().slice(0, 8);

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

describe.skipIf(!hasLaneDb)(
  "S2-AUTH-USEROPS-1 /auth/users?deleted filter (double-pipe regression)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let adminToken: string;
    let liveEmail: string;
    let deletedEmail: string;
    const companyIds: string[] = [];

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      // Production-faithful: main.ts đăng ký global ZodValidationPipe → đường validate-kép (global + @UsePipes).
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();

      const pw = await new PasswordService().hash(PASSWORD);
      A = await seedCompany(direct, "udelf");
      companyIds.push(A.companyId);

      // admin (company-admin → view:user Company) login được.
      const adminEmail = `adm-${TAG}@a.test`;
      const admin = await seedUser(direct, A.companyId, adminEmail, pw);
      await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE_ID, A.companyId);

      // 1 user LIVE + 1 user đã XÓA MỀM (deleted_at set thẳng — bộ lọc là thứ đang test, không cần qua endpoint).
      liveEmail = `live-${TAG}@a.test`;
      await seedUser(direct, A.companyId, liveEmail, pw);
      deletedEmail = `gone-${TAG}@a.test`;
      const deletedId = await seedUser(direct, A.companyId, deletedEmail, pw);
      await direct.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [deletedId]);

      adminToken = await login(app, A.slug, adminEmail);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    it("P1 — GET /auth/users → 200, CHỈ user LIVE (đã xóa VẮNG)", async () => {
      const res = await api(app)
        .get("/auth/users?limit=100")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const emails = (res.body.data.users as AuthUserDto[]).map((u) => u.email);
      expect(emails).toContain(liveEmail);
      expect(emails).not.toContain(deletedEmail);
      expect((res.body.data.users as AuthUserDto[]).every((u) => u.deletedAt === null)).toBe(true);
    });

    it("P2 — GET /auth/users?deleted=true → 200 (KHÔNG 400), CHỈ user đã xóa mềm", async () => {
      const res = await api(app)
        .get("/auth/users?deleted=true&limit=100")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const users = res.body.data.users as AuthUserDto[];
      const emails = users.map((u) => u.email);
      expect(emails).toContain(deletedEmail);
      expect(emails).not.toContain(liveEmail);
      expect(users.every((u) => u.deletedAt !== null)).toBe(true);
    });

    it("P3 — GET /auth/users?deleted=false → 200, = danh sách LIVE ('false' KHÔNG bị coerce→true)", async () => {
      const res = await api(app)
        .get("/auth/users?deleted=false&limit=100")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const emails = (res.body.data.users as AuthUserDto[]).map((u) => u.email);
      expect(emails).toContain(liveEmail);
      expect(emails).not.toContain(deletedEmail);
    });
  },
);
