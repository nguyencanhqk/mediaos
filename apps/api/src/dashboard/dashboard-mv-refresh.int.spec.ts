/**
 * S10-DASH-MVREFRESH-1 — Integration (Postgres THẬT, DB CÔ LẬP): DashboardMvRefreshJobHandler thật sự
 * LÀM MỚI dữ liệu (không chỉ "không ném lỗi"). Đo hàng qua `GET /dashboard/mv-stats` TRƯỚC/SAU khi
 * trồng thêm task và gọi job — khác `mv-taskstatus-canonical.int.spec.ts` (đo ĐÚNG giá trị canonical
 * sau MỘT lần REFRESH SQL tay), spec này đo THAY ĐỔI qua job handler THẬT (đường sẽ chạy theo lịch).
 *
 * KI-017 nửa "lịch chạy" (nửa "must be owner"/privilege đã đóng ở mig 0534, `S6-SEC-MV-1`): trước WO
 * này KHÔNG có gì tự gọi `DashboardRefreshService.refresh()` định kỳ — chỉ chạy khi bấm tay
 * `POST /dashboard/refresh`. Endpoint tay GIỮ NGUYÊN (không kiểm lại ở đây).
 *
 * Throttle nội bộ của handler (in-memory, cấp instance — xem docblock `dashboard-mv-refresh.job-handler.ts`)
 * là lý do mỗi "lần refresh" dưới đây dùng MỘT instance handler MỚI: throttle chỉ có ý nghĩa chống refresh
 * TRÙNG trong CÙNG một tick đa-tenant (đã phủ bằng mock ở `.spec.ts`), KHÔNG phải thứ spec này muốn đo.
 *
 * Gate cứng `hasDb && LANE_DB`. Colocated src/dashboard → vitest include src/**\/*.spec.ts.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../auth/password.service";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../test/helpers/seed";
import { DashboardMvRefreshJobHandler } from "./dashboard-mv-refresh.job-handler";
import { DashboardRefreshService } from "./dashboard-refresh.service";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = "Passw0rd!test99";

interface StatusStat {
  status: string;
  taskCount: number;
}

describe.skipIf(!runDb)(
  "S10-DASH-MVREFRESH-1 — DashboardMvRefreshJobHandler làm mới dữ liệu THẬT (đo hàng trước/sau)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];
    let cachedToken: string | undefined;

    async function plantDoneTask(): Promise<void> {
      // hr + approved → canonical Done (mirror mv-taskstatus-canonical.int.spec.ts plantLegacyTask).
      await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, status) VALUES ($1,$2,$3,$4)`,
        [
          A.companyId,
          "hr",
          `mvrefresh-done-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          "approved",
        ],
      );
    }

    async function login(): Promise<string> {
      if (cachedToken) return cachedToken;
      const email = `a@${A.slug}.test`;
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: A.slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      cachedToken = res.body.data.accessToken as string;
      return cachedToken;
    }

    async function fetchDoneCount(): Promise<number> {
      const token = await login();
      const res = await request(app.getHttpServer())
        .get("/dashboard/mv-stats")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const stats = res.body.data.taskStatus as StatusStat[];
      return stats.find((s) => s.status === "Done")?.taskCount ?? 0;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);

      A = await seedCompany(direct, "dashmvrf");
      companyIds.push(A.companyId);
      const uA = await seedUser(direct, A.companyId, `a@${A.slug}.test`, hash);
      const role = await seedRole(direct, A.companyId, "dashmvrefresh");
      const perm = await seedPermissionCatalog(direct, "read", "dashboard", false);
      await seedRolePermission(direct, role, perm, "ALLOW", "Company");
      await seedUserRole(direct, uA, role, A.companyId);

      // MV vừa tạo (mig 0102) là WITH NO DATA trên lane mới — SELECT thẳng sẽ ném "has not been
      // populated" nếu chưa refresh lần nào. Populate lần đầu QUA CHÍNH JOB (không phải SQL tay):
      // chứng minh nhánh populate-đầu-tiên của refresh_dashboard_mvs() (mig 0534) chạy được qua
      // đường job, không chỉ qua REFRESH gõ tay như mv-taskstatus-canonical.int.spec.ts.
      await plantDoneTask();
      const seeded = await new DashboardMvRefreshJobHandler(new DashboardRefreshService()).run({
        companyId: A.companyId,
      });
      expect(seeded).toMatchObject({ total: 1, success: 1, failed: 0 });
    });

    afterAll(async () => {
      if (app) await app.close();
      if (direct) {
        await direct
          .query("DELETE FROM tasks WHERE company_id = ANY($1::uuid[])", [companyIds])
          .catch(() => undefined);
        await cleanupTenants(direct, companyIds);
      }
    });

    it("TRƯỚC: job đã populate lần đầu — Done=1", async () => {
      expect(await fetchDoneCount()).toBe(1);
    });

    it("dữ liệu drift (task Done thứ 2) KHÔNG tự phản ánh cho tới khi job chạy lại — MV vẫn CŨ", async () => {
      await plantDoneTask();
      expect(await fetchDoneCount()).toBe(1);
    });

    it("SAU: gọi job (instance MỚI) ⇒ Done=2 — job THẬT SỰ làm dữ liệu mới đi, không chỉ 'chạy không lỗi'", async () => {
      const handler = new DashboardMvRefreshJobHandler(new DashboardRefreshService());
      const result = await handler.run({ companyId: A.companyId });
      expect(result).toMatchObject({ total: 1, success: 1, failed: 0 });
      expect(result.metadata).toMatchObject({ skipped: false });
      expect(await fetchDoneCount()).toBe(2);
    });
  },
);
