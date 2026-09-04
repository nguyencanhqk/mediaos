/**
 * S14-SEC-DASHGATE-WILDCARD-1 §5.4 — grant wildcard `('*','*')` KHÔNG mở được cặp SENSITIVE,
 * trên ĐƯỜNG THẬT (HTTP + DB cô lập). ADR `DECISIONS-12`.
 *
 * LỖ ĐANG VÁ: `decideCan` đọc `is_sensitive` của HÀNG GRANT KHỚP. Actor chỉ cầm `('*','*')` ⇒ hàng
 * khớp là hàng wildcard (`is_sensitive=false`) ⇒ cổng sensitive KHÔNG bật ⇒ wildcard qua. Cổng tự
 * khoá mình bằng chìa của kẻ đi qua.
 *
 * BỐN RÀNG BUỘC ĐƯỢC CHỨNG Ở ĐÂY — và lý do phải là int-spec, không phải unit:
 *
 *  1. HAI TẦNG, KHÔNG PHẢI MỘT. Đường METADATA (`GET /dashboard/me` — widget không hiện) và đường
 *     DATA (gọi THẲNG slug ⇒ 403) là hai đường code khác nhau; vá một tầng rồi tuyên bố xong là bẫy
 *     `asset-guards-pairs-in-two-layers`. Unit-spec của gate chỉ đo tầng data.
 *
 *  2. CA ALLOW ĐỐI CHỨNG BẮT BUỘC. Không có chúng, mọi ca deny dưới đây xanh y hệt với một bản vá
 *     "chặn sạch mọi grant wildcard" — tức mất quyền của actor hợp lệ mà không spec nào kêu
 *     (`deny-cases-vacuous-without-allow-case`). Hai ca đối chứng ở hai trục KHÁC nhau: cặp
 *     NON-sensitive với CÙNG actor wildcard · cặp SENSITIVE với actor có grant EXACT.
 *
 *  3. MÃ LỖI ĐÚNG, không phải "khác 200". `.not.toBe(200)` nuốt cả 500 — một lỗi hạ tầng sẽ trông
 *     như một denial thành công (`allow-counter-case-not-403-lets-500-through`).
 *
 *  4. HAI NỬA CỦA BẢN VÁ PHẢI ĐƯỢC ĐO RIÊNG. `decideCan` và `decideStrongestScope` cùng được vá,
 *     nhưng trên `PAYROLL_COST`/`RECRUIT_FUNNEL` thì SÀN scope (`DASH_WIDGET_MIN_DATA_SCOPE`) chặn
 *     TRƯỚC ⇒ hai widget đó một mình KHÔNG chứng được nửa `can()`. Đo bằng đột biến: gỡ
 *     `pairIsSensitive` khỏi RIÊNG `decideCan` thì #18/#19 VẪN XANH. Vì vậy có #18b
 *     (`ATTENDANCE_TODAY`, tầng metadata) và #19c (`system-logs`, tầng data) — hai widget có cặp
 *     SENSITIVE mà KHÔNG khai sàn, nên `can()` là cổng duy nhất của chúng. GỠ HAI CA NÀY LÀ MÙ NỬA
 *     BẢN VÁ.
 *
 *  5. Kiểu dashboard `Employee` của actor wildcard là TIỀN ĐỀ, KHÔNG phải hệ quả bản vá —
 *     `DashboardResolverService.allowedTypeSet` vốn đã truyền `isSensitive` tường minh. Xem #22.
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
import { PermissionService } from "../../src/permission/permission.service";
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
const LOGIN_PW = ["Passw0rd", "dashwild1"].join("!");

type Scope = "Own" | "Team" | "Department" | "Company";
/** [action, resource, scope, isSensitive] — cờ PHẢI khớp seed thật (mig 0560/0565). */
type PairGrant = [string, string, Scope, boolean];

/** Hàng grant DUY NHẤT của actor wildcard. `is_sensitive=false` là cờ của CHÍNH hàng `*:*` — lỗ. */
const WILDCARD: PairGrant = ["*", "*", "Company", false];

/** Cặp gate của hai widget SENSITIVE dùng làm mẫu đo (mig 0560:84 · mig 0565:191). */
const VIEW_CANDIDATE: PairGrant = ["view", "candidate", "Company", true];
const VIEW_LINE: PairGrant = ["view-line", "payroll-period", "Company", true];
/**
 * Cặp SENSITIVE **KHÔNG có sàn scope** (`SYSTEM_LOGS` vắng trong `DASH_WIDGET_MIN_DATA_SCOPE`) —
 * mig 0340:31. Đây là mẫu đo CÔ LẬP cổng `can()`: hai widget trên đều có sàn nên `decideStrongestScope`
 * chặn trước, che mất nửa `decideCan` của bản vá.
 */
const VIEW_AUDIT_LOG: PairGrant = ["view", "audit-log", "Company", true];
/**
 * Cặp SENSITIVE **không sàn** DUY NHẤT nằm trên dashboard 'Employee' mặc định (mig 0454:35) — mẫu đo
 * CÔ LẬP `can()` ở tầng METADATA. Xem ca #18b.
 */
const VIEW_OWN_ATT: PairGrant = ["view-own", "attendance", "Own", true];
/** Cặp NON-sensitive để dựng ca ĐỐI CHỨNG (mig 0100:7 · 0051:99). */
const READ_DASHBOARD: PairGrant = ["read", "dashboard", "Company", false];
const VIEW_EMPLOYEE_DASH: PairGrant = ["view-employee", "dashboard", "Own", false];

describe.skipIf(!hasLaneDb)(
  "S14-SEC-DASHGATE-WILDCARD-1 — wildcard `*:*` không mở cặp SENSITIVE (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];

    let wildUser = ""; // CHỈ ('*','*')                         ← phải MẤT mọi widget sensitive
    let exactUser = ""; // grant EXACT cặp sensitive             ← phải VẪN thấy
    let tWild = "";
    let tExact = "";

    async function grantPairs(
      companyId: string,
      userId: string,
      label: string,
      pairs: PairGrant[],
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `dwild-${label}-${userId.slice(0, 8)}`);
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

    const codesOf = (body: unknown): string[] =>
      ((body as { data: { widgets: Array<{ widget_code: string }> } }).data.widgets ?? []).map(
        (w) => w.widget_code,
      );

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "dwild1a");
      companyIds.push(A.companyId);

      wildUser = await seedUser(direct, A.companyId, `wild@${A.slug}.test`, hash);
      exactUser = await seedUser(direct, A.companyId, `exact@${A.slug}.test`, hash);

      // Actor wildcard: ĐÚNG MỘT hàng grant. KHÔNG kèm read:dashboard — `*:*` phải tự phủ nó
      // (cặp non-sensitive), nếu không ca metadata dưới đây sẽ 403 vì lý do KHÁC lỗ đang đo.
      await grantPairs(A.companyId, wildUser, "wild", [WILDCARD]);
      await grantPairs(A.companyId, exactUser, "exact", [
        READ_DASHBOARD,
        VIEW_EMPLOYEE_DASH,
        VIEW_CANDIDATE,
        VIEW_LINE,
        VIEW_AUDIT_LOG,
        VIEW_OWN_ATT,
      ]);

      tWild = await login(A.slug, `wild@${A.slug}.test`);
      tExact = await login(A.slug, `exact@${A.slug}.test`);

      // Seeder default dashboard_widget_configs (company_id NOT NULL ⇒ runtime, không ở migration).
      const dbsvc = new DatabaseService();
      const registry = new MasterDataSeederRegistry();
      registry.register(new DashboardConfigSeeder());
      const runner = new MasterDataSeedRunner(dbsvc, new SeedTrackingService(dbsvc), registry);
      const outcomes = await runner.reconcileCompany(A.companyId);
      expect(outcomes.find((o) => o.seedKey === "dash.default-configs")?.ok).toBe(true);

      // ADR `DECISIONS-12` D7 — ảnh chụp catalog có TTL 5 phút và nạp LƯỜI. Các `login()` ở trên đã
      // kiểm quyền ⇒ ảnh chụp có thể đã nạp TRƯỚC khi `grantPairs` seed xong cặp mới. Không reset thì
      // spec đo một ảnh chụp cũ và đỏ/xanh theo thứ tự chạy, không theo hành vi.
      app.get(PermissionService).resetCatalogSnapshotForTest();
    }, 180_000);

    afterAll(async () => {
      if (direct) {
        await direct.query(
          "DELETE FROM dashboard_widget_cache WHERE company_id = ANY($1::uuid[])",
          [companyIds],
        );
        await cleanupTenants(direct, companyIds);
        await direct.end();
      }
      await app.close();
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════
    // Tầng METADATA — GET /dashboard/me (widget không hiện ⇒ FE không mount ⇒ không gọi API)
    // ══════════════════════════════════════════════════════════════════════════════════════════

    describe("tầng METADATA — GET /dashboard/me", () => {
      it("#18 actor CHỈ có `*:*` ⇒ PAYROLL_COST và RECRUIT_FUNNEL VẮNG", async () => {
        const res = await get(tWild, "/dashboard/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const codes = codesOf(res.body);
        expect(codes).not.toContain("PAYROLL_COST");
        expect(codes).not.toContain("RECRUIT_FUNNEL");
      });

      it("#20 ĐỐI CHỨNG — CÙNG actor wildcard VẪN thấy NOTIFICATIONS (`read:notification`, non-sensitive)", async () => {
        // Trục đối chứng 1: bản vá KHÔNG được biến thành "chặn mọi wildcard". Cùng người gọi, cùng
        // request, khác biệt DUY NHẤT là cờ `is_sensitive` của cặp gate.
        const res = await get(tWild, "/dashboard/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(codesOf(res.body)).toContain("NOTIFICATIONS");
      });

      it("#21 ĐỐI CHỨNG — actor có grant EXACT VẪN thấy cả hai widget sensitive", async () => {
        // Trục đối chứng 2: cặp vẫn mở được, chỉ là phải bằng grant EXACT. Nếu ca này đỏ thì bản vá
        // đã siết quá tay (deny cả người có quyền thật), không phải fixture sai.
        const res = await get(tExact, "/dashboard/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const codes = codesOf(res.body);
        expect(codes).toContain("PAYROLL_COST");
        expect(codes).toContain("RECRUIT_FUNNEL");
      });

      it("#22 kiểu dashboard của actor wildcard = 'Employee' — TIỀN ĐỀ của #18b, KHÔNG phải hệ quả bản vá", async () => {
        // ⚠️ Kế hoạch §5.4 ca 22 xếp điều này là "hệ quả có chủ ý của bản vá". ĐO LẠI: SAI.
        // `DashboardResolverService.allowedTypeSet` truyền `isSensitive: pair.isSensitive` TƯỜNG MINH
        // (dashboard-resolver.service.ts:81-86), nên `view-admin/-hr/-manager:dashboard` đã chặn
        // wildcard từ TRƯỚC WO này — đường resolve kiểu dashboard chưa bao giờ nằm trong lỗ.
        // Giữ ca lại vì nó là TIỀN ĐỀ: #18b chỉ có nghĩa nếu actor thực sự ở dashboard 'Employee'.
        const res = await get(tWild, "/dashboard/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.dashboard_type).toBe("Employee");
      });

      it("#18b CÔ LẬP cổng `can()` ở tầng metadata — ATTENDANCE_TODAY VẮNG (`view-own:attendance` sensitive, KHÔNG sàn)", async () => {
        // ⚠️ Ca then chốt. PAYROLL_COST/RECRUIT_FUNNEL có SÀN scope ⇒ `decideStrongestScope` loại
        // chúng TRƯỚC khi `decideCan` kịp nói gì: đo bằng đột biến (gỡ `pairIsSensitive` khỏi RIÊNG
        // `decideCan`) thì #18 VẪN XANH. `ATTENDANCE_TODAY` là widget duy nhất trên dashboard
        // 'Employee' mặc định có cặp gate SENSITIVE (`view-own:attendance` — mig 0454:35) mà KHÔNG
        // khai sàn ⇒ cổng duy nhất của nó là `filterByGatePair` pha 1 = `can()` không truyền cờ.
        const res = await get(tWild, "/dashboard/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(codesOf(res.body)).not.toContain("ATTENDANCE_TODAY");
      });

      it("#21d ĐỐI CHỨNG cho #18b — actor có `view-own:attendance` EXACT VẪN thấy ATTENDANCE_TODAY", async () => {
        const res = await get(tExact, "/dashboard/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(codesOf(res.body)).toContain("ATTENDANCE_TODAY");
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════
    // Tầng DATA — gọi THẲNG slug (bỏ qua metadata; đây là đường mà kẻ tấn công đi)
    // ══════════════════════════════════════════════════════════════════════════════════════════

    describe("tầng DATA — GET /dashboard/widgets/:slug", () => {
      it("#19 actor CHỈ có `*:*` ⇒ 403 AUTH-ERR-FORBIDDEN ở payroll-cost (đúng MÃ, không chỉ 'khác 200')", async () => {
        const res = await get(tWild, "/dashboard/widgets/payroll-cost");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        // Khẳng định MÃ: `.not.toBe(200)` sẽ nuốt cả 500 và biến lỗi hạ tầng thành "deny thành công".
        expect(JSON.stringify(res.body)).toContain("AUTH-ERR-FORBIDDEN");
      });

      it("#19b cùng actor ⇒ 403 luôn ở recruit-funnel (vá theo BỀ MẶT, không theo một widget)", async () => {
        const res = await get(tWild, "/dashboard/widgets/recruit-funnel");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).toContain("AUTH-ERR-FORBIDDEN");
      });

      it("#19c CÔ LẬP cổng `can()` — system-logs (`view:audit-log` sensitive, KHÔNG có sàn scope) ⇒ 403", async () => {
        // ⚠️ Ca này KHÔNG thừa. `payroll-cost`/`recruit-funnel` có SÀN scope
        // (`DASH_WIDGET_MIN_DATA_SCOPE`) nên chúng bị chặn bởi `decideStrongestScope` TRƯỚC khi
        // `decideCan` kịp nói gì — đo bằng đột biến: gỡ vế `pairIsSensitive` khỏi RIÊNG `decideCan`,
        // hai ca kia VẪN XANH. Tức chúng một mình KHÔNG chứng được nửa `can()` của bản vá.
        // `SYSTEM_LOGS` vắng mặt trong bản đồ sàn ⇒ cổng DUY NHẤT là `can()`.
        const res = await get(tWild, "/dashboard/widgets/system-logs");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).toContain("AUTH-ERR-FORBIDDEN");
      });

      it("#21c ĐỐI CHỨNG cho #19c — actor có `view:audit-log` EXACT gọi được system-logs (200)", async () => {
        const res = await get(tExact, "/dashboard/widgets/system-logs");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });

      it("#20b ĐỐI CHỨNG — CÙNG actor wildcard vẫn gọi được slug NON-sensitive (200)", async () => {
        const res = await get(tWild, "/dashboard/widgets/notifications");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });

      it("#21b ĐỐI CHỨNG — actor grant EXACT gọi được slug sensitive (200)", async () => {
        const res = await get(tExact, "/dashboard/widgets/payroll-cost");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });
    });
  },
);
