/**
 * S20-GOAL-OWNERCHECKIN-1 — ownerName / actorName / lastCheckinAt trên GOAL (Q14 = B).
 * Đường THẬT (guard → service → repo → RLS). Gate cứng `hasDb && LANE_DB`.
 *
 * DENY: view@Own chỉ thấy mục tiêu của mình (không tên người ngoài phạm vi); mục tiêu công ty khác 404;
 *       phản hồi KHÔNG chứa email/SĐT/mã NV. ALLOW: view:goal Department + read:employee Own thấy tên trưởng
 *       phòng + tên người check-in; chỉ có view:goal (không read:employee) cũng thấy TÊN (Q14 = B).
 */
import "reflect-metadata";
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
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = ["Passw0rd", "goal-oc"].join("!");

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];
interface GoalRow {
  id: string;
  ownerName: string | null;
  lastCheckinAt: string | null;
}

describe.skipIf(!hasLaneDb)("S20-GOAL-OWNERCHECKIN-1 tên + check-in cuối (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];
  let ou = "";
  let tHead = "";
  let tViewer = "";
  let tStrict = "";
  let gDept = "";
  let gStrict = "";
  let gGone = "";
  let gNever = "";
  let gB = "";
  const emails: string[] = [];

  async function seedEmp(c: string, u: string | null, status = "active"): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [c, u, ou, status],
    );
    return r.rows[0].id as string;
  }
  async function grant(c: string, u: string, label: string, pairs: PairGrant[]): Promise<void> {
    const roleId = await seedRole(direct, c, `goaloc-${label}-${u.slice(0, 8)}`);
    for (const [a, r, s] of pairs) {
      const p = await seedPermissionCatalog(direct, a, r, false);
      await seedRolePermission(direct, roleId, p, "ALLOW", s);
    }
    await seedUserRole(direct, u, roleId, c);
  }
  async function seedGoal(
    c: string,
    code: string,
    level: string,
    owner: string,
    emp: string | null,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO goals (company_id, goal_code, name, level, department_id, employee_id,
          owner_employee_id, period_type, period_start, period_end, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'quarter','2026-10-01','2026-12-31','Active') RETURNING id`,
      [c, code, `Mục tiêu ${code}`, level, level === "department" ? ou : null, emp, owner],
    );
    return r.rows[0].id as string;
  }
  async function seedUpdate(
    c: string,
    g: string,
    actor: string,
    type: string,
    at: string,
  ): Promise<void> {
    await direct.query(
      `INSERT INTO goal_updates (company_id, goal_id, update_type, actor_user_id, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [c, g, type, actor, at],
    );
  }
  async function login(slug: string, email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.accessToken as string;
  }
  const get = (t: string, u: string) =>
    request(app.getHttpServer()).get(u).set("Authorization", `Bearer ${t}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = applyMainPipeline(moduleRef.createNestApplication());
    await app.init();
    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "goaloca");
    B = await seedCompany(direct, "goalocb");
    companyIds.push(A.companyId, B.companyId);
    const ouRes = await direct.query(
      "INSERT INTO org_units (company_id, name, type) VALUES ($1,'KD','department') RETURNING id",
      [A.companyId],
    );
    ou = ouRes.rows[0].id as string;

    const mk = async (n: string, full: string): Promise<string> => {
      const email = `${n}@${A.slug}.test`;
      emails.push(email);
      const id = await seedUser(direct, A.companyId, email, hash);
      await direct.query("UPDATE users SET full_name=$2 WHERE id=$1", [id, full]);
      return id;
    };
    const headUser = await mk("head", "Trần Trưởng Phòng");
    const viewerUser = await mk("viewer", "Lê Người Xem");
    const strictUser = await mk("strict", "Phạm Chỉ Own");
    const goneUser = await mk("gone", "Võ Đã Nghỉ");
    const delUser = await mk("del", "Hồ Sơ Xoá");
    const headEmp = await seedEmp(A.companyId, headUser);
    const viewerEmp = await seedEmp(A.companyId, viewerUser);
    const strictEmp = await seedEmp(A.companyId, strictUser);
    const goneEmp = await seedEmp(A.companyId, goneUser, "resigned");
    const delEmp = await seedEmp(A.companyId, delUser);
    await direct.query("UPDATE employee_profiles SET deleted_at=now() WHERE id=$1", [delEmp]);

    await grant(A.companyId, headUser, "head", [
      ["access", "goal", "Own"],
      ["view", "goal", "Department"],
    ]);
    await grant(A.companyId, viewerUser, "viewer", [
      ["access", "goal", "Own"],
      ["view", "goal", "Department"],
      ["read", "employee", "Own"],
    ]);
    await grant(A.companyId, strictUser, "strict", [
      ["access", "goal", "Own"],
      ["view", "goal", "Own"],
    ]);

    gDept = await seedGoal(A.companyId, "G-OC-1", "department", headEmp, null);
    gStrict = await seedGoal(A.companyId, "G-OC-2", "employee", strictEmp, strictEmp);
    gGone = await seedGoal(A.companyId, "G-OC-3", "employee", goneEmp, viewerEmp);
    gNever = await seedGoal(A.companyId, "G-OC-4", "employee", delEmp, viewerEmp);
    await seedUpdate(A.companyId, gDept, headUser, "checkin", "2026-10-05T01:00:00Z");
    await seedUpdate(A.companyId, gDept, viewerUser, "checkin", "2026-10-09T01:00:00Z");
    await seedUpdate(A.companyId, gDept, headUser, "finalize", "2026-10-20T01:00:00Z");
    await seedUpdate(A.companyId, gStrict, strictUser, "checkin", "2026-10-07T01:00:00Z");

    const bu = await seedUser(direct, B.companyId, `bu@${B.slug}.test`, hash);
    await direct.query("UPDATE users SET full_name='Người Công Ty Khác' WHERE id=$1", [bu]);
    const bEmp = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,'active') RETURNING id`,
      [B.companyId, bu],
    );
    const bGoal = await direct.query(
      `INSERT INTO goals (company_id, goal_code, name, level, employee_id, owner_employee_id,
         period_type, period_start, period_end, status)
       VALUES ($1,'G-B-1','B goal','employee',$2,$2,'quarter','2026-10-01','2026-12-31','Active')
       RETURNING id`,
      [B.companyId, bEmp.rows[0].id],
    );
    gB = bGoal.rows[0].id as string;

    tHead = await login(A.slug, `head@${A.slug}.test`);
    tViewer = await login(A.slug, `viewer@${A.slug}.test`);
    tStrict = await login(A.slug, `strict@${A.slug}.test`);
  }, 120_000);

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await app?.close();
    await direct?.end();
  });

  it("DENY: view@Own chỉ thấy mục tiêu của mình; không tên người ngoài phạm vi, không công ty khác", async () => {
    const res = await get(tStrict, "/goals");
    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((g) => g.id);
    expect(ids).toEqual([gStrict]);
    const text = JSON.stringify(res.body);
    for (const leaked of ["Trần Trưởng Phòng", "Lê Người Xem", "Người Công Ty Khác"]) {
      expect(text).not.toContain(leaked);
    }
    expect((await get(tStrict, `/goals/${gGone}`)).status).toBe(403);
    expect((await get(tStrict, `/goals/${gB}`)).status).toBe(404);
  });

  it("DENY: phản hồi không chứa email/SĐT/mã NV; chỉ ba trường mới", async () => {
    const list = await get(tViewer, "/goals");
    const detail = await get(tViewer, `/goals/${gDept}`);
    const ups = await get(tViewer, `/goals/${gDept}/updates`);
    for (const res of [list, detail, ups]) {
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      for (const e of emails) expect(text).not.toContain(e);
      expect(text).not.toMatch(/employeeCode|phone|"email"/i);
    }
    const keys = Object.keys(detail.body.data);
    expect(keys).toContain("ownerName");
    expect(keys).toContain("lastCheckinAt");
    const nameKeys = Object.keys(ups.body.data[0]).filter((k) => /name/i.test(k));
    expect(nameKeys).toEqual(["actorName"]);
  });

  it("Q14 = B: chỉ có view:goal (không read:employee) vẫn thấy TÊN người phụ trách của mình", async () => {
    const res = await get(tStrict, `/goals/${gStrict}`);
    expect(res.status).toBe(200);
    expect(res.body.data.ownerName).toBe("Phạm Chỉ Own");
    expect(res.body.data.lastCheckinAt).toBe("2026-10-07T01:00:00.000Z");
  });

  it("ALLOW: tên trưởng phòng + MAX check-in (bỏ qua finalize) + actorName từng dòng", async () => {
    const detail = await get(tViewer, `/goals/${gDept}`);
    expect(detail.body.data.ownerName).toBe("Trần Trưởng Phòng");
    expect(detail.body.data.lastCheckinAt).toBe("2026-10-09T01:00:00.000Z");
    const ups = await get(tViewer, `/goals/${gDept}/updates`);
    const rows = (ups.body.data as { updateType: string; actorName: string }[]).map(
      (u) => `${u.updateType}:${u.actorName}`,
    );
    expect(rows).toContain("checkin:Trần Trưởng Phòng");
    expect(rows).toContain("checkin:Lê Người Xem");
  });

  it("ALLOW: danh sách + cây + /me; đã nghỉ ⇒ «(Đã nghỉ)», hồ sơ xoá ⇒ null, chưa check-in ⇒ null", async () => {
    const list = await get(tViewer, "/goals");
    const by = new Map((list.body.data as GoalRow[]).map((g) => [g.id, g]));
    expect(by.get(gGone)?.ownerName).toBe("Võ Đã Nghỉ (Đã nghỉ)");
    expect(by.get(gNever)?.ownerName).toBeNull();
    expect(by.get(gNever)?.lastCheckinAt).toBeNull();
    const tree = await get(tViewer, "/goals/tree");
    expect(tree.status).toBe(200);
    expect(JSON.stringify(tree.body)).toContain("Trần Trưởng Phòng");
    const mine = await get(tHead, "/me/goals");
    expect(mine.status).toBe(200);
    const mineRows = mine.body.data as GoalRow[];
    expect(mineRows.find((g) => g.id === gDept)?.ownerName).toBe("Trần Trưởng Phòng");
  });
});
