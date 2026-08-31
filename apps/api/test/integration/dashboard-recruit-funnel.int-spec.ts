/**
 * S12-RECRUIT-DASH-1 — widget DASH «phễu tuyển dụng» (SPEC-12 §5.1 RC-10 · §10 RECRUIT-FUNC-013 ·
 * RECRUIT-WIDGET-001, mig 0563): `recruit-funnel` (RECRUIT_FUNNEL).
 *
 * BA RÀNG BUỘC ĐƯỢC CHỨNG Ở ĐÂY (không phải ở FE — FE chỉ có gate PHỤ theo CẶP):
 *
 *  1. SÀN SCOPE 'Company' ép ở HAI TẦNG đọc CÙNG hằng (`DASH_WIDGET_MIN_DATA_SCOPE`): đường METADATA
 *     (GET /dashboard/me — omit ⇒ FE không mount ⇒ không gọi API, SPEC-12 §20.11) VÀ đường DATA
 *     (GET /dashboard/widgets/recruit-funnel ⇒ 403). Sàn ở đây KHÔNG phải phòng xa: `summaryTx` đếm
 *     TOÀN company (không co theo actor scope), nên grant `view:candidate` hẹp hơn Company mà được serve
 *     là rò số liệu ngoài scope — ca `@Department ⇒ 403` bên dưới đo đúng lỗ đó. Đo một tầng là chưa đủ
 *     (bẫy `asset-guards-pairs-in-two-layers`).
 *
 *  2. MỘT CÔNG THỨC, MỘT CON SỐ. Widget PHẢI khớp `GET /candidates/summary` (RECRUIT-API-009) cho CÙNG
 *     người gọi — đối chiếu trực tiếp endpoint nguồn, không so hằng chép tay
 *     (memory `reused-method-must-be-actor-scoped`).
 *
 *  3. KHÔNG PII ứng viên trong payload (REC-DEC-003): widget chỉ ĐẾM — fullName/email/phone không được
 *     xuất hiện, kể cả khi cache company-shared.
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory `integration-test-lane-db-gate`) — chỉ chạy trên DB cô lập lane.
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
import { DatabaseService } from "../../src/db/db.service";
import { DashboardConfigSeeder } from "../../src/dashboard/dashboard-config.seeder";
import { MasterDataSeederRegistry } from "../../src/foundation/seed/master-data-seeder.registry";
import { MasterDataSeedRunner } from "../../src/foundation/seed/master-data-seed-runner.service";
import { SeedTrackingService } from "../../src/foundation/seed/seed-tracking.service";
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
const LOGIN_PW = "Passw0rd!recruitdash1";

type Scope = "Own" | "Team" | "Department" | "Company";
/** [action, resource, scope, isSensitive] — view:candidate PHẢI true (mig 0560; helper fail-loud nếu lệch). */
type PairGrant = [string, string, Scope, boolean];

/** Mọi actor cần cặp này để qua @RequirePermission của DashboardWidgetDataController + resolver /me. */
const DASH_BASE: PairGrant[] = [
  ["read", "dashboard", "Company", false],
  ["view-employee", "dashboard", "Own", false],
];

// Marker PII cố ý ĐẶC THÙ để quét vắng mặt trong payload widget.
const PII_NAME = "Ứng viên FUNNEL1 Nguyễn";
const PII_EMAIL = "cand-funnel1@rdash1.test";

describe.skipIf(!hasLaneDb)(
  "S12-RECRUIT-DASH-1 — widget RECRUIT_FUNNEL (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let recUser = ""; // "recruiter": view:candidate @Company  ← PHẢI thấy widget
    let deptUser = ""; // grant HẸP: view:candidate @Department ← sàn scope PHẢI chặn (giả định tương lai)
    let bareUser = ""; // KHÔNG có view:candidate
    let bUser = ""; // công ty B: view:candidate @Company, tenant KHÔNG có dữ liệu
    let tRec = "";
    let tDept = "";
    let tBare = "";
    let tB = "";

    async function grantPairs(
      companyId: string,
      userId: string,
      label: string,
      pairs: PairGrant[],
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `rdash-${label}-${userId.slice(0, 8)}`);
      for (const [action, resource, scope, sensitive] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resource, sensitive);
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

    async function seedJobOpening(
      companyId: string,
      orgUnitId: string,
      title: string,
      status: string,
    ): Promise<string> {
      const r = await direct.query<{ id: string }>(
        `INSERT INTO job_openings (company_id, title, org_unit_id, status)
       VALUES ($1,$2,$3,$4) RETURNING id`,
        [companyId, title, orgUnitId, status],
      );
      return r.rows[0].id;
    }

    async function seedCandidate(
      companyId: string,
      jobOpeningId: string,
      fullName: string,
      stage: string,
      v?: { email?: string; deleted?: boolean },
    ): Promise<string> {
      const r = await direct.query<{ id: string }>(
        `INSERT INTO candidates (company_id, job_opening_id, full_name, email, stage, deleted_at)
       VALUES ($1,$2,$3,$4,$5, CASE WHEN $6 THEN now() ELSE NULL END) RETURNING id`,
        [companyId, jobOpeningId, fullName, v?.email ?? null, stage, v?.deleted ?? false],
      );
      return r.rows[0].id;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "rdash1a");
      B = await seedCompany(direct, "rdash1b");
      companyIds.push(A.companyId, B.companyId);

      const ou = await direct.query<{ id: string }>(
        "INSERT INTO org_units (company_id, name, type) VALUES ($1,'Tuyển dụng RDASH1','department') RETURNING id",
        [A.companyId],
      );
      const ouId = ou.rows[0].id;

      const mk = (name: string, co = A) =>
        seedUser(direct, co.companyId, `${name}@${co.slug}.test`, hash);
      recUser = await mk("rec");
      deptUser = await mk("dept");
      bareUser = await mk("bare");
      bUser = await seedUser(direct, B.companyId, `rec@${B.slug}.test`, hash);

      await grantPairs(A.companyId, recUser, "rec", [
        ...DASH_BASE,
        ["view", "candidate", "Company", true],
      ]);
      // Grant HẸP GIẢ ĐỊNH (hôm nay ma trận §9f chỉ có @Company) — đo SÀN, không đo ma trận seed.
      await grantPairs(A.companyId, deptUser, "dept", [
        ...DASH_BASE,
        ["view", "candidate", "Department", true],
      ]);
      await grantPairs(A.companyId, bareUser, "bare", DASH_BASE);
      await grantPairs(B.companyId, bUser, "b", [
        ...DASH_BASE,
        ["view", "candidate", "Company", true],
      ]);

      tRec = await login(A.slug, `rec@${A.slug}.test`);
      tDept = await login(A.slug, `dept@${A.slug}.test`);
      tBare = await login(A.slug, `bare@${A.slug}.test`);
      tB = await login(B.slug, `rec@${B.slug}.test`);

      // ── Fixture RECRUIT (SQL — summary chỉ ĐẾM, không cần đi qua FSM):
      //    1 vị trí Open + 1 Draft ⇒ openJobOpenings = 1;
      //    hồ sơ SỐNG: New×2 + Interview×1 ⇒ byStage {New:2, Interview:1}, total = 3;
      //    1 hồ sơ soft-delete (New) — PHẢI KHÔNG được đếm (liveWhere).
      const jobOpen = await seedJobOpening(A.companyId, ouId, "Backend Dev RDASH1", "Open");
      await seedJobOpening(A.companyId, ouId, "Designer RDASH1 (nháp)", "Draft");
      await seedCandidate(A.companyId, jobOpen, PII_NAME, "New", { email: PII_EMAIL });
      await seedCandidate(A.companyId, jobOpen, "Ứng viên FUNNEL2", "New");
      await seedCandidate(A.companyId, jobOpen, "Ứng viên FUNNEL3", "Interview");
      await seedCandidate(A.companyId, jobOpen, "Ứng viên FUNNEL4 (đã xoá)", "New", {
        deleted: true,
      });
      // Công ty B: KHÔNG dữ liệu ⇒ widget Empty (đồng thời chứng cách ly tenant).

      // Seeder default dashboard_widget_configs (company_id NOT NULL ⇒ runtime, không ở migration).
      const dbsvc = new DatabaseService();
      const registry = new MasterDataSeederRegistry();
      registry.register(new DashboardConfigSeeder());
      const runner = new MasterDataSeedRunner(dbsvc, new SeedTrackingService(dbsvc), registry);
      const outcomes = await runner.reconcileCompany(A.companyId);
      expect(outcomes.find((o) => o.seedKey === "dash.default-configs")?.ok).toBe(true);
      const outcomesB = await runner.reconcileCompany(B.companyId);
      expect(outcomesB.find((o) => o.seedKey === "dash.default-configs")?.ok).toBe(true);
    }, 180_000);

    afterAll(async () => {
      if (direct) {
        await direct.query(
          "DELETE FROM dashboard_widget_cache WHERE company_id = ANY($1::uuid[])",
          [companyIds],
        );
        await direct.query("DELETE FROM candidates WHERE company_id = ANY($1::uuid[])", [
          companyIds,
        ]);
        await direct.query("DELETE FROM job_openings WHERE company_id = ANY($1::uuid[])", [
          companyIds,
        ]);
        await cleanupTenants(direct, companyIds);
        await direct.end();
      }
      await app.close();
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // Tầng DATA — GET /dashboard/widgets/recruit-funnel
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    describe("RECRUIT_FUNNEL — tầng DATA", () => {
      it("RED: user KHÔNG có view:candidate ⇒ 403 (fail-closed, KHÔNG Degraded 200)", async () => {
        const res = await get(tBare, "/dashboard/widgets/recruit-funnel");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("RED: view:candidate@Department ⇒ 403 — SÀN 'Company' vì summaryTx đếm TOÀN company", async () => {
        const res = await get(tDept, "/dashboard/widgets/recruit-funnel");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("ALLOW @Company: 200 và số liệu KHỚP GET /candidates/summary của CÙNG người gọi", async () => {
        const src = await get(tRec, "/candidates/summary");
        expect(src.status, JSON.stringify(src.body)).toBe(200);
        const res = await get(tRec, "/dashboard/widgets/recruit-funnel");
        expect(res.status, JSON.stringify(res.body)).toBe(200);

        const w = res.body.data.data as {
          byStage: Record<string, number>;
          summary: { totalCandidates: number; openJobOpenings: number };
        };
        expect(w.byStage).toEqual(src.body.data.byStage);
        expect(w.summary.openJobOpenings).toBe(src.body.data.openJobOpenings);
        // Số kỳ vọng TƯỜNG MINH (không chỉ parity — hai vế cùng sai vẫn "khớp"): hồ sơ soft-delete
        // KHÔNG đếm, vị trí Draft KHÔNG tính là mở.
        expect(w.byStage).toEqual({ New: 2, Interview: 1 });
        expect(w.summary.totalCandidates).toBe(3);
        expect(w.summary.openJobOpenings).toBe(1);
      });

      it("payload KHÔNG chứa PII ứng viên (fullName/email — REC-DEC-003)", async () => {
        const res = await get(tRec, "/dashboard/widgets/recruit-funnel");
        expect(res.status).toBe(200);
        const flat = JSON.stringify(res.body.data);
        expect(flat).not.toContain(PII_NAME);
        expect(flat).not.toContain(PII_EMAIL);
        expect(flat).not.toContain("fullName");
        expect(flat).not.toContain("email");
        expect(flat).not.toContain("phone");
      });

      it("cross-tenant: công ty B (0 dữ liệu) ⇒ Empty, KHÔNG marker nào của công ty A", async () => {
        const res = await get(tB, "/dashboard/widgets/recruit-funnel");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.status).toBe("Empty");
        expect(res.body.data.data).toBeNull();
        const flat = JSON.stringify(res.body.data);
        expect(flat).not.toContain("Backend Dev RDASH1");
        expect(flat).not.toContain(PII_NAME);
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // Tầng METADATA — GET /dashboard/me: omit ⇒ FE KHÔNG mount ⇒ KHÔNG gọi API (SPEC-12 §20.11)
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    describe("RECRUIT_FUNNEL — tầng METADATA (GET /dashboard/me)", () => {
      const codesOf = (body: unknown): string[] =>
        ((body as { data: { widgets: Array<{ widget_code: string }> } }).data.widgets ?? []).map(
          (w) => w.widget_code,
        );

      it("bare (không cặp): RECRUIT_FUNNEL VẮNG khỏi /dashboard/me", async () => {
        const res = await get(tBare, "/dashboard/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(codesOf(res.body)).not.toContain("RECRUIT_FUNNEL");
      });

      it("view:candidate@Department: VẮNG — sàn scope ép ở CẢ tầng metadata, cùng hằng với tầng data", async () => {
        const res = await get(tDept, "/dashboard/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(codesOf(res.body)).not.toContain("RECRUIT_FUNNEL");
      });

      it("view:candidate@Company: CÓ trong /dashboard/me — cùng dashboard type 'Employee' với hai ca trên", async () => {
        const res = await get(tRec, "/dashboard/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        // Cả ba actor đều resolve về dashboard 'Employee' (chỉ có view-employee:dashboard) ⇒ khác biệt
        // DUY NHẤT là CẶP + SCOPE, không phải dashboard_type / role.
        expect(res.body.data.dashboard_type).toBe("Employee");
        expect(codesOf(res.body)).toContain("RECRUIT_FUNNEL");
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // Đường catalog — GET /dashboard/widgets omit widget ngoài quyền
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    it("GET /dashboard/widgets: dept/bare KHÔNG thấy RECRUIT_FUNNEL; rec thấy", async () => {
      const codes = async (t: string) => {
        const res = await get(t, "/dashboard/widgets");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        return (res.body.data as Array<{ widget_code: string }>).map((w) => w.widget_code);
      };
      expect(await codes(tBare)).not.toContain("RECRUIT_FUNNEL");
      expect(await codes(tDept)).not.toContain("RECRUIT_FUNNEL");
      expect(await codes(tRec)).toContain("RECRUIT_FUNNEL");
    });

    it("slug lạ vẫn 404 (không mở cửa hậu khi thêm slug mới)", async () => {
      const res = await get(tRec, "/dashboard/widgets/recruit-funnell");
      expect([404, 400]).toContain(res.status);
    });
  },
);
