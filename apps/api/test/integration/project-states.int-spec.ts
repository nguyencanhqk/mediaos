import { randomUUID } from "node:crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { ProjectStatesService } from "../../src/tasks/project-states.service";
import { TasksService } from "../../src/tasks/tasks.service";
import { TasksRepository } from "../../src/tasks/tasks.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * PM-1 (apps/projects, mig 0420) — ProjectStatesService qua Postgres thật (RLS app role).
 * Bao: SEC-1 cross-tenant guard project, CRUD + soft-delete, ≤1 default/project, delete-in-use block.
 */
describe.skipIf(!hasDb)("PM-1 ProjectStatesService (RLS app role)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let projectA: string;
  let projectB: string;
  let states: ProjectStatesService;
  let tasks: TasksService;

  const user = () => ({ id: userA, companyId: A.companyId });

  async function seedProjectDirect(companyId: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO projects (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
      [companyId, `pm-prj-${randomUUID().slice(0, 8)}`],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "pms-a");
    B = await seedCompany(direct, "pms-b");
    userA = await seedUser(direct, A.companyId, `pms-${randomUUID().slice(0, 8)}@a.test`);
    projectA = await seedProjectDirect(A.companyId);
    projectB = await seedProjectDirect(B.companyId);

    const db = new DatabaseService();
    const repo = new TasksRepository(db);
    const audit = new AuditService();
    states = new ProjectStatesService(db, repo, audit);
    tasks = new TasksService(db, repo, audit);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  it("create + list states (order by sort_order)", async () => {
    const s1 = await states.createState(user(), projectA, {
      name: `St-${randomUUID().slice(0, 6)}`,
      stateGroup: "started",
      sortOrder: 5,
    });
    expect(s1.projectId).toBe(projectA);
    expect(s1.stateGroup).toBe("started");

    const list = await states.listStates(A.companyId, projectA);
    expect(list.find((s) => s.id === s1.id)).toBeTruthy();
    // sort_order tăng dần
    const orders = list.map((s) => s.sortOrder);
    expect([...orders]).toEqual([...orders].sort((a, b) => a - b));
  });

  it("SEC-1: create state cho project tenant khác → NotFound", async () => {
    await expect(
      states.createState(user(), projectB, { name: "X", stateGroup: "backlog" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("SEC-1: list states project tenant khác → NotFound", async () => {
    await expect(states.listStates(A.companyId, projectB)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("≤1 default/project: set default mới bỏ cờ state default cũ trong cùng project", async () => {
    const p = await seedProjectDirect(A.companyId);
    const d1 = await states.createState(user(), p, {
      name: "Default-1",
      stateGroup: "unstarted",
    });
    const d2 = await states.createState(user(), p, { name: "Default-2", stateGroup: "started" });
    await states.updateState(user(), d1.id, { isDefault: true });
    await states.updateState(user(), d2.id, { isDefault: true });

    const list = await states.listStates(A.companyId, p);
    const defaults = list.filter((s) => s.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(d2.id);
  });

  it("soft-delete state không dùng → OK + biến mất khỏi list", async () => {
    const s = await states.createState(user(), projectA, {
      name: `Del-${randomUUID().slice(0, 6)}`,
      stateGroup: "cancelled",
    });
    await states.deleteState(user(), s.id);
    const list = await states.listStates(A.companyId, projectA);
    expect(list.find((x) => x.id === s.id)).toBeUndefined();
  });

  it("delete-in-use: state đang được task tham chiếu → BadRequest (chặn xoá)", async () => {
    const p = await seedProjectDirect(A.companyId);
    const s = await states.createState(user(), p, { name: "InUse", stateGroup: "started" });
    // tạo task gắn state này (createHubTask guard state thuộc project)
    await tasks.createTask(user(), {
      title: "task-uses-state",
      taskType: "office",
      projectId: p,
      stateId: s.id,
    });
    await expect(states.deleteState(user(), s.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("update/delete state tenant khác → NotFound (RLS 0 row, no oracle)", async () => {
    const sB = await direct.query(
      `INSERT INTO project_states (company_id, project_id, name, state_group)
       VALUES ($1, $2, 'foreign', 'backlog') RETURNING id`,
      [B.companyId, projectB],
    );
    const idB = sB.rows[0].id as string;
    await expect(
      states.updateState(user(), idB, { name: "hack" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(states.deleteState(user(), idB)).rejects.toBeInstanceOf(NotFoundException);
  });
});
