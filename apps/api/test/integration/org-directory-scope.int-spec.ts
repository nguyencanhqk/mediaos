/**
 * S6-SEC-ORGSCOPE-1 — N-1: `GET /org/employees` phải ép `data_scope`, không chỉ cặp quyền.
 *
 * `S6-SEC-ORG-1` đã gate route bằng `read:user`, nhưng `PermissionGuard` chỉ hỏi "CÓ cặp quyền
 * không", không hỏi "scope TỚI ĐÂU". `OrgRepository.listEmployees` khi đó chỉ `withTenant` +
 * `eq(users.companyId)` ⇒ một role tenant đúc qua role-admin với `data_scope = Own/Team/Department`
 * (ceiling chỉ chặn `System` — `role-admin.service.ts`) QUA được guard rồi nhận TRỌN danh bạ tenant
 * kèm email. UI hứa hẹp, API giao rộng.
 *
 * VẾ RED (trên code TRƯỚC khi vá): mọi ca `Own`/`Team`/`Department` dưới đây trả về TOÀN BỘ user của
 * tenant. Pin cũ ở `org-directory-permission.int-spec.ts` không bắt được vì nó lọc `is_system = true`
 * ⇒ chỉ phủ role HỆ THỐNG, không phủ role tenant đúc lúc chạy — tức đúng cái role-admin sinh ra.
 *
 * QUYẾT ĐỊNH THIẾT KẾ được khoá ở đây (plan §2, đường (b)): vị từ hình-`users`, cùng ngữ nghĩa
 * `GET /auth/users` (`auth-users.service.ts:478`) — `System/Company` → tenant · `Own` → chính mình ·
 * `Team`/`Department` → fail-closed 0 hàng (`users` không có org-mapping; §13 chỉ cấp Company cho
 * cặp đọc user). KHÔNG join `employee_profiles` (đường (a)) vì user CHƯA CÓ hồ sơ nhân sự sẽ biến
 * mất khỏi màn RBAC của console — chính route này là danh sách subject để gán role.
 *
 * Gate `hasDb && LANE_DB` (memory `integration-test-lane-db-gate`).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
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

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const PASSWORD = "Passw0rd!test99";
const hasLaneDb = hasDb && !!process.env.LANE_DB;

/**
 * Cặp quyền gate đường danh bạ. GIỮ ĐỒNG BỘ với `ORG_EMPLOYEE_DIRECTORY`
 * (`apps/api/src/org/org.permissions.ts`) — `S6-SEC-PERMVERB-1` đổi động từ sang `view:user` thì
 * đổi ở đây cùng lúc, nếu không test sẽ seed một cặp mà guard không dùng ⇒ 403 khắp nơi.
 */
const DIRECTORY_PAIR = ["read", "user"] as const;

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

type Row = { id: string; email: string; teams: { teamId: string }[] };

describe.skipIf(!hasLaneDb)("S6-SEC-ORGSCOPE-1 — /org/employees ép data_scope (N-1)", () => {
  const direct = directPool();
  let app: INestApplication;

  let A: SeededTenant;

  /** `Company` — đại diện company-admin/SA của PROD (mọi grant đang sống đều Company). */
  let uCompany = "";
  /** `Own` — chỉ được thấy chính mình. */
  let uOwn = "";
  /** `Team` — scope KHÔNG định nghĩa được trên `users` ⇒ phải fail-closed. */
  let uTeam = "";
  /** `Department` — như `Team`. */
  let uDept = "";
  /** Không grant, CÓ hồ sơ nhân sự — mồi để đếm "thấy được ai". */
  let uPlainWithProfile = "";
  /** Không grant, KHÔNG hồ sơ nhân sự — chốt chống hồi quy màn RBAC (done_when #3). */
  let uPlainNoProfile = "";

  let teamA = "";

  async function grantScoped(
    companyId: string,
    userId: string,
    dataScope: "Own" | "Team" | "Department" | "Company",
    label: string,
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `orgscope-${label}-${userId.slice(0, 8)}`);
    const permId = await seedPermissionCatalog(direct, DIRECTORY_PAIR[0], DIRECTORY_PAIR[1], false);
    await seedRolePermission(direct, roleId, permId, "ALLOW", dataScope);
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function login(slug: string, email: string): Promise<string> {
    const res = await api(app)
      .post("/auth/login")
      .send({ companySlug: slug, email, password: PASSWORD });
    expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function employees(token: string): Promise<{ status: number; rows: Row[] }> {
    const res = await api(app).get("/org/employees").set(bearer(token));
    return { status: res.status, rows: (res.body?.data ?? []) as Row[] };
  }

  let tokCompany = "";
  let tokOwn = "";
  let tokTeam = "";
  let tokDept = "";

  beforeAll(async () => {
    const hash = await hashedPw();
    A = await seedCompany(direct, "orgscope");

    uCompany = await seedUser(direct, A.companyId, `company@${A.slug}.test`, hash);
    uOwn = await seedUser(direct, A.companyId, `own@${A.slug}.test`, hash);
    uTeam = await seedUser(direct, A.companyId, `team@${A.slug}.test`, hash);
    uDept = await seedUser(direct, A.companyId, `dept@${A.slug}.test`, hash);
    uPlainWithProfile = await seedUser(direct, A.companyId, `withprofile@${A.slug}.test`, hash);
    uPlainNoProfile = await seedUser(direct, A.companyId, `noprofile@${A.slug}.test`, hash);

    await grantScoped(A.companyId, uCompany, "Company", "co");
    await grantScoped(A.companyId, uOwn, "Own", "own");
    await grantScoped(A.companyId, uTeam, "Team", "team");
    await grantScoped(A.companyId, uDept, "Department", "dept");

    // ĐÚNG MỘT user có hồ sơ nhân sự. Nếu ai đó "sửa" bằng cách join employee_profiles (đường (a)
    // của plan) thì ca Company bên dưới sẽ ĐỎ ngay — đó là mục đích của sự bất đối xứng này.
    await direct.query("INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2)", [
      A.companyId,
      uPlainWithProfile,
    ]);

    const t = await direct.query(
      "INSERT INTO teams (company_id, name, type) VALUES ($1, $2, 'production_team') RETURNING id",
      [A.companyId, "Team orgscope"],
    );
    teamA = t.rows[0].id as string;
    for (const u of [uPlainWithProfile, uPlainNoProfile]) {
      await direct.query(
        "INSERT INTO team_members (company_id, team_id, user_id, role_name) VALUES ($1, $2, $3, 'member')",
        [A.companyId, teamA, u],
      );
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    await app.init();

    tokCompany = await login(A.slug, `company@${A.slug}.test`);
    tokOwn = await login(A.slug, `own@${A.slug}.test`);
    tokTeam = await login(A.slug, `team@${A.slug}.test`);
    tokDept = await login(A.slug, `dept@${A.slug}.test`);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await cleanupTenants(direct, [A?.companyId].filter(Boolean) as string[]);
    await direct.end();
  });

  // ── Vế RED: scope hẹp KHÔNG được nhận trọn danh bạ ─────────────────────────────────────────────

  it("scope `Own` → CHỈ thấy chính mình (không phải toàn tenant)", async () => {
    const { status, rows } = await employees(tokOwn);
    expect(status, JSON.stringify(rows)).toBe(200);
    expect(
      rows.map((r) => r.id),
      "Own nhận nhiều hơn chính mình ⇒ repository chưa ép data_scope (N-1)",
    ).toEqual([uOwn]);
  });

  it("scope `Team` → 0 hàng (fail-closed: `users` không có org-mapping — plan §2.1)", async () => {
    const { status, rows } = await employees(tokTeam);
    expect(status, JSON.stringify(rows)).toBe(200);
    expect(
      rows,
      "Team qua guard rồi nhận danh bạ ⇒ đúng bẫy ngủ đông N-1: UI hứa hẹp, API giao rộng",
    ).toEqual([]);
  });

  it("scope `Department` → 0 hàng (fail-closed)", async () => {
    const { status, rows } = await employees(tokDept);
    expect(status, JSON.stringify(rows)).toBe(200);
    expect(rows).toEqual([]);
  });

  it("scope hẹp KHÔNG rò email của người ngoài scope (khẳng định trên THÂN phản hồi)", async () => {
    // Không dừng ở việc đếm hàng: một hồi quy giữ nguyên `email` trong projection nhưng lọc sai vẫn
    // phải bị bắt. Đây là dữ liệu PII thật mà KI-030 đã cắt một lần.
    for (const tok of [tokOwn, tokTeam, tokDept]) {
      const res = await api(app).get("/org/employees").set(bearer(tok));
      expect(JSON.stringify(res.body)).not.toContain(`noprofile@${A.slug}.test`);
      expect(JSON.stringify(res.body)).not.toContain(`withprofile@${A.slug}.test`);
    }
  });

  it("scope hẹp KHÔNG rò membership team của người ngoài scope", async () => {
    // `listEmployees` trả kèm `teams[]`. Lọc user mà quên bound `team_members` = vẫn rò ai thuộc
    // nhóm nào (một nửa danh bạ), nên vế này được khoá riêng.
    const { rows } = await employees(tokOwn);
    expect(rows.flatMap((r) => r.teams ?? [])).toEqual([]);
  });

  // ── Vế chống-siết-quá-tay: Company phải KHÔNG hồi quy (done_when #3) ───────────────────────────

  it("scope `Company` → thấy MỌI user tenant, KỂ CẢ user chưa có employee_profile", async () => {
    const { status, rows } = await employees(tokCompany);
    expect(status, JSON.stringify(rows)).toBe(200);
    const emails = rows.map((r) => r.email);

    // Chốt hồi quy màn RBAC console (`apps/console/src/lib/rbac-api.ts` dùng route này làm danh sách
    // subject để gán role): join `employee_profiles` sẽ làm user chưa có hồ sơ biến mất ⇒ admin
    // KHÔNG gán role được cho người vừa tạo. Đây là lý do plan §2 loại đường (a).
    expect(
      emails,
      "user chưa có employee_profile bị rụng ⇒ hồi quy màn RBAC (plan §2, đường (a) đã bị loại)",
    ).toContain(`noprofile@${A.slug}.test`);
    expect(emails).toContain(`withprofile@${A.slug}.test`);
    expect(emails).toContain(`company@${A.slug}.test`);
    expect(emails).toContain(`own@${A.slug}.test`);
  });

  it("scope `Company` vẫn trả membership team (không siết nhầm vế teams)", async () => {
    const { rows } = await employees(tokCompany);
    const withProfile = rows.find((r) => r.email === `withprofile@${A.slug}.test`);
    expect(withProfile?.teams.map((t) => t.teamId)).toEqual([teamA]);
  });
});
