/**
 * S4-DASH-HROVERVIEW-FLOOR-1 — SÀN scope `Department` của widget DASH `HR_OVERVIEW` (SPEC-07 §14.8, DASH-API-108)
 * trên ĐƯỜNG THẬT (HTTP → guard → registry / handler → `HrReadService` → DB lane). Plan
 * `docs/plans/S4-DASH-HROVERVIEW-FLOOR-1.md` §6.
 *
 * Cặp gate `read:employee` MỘT MÌNH không phân biệt được HR với nhân viên: cả bốn vai chuẩn đều giữ nó, chỉ
 * khác scope (employee @Own · manager @Team · hr / company-admin @Company). Bất biến được chứng ở đây:
 *  1. Người giữ `read:employee` dưới `Department` (Own / Team) KHÔNG nhận widget ở METADATA (`/dashboard/me` ·
 *     `/dashboard/widgets` · route theo loại) và nhận 403 «ở phạm vi đủ rộng» ở ĐƯỜNG DATA — kể cả khi widget
 *     được bật tay qua `dashboard_widget_configs` và kể cả khi đã có hàng cache tươi mang khoá của họ (D4′).
 *  2. `Department` chỉ đếm hồ sơ trong đơn vị của mình (∪ đơn vị mình làm trưởng); không đơn vị ⇒ 0.
 *  3. Company / System giữ hành vi cũ (một hàng cache chia sẻ); cô lập công ty không đổi (X1).
 *
 * Bằng chứng «không đọc hàng chia sẻ» (plan F2): A3/A4 TỰ làm ấm hàng `Employee:HR_OVERVIEW:co` (hr gọi route, không
 * `dashboard_type`, không `?refresh`) rồi chứng bằng SQL hàng đó tươi TRƯỚC khi `dept` gọi — không dựa vào thứ tự
 * chạy (`-t`, shuffle).
 *
 * App dựng bằng `bootQa1World` (`applyMainPipeline` + `listen(0)`). CHỈ chạy trên DB cô lập của lane.
 */
import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PasswordService } from "../../src/auth/password.service";
import { DashboardConfigSeeder } from "../../src/dashboard/dashboard-config.seeder";
import { MasterDataSeedRunner } from "../../src/foundation/seed/master-data-seed-runner.service";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { hasDb } from "../helpers/integration-db";
import {
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";
import { bootQa1World, type Qa1Actor, type Qa1Res, type Qa1World } from "../helpers/social-qa1-kit";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 180_000;

const ROUTE = "/dashboard/widgets/hr-overview";
const CODE = "HR_OVERVIEW";
const UNASSIGNED = "(chưa phân bổ)";

/** Thông điệp 403 của CỔNG DASH — «thiếu cặp» khác «dưới sàn» (quy ước của mọi widget khai sàn). */
const FORBIDDEN_CODE = "AUTH-ERR-FORBIDDEN";
const DENY_PAIR = "AUTH-ERR-FORBIDDEN: thiếu quyền read:employee";
const DENY_FLOOR = "AUTH-ERR-FORBIDDEN: thiếu quyền read:employee ở phạm vi đủ rộng";

type Scope = "Own" | "Team" | "Department" | "Company";
type Grant = readonly [pair: string, scope: Scope];

/** Hai cặp nền của Dashboard — vai tuỳ biến phải tự gắn: qua guard của route + loại `Employee`. */
const DASH_BASE: readonly Grant[] = [
  ["read:dashboard", "Company"],
  ["view-employee:dashboard", "Own"],
];

interface Viewer {
  token: string;
  userId: string;
  label: string;
}

interface Overview {
  summary: { headcount: number };
  byStatus: Record<string, number>;
  byOrgUnit: Record<string, number>;
}

interface WidgetBody {
  widget_code: string;
  status: string;
  data: Overview | null;
  empty_state: { message: string } | null;
}

describe.skipIf(!hasLaneDb)("S4-DASH-HROVERVIEW-FLOOR-1 · sàn Department của HR_OVERVIEW", () => {
  let w: Qa1World;
  let login: { password: string; passwordHash: string };
  let u1: string;
  let u1Name: string;
  let u2Name: string;
  let ubName: string;

  // Vai chuẩn (hàng `roles.company_id IS NULL`).
  let hr: Qa1Actor;
  let ca: Qa1Actor;
  let mgr: Qa1Actor;
  let emp: Qa1Actor;
  /** Chỉ dùng ở D4′ — chưa từng gọi route nên khoá cache `u:<id>` của họ chưa có hàng. */
  let empC: Qa1Actor;
  let mgrC: Qa1Actor;
  let hrB: Qa1Actor;

  // Vai tuỳ biến (đều rơi về dashboard loại `Employee`).
  let dept: Viewer;
  let deptNoUnit: Viewer;
  let none: Viewer;
  /** Hai grant cùng cặp: role employee chuẩn (`read:employee@Own`) + role tuỳ biến `@Department`. */
  let dual: Viewer;
  /** Manager chuẩn (`@Team`) + role tuỳ biến `read:employee@Department` — đối chứng ALLOW của M3. */
  let mgrDept: Viewer;

  const get = (who: Viewer, url: string) => w.get(who.token, url);

  /**
   * Tài khoản + hồ sơ (đơn vị `orgUnitId`) + vai tuỳ biến chứa `DASH_BASE` ∪ `grants` (+ vai chuẩn tuỳ chọn),
   * RỒI mới đăng nhập. Cặp CHỈ được tra trong catalog `permissions` — thiếu ⇒ ném, không bao giờ INSERT.
   */
  async function customActor(
    tenant: SeededTenant,
    label: string,
    orgUnitId: string | null,
    grants: readonly Grant[],
    canonical?: string,
  ): Promise<Viewer> {
    const email = `${label}-${randomUUID().slice(0, 8)}@${tenant.slug}.test`.toLowerCase();
    const userId = await seedUser(w.direct, tenant.companyId, email, login.passwordHash);
    await insertProfile(tenant.companyId, userId, orgUnitId);
    const roleId = await seedRole(
      w.direct,
      tenant.companyId,
      `hrov-${label}-${userId.slice(0, 8)}`,
    );
    for (const [pair, scope] of [...DASH_BASE, ...grants]) {
      const [action, resource] = pair.split(":") as [string, string];
      const found = await w.direct.query<{ id: string }>(
        `SELECT id FROM permissions WHERE action = $1 AND resource_type = $2`,
        [action, resource],
      );
      if (found.rows.length !== 1) {
        throw new Error(`[hrov] catalog thiếu cặp ${pair} (${found.rows.length} hàng)`);
      }
      await seedRolePermission(w.direct, roleId, found.rows[0].id, "ALLOW", scope);
    }
    await seedUserRole(w.direct, userId, roleId, tenant.companyId);
    if (canonical) {
      const r = await w.direct.query<{ id: string }>(
        `SELECT id FROM roles WHERE name = $1 AND company_id IS NULL AND deleted_at IS NULL`,
        [canonical],
      );
      if (r.rows.length !== 1) throw new Error(`[hrov] vai chuẩn ${canonical}: ${r.rows.length}`);
      await seedUserRole(w.direct, userId, r.rows[0].id, tenant.companyId);
    }
    const body = { companySlug: tenant.slug, email, password: login.password };
    const res = await w.post(null, "/auth/login").send(body);
    if (res.status !== 200) {
      throw new Error(`[hrov] login ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return { token: res.body.data.accessToken as string, userId, label };
  }

  async function insertProfile(companyId: string, userId: string, orgUnitId: string | null) {
    await w.direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, $3, 'active', 'offline', $4)`,
      [companyId, userId, orgUnitId, `HROV-${randomUUID().slice(0, 10)}`],
    );
  }

  /** Hồ sơ «đứng hình» (không đăng nhập) — làm dày đơn vị để phép đếm theo scope có ý nghĩa. */
  async function filler(tenant: SeededTenant, orgUnitId: string, label: string): Promise<void> {
    const email = `${label}-${randomUUID().slice(0, 8)}@${tenant.slug}.test`.toLowerCase();
    const userId = await seedUser(w.direct, tenant.companyId, email, login.passwordHash);
    await insertProfile(tenant.companyId, userId, orgUnitId);
  }

  /** Đếm ĐỘC LẬP bằng SQL — cùng vị từ với danh sách HR: công ty + chưa xoá mềm (+ đơn vị). */
  async function sqlHeadcount(companyId: string, orgUnitId?: string): Promise<number> {
    const r = await w.direct.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM employee_profiles
        WHERE company_id = $1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR org_unit_id = $2::uuid)`,
      [companyId, orgUnitId ?? null],
    );
    return r.rows[0].n;
  }

  async function unitName(id: string): Promise<string> {
    const r = await w.direct.query<{ name: string }>(`SELECT name FROM org_units WHERE id = $1`, [
      id,
    ]);
    return r.rows[0].name;
  }

  async function widgetIdOf(code: string): Promise<string> {
    const r = await w.direct.query<{ id: string }>(
      `SELECT id FROM dashboard_widgets WHERE widget_code = $1 AND company_id IS NULL AND deleted_at IS NULL`,
      [code],
    );
    if (r.rows.length !== 1) throw new Error(`[hrov] catalog widget thiếu ${code}`);
    return r.rows[0].id;
  }

  /** Bật tay `HR_OVERVIEW` cho một loại dashboard (cấu hình mức công ty) — đường rò của bất biến 1. */
  async function enableFor(companyId: string, dashboardType: string): Promise<void> {
    await w.direct.query(
      `INSERT INTO dashboard_widget_configs
         (company_id, widget_id, dashboard_type, config_scope, role_id, user_id, is_enabled, sort_order)
       VALUES ($1, $2, $3, 'Company', NULL, NULL, true, 95)`,
      [companyId, await widgetIdOf(CODE), dashboardType],
    );
  }

  const ok = async (who: Viewer): Promise<WidgetBody> => {
    const res = await get(who, ROUTE);
    expect(res.status, `${who.label} ${ROUTE} ⇒ ${JSON.stringify(res.body)}`).toBe(200);
    const body = res.body.data as WidgetBody;
    expect(body.widget_code).toBe(CODE);
    return body;
  };

  /** 403 của CỔNG DASH: mã chung + NGUYÊN chuỗi thông điệp + thân không chở số liệu. */
  const expectDenied = (res: Qa1Res, message: string, what: string): void => {
    expect(res.status, `${what}: ${JSON.stringify(res.body)}`).toBe(403);
    expect(res.body.error?.code, what).toBe(FORBIDDEN_CODE);
    expect(res.body.error?.message, what).toBe(message);
    expect(JSON.stringify(res.body), what).not.toContain("headcount");
  };

  /**
   * Làm ấm hàng chia sẻ `Employee:HR_OVERVIEW:co` NGAY TRONG ca (hr gọi route) rồi chứng bằng SQL nó tươi — ca
   * dùng nó tự chứa bằng chứng, không phụ thuộc A1 chạy trước.
   */
  async function warmSharedRow(): Promise<void> {
    await ok(hr);
    const r = await w.direct.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM dashboard_widget_cache
        WHERE company_id = $1 AND cache_key = $2 AND status = 'Fresh'
          AND expires_at > now() AND deleted_at IS NULL`,
      [w.A.companyId, `Employee:${CODE}:co`],
    );
    expect(r.rows[0].n, "hàng chia sẻ Employee:HR_OVERVIEW:co phải tươi trước khi dept gọi").toBe(
      1,
    );
  }

  const sum = (rec: Record<string, number>): number =>
    Object.values(rec).reduce((a, b) => a + b, 0);

  const codesOf = async (who: Viewer, url: string): Promise<string[]> => {
    const res = await get(who, url);
    expect(res.status, `${url} ${who.label} ⇒ ${JSON.stringify(res.body)}`).toBe(200);
    const data = res.body.data as
      | { widgets?: { widget_code: string }[] }
      | { widget_code: string }[];
    const list = Array.isArray(data) ? data : (data.widgets ?? []);
    return list.map((x) => x.widget_code);
  };

  beforeAll(async () => {
    w = await bootQa1World("hrov");
    const password = loginPasswordFixture("hrovfloor");
    login = { password, passwordHash: await w.app.get(PasswordService).hash(password) };

    u1 = await w.orgUnit(w.A, "hrov-u1");
    const u2 = await w.orgUnit(w.A, "hrov-u2");
    const ub = await w.orgUnit(w.B, "hrov-ub");
    [u1Name, u2Name, ubName] = await Promise.all([unitName(u1), unitName(u2), unitName(ub)]);

    hr = await w.actor(w.A, "hr", { canonical: "hr" });
    ca = await w.actor(w.A, "ca", { canonical: "company-admin" });
    mgr = await w.actor(w.A, "mgr", { canonical: "manager", orgUnitId: u1 });
    emp = await w.actor(w.A, "emp", { canonical: "employee", orgUnitId: u1 });
    empC = await w.actor(w.A, "empc", { canonical: "employee", orgUnitId: u1 });
    mgrC = await w.actor(w.A, "mgrc", { canonical: "manager", orgUnitId: u1 });
    hrB = await w.actor(w.B, "hrb", { canonical: "hr", orgUnitId: ub });

    const deptGrant: Grant = ["read:employee", "Department"];
    dept = await customActor(w.A, "dept", u1, [deptGrant]);
    deptNoUnit = await customActor(w.A, "deptnounit", null, [deptGrant]);
    none = await customActor(w.A, "none", u2, []);
    dual = await customActor(w.A, "dual", u1, [deptGrant], "employee");
    mgrDept = await customActor(w.A, "mgrdept", u1, [deptGrant], "manager");

    // U2 dày hơn: ≥ 2 hồ sơ, có người ngoài phòng của `dept`. B: thêm một hồ sơ ở đơn vị mốc.
    await filler(w.A, u2, "u2a");
    await filler(w.A, u2, "u2b");
    await filler(w.B, ub, "ubx");

    // Seeder mặc định THẬT (NODE_ENV=test không tự seed lúc boot) rồi bật tay cho Employee + Manager.
    for (const companyId of w.companyIds) {
      const seeders = [w.app.get(DashboardConfigSeeder)];
      const outcomes = await w.app.get(MasterDataSeedRunner).reconcileCompany(companyId, seeders);
      expect(outcomes, `seeder dash.default-configs của ${companyId}`).toEqual([
        expect.objectContaining({ seedKey: "dash.default-configs", ok: true }),
      ]);
    }
    const hrCfg = await w.direct.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM dashboard_widget_configs c
         JOIN dashboard_widgets wd ON wd.id = c.widget_id
        WHERE c.company_id = $1 AND c.dashboard_type = 'HR' AND wd.widget_code = $2
          AND c.deleted_at IS NULL AND c.is_enabled`,
      [w.A.companyId, CODE],
    );
    expect(hrCfg.rows[0].n, "cấu hình mặc định loại HR phải có HR_OVERVIEW").toBeGreaterThan(0);
    await enableFor(w.A.companyId, "Employee");
    await enableFor(w.A.companyId, "Manager");
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (!w) return;
    try {
      const sql = "DELETE FROM dashboard_widget_cache WHERE company_id = ANY($1::uuid[])";
      await w.direct.query(sql, [[...w.companyIds]]);
    } finally {
      await w.close();
    }
  });

  describe("tầng DATA — GET /dashboard/widgets/hr-overview", () => {
    it("A1 · ALLOW hr @Company: headcount = đếm SQL cả công ty; Σ byStatus = headcount; byOrgUnit có U1 + U2", async () => {
      const body = await ok(hr);
      const data = body.data as Overview;
      expect(data.summary.headcount).toBe(await sqlHeadcount(w.A.companyId));
      expect(sum(data.byStatus)).toBe(data.summary.headcount);
      expect(Object.keys(data.byOrgUnit)).toEqual(expect.arrayContaining([u1Name, u2Name]));
      // hr · ca · deptNoUnit không đơn vị ⇒ nhóm «chưa phân bổ» cũng phải có mặt trong bức tranh cả công ty.
      expect(Object.keys(data.byOrgUnit)).toContain(UNASSIGNED);
    });

    it("A2 · ALLOW company-admin @Company: như A1", async () => {
      const data = (await ok(ca)).data as Overview;
      expect(data.summary.headcount).toBe(await sqlHeadcount(w.A.companyId));
      expect(Object.keys(data.byOrgUnit)).toEqual(expect.arrayContaining([u1Name, u2Name]));
    });

    it("A3 · ALLOW @Department (U1), hàng chia sẻ co đã tươi: chỉ đếm U1, không đọc hàng chia sẻ", async () => {
      await warmSharedRow();
      const data = (await ok(dept)).data as Overview;
      const unit1 = await sqlHeadcount(w.A.companyId, u1);
      expect(data.summary.headcount).toBe(unit1);
      expect(data.summary.headcount).toBeLessThan(await sqlHeadcount(w.A.companyId));
      expect(Object.keys(data.byOrgUnit)).toEqual([u1Name]);
      expect(sum(data.byStatus)).toBe(unit1);
    });

    it("A4 · ALLOW @Department KHÔNG đơn vị: 200 `Empty`, headcount 0 (không bao giờ «cả công ty»)", async () => {
      await warmSharedRow();
      const body = await ok(deptNoUnit);
      // `Empty` ⇒ server bỏ `data` (null) và gửi chữ rỗng — phép đếm của phạm vi rỗng = 0 hồ sơ.
      expect(body.status).toBe("Empty");
      expect(body.data).toBeNull();
      expect(body.empty_state).toEqual({ message: "Chưa có nhân sự" });
    });

    it("A5 · ALLOW nhiều grant (Own + Department): dùng grant mạnh nhất ⇒ đếm U1", async () => {
      const data = (await ok(dual)).data as Overview;
      expect(data.summary.headcount).toBe(await sqlHeadcount(w.A.companyId, u1));
      expect(await codesOf(dual, "/dashboard/me")).toContain(CODE);
    });

    it("D1 · DENY manager @Team: 403 «ở phạm vi đủ rộng», không số liệu", async () => {
      expect((await get(dept, ROUTE)).status, "đối chứng: @Department qua").toBe(200);
      expectDenied(await get(mgr, ROUTE), DENY_FLOOR, "mgr gọi hr-overview");
    });

    it("D2 · DENY employee @Own: 403 «ở phạm vi đủ rộng», không số liệu", async () => {
      expectDenied(await get(emp, ROUTE), DENY_FLOOR, "emp gọi hr-overview");
    });

    it("D3 · DENY không có cặp: 403 «thiếu quyền read:employee» (KHÔNG phải thông điệp sàn)", async () => {
      expectDenied(await get(none, ROUTE), DENY_PAIR, "none gọi hr-overview");
    });

    it("D4′ · DENY kể cả khi đã có hàng cache TƯƠI mang khoá của chính người gọi (gate chạy trước cache)", async () => {
      const sentinel = 700_000 + randomInt(100_000);
      const widgetId = await widgetIdOf(CODE);
      const seeds: [Qa1Actor, Scope][] = [
        [empC, "Own"],
        [mgrC, "Team"],
      ];
      for (const [who, scope] of seeds) {
        const payload = { summary: { headcount: sentinel }, byStatus: {}, byOrgUnit: {} };
        await w.direct.query(
          `INSERT INTO dashboard_widget_cache
             (company_id, widget_id, dashboard_type, user_id, cache_scope, scope_reference_id, cache_key,
              data, status, generated_at, expires_at)
           VALUES ($1, $2, 'Employee', $3, $4, $3, $5, $6::jsonb, 'Fresh', now(), now() + interval '10 minutes')`,
          [
            w.A.companyId,
            widgetId,
            who.userId,
            scope,
            `Employee:${CODE}:u:${who.userId}`,
            JSON.stringify(payload),
          ],
        );
      }
      for (const [who] of seeds) {
        const res = await get(who, ROUTE);
        expect(JSON.stringify(res.body), `${who.label}: thân lộ sentinel`).not.toContain(
          String(sentinel),
        );
        expectDenied(res, DENY_FLOOR, `${who.label} gọi hr-overview (cache tươi)`);
      }
    });
  });

  describe("tầng METADATA — danh sách widget", () => {
    it("M1 · employee @Own: /dashboard/me KHÔNG có HR_OVERVIEW dù cấu hình bật tay; @Department cùng loại CÓ", async () => {
      expect(await codesOf(dept, "/dashboard/me"), "đối chứng dept").toContain(CODE);
      expect(await codesOf(emp, "/dashboard/me")).not.toContain(CODE);
    });

    it("M2 · employee @Own: /dashboard/widgets (kể cả ?include_data=true) KHÔNG có HR_OVERVIEW; @Department CÓ", async () => {
      expect(await codesOf(dept, "/dashboard/widgets"), "đối chứng dept").toContain(CODE);
      expect(
        await codesOf(dept, "/dashboard/widgets?include_data=true"),
        "đối chứng dept",
      ).toContain(CODE);
      expect(await codesOf(emp, "/dashboard/widgets")).not.toContain(CODE);
      expect(await codesOf(emp, "/dashboard/widgets?include_data=true")).not.toContain(CODE);
    });

    it("M3 · manager @Team: /dashboard/manager KHÔNG có HR_OVERVIEW dù cấu hình bật tay; manager + @Department CÓ", async () => {
      expect(await codesOf(mgrDept, "/dashboard/manager"), "đối chứng mgrDept").toContain(CODE);
      expect(await codesOf(mgr, "/dashboard/manager")).not.toContain(CODE);
    });

    it("M4 · hr @Company: /dashboard/hr CÓ HR_OVERVIEW (cấu hình mặc định)", async () => {
      expect(await codesOf(hr, "/dashboard/hr")).toContain(CODE);
    });
  });

  describe("cô lập công ty", () => {
    it("X1 · hr của B chỉ thấy số của B; hai bên không thấy tên đơn vị của nhau", async () => {
      const b = (await ok(hrB)).data as Overview;
      expect(b.summary.headcount).toBe(await sqlHeadcount(w.B.companyId));
      expect(Object.keys(b.byOrgUnit)).toContain(ubName);
      expect(Object.keys(b.byOrgUnit)).not.toContain(u1Name);
      expect(Object.keys(b.byOrgUnit)).not.toContain(u2Name);
      const a = (await ok(hr)).data as Overview;
      expect(Object.keys(a.byOrgUnit)).not.toContain(ubName);
    });
  });
});
