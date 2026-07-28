/**
 * S6-SEC-ORG-1 — KI-030: 3 route đọc `/org` trả DỮ LIỆU VỀ NGƯỜI phải gate (CROWN-JEWEL).
 *
 * Boot AppModule THẬT + supertest ⇒ chạy trọn chuỗi JwtAuthGuard → CompanyGuard → PermissionGuard →
 * OrgService → DB. Không mock PermissionService: cặp quyền được đọc từ `role_permissions` thật, nên
 * test này chứng minh được cả "chặn ai" lẫn "cho ai qua".
 *
 * Trạng thái TRƯỚC khi vá (đây là vế RED):
 *   `GET /org/employees` · `GET /org/teams` · `GET /org/teams/:id/members` không mang `@UseGuards`
 *   hay `@RequirePermission` nào ⇒ MỌI user đã đăng nhập đọc được danh bạ toàn tenant, kèm email
 *   (`org.repository.ts:322` trả id·email·fullName·status; `listTeamMembers` trả cả `userEmail`).
 *   Cùng lớp dữ liệu đó ở `/hr/employees` thì bị ép `read:employee` + data_scope ⇒ lệch = SEC-F04.
 *
 * Cặp quyền dùng để gate là cặp CÓ THẬT trong seed, không phát minh cặp mới
 * (memory `s1-fnd-module-metadata-seed-drift`):
 *   - `read:user` — `0005_permissions.sql:205`
 *   - `read:team` — `0005_permissions.sql:200` (tái khẳng định `0030_g5fix_org_team_perms.sql:28`)
 *
 * VẾ NGƯỢC LẠI CŨNG ĐƯỢC KHOÁ (chống siết quá tay): `GET /org/units`, `GET /org/units/tree`,
 * `GET /org/departments`, `GET /org/roles` PHẢI vẫn 200 cho user KHÔNG grant. `apps/app` dùng
 * `/org/units/tree` ở `routes/hr/org-chart/OrgChartPage.tsx` + `layouts/workspace/TaskSidebarTree.tsx`
 * ⇒ siết cùng nhát (ví dụ nâng PermissionGuard lên CẤP CLASS) sẽ gãy UI của mọi nhân viên.
 *
 * Gate `hasDb && LANE_DB` (memory `integration-test-lane-db-gate`): .env trỏ DB dev dùng chung làm
 * hasDb=true, nên các khẳng định chạm DB chỉ chạy dưới LANE_DB cô lập.
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

describe.skipIf(!hasLaneDb)("S6-SEC-ORG-1 — gate 3 route đọc /org (KI-030)", () => {
  const direct = directPool();
  let app: INestApplication;

  let A: SeededTenant;
  let B: SeededTenant;

  /** Không grant nào — đại diện role `employee` của PROD (45/46 user funtime). */
  let uNone = "";
  /** Chỉ `read:user` — chứng minh gate hai route team KHÔNG dùng chung cặp với employees. */
  let uUserReader = "";
  /** Chỉ `read:team`. */
  let uTeamReader = "";
  /** Cả hai — đại diện company-admin/SA. */
  let uAdmin = "";
  /** Tenant B — chốt BẤT BIẾN #1 (cô lập tenant) trên chính đường vừa gate. */
  let uOther = "";

  let teamA = "";
  let teamB = "";

  async function grant(
    companyId: string,
    userId: string,
    pairs: readonly (readonly [action: string, resource: string])[],
    label: string,
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `sec-org-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function seedTeam(companyId: string, name: string): Promise<string> {
    const r = await direct.query(
      "INSERT INTO teams (company_id, name, type) VALUES ($1, $2, 'production_team') RETURNING id",
      [companyId, name],
    );
    return r.rows[0].id as string;
  }

  async function seedTeamMember(companyId: string, teamId: string, userId: string): Promise<void> {
    await direct.query(
      "INSERT INTO team_members (company_id, team_id, user_id, role_name) VALUES ($1, $2, $3, 'member')",
      [companyId, teamId, userId],
    );
  }

  async function login(slug: string, email: string): Promise<string> {
    const res = await api(app)
      .post("/auth/login")
      .send({ companySlug: slug, email, password: PASSWORD });
    expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  let tokNone = "";
  let tokUserReader = "";
  let tokTeamReader = "";
  let tokAdmin = "";
  let tokOther = "";

  beforeAll(async () => {
    const hash = await hashedPw();
    A = await seedCompany(direct, "secorgA");
    B = await seedCompany(direct, "secorgB");

    uNone = await seedUser(direct, A.companyId, `none@${A.slug}.test`, hash);
    uUserReader = await seedUser(direct, A.companyId, `userreader@${A.slug}.test`, hash);
    uTeamReader = await seedUser(direct, A.companyId, `teamreader@${A.slug}.test`, hash);
    uAdmin = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);
    uOther = await seedUser(direct, B.companyId, `other@${B.slug}.test`, hash);

    await grant(A.companyId, uUserReader, [["read", "user"]], "u");
    await grant(A.companyId, uTeamReader, [["read", "team"]], "t");
    await grant(
      A.companyId,
      uAdmin,
      [
        ["read", "user"],
        ["read", "team"],
      ],
      "ut",
    );
    // Tenant B: grant ĐỦ cả hai — nếu vẫn không thấy dữ liệu của A thì đó là cô lập tenant
    // đang làm việc, chứ không phải "thiếu quyền" che mất.
    await grant(
      B.companyId,
      uOther,
      [
        ["read", "user"],
        ["read", "team"],
      ],
      "ut",
    );

    teamA = await seedTeam(A.companyId, "Team A");
    teamB = await seedTeam(B.companyId, "Team B");
    await seedTeamMember(A.companyId, teamA, uNone);
    await seedTeamMember(A.companyId, teamA, uAdmin);
    await seedTeamMember(B.companyId, teamB, uOther);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    await app.init();

    tokNone = await login(A.slug, `none@${A.slug}.test`);
    tokUserReader = await login(A.slug, `userreader@${A.slug}.test`);
    tokTeamReader = await login(A.slug, `teamreader@${A.slug}.test`);
    tokAdmin = await login(A.slug, `admin@${A.slug}.test`);
    tokOther = await login(B.slug, `other@${B.slug}.test`);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await cleanupTenants(direct, [A?.companyId, B?.companyId].filter(Boolean) as string[]);
    await direct.end();
  });

  // ── DENY (vế RED — trên code chưa vá cả 3 khối này trả 200 thay vì 403) ─────────────────────────

  it("user KHÔNG grant → 403 ở cả 3 route, và KHÔNG rò một byte danh bạ nào", async () => {
    const employees = await api(app).get("/org/employees").set(bearer(tokNone));
    const teams = await api(app).get("/org/teams").set(bearer(tokNone));
    const members = await api(app).get(`/org/teams/${teamA}/members`).set(bearer(tokNone));

    expect(
      [employees.status, teams.status, members.status],
      "KI-030: mọi user đăng nhập đọc được danh bạ toàn tenant kèm email",
    ).toEqual([403, 403, 403]);

    // Không chỉ mã lỗi — thân phản hồi cũng không được chứa dữ liệu.
    for (const res of [employees, teams, members]) {
      expect(JSON.stringify(res.body)).not.toContain(`@${A.slug}.test`);
    }
  });

  it("`read:user` KHÔNG mở được đường team (mỗi route mang đúng cặp quyền của nó)", async () => {
    const teams = await api(app).get("/org/teams").set(bearer(tokUserReader));
    const members = await api(app).get(`/org/teams/${teamA}/members`).set(bearer(tokUserReader));
    expect([teams.status, members.status]).toEqual([403, 403]);
  });

  it("`read:team` KHÔNG mở được đường danh bạ user", async () => {
    const employees = await api(app).get("/org/employees").set(bearer(tokTeamReader));
    expect(employees.status).toBe(403);
  });

  // ── ALLOW (chống siết quá tay — gate sai chiều cũng là hỏng) ────────────────────────────────────

  it("có `read:user` → 200 /org/employees; có `read:team` → 200 hai route team", async () => {
    const employees = await api(app).get("/org/employees").set(bearer(tokUserReader));
    expect(employees.status, JSON.stringify(employees.body)).toBe(200);
    // KHÔNG dừng ở `Array.isArray`: một hồi quy làm hỏng tenant context và trả `[]` sẽ vẫn xanh.
    // Phải khẳng định DỮ LIỆU THẬT có mặt thì ca allow-path mới chứng minh được điều nó nói.
    const emails = (employees.body.data as { email: string }[]).map((u) => u.email);
    expect(emails).toContain(`none@${A.slug}.test`);
    expect(emails).toContain(`admin@${A.slug}.test`);

    const teams = await api(app).get("/org/teams").set(bearer(tokTeamReader));
    const members = await api(app).get(`/org/teams/${teamA}/members`).set(bearer(tokTeamReader));
    expect([teams.status, members.status], JSON.stringify(teams.body)).toEqual([200, 200]);
    expect(members.body.data).toHaveLength(2);
  });

  it("có cả hai cặp (company-admin/SA) → 200 cả 3 route", async () => {
    const employees = await api(app).get("/org/employees").set(bearer(tokAdmin));
    const teams = await api(app).get("/org/teams").set(bearer(tokAdmin));
    const members = await api(app).get(`/org/teams/${teamA}/members`).set(bearer(tokAdmin));
    expect([employees.status, teams.status, members.status]).toEqual([200, 200, 200]);
  });

  // ── KHÔNG ĐƯỢC SIẾT (route cơ cấu — apps/app phụ thuộc) ────────────────────────────────────────

  it("route CƠ CẤU vẫn mở cho user không grant: /org/units · /org/units/tree · /org/departments · /org/roles", async () => {
    // Đây là chốt hồi quy cho QĐ-1 của plan: guard đặt THEO ROUTE, KHÔNG nâng lên cấp class.
    // PermissionGuard fail-closed khi route thiếu @RequirePermission ⇒ nâng cấp class sẽ biến cả 4
    // route này thành 403 và gãy OrgChartPage + TaskSidebarTree của apps/app.
    const units = await api(app).get("/org/units").set(bearer(tokNone));
    const tree = await api(app).get("/org/units/tree").set(bearer(tokNone));
    const departments = await api(app).get("/org/departments").set(bearer(tokNone));
    const roles = await api(app).get("/org/roles").set(bearer(tokNone));

    expect(
      [units.status, tree.status, departments.status, roles.status],
      "siết quá tay: cơ cấu tổ chức KHÔNG phải danh bạ người — xem plan §QĐ-3",
    ).toEqual([200, 200, 200, 200]);
  });

  // ── BẤT BIẾN #1 — cô lập tenant trên chính đường vừa gate ───────────────────────────────────────

  it("tenant B (có ĐỦ grant) vẫn không thấy user/team của tenant A", async () => {
    // Khẳng định DANH TÍNH DƯƠNG, không chỉ "vắng mặt email của A": bản trước chỉ kiểm
    // `not.toContain('@A.test')`, nên nếu ai đó bỏ cột email khỏi projection (rất có thể xảy ra khi
    // siết PII) thì rò `userId`/`fullName`/`teamId` chéo tenant vẫn xanh.
    const employees = await api(app).get("/org/employees").set(bearer(tokOther));
    expect(employees.status).toBe(200);
    expect(new Set((employees.body.data as { id: string }[]).map((u) => u.id))).toEqual(
      new Set([uOther]),
    );

    const teams = await api(app).get("/org/teams").set(bearer(tokOther));
    expect(teams.status).toBe(200);
    const teamRows = teams.body.data as { id: string; companyId: string }[];
    expect(teamRows.every((t) => t.companyId === B.companyId)).toBe(true);
    expect(teamRows.map((t) => t.id)).not.toContain(teamA);
  });

  it("tenant B ĐỌC ĐƯỢC team của CHÍNH NÓ — loại trừ giả thuyết 'route trả rỗng cho mọi người'", async () => {
    // Không có ca này thì mọi khẳng định "B không thấy dữ liệu của A" ở trên đều thoả mãn một cách
    // tầm thường bởi một route hỏng hoàn toàn.
    const own = await api(app).get(`/org/teams/${teamB}/members`).set(bearer(tokOther));
    expect(own.status).toBe(200);
    expect((own.body.data as { userId: string }[]).map((m) => m.userId)).toEqual([uOther]);
  });

  it("đọc team của tenant A bằng token B → 200 + rỗng TẤT ĐỊNH (không phải phép tuyển 200|403|404)", async () => {
    // `OrgService.listTeamMembers` KHÔNG ném NotFound cho teamId lạ ⇒ 403/404 là nhánh CHẾT.
    // Phép tuyển `[200,403,404]` che mất việc status đổi, nên pin cứng hành vi thật.
    const members = await api(app).get(`/org/teams/${teamA}/members`).set(bearer(tokOther));
    expect(members.status).toBe(200);
    expect(members.body.data).toEqual([]);
  });

  it("GHI chéo tenant: token B thêm user của A vào team của A → không tạo được hàng nào", async () => {
    // Vế GHI trước đây chỉ được chứng minh ở tầng SQL, harness HTTP chưa khoá.
    const res = await api(app)
      .post(`/org/teams/${teamA}/members`)
      .set(bearer(tokOther))
      .send({ userId: uNone, roleName: "member" });
    expect(res.status).toBeGreaterThanOrEqual(400);

    const after = await direct.query(
      "SELECT count(*)::int AS n FROM team_members WHERE team_id = $1 AND deleted_at IS NULL",
      [teamA],
    );
    expect(after.rows[0].n, "team A phải vẫn đúng 2 thành viên đã seed").toBe(2);
  });

  // ── Cảnh báo trôi catalog role HỆ THỐNG (tiền đề CŨ đã được thay bằng code) ─────────────────────

  it("KHÔNG role HỆ THỐNG nào giữ `read:user`/`read:team` ở data_scope ≠ Company", async () => {
    // LỊCH SỬ: ca này từng là "ghim TIỀN ĐỀ" — `OrgRepository.listEmployees` chỉ `withTenant`, nên an
    // toàn CHỈ VÌ mọi grant của 2 cặp này đều `Company`; một grant Own/Team/Department sẽ qua guard
    // rồi nhận TRỌN danh bạ kèm email.
    //
    // TIỀN ĐỀ ĐÓ KHÔNG CÒN: `S6-SEC-ORGSCOPE-1` đã ép `data_scope` trong repository, và vế đó được
    // chứng minh ở `org-directory-scope.int-spec.ts` (Own → chỉ mình · Team/Department → 0 hàng).
    // Rò do scope hẹp giờ là chuyện KHÔNG THỂ, không phải chuyện "chưa xảy ra".
    //
    // VÌ SAO VẪN GIỮ (done_when #4 — "bỏ `is_system` HOẶC nêu rõ vì sao giữ"): ý nghĩa của ca đã ĐỔI
    // từ hàng-rào-an-toàn sang CẢNH BÁO TRÔI CATALOG. Một migration cấp `Own`/`Team` cho role hệ
    // thống nay không còn gây rò — nó gây MÀN HÌNH RỖNG cho role đó (fail-closed). Đó vẫn là hồi quy
    // đáng vỡ to tiếng, chỉ khác loại.
    //
    // VÌ SAO KHÔNG BỎ `is_system = true`: `org-directory-scope.int-spec.ts` CỐ Ý seed role tenant với
    // scope Own/Team/Department trên đúng cặp `read:user` để chứng minh vế deny. Bỏ bộ lọc ⇒ ca này
    // bắt phải role phù du của spec ANH EM chạy song song trên cùng lane DB ⇒ đỏ ngẫu nhiên. Phạm vi
    // "role hệ thống (seed/migration)" mới là thứ ca này thực sự canh.
    const rows = await direct.query(
      `SELECT r.name AS role, p.action || ':' || p.resource_type AS perm, rp.data_scope
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         JOIN roles r ON r.id = rp.role_id AND r.deleted_at IS NULL AND r.is_system = true
        WHERE rp.effect = 'ALLOW'
          AND (p.action, p.resource_type) IN (('read','user'), ('read','team'))
          AND rp.data_scope IS DISTINCT FROM 'Company'`,
    );
    expect(
      rows.rows,
      "Role HỆ THỐNG có grant read:user/read:team ở scope hẹp hơn Company. Sau S6-SEC-ORGSCOPE-1 " +
        "điều này KHÔNG còn gây rò (repo đã ép data_scope) nhưng role đó sẽ nhận MÀN HÌNH RỖNG ở " +
        "/org/employees — `users` không có org-mapping nên Team/Department fail-closed 0 hàng. " +
        "Sửa migration để cấp Company, hoặc thêm org-mapping cho `users` trước khi cấp scope hẹp.",
    ).toEqual([]);
  });
});
