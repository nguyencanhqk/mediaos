/**
 * S10-QA-ROUTEHTTP-3 (file 7/7) — test HTTP THẬT cho phần đuôi VÒNG ĐỜI NHÂN SỰ:
 *
 *   ApprovalInboxController         1  POST /approval/requests/:id/reject
 *   EmployeesController             1  DELETE /employees/:id
 *   RecycleBinController            1  POST /recycle-bin/employees/:id/restore
 *   HrWriteController               1  DELETE /hr/employees/:id/link-user
 *   ContractController              1  POST /hr/contracts/:id/file
 *   HrImportController              1  GET  /hr/employees/import/template
 *   ProfileChangeRequestController  5  POST · POST :id/cancel · GET :id · GET me · GET (danh sách duyệt)
 *
 * CẶP XOÁ↔KHÔI PHỤC ĐI CÙNG NHAU CÓ CHỦ Ý. `DELETE /employees/:id` là soft-delete và
 * `POST /recycle-bin/employees/:id/restore` là đường lùi của nó. Test riêng lẻ thì mỗi ca chỉ chứng
 * minh được "trả 2xx"; test theo cặp thì chứng minh được HỆ QUẢ THẬT: nhân viên rời `GET /employees`
 * → xuất hiện ở `GET /recycle-bin/employees` → quay lại `GET /employees` sau khi khôi phục.
 *
 * `GET /hr/employees/import/template` trả **CSV thô** (`@Header("Content-Type","text/csv")`), KHÔNG đi
 * qua envelope ⇒ assert theo `res.text` + header, đừng đòi `body.data` (sẽ luôn undefined ⇒ ca xanh-rỗng).
 *
 * `restore:employee` và `import:employee` là `is_sensitive=true` trong catalog — khai đúng cờ.
 *
 * LUẬT CHỐNG DENY-XANH-RỖNG: ca DENY (role RỖNG → 403) đặt SAU chuỗi ALLOW của cùng route.
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
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
const LOGIN_PW = loginPasswordFixture("s10rh3hr");

const uniq = () => randomUUID().slice(0, 8);

function dayShift(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `[action, resource, is_sensitive]` — cờ đo trên catalog lane DB. */
const ADMIN_PAIRS: ReadonlyArray<readonly [string, string, boolean]> = [
  ["read", "employee", false],
  ["create", "employee", false],
  ["update", "employee", false],
  ["delete", "employee", false],
  ["restore", "employee", true],
  ["import", "employee", true],
  ["view", "contract", false],
  ["manage", "contract", false],
  ["manage", "master-data", false],
  ["create", "profile-change-request", false],
  ["approve", "profile-change-request", false],
];

describe.skipIf(!hasLaneDb)(
  "S10-QA-ROUTEHTTP-3 — HTTP thật: vòng đời nhân sự · hợp đồng · yêu cầu đổi hồ sơ (11 route)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let tAdminA = "";
    let tEmptyA = "";
    let tAdminB = "";
    let adminUserIdA = "";
    let adminEmpIdA = "";
    let orgUnitA = "";

    const http = () => request(app.getHttpServer());
    const authGet = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
    const authPost = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
    const authDelete = (t: string, u: string) =>
      http().delete(u).set("Authorization", `Bearer ${t}`);

    async function login(slug: string, email: string): Promise<string> {
      const res = await http().post("/auth/login").send({
        companySlug: slug,
        email,
        password: LOGIN_PW,
      });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    async function actor(
      tenant: SeededTenant,
      tag: string,
      pairs: ReadonlyArray<readonly [string, string, boolean]>,
    ): Promise<{ token: string; userId: string; employeeId: string; orgUnitId: string }> {
      const password = new PasswordService();
      const email = `${tag}-${uniq()}@s10rh3hr.local`;
      const userId = await seedUser(direct, tenant.companyId, email, await password.hash(LOGIN_PW));
      const ou = await direct.query<{ id: string }>(
        `INSERT INTO org_units (company_id, name, type) VALUES ($1, $2, 'department') RETURNING id`,
        [tenant.companyId, `s10rh3hr-ou-${uniq()}`],
      );
      const emp = await direct.query<{ id: string }>(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
         VALUES ($1, $2, $3, 'active') RETURNING id`,
        [tenant.companyId, userId, ou.rows[0].id],
      );
      const roleId = await seedRole(direct, tenant.companyId, `s10rh3hr-${tag}-${uniq()}`);
      for (const [action, resource, sensitive] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resource, sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, userId, roleId, tenant.companyId);
      return {
        token: await login(tenant.slug, email),
        userId,
        employeeId: emp.rows[0].id,
        orgUnitId: ou.rows[0].id,
      };
    }

    /**
     * Nhân viên + tài khoản gắn kèm.
     *
     * ⚠️ PHẢI có `user_id`: `EmployeesRepository.listEmployeesTx` dùng **innerJoin(users)**, nên nhân
     * viên chưa gắn tài khoản là VÔ HÌNH với `GET /employees` (đo được, không suy đoán). Gieo nhân viên
     * "rời" rồi assert nó có trong danh sách sẽ đỏ vì lý do KHÁC với cái ca này định đo.
     * `employee_profiles` cũng KHÔNG có cột `full_name` — tên sống ở `users`.
     */
    async function seedEmployee(companyId: string, ouId: string): Promise<string> {
      const userId = await seedUser(
        direct,
        companyId,
        `nv-${uniq()}@s10rh3hr.local`,
        await new PasswordService().hash(LOGIN_PW),
      );
      const r = await direct.query<{ id: string }>(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
         VALUES ($1, $2, $3, 'active') RETURNING id`,
        [companyId, userId, ouId],
      );
      return r.rows[0].id;
    }

    async function insertFile(companyId: string, ownerId: string): Promise<string> {
      const fileId = randomUUID();
      await direct.query(
        `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
           storage_provider, storage_path, visibility, upload_status, scan_status, owner_user_id, uploaded_by)
         VALUES ($1,$2,'hd.pdf',$3,'application/pdf',10,'MinIO',$4,'Private','Uploaded','NotRequired',$5,$5)`,
        [fileId, companyId, `${fileId}-hd.pdf`, `${companyId}/files/${fileId}`, ownerId],
      );
      return fileId;
    }

    /** Chuỗi duyệt 1 cấp gieo thẳng (khuôn `approval-inbox.e2e-spec.ts`) — trả requestId. */
    async function seedApprovalRequest(companyId: string, approverId: string): Promise<string> {
      const def = await direct.query<{ id: string }>(
        `INSERT INTO workflow_definitions (company_id, code, name, applies_to, max_approval_level, allow_parallel_steps)
         VALUES ($1, $2, 's10rh3hr', 'content_item', 1, false) RETURNING id`,
        [companyId, `s10rh3hr-${uniq()}`],
      );
      const prj = await direct.query<{ id: string }>(
        `INSERT INTO projects (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
        [companyId, `s10rh3hr-prj-${uniq()}`],
      );
      const ci = await direct.query<{ id: string }>(
        `INSERT INTO content_items (company_id, project_id, title, status)
         VALUES ($1, $2, $3, 'draft') RETURNING id`,
        [companyId, prj.rows[0].id, `s10rh3hr-ci-${uniq()}`],
      );
      const inst = await direct.query<{ id: string }>(
        `INSERT INTO workflow_instances (company_id, workflow_definition_id, content_item_id, current_step_order, status)
         VALUES ($1, $2, $3, 1, 'active') RETURNING id`,
        [companyId, def.rows[0].id, ci.rows[0].id],
      );
      const step = await direct.query<{ id: string }>(
        `INSERT INTO workflow_steps (company_id, workflow_instance_id, step_order, step_code, step_name, status, reviewer_user_id)
         VALUES ($1, $2, 1, 'script', 'Viết kịch bản', 'waiting_review', $3) RETURNING id`,
        [companyId, inst.rows[0].id, approverId],
      );
      const req = await direct.query<{ id: string }>(
        `INSERT INTO approval_requests (company_id, workflow_step_id, requested_by, status, current_level, max_level)
         VALUES ($1, $2, $3, 'pending', 1, 1) RETURNING id`,
        [companyId, step.rows[0].id, approverId],
      );
      await direct.query(
        `INSERT INTO approval_rules (company_id, workflow_step_id, level, approver_user_id)
         VALUES ($1, $2, 1, $3)`,
        [companyId, step.rows[0].id, approverId],
      );
      return req.rows[0].id;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      // Phải listen THẬT: supertest tự listen(0) rồi close() server dùng chung ngay khi request ĐẦU kết thúc
      // ⇒ các request anh em trong Promise.all bị reset socket (ECONNRESET). Server đang listen thì supertest không sở hữu nó.
      await app.listen(0);

      direct = directPool();
      A = await seedCompany(direct, "s10rh3hra");
      B = await seedCompany(direct, "s10rh3hrb");
      companyIds.push(A.companyId, B.companyId);

      const admin = await actor(A, "admin", ADMIN_PAIRS);
      tAdminA = admin.token;
      adminUserIdA = admin.userId;
      adminEmpIdA = admin.employeeId;
      orgUnitA = admin.orgUnitId;

      tEmptyA = (await actor(A, "empty", [])).token;
      tAdminB = (await actor(B, "adminb", ADMIN_PAIRS)).token;
    }, 180_000);

    afterAll(async () => {
      await app?.close();
      if (companyIds.length > 0) {
        // `employee_contracts` KHÔNG nằm trong thứ tự xoá của `cleanupTenants()` nhưng có FK sang
        // `employee_profiles` ⇒ để nguyên thì dọn dẹp vỡ FK và cả FILE đỏ dù mọi ca đã xanh
        // ([[vitest-unhandled-rejection-after-teardown]] là cùng lớp "đỏ sau khi test xong").
        await direct.query("DELETE FROM employee_contracts WHERE company_id = ANY($1::uuid[])", [
          companyIds,
        ]);
        await cleanupTenants(direct, companyIds);
      }
      await direct?.end();
    });

    // ─── 1. XOÁ ↔ KHÔI PHỤC nhân viên ───────────────────────────────────────────

    it("DELETE /employees/:id + POST /recycle-bin/employees/:id/restore — vòng tròn ĐẦY ĐỦ, HỆ QUẢ ba chặng", async () => {
      const empId = await seedEmployee(A.companyId, orgUnitA);

      const listed = await authGet(tAdminA, "/employees");
      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      const activeBefore = (
        Array.isArray(listed.body.data) ? listed.body.data : (listed.body.data.items ?? [])
      ) as Array<{ id: string }>;
      expect(
        activeBefore.map((e) => e.id),
        "nhân viên mới phải đang hoạt động",
      ).toContain(empId);

      const removed = await authDelete(tAdminA, `/employees/${empId}`);
      expect(removed.status, JSON.stringify(removed.body)).toBe(204);

      const afterDelete = await authGet(tAdminA, "/employees");
      const activeAfter = (
        Array.isArray(afterDelete.body.data)
          ? afterDelete.body.data
          : (afterDelete.body.data.items ?? [])
      ) as Array<{ id: string }>;
      expect(
        activeAfter.map((e) => e.id),
        "sau soft-delete phải rời danh sách",
      ).not.toContain(empId);

      const bin = await authGet(tAdminA, "/recycle-bin/employees");
      expect(bin.status, JSON.stringify(bin.body)).toBe(200);
      const binRows = (
        Array.isArray(bin.body.data) ? bin.body.data : (bin.body.data.items ?? [])
      ) as Array<{ id: string }>;
      expect(
        binRows.map((e) => e.id),
        "phải nằm trong thùng rác",
      ).toContain(empId);

      const restored = await authPost(tAdminA, `/recycle-bin/employees/${empId}/restore`).send({});
      expect(restored.status, JSON.stringify(restored.body)).toBe(200);

      const afterRestore = await authGet(tAdminA, "/employees");
      const activeFinal = (
        Array.isArray(afterRestore.body.data)
          ? afterRestore.body.data
          : (afterRestore.body.data.items ?? [])
      ) as Array<{ id: string }>;
      expect(
        activeFinal.map((e) => e.id),
        "khôi phục xong phải quay lại danh sách",
      ).toContain(empId);
    });

    // ─── 2. Gỡ liên kết tài khoản ───────────────────────────────────────────────

    it("DELETE /hr/employees/:id/link-user — ALLOW, HỆ QUẢ: employee_profiles.user_id về NULL", async () => {
      // `seedEmployee` đã gắn sẵn tài khoản (bắt buộc, vì list innerJoin users) ⇒ gọi thẳng đường GỠ.
      // Gọi POST link-user lần nữa sẽ nhận 409 "already has a linked user" — đó là hành vi ĐÚNG, không
      // phải lỗi; đừng dựng ca quanh nó ở đây.
      const empId = await seedEmployee(A.companyId, orgUnitA);
      const boundRow = await direct.query<{ user_id: string | null }>(
        `SELECT user_id FROM employee_profiles WHERE company_id = $1 AND id = $2`,
        [A.companyId, empId],
      );
      expect(boundRow.rows[0].user_id, "fixture phải có tài khoản gắn sẵn").toBeTruthy();

      const unlinked = await http()
        .delete(`/hr/employees/${empId}/link-user`)
        .set("Authorization", `Bearer ${tAdminA}`)
        .send({ lockUser: false });
      expect(unlinked.status, JSON.stringify(unlinked.body)).toBeLessThan(300);

      const after = await direct.query<{ user_id: string | null }>(
        `SELECT user_id FROM employee_profiles WHERE company_id = $1 AND id = $2`,
        [A.companyId, empId],
      );
      expect(after.rows[0].user_id, "gỡ xong phải về NULL").toBeNull();
    });

    // ─── 3. Gắn tệp vào hợp đồng ────────────────────────────────────────────────

    it("POST /hr/contracts/:id/file — ALLOW, HỆ QUẢ đọc lại qua GET /hr/contracts/:id", async () => {
      const ct = await authPost(tAdminA, "/hr/master-data/contract-types").send({
        code: `CT-${uniq()}`,
        name: "HĐ xác định thời hạn",
        requiresEndDate: false,
      });
      expect(ct.status, JSON.stringify(ct.body)).toBe(201);

      const empId = await seedEmployee(A.companyId, orgUnitA);
      const contract = await authPost(tAdminA, "/hr/contracts").send({
        employeeId: empId,
        contractTypeId: ct.body.data.id,
        startDate: dayShift(-10),
      });
      expect(contract.status, JSON.stringify(contract.body)).toBe(201);
      const contractId = contract.body.data.id as string;

      const fileId = await insertFile(A.companyId, adminUserIdA);
      const linked = await authPost(tAdminA, `/hr/contracts/${contractId}/file`).send({ fileId });
      expect(linked.status, JSON.stringify(linked.body)).toBeLessThan(300);

      const reread = await authGet(tAdminA, `/hr/contracts/${contractId}`);
      expect(reread.status, JSON.stringify(reread.body)).toBe(200);
      expect(
        JSON.stringify(reread.body.data),
        "hợp đồng đọc lại phải mang dấu vết của tệp vừa gắn",
      ).toContain(fileId);
    });

    // ─── 4. Mẫu CSV nhập nhân viên ──────────────────────────────────────────────

    it("GET /hr/employees/import/template — 200 CSV THÔ (không envelope), có dòng tiêu đề", async () => {
      const res = await authGet(tAdminA, "/hr/employees/import/template");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.text, "phải trả nội dung CSV thật, không rỗng").toBeTruthy();
      expect(
        res.text.split("\n")[0].includes(","),
        `dòng đầu phải là header nhiều cột: ${res.text.slice(0, 120)}`,
      ).toBe(true);
    });

    // ─── 5. Yêu cầu đổi hồ sơ (5 route) ─────────────────────────────────────────

    it("profile-change-requests: POST → GET me → GET :id → GET danh sách duyệt → POST :id/cancel", async () => {
      const created = await authPost(tAdminA, "/hr/profile-change-requests").send({
        changedFields: ["phone"],
        newValues: { phone: "0900000001" },
        reason: "Đổi số điện thoại",
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const requestId = created.body.data.id as string;

      const mine = await authGet(tAdminA, "/hr/profile-change-requests/me");
      expect(mine.status, JSON.stringify(mine.body)).toBe(200);
      const mineRows = (
        Array.isArray(mine.body.data) ? mine.body.data : (mine.body.data.items ?? [])
      ) as Array<{ id: string }>;
      expect(
        mineRows.map((r) => r.id),
        "yêu cầu vừa tạo phải ở danh sách CỦA MÌNH",
      ).toContain(requestId);

      const one = await authGet(tAdminA, `/hr/profile-change-requests/${requestId}`);
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      expect(one.body.data.id).toBe(requestId);

      const forApproval = await authGet(tAdminA, "/hr/profile-change-requests");
      expect(forApproval.status, JSON.stringify(forApproval.body)).toBe(200);
      const approvalRows = (
        Array.isArray(forApproval.body.data)
          ? forApproval.body.data
          : (forApproval.body.data.items ?? [])
      ) as Array<{ id: string }>;
      expect(
        approvalRows.map((r) => r.id),
        "yêu cầu đang chờ phải hiện ở danh sách duyệt",
      ).toContain(requestId);

      const cancelled = await authPost(
        tAdminA,
        `/hr/profile-change-requests/${requestId}/cancel`,
      ).send({});
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);

      const afterCancel = await authGet(tAdminA, `/hr/profile-change-requests/${requestId}`);
      expect(afterCancel.status).toBe(200);
      expect(
        String(afterCancel.body.data.status).toLowerCase(),
        "trạng thái sau khi huỷ phải KHÁC pending",
      ).not.toBe("pending");
    });

    it("profile-change-requests: DTO 400 ở BIÊN (`changedFields` rỗng / trường ngoài allowlist)", async () => {
      const empty = await authPost(tAdminA, "/hr/profile-change-requests").send({
        changedFields: [],
        newValues: {},
      });
      expect(empty.status, JSON.stringify(empty.body)).toBe(400);

      const notAllowed = await authPost(tAdminA, "/hr/profile-change-requests").send({
        changedFields: ["base_salary"],
        newValues: { base_salary: 1 },
      });
      expect(notAllowed.status, JSON.stringify(notAllowed.body)).toBe(400);
    });

    // ─── 6. Từ chối yêu cầu duyệt ───────────────────────────────────────────────

    // Lưu ý mã trả về: `approve`/`reject` của ApprovalInboxController KHÔNG khai `@HttpCode` ⇒ Nest
    // dùng mặc định của @Post là **201**, không phải 200 (đo được, không suy từ tên hành động).
    it("POST /approval/requests/:id/reject — ALLOW 201, HỆ QUẢ: request rời trạng thái pending", async () => {
      const requestId = await seedApprovalRequest(A.companyId, adminUserIdA);

      const res = await authPost(tAdminA, `/approval/requests/${requestId}/reject`).send({
        description: "Chưa đạt yêu cầu",
        comment: "Làm lại phần mở đầu",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);

      const row = await direct.query<{ status: string }>(
        `SELECT status FROM approval_requests WHERE company_id = $1 AND id = $2`,
        [A.companyId, requestId],
      );
      expect(row.rows[0].status, "từ chối xong không được còn 'pending'").not.toBe("pending");
    });

    it("POST /approval/requests/:id/reject — DTO 400 ở BIÊN khi thiếu `description`", async () => {
      const requestId = await seedApprovalRequest(A.companyId, adminUserIdA);
      const res = await authPost(tAdminA, `/approval/requests/${requestId}/reject`).send({
        comment: "thiếu description",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });

    // ─── 7. DENY — role RỖNG, đặt SAU toàn bộ ALLOW ─────────────────────────────

    it("DENY 403: actor role RỖNG bị chặn ở cả 11 route", async () => {
      const fake = randomUUID();
      const calls = [
        authPost(tEmptyA, `/approval/requests/${fake}/reject`).send({ description: "x" }),
        authDelete(tEmptyA, `/employees/${fake}`),
        authPost(tEmptyA, `/recycle-bin/employees/${fake}/restore`).send({}),
        http()
          .delete(`/hr/employees/${fake}/link-user`)
          .set("Authorization", `Bearer ${tEmptyA}`)
          .send({ lockUser: false }),
        authPost(tEmptyA, `/hr/contracts/${fake}/file`).send({ fileId: fake }),
        authGet(tEmptyA, "/hr/employees/import/template"),
        authPost(tEmptyA, "/hr/profile-change-requests").send({
          changedFields: ["phone"],
          newValues: { phone: "0900000002" },
        }),
        authPost(tEmptyA, `/hr/profile-change-requests/${fake}/cancel`).send({}),
        authGet(tEmptyA, `/hr/profile-change-requests/${fake}`),
        authGet(tEmptyA, "/hr/profile-change-requests/me"),
        authGet(tEmptyA, "/hr/profile-change-requests"),
      ];
      const results = await Promise.all(calls);
      for (const [i, r] of results.entries()) {
        expect(r.status, `call#${i} phải 403, nhận ${r.status}: ${JSON.stringify(r.body)}`).toBe(
          403,
        );
      }
    });

    // ─── 8. Cô lập tenant ───────────────────────────────────────────────────────

    it("CROSS-TENANT: tenant B không xoá/khôi phục/từ chối được thực thể của tenant A", async () => {
      const empA = await seedEmployee(A.companyId, orgUnitA);
      const reqA = await seedApprovalRequest(A.companyId, adminUserIdA);

      const del = await authDelete(tAdminB, `/employees/${empA}`);
      expect(del.status, JSON.stringify(del.body)).toBe(404);

      const reject = await authPost(tAdminB, `/approval/requests/${reqA}/reject`).send({
        description: "chiếm quyền",
      });
      expect(reject.status, JSON.stringify(reject.body)).toBeGreaterThanOrEqual(400);
      expect(reject.status).toBeLessThan(500);

      const stillPending = await direct.query<{ status: string }>(
        `SELECT status FROM approval_requests WHERE company_id = $1 AND id = $2`,
        [A.companyId, reqA],
      );
      expect(stillPending.rows[0].status, "tenant B KHÔNG được đổi trạng thái của A").toBe(
        "pending",
      );

      // Cạnh đối chứng: cùng token B tạo được yêu cầu đổi hồ sơ của CHÍNH nó ⇒ 404 ở trên là cô lập.
      const ownB = await authPost(tAdminB, "/hr/profile-change-requests").send({
        changedFields: ["phone"],
        newValues: { phone: "0900000003" },
      });
      expect(ownB.status, JSON.stringify(ownB.body)).toBe(201);
    });

    it("neo chống-nhiễu: hồ sơ nhân viên của actor tồn tại (fixture không rỗng)", () => {
      expect(adminEmpIdA).toBeTruthy();
    });
  },
);
