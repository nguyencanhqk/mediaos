/**
 * S5-SEQ-HARDEN-1 (security-reviewer MEDIUM-1) — deny-path LANE_DB: authz tầng-service (403) + kỳ đã khoá
 * (409) trong POST /attendance/adjustment-requests KHÔNG được "đốt" giá trị counter 'task'.
 *
 * Trước fix: createRequest cấp task_code (allocateTaskCodeBeforeTx) TRƯỚC resolveCreateTarget (403) và
 * assertPeriodOpenForDate (409) ⇒ mỗi lần thử-thất-bại vẫn tăng counter (counter inflation / DoS-lite bởi
 * actor đã đăng nhập). Sau fix: authz + kiểm kỳ chạy ở Phase 1 TRƯỚC khi cấp mã ⇒ 403/409 KHÔNG chạm counter.
 *
 * Bằng chứng: chốt current_value của counter 'task' sau 1 request THÀNH CÔNG (baseline V), rồi bắn 403 và
 * 409; current_value phải GIỮ NGUYÊN V (không tăng).
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). HTTP THẬT (controller/guard/permission).
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
  seedRole,
  seedPermissionCatalog,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);
// Ghép chuỗi để KHÔNG trip gitleaks generic-api-key (mật khẩu test ephemeral — CLAUDE.md §5).
const LOGIN_PW = ["Passw0rd", "seqharden1"].join("!");

type Scope = "Own" | "Team" | "Company";
type Pair = [action: string, resourceType: string, scope: Scope];

describe.skipIf(!runDb)(
  "S5-SEQ-HARDEN-1 — allocate-after-authz: 403/409 KHÔNG đốt counter 'task'",
  () => {
    let app: INestApplication;
    let direct: Pool;
    const companyIds: string[] = [];

    let passwordHash = "";
    async function hash(): Promise<string> {
      if (!passwordHash) passwordHash = await new PasswordService().hash(LOGIN_PW);
      return passwordHash;
    }

    async function seedEmployee(companyId: string, userId: string | null): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,'active') RETURNING id`,
        [companyId, userId],
      );
      return r.rows[0].id as string;
    }

    async function grant(
      companyId: string,
      userId: string,
      label: string,
      pairs: Pair[],
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `seqh-${label}-${userId.slice(0, 8)}`);
      for (const [action, resourceType, scope] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resourceType, false);
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

    const authPost = (t: string, u: string, body: object = {}) =>
      request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`).send(body);

    /** current_value của counter 'task' (bigint → string). null nếu counter chưa tồn tại. */
    async function taskCounterValue(companyId: string): Promise<string | null> {
      const r = await direct.query(
        `SELECT current_value FROM sequence_counters
         WHERE company_id=$1 AND sequence_key='task' AND scope_type='Company' AND deleted_at IS NULL`,
        [companyId],
      );
      return (r.rows[0]?.current_value as string | undefined) ?? null;
    }

    async function lockPeriod(companyId: string, periodMonth: string): Promise<void> {
      await direct.query(
        `INSERT INTO attendance_periods (company_id, period_month, status)
         VALUES ($1,$2,'locked')
         ON CONFLICT (company_id, period_month) DO UPDATE SET status='locked'`,
        [companyId, periodMonth],
      );
    }

    let C: SeededTenant;
    let empUserId: string;
    let empToken: string;
    let otherEmployeeId: string;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();

      C = await seedCompany(direct, "seqhalloc");
      companyIds.push(C.companyId);
      empUserId = await seedUser(direct, C.companyId, `emp@${C.slug}.test`, await hash());
      await seedEmployee(C.companyId, empUserId);
      // Actor CHỈ có create-own:adjustment scope Own (KHÔNG đủ để tạo-thay nhân viên khác).
      await grant(C.companyId, empUserId, "emp", [["create-own", "adjustment", "Own"]]);
      // Một nhân viên KHÁC (không liên kết user) làm target cho nhánh create-thay → 403.
      otherEmployeeId = await seedEmployee(C.companyId, null);
      empToken = await login(C.slug, `emp@${C.slug}.test`);
    });

    afterAll(async () => {
      await direct
        ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
        .catch(() => undefined);
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    it("baseline: 1 request thành công tạo counter 'task' (current_value tiến 1)", async () => {
      expect(await taskCounterValue(C.companyId)).toBeNull(); // chưa có counter trước request đầu
      const res = await authPost(empToken, "/attendance/adjustment-requests", {
        workDate: "2027-09-07",
        requestType: "UPDATE_CHECK_IN",
        reason: "Baseline S5-SEQ-HARDEN-1 allocate-guard",
        requestedCheckInAt: "2027-09-07T02:00:00Z",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(await taskCounterValue(C.companyId)).toBe("1");
    });

    it("403 create-thay (ngoài scope) KHÔNG đốt counter — current_value giữ nguyên", async () => {
      const before = await taskCounterValue(C.companyId);
      expect(before).toBe("1");

      const res = await authPost(empToken, "/attendance/adjustment-requests", {
        workDate: "2027-09-14",
        requestType: "UPDATE_CHECK_IN",
        reason: "403 create-thay ngoài scope",
        requestedCheckInAt: "2027-09-14T02:00:00Z",
        targetEmployeeId: otherEmployeeId,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(await taskCounterValue(C.companyId)).toBe(before); // KHÔNG tăng
    });

    it("409 kỳ đã khoá KHÔNG đốt counter — current_value giữ nguyên", async () => {
      await lockPeriod(C.companyId, "2027-10");
      const before = await taskCounterValue(C.companyId);
      expect(before).toBe("1");

      const res = await authPost(empToken, "/attendance/adjustment-requests", {
        workDate: "2027-10-05",
        requestType: "UPDATE_CHECK_IN",
        reason: "409 kỳ đã khoá",
        requestedCheckInAt: "2027-10-05T02:00:00Z",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(await taskCounterValue(C.companyId)).toBe(before); // KHÔNG tăng
    });
  },
);
