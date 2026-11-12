/**
 * S20-SEC-LEAVETYPEMASK-1 — lịch nghỉ cấp đội hiển thị «Nghỉ» + khoảng ngày; loại nghỉ cụ thể chỉ trả cho
 * chủ đơn, hoặc người xem có view:leave / approve:leave phủ chủ đơn (cặp sẵn có). Che ở SERVER cho cả
 * GET /leave/calendar lẫn widget `leave-calendar`. Mỗi ca DENY có ca ALLOW đứng cạnh.
 *
 * Gate cứng hasDb && LANE_DB. Dựng app qua applyMainPipeline.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const runIsolatedDb = hasDb && Boolean(process.env.LANE_DB);
const PASSWORD = "Passw0rd!typemask1X";

type Scope = "Own" | "Team" | "Department" | "Company";
type Pair = [action: string, resource: string, scope: Scope];

const CAL_TEAM: Pair[] = [
  ["read", "dashboard", "Company"],
  ["view-own", "leave-calendar", "Own"],
  ["view-team", "leave-calendar", "Team"],
];
const CAL_TEAM_CO: Pair[] = [
  ["read", "dashboard", "Company"],
  ["view-own", "leave-calendar", "Own"],
  ["view-team", "leave-calendar", "Company"],
  ["view-company", "leave-calendar", "Company"],
];

function isoDay(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

interface Person {
  userId: string;
  profileId: string;
  email: string;
  leaveId: string;
}

interface CalItem {
  id: string;
  leaveTypeId: string | null;
  leaveTypeCode: string | null;
  leaveTypeName: string | null;
  leaveTypeMasked?: boolean;
  startDate: string;
  endDate: string;
}

describe.skipIf(!runIsolatedDb)("S20-SEC-LEAVETYPEMASK-1 che loại nghỉ ở server", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];
  let typeNameA = "";
  let typeNameB = "";
  let typeA = "";
  let typeB = "";
  let pwHash = "";
  const p: Record<string, Person> = {};

  async function plantType(companyId: string, name: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO leave_types
         (company_id, code, name, paid, status, deduct_balance, balance_unit,
          allow_full_day, allow_half_day, allow_hourly, allow_multiple_days,
          require_reason, min_notice_days, sort_order)
       VALUES ($1,$2,$3,true,'active',true,'Day',true,true,false,true,false,0,1) RETURNING id`,
      [companyId, `LT-${randomUUID().slice(0, 8)}`, name],
    );
    return r.rows[0].id as string;
  }

  /** user + hồ sơ + 1 đơn Approved (hôm nay+2..+3). */
  async function mkPerson(
    co: SeededTenant,
    typeId: string,
    key: string,
    managerUserId: string | null,
  ): Promise<Person> {
    const email = `${key}@${co.slug}.test`;
    const userId = await seedUser(direct, co.companyId, email, pwHash);
    const prof = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, direct_manager_id, employee_code)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [co.companyId, userId, managerUserId, `${key}-${randomUUID().slice(0, 6)}`.toUpperCase()],
    );
    const profileId = prof.rows[0].id as string;
    const lv = await direct.query(
      `INSERT INTO leave_requests
         (company_id, user_id, employee_id, leave_type_id, start_date, end_date, total_days, status, reason)
       VALUES ($1,$2,$3,$4,$5,$6,2,'Approved','ly-do-rieng-tu') RETURNING id`,
      [co.companyId, userId, profileId, typeId, isoDay(2), isoDay(3)],
    );
    return { userId, profileId, email, leaveId: lv.rows[0].id as string };
  }

  async function grantRole(co: SeededTenant, who: Person, label: string, pairs: Pair[]) {
    const roleId = await seedRole(direct, co.companyId, `tm-${label}-${randomUUID().slice(0, 6)}`);
    for (const [a, r, s] of pairs) {
      const perm = await direct.query(
        "SELECT id FROM permissions WHERE action=$1 AND resource_type=$2 LIMIT 1",
        [a, r],
      );
      if (perm.rows.length === 0) throw new Error(`permission missing ${a}:${r}`);
      await seedRolePermission(direct, roleId, perm.rows[0].id as string, "ALLOW", s);
    }
    await seedUserRole(direct, who.userId, roleId, co.companyId);
  }

  async function login(co: SeededTenant, who: Person): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: co.slug, email: who.email, password: PASSWORD });
    expect(res.status, `login ${who.email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function calendar(co: SeededTenant, who: Person, scope: "own" | "team" | "company") {
    const token = await login(co, who);
    const res = await request(app.getHttpServer())
      .get(`/leave/calendar?scope=${scope}&from=${isoDay(-1)}&to=${isoDay(10)}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.data.items as CalItem[];
    return { items, raw: JSON.stringify(res.body) };
  }

  function entry<T extends { id?: unknown }>(items: T[], leaveId: string): T {
    const found = items.find((i) => i.id === leaveId);
    expect(found, `đơn ${leaveId} phải có trong lịch`).toBeDefined();
    return found as T;
  }

  function expectMasked(it: CalItem) {
    expect(it.leaveTypeMasked).toBe(true);
    expect(it.leaveTypeId).toBeNull();
    expect(it.leaveTypeCode).toBeNull();
    expect(it.leaveTypeName).toBeNull();
    expect(it.startDate).toBe(isoDay(2));
    expect(it.endDate).toBe(isoDay(3));
  }

  function expectShown(it: CalItem, name: string) {
    expect(it.leaveTypeMasked).toBe(false);
    expect(it.leaveTypeName).toBe(name);
    expect(it.leaveTypeId).not.toBeNull();
  }

  async function widgetItems(co: SeededTenant, who: Person) {
    const token = await login(co, who);
    const res = await request(app.getHttpServer())
      .get("/dashboard/widgets/leave-calendar")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items: Array<Record<string, unknown>> = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (typeof o.userFullName !== "undefined" && typeof o.startDate === "string") items.push(o);
        Object.values(o).forEach(walk);
      }
    };
    walk(res.body);
    return { items, raw: JSON.stringify(res.body) };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = applyMainPipeline(moduleRef.createNestApplication());
    await app.init();
    direct = directPool();
    pwHash = await new PasswordService().hash(PASSWORD);
    A = await seedCompany(direct, "tmaska");
    B = await seedCompany(direct, "tmaskb");
    companyIds.push(A.companyId, B.companyId);
    typeNameA = `TRAPTYPE-${randomUUID().slice(0, 8)}`;
    typeNameB = `TRAPTYPE-${randomUUID().slice(0, 8)}`;
    typeA = await plantType(A.companyId, typeNameA);
    typeB = await plantType(B.companyId, typeNameB);

    // Người xem (cũng là nhân viên có đơn riêng) + nhân viên báo cáo trực tiếp.
    p.v = await mkPerson(A, typeA, "v", null); // R1: lịch đội, không view/approve:leave
    p.ev = await mkPerson(A, typeA, "ev", p.v.userId);
    p.m = await mkPerson(A, typeA, "m", null); // R2: manager chuẩn (view + approve @Team)
    p.em = await mkPerson(A, typeA, "em", p.m.userId);
    p.a = await mkPerson(A, typeA, "a", null); // R3: chỉ approve:leave@Team, lịch @Company
    p.ea = await mkPerson(A, typeA, "ea", p.a.userId);
    p.h = await mkPerson(A, typeA, "h", null); // R4: view:leave@Company
    p.hn = await mkPerson(A, typeA, "hn", null); // R4: view:leave@Team, lịch @Company
    p.eh = await mkPerson(A, typeA, "eh", p.hn.userId);
    p.e2 = await mkPerson(A, typeA, "e2", null); // ngoài mọi đội
    p.x = await mkPerson(A, typeA, "x", null); // R6: approve:leave@Company
    p.edel = await mkPerson(A, typeA, "edel", null);
    await direct.query("UPDATE employee_profiles SET deleted_at = now() WHERE id=$1", [
      p.edel.profileId,
    ]);
    p.hb = await mkPerson(B, typeB, "hb", null);
    p.eb = await mkPerson(B, typeB, "eb", p.hb.userId);

    await grantRole(A, p.v, "v", CAL_TEAM);
    await grantRole(A, p.m, "m", [
      ...CAL_TEAM,
      ["view", "leave", "Team"],
      ["approve", "leave", "Team"],
    ]);
    await grantRole(A, p.a, "a", [...CAL_TEAM_CO, ["approve", "leave", "Team"]]);
    await grantRole(A, p.h, "h", [...CAL_TEAM_CO, ["view", "leave", "Company"]]);
    await grantRole(A, p.hn, "hn", [...CAL_TEAM_CO, ["view", "leave", "Team"]]);
    await grantRole(A, p.x, "x", [...CAL_TEAM_CO, ["approve", "leave", "Company"]]);
    await grantRole(B, p.hb, "hb", [...CAL_TEAM_CO, ["view", "leave", "Company"]]);
  });

  afterAll(async () => {
    await direct
      ?.query("DELETE FROM leave_requests WHERE company_id = ANY($1::uuid[])", [companyIds])
      .catch(() => undefined);
    await direct
      ?.query("DELETE FROM dashboard_widget_cache WHERE company_id = ANY($1::uuid[])", [companyIds])
      .catch(() => undefined);
    await direct
      ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
      .catch(() => undefined);
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  it("R1 DENY: người xem cấp đội không có view/approve:leave thấy «Nghỉ» + ngày, không có loại", async () => {
    const { items, raw } = await calendar(A, p.v, "team");
    expectMasked(entry(items, p.ev.leaveId));
    // tên loại chỉ xuất hiện đúng 1 lần: ở đơn của chính người xem.
    expect(raw.split(typeNameA).length - 1).toBe(1);
  });

  it("R1 ALLOW cạnh: cùng người xem, đơn của chính mình thấy loại", async () => {
    const { items } = await calendar(A, p.v, "team");
    expectShown(entry(items, p.v.leaveId), typeNameA);
  });

  it("R2 DENY: widget lịch nghỉ — người xem cấp đội không duyệt thấy mục không có loại", async () => {
    const { items } = await widgetItems(A, p.v);
    // đơn của cấp dưới trực tiếp (ngoài quyền xem loại) bị che — chỉ đích danh dòng.
    const subordinate = entry(items, p.ev.leaveId);
    expect(subordinate.leaveTypeName).toBeNull();
    expect(subordinate.leaveTypeMasked).toBe(true);
    // đơn của chính người xem đứng cạnh vẫn thấy loại.
    const own = entry(items, p.v.leaveId);
    expect(own.leaveTypeMasked).toBe(false);
    expect(own.leaveTypeName).toBe(typeNameA);
  });

  it("R2 ALLOW cạnh: manager chuẩn (view + approve @Team) thấy tên loại trong widget", async () => {
    const { items } = await widgetItems(A, p.m);
    expect(items.some((i) => i.leaveTypeName === typeNameA && i.leaveTypeMasked === false)).toBe(
      true,
    );
  });

  it("R3 ALLOW: người chỉ có approve:leave@Team thấy loại của người trong đội", async () => {
    const { items } = await calendar(A, p.a, "team");
    expectShown(entry(items, p.ea.leaveId), typeNameA);
  });

  it("R3 DENY cạnh: cùng người, đơn ngoài đội bị che", async () => {
    const { items } = await calendar(A, p.a, "team");
    expectMasked(entry(items, p.e2.leaveId));
    expectMasked(entry(items, p.ev.leaveId));
  });

  it("R4 ALLOW: view:leave@Company thấy loại mọi đơn trong công ty", async () => {
    const { items } = await calendar(A, p.h, "company");
    expectShown(entry(items, p.e2.leaveId), typeNameA);
    expectShown(entry(items, p.eh.leaveId), typeNameA);
  });

  it("R4 DENY cạnh: view:leave@Team — đơn ngoài đội bị che, đơn trong đội thấy loại", async () => {
    const { items } = await calendar(A, p.hn, "company");
    expectMasked(entry(items, p.e2.leaveId));
    expectShown(entry(items, p.eh.leaveId), typeNameA);
  });

  it("R5 DENY: người xem công ty B không có dòng nào của công ty A", async () => {
    const { items, raw } = await calendar(B, p.hb, "company");
    expect(items.some((i) => i.id === p.ev.leaveId || i.id === p.e2.leaveId)).toBe(false);
    expect(raw.includes(typeNameA)).toBe(false);
  });

  it("R5 ALLOW cạnh: view:leave@Company của công ty B thấy loại đơn công ty B", async () => {
    const { items } = await calendar(B, p.hb, "company");
    expectShown(entry(items, p.eb.leaveId), typeNameB);
  });

  it("R6 DENY: hồ sơ chủ đơn đã xoá mềm ⇒ dòng bị che dù người xem có approve@Company", async () => {
    const { items } = await calendar(A, p.x, "company");
    expectMasked(entry(items, p.edel.leaveId));
  });

  it("R6 ALLOW cạnh: hồ sơ còn hiệu lực ⇒ thấy loại", async () => {
    const { items } = await calendar(A, p.x, "company");
    expectShown(entry(items, p.e2.leaveId), typeNameA);
  });
});
