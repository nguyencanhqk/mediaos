/**
 * S10-FND-PARAMUUID-3 · lane **L2-EMPDOC** (KI-078 đợt 2) — biên HTTP THẬT cho kênh **PARAM** của
 * hợp đồng lao động + hồ sơ đính kèm nhân viên (SPEC-03). **13 tham số / 2 controller.**
 *
 *   GET    /hr/employees/:id/contracts          [ContractController#listForEmployee]  view:contract
 *   GET    /hr/contracts/:id                    [ContractController#getById]          view:contract
 *   PATCH  /hr/contracts/:id                    [ContractController#update]           manage:contract
 *   POST   /hr/contracts/:id/file               [ContractController#linkFile]         manage:contract   (201)
 *   DELETE /hr/contracts/:id                    [ContractController#delete]           manage:contract   (204)
 *   GET    /hr/employees/:id/files              [EmployeeFileController#list]         file-view:employee
 *   GET    /hr/employees/:id/files/:fileId      [EmployeeFileController#getOne]       file-view:employee
 *   GET    /hr/employees/:id/files/:fileId/download
 *                                               [EmployeeFileController#download]     file-view:employee  (302)
 *   POST   /hr/employees/:id/files              [EmployeeFileController#link]         file-upload:employee (201)
 *   DELETE /hr/employees/:id/files/:fileId      [EmployeeFileController#remove]       file-delete:employee (204)
 *
 * ⚠️ **NĂM route có HAI tham số id-like** (`:id` của `@Controller("hr/employees/:id/files")` CẤP CLASS
 * + `:fileId` cấp method). Census đếm chúng là HAI site riêng, nên ca DENY cũng phải đo RIÊNG từng vế:
 * rác ở `:id` (với `:fileId` HỢP LỆ) và rác ở `:fileId` (với `:id` HỢP LỆ). Chỉ đo một vế là site kia
 * chưa bao giờ được chứng minh — đúng lớp "ký verdict cho chỗ chưa đo" mà WO cấm.
 *
 * ─── MỨC ĐỘ — PHÁT BIỂU TRƯỚC MỌI SỐ ĐO ─────────────────────────────────────────────────────────
 * Hỏng ĐÚNG CHIỀU AN TOÀN: `:id` rác đi hết đường tới Postgres, vỡ `22P02`, filter trả **500**.
 * Request vẫn **bị từ chối** ⇒ **KHÔNG phải lỗ bảo mật**. Giá trị = hợp đồng API + chấm dứt 500 GIẢ
 * bơm vào giám sát. Y hệt KI-068 / KI-077 / đợt 1 của KI-078.
 *
 * ─── LUẬT ĐO (vi phạm một điều là số đo VÔ GIÁ TRỊ) ─────────────────────────────────────────────
 * • Guard chạy TRƯỚC pipe ⇒ mọi ca dùng actor ĐÃ đăng nhập; actor KHÔNG super-admin, KHÔNG `*:*`.
 * • Body PHẢI HỢP LỆ (`linkFile`/`link` đòi `fileId` uuid) — 400-do-body là số đo GIẢ.
 * • TUYỆT ĐỐI KHÔNG gửi `Idempotency-Key` (interceptor chạy TRƯỚC pipe).
 * • DENY = **400 ĐƠN TRỊ** + neo `error.type ∉ {Error, ZodError}`; ALLOW loại CẢ 400 VÀ 500.
 *
 * ─── TIỀN ĐIỀU KIỆN cho ca ALLOW ───────────────────────────────────────────────────────────────
 * `download` đi qua scan-guard STRICT (`Clean`/`NotRequired`, khác ⇒ 409) ⇒ file fixture phải
 * `scan_status='Clean'`. `link` đòi file `upload_status='Uploaded'`. Mỗi ca ALLOW ghi-trạng-thái
 * (`delete` contract, `remove` file) tiêu thụ MỘT bản ghi riêng — dùng lại là ca sau rơi 404/409 rồi
 * bị "chữa" bằng nới assert ([[deny-cases-vacuous-without-allow-case]]).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5). DB phát triển: `mediaos_paramuuid3`.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
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
const LOGIN_PW = loginPasswordFixture("s10paramuuid3l2");

/** Giá trị KHÔNG phải UUID dùng chung mọi ca — một hình dạng, để so sánh giữa các route có nghĩa. */
const JUNK = "khong-phai-uuid";

describe.skipIf(!hasLaneDb)(
  "S10-FND-PARAMUUID-3 · L2-EMPDOC — biên HTTP kênh PARAM của hr/contracts + hr/employees/:id/files",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];
    let token = "";
    let actorUserId = "";
    let employeeId = "";
    let contractTypeId = "";

    const http = () => request(app.getHttpServer());
    const auth = () => ({ Authorization: `Bearer ${token}` });

    async function seedEmployeeProfile(): Promise<string> {
      const uid = await seedUser(
        direct,
        A.companyId,
        `emp-${randomUUID().slice(0, 8)}@s10pu3l2.local`,
      );
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
        [A.companyId, uid],
      );
      return r.rows[0].id as string;
    }

    /** Hợp đồng dùng-một-lần (`update`/`delete`/`linkFile` đều ghi). `contract_code` phải DUY NHẤT. */
    async function seedContract(): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_contracts
           (company_id, employee_id, contract_type_id, contract_code, start_date, status)
         VALUES ($1, $2, $3, $4, '2025-01-01', 'Active') RETURNING id`,
        [A.companyId, employeeId, contractTypeId, `L2-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    }

    /**
     * `files` row Uploaded + Clean — `download` có scan-guard STRICT nên `Pending`/`Infected` sẽ ra
     * 409 và ca ALLOW sẽ đỏ vì lý do KHÔNG liên quan tới tham số.
     * `storage_path` mang tiền tố tenant đúng khuôn `employee-file.int-spec.ts:111`.
     */
    async function seedFile(): Promise<string> {
      const fileId = randomUUID();
      await direct.query(
        `INSERT INTO files
           (id, company_id, original_name, stored_name, mime_type, file_size_bytes, storage_provider,
            storage_path, upload_status, scan_status, uploaded_by)
         VALUES ($1, $2, 'ho-so.pdf', $3, 'application/pdf', 2048, 'MinIO', $4, 'Uploaded', 'Clean', $5)`,
        [fileId, A.companyId, fileId, `${A.companyId}/files/${fileId}`, actorUserId],
      );
      return fileId;
    }

    /** `file_links` row (module HR / entity employee_profile) — điều kiện để file "thuộc về" nhân viên. */
    async function linkFileToEmployee(fileId: string, empId: string): Promise<void> {
      await direct.query(
        `INSERT INTO file_links
           (company_id, file_id, module_code, entity_type, entity_id, link_type, access_scope,
            is_primary, purpose, created_by)
         VALUES ($1, $2, 'HR', 'employee_profile', $3, 'Document', 'Company', false, 'CCCD', $4)`,
        [A.companyId, fileId, empId, actorUserId],
      );
    }

    /** File ĐÃ gắn vào `employeeId` — dùng cho các ca đọc/xoá theo `:fileId`. */
    async function seedLinkedFile(): Promise<string> {
      const fileId = await seedFile();
      await linkFileToEmployee(fileId, employeeId);
      return fileId;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "s10pu3l2");
      companyIds.push(A.companyId);

      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `hr-${randomUUID().slice(0, 8)}@s10pu3l2.local`;
      actorUserId = await seedUser(direct, A.companyId, email, hash);

      // Role RIÊNG, chỉ đúng cặp quyền của các route đang đo — đọc thẳng từ `@RequirePermission`.
      const roleId = await seedRole(direct, A.companyId, `s10pu3l2-${randomUUID().slice(0, 8)}`);
      const pairs: Array<[string, string]> = [
        ["view", "contract"],
        ["manage", "contract"],
        ["file-view", "employee"],
        ["file-upload", "employee"],
        ["file-delete", "employee"],
      ];
      for (const [action, resourceType] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resourceType, false);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, actorUserId, roleId, A.companyId);

      employeeId = await seedEmployeeProfile();
      const ct = await direct.query(
        `INSERT INTO contract_types (company_id, name, requires_end_date)
         VALUES ($1, $2, false) RETURNING id`,
        [A.companyId, `ct-${randomUUID().slice(0, 8)}`],
      );
      contractTypeId = ct.rows[0].id as string;

      const res = await http()
        .post("/auth/login")
        .send({ companySlug: A.slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      token = res.body.data.accessToken as string;
    }, 180_000);

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app?.close();
    });

    function expectRejectedAtBoundary(res: request.Response): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).toBe(400);
      expect(res.body.error?.type, body).not.toBe("ZodError");
      expect(res.body.error?.type, body).not.toBe("Error");
    }

    function expectPassedBoundary(res: request.Response, expectedStatus: number): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).not.toBe(400);
      expect(res.status, body).not.toBe(500);
      expect(res.status, body).toBe(expectedStatus);
    }

    // ══ 1. GET /hr/employees/:id/contracts ══════════════════════════════════════════
    it("PARAM · GET /hr/employees/:id/contracts với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().get(`/hr/employees/${JUNK}/contracts`).set(auth()));
    });

    it("ALLOW-200 · GET /hr/employees/:id/contracts trên HÀNG THẬT", async () => {
      const res = await http().get(`/hr/employees/${employeeId}/contracts`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ 2. GET /hr/contracts/:id ════════════════════════════════════════════════════
    it("PARAM · GET /hr/contracts/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().get(`/hr/contracts/${JUNK}`).set(auth()));
    });

    it("ALLOW · GET /hr/contracts/:id UUID hợp lệ (không tồn tại) đi qua biên → 404 đơn trị", async () => {
      expectPassedBoundary(await http().get(`/hr/contracts/${randomUUID()}`).set(auth()), 404);
    });

    it("ALLOW-200 · GET /hr/contracts/:id trên HÀNG THẬT (loại khoá employee_contract)", async () => {
      const id = await seedContract();
      const res = await http().get(`/hr/contracts/${id}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ 3. PATCH /hr/contracts/:id ══════════════════════════════════════════════════
    it("PARAM · PATCH /hr/contracts/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http()
          .patch(`/hr/contracts/${JUNK}`)
          .set(auth())
          .send({ note: "L2 param-uuid probe" }),
      );
    });

    it("ALLOW-200 · PATCH /hr/contracts/:id trên HÀNG THẬT (body hợp lệ)", async () => {
      const id = await seedContract();
      const res = await http()
        .patch(`/hr/contracts/${id}`)
        .set(auth())
        .send({ note: "L2 param-uuid probe" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ 4. POST /hr/contracts/:id/file ══════════════════════════════════════════════
    it("PARAM · POST /hr/contracts/:id/file với :id rác → 400 ở BIÊN", async () => {
      // `fileId` trong body là UUID THẬT ⇒ 400 quan sát được KHÔNG thể đến từ body-pipe.
      const fileId = await seedFile();
      expectRejectedAtBoundary(
        await http().post(`/hr/contracts/${JUNK}/file`).set(auth()).send({ fileId }),
      );
    });

    it("ALLOW-201 · POST /hr/contracts/:id/file trên HÀNG THẬT (@Post không khai @HttpCode ⇒ 201)", async () => {
      const id = await seedContract();
      const fileId = await seedFile();
      const res = await http().post(`/hr/contracts/${id}/file`).set(auth()).send({ fileId });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    // ══ 5. DELETE /hr/contracts/:id ═════════════════════════════════════════════════
    it("PARAM · DELETE /hr/contracts/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().delete(`/hr/contracts/${JUNK}`).set(auth()));
    });

    it("ALLOW-204 · DELETE /hr/contracts/:id trên HÀNG THẬT (@HttpCode(204))", async () => {
      const id = await seedContract();
      const res = await http().delete(`/hr/contracts/${id}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(204);
    });

    // ══ 6. GET /hr/employees/:id/files ══════════════════════════════════════════════
    it("PARAM · GET /hr/employees/:id/files với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().get(`/hr/employees/${JUNK}/files`).set(auth()));
    });

    it("ALLOW-200 · GET /hr/employees/:id/files trên HÀNG THẬT", async () => {
      const res = await http().get(`/hr/employees/${employeeId}/files`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ 7. GET /hr/employees/:id/files/:fileId — HAI tham số, đo RIÊNG từng vế ══════
    it("PARAM · getOne với :id rác (:fileId HỢP LỆ) → 400 ở BIÊN", async () => {
      const fileId = await seedLinkedFile();
      expectRejectedAtBoundary(
        await http().get(`/hr/employees/${JUNK}/files/${fileId}`).set(auth()),
      );
    });

    it("PARAM · getOne với :fileId rác (:id HỢP LỆ) → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http().get(`/hr/employees/${employeeId}/files/${JUNK}`).set(auth()),
      );
    });

    it("ALLOW-200 · getOne trên HÀNG THẬT (loại khoá employee_file)", async () => {
      const fileId = await seedLinkedFile();
      const res = await http().get(`/hr/employees/${employeeId}/files/${fileId}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ 8. GET /hr/employees/:id/files/:fileId/download — HAI tham số ═══════════════
    it("PARAM · download với :id rác (:fileId HỢP LỆ) → 400 ở BIÊN", async () => {
      const fileId = await seedLinkedFile();
      expectRejectedAtBoundary(
        await http().get(`/hr/employees/${JUNK}/files/${fileId}/download`).set(auth()),
      );
    });

    it("PARAM · download với :fileId rác (:id HỢP LỆ) → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http().get(`/hr/employees/${employeeId}/files/${JUNK}/download`).set(auth()),
      );
    });

    it("ALLOW-302 · download trên HÀNG THẬT (res.redirect(302) ⇒ KHÔNG qua envelope)", async () => {
      const fileId = await seedLinkedFile();
      const res = await http()
        .get(`/hr/employees/${employeeId}/files/${fileId}/download`)
        .set(auth())
        .redirects(0);
      expect(res.status, JSON.stringify(res.body)).toBe(302);
    });

    // ══ 9. POST /hr/employees/:id/files ═════════════════════════════════════════════
    it("PARAM · POST /hr/employees/:id/files với :id rác → 400 ở BIÊN", async () => {
      const fileId = await seedFile();
      expectRejectedAtBoundary(
        await http().post(`/hr/employees/${JUNK}/files`).set(auth()).send({ fileId }),
      );
    });

    it("ALLOW-201 · POST /hr/employees/:id/files trên HÀNG THẬT (@Post không khai @HttpCode ⇒ 201)", async () => {
      const fileId = await seedFile();
      const res = await http()
        .post(`/hr/employees/${employeeId}/files`)
        .set(auth())
        .send({ fileId, category: "CCCD" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    // ══ 10. DELETE /hr/employees/:id/files/:fileId — HAI tham số ════════════════════
    it("PARAM · remove với :id rác (:fileId HỢP LỆ) → 400 ở BIÊN", async () => {
      const fileId = await seedLinkedFile();
      expectRejectedAtBoundary(
        await http().delete(`/hr/employees/${JUNK}/files/${fileId}`).set(auth()),
      );
    });

    it("PARAM · remove với :fileId rác (:id HỢP LỆ) → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http().delete(`/hr/employees/${employeeId}/files/${JUNK}`).set(auth()),
      );
    });

    it("ALLOW-204 · remove trên HÀNG THẬT (@HttpCode(204))", async () => {
      const fileId = await seedLinkedFile();
      const res = await http().delete(`/hr/employees/${employeeId}/files/${fileId}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(204);
    });
  },
);
