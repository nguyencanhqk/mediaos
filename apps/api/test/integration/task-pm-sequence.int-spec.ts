import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { ChatService } from "../../src/chat/chat.service";
import { TasksService } from "../../src/tasks/tasks.service";
import { TasksRepository } from "../../src/tasks/tasks.repository";
import { ProjectsRepository } from "../../src/media/projects.repository";
import { ProjectsService } from "../../src/media/projects.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * PM-1 (apps/projects, mig 0420) — sequence allocator + displayId + default-state on create, qua Postgres thật.
 * Bao: projects.createProject auto-seed 5 default state + identifier; tasks gắn project nhận sequence ATOMIC
 * tăng dần + state mặc định; displayId = {IDENT}-{seq}.
 */
describe.skipIf(!hasDb)("PM-1 task sequence + displayId + default state (RLS app role)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let userA: string;
  let tasks: TasksService;
  let projects: ProjectsService;

  const user = () => ({ id: userA, companyId: A.companyId });

  // ChatService stub — createProject auto-tạo phòng chat (non-critical); test KHÔNG xoay quanh chat.
  const chatStub = { ensureProjectRoom: async () => undefined } as unknown as ChatService;

  beforeAll(async () => {
    A = await seedCompany(direct, "pmseq");
    userA = await seedUser(direct, A.companyId, `pmseq-${randomUUID().slice(0, 8)}@a.test`);

    const db = new DatabaseService();
    const repo = new TasksRepository(db);
    const audit = new AuditService();
    tasks = new TasksService(db, repo, audit);
    projects = new ProjectsService(new ProjectsRepository(db), db, audit, chatStub);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  it("createProject auto-seeds 5 default states (1 is_default) + stores uppercased identifier", async () => {
    const project = await projects.createProject(user(), {
      name: `seq-prj-${randomUUID().slice(0, 8)}`,
      identifier: "web",
    });
    expect(project.identifier).toBe("WEB");
    expect(project.lastTaskSequence).toBe(0);

    const stateRows = await direct.query(
      `SELECT name, is_default FROM project_states WHERE project_id = $1 AND deleted_at IS NULL`,
      [project.id],
    );
    expect(stateRows.rows).toHaveLength(5);
    expect(stateRows.rows.filter((r) => r.is_default)).toHaveLength(1);
  });

  it("project-scoped task gets ATOMIC incrementing sequence + default state + displayId", async () => {
    const project = await projects.createProject(user(), {
      name: `seq2-${randomUUID().slice(0, 8)}`,
      identifier: "app",
    });

    const t1 = await tasks.createTask(user(), {
      title: "first",
      taskType: "office",
      projectId: project.id,
    });
    const t2 = await tasks.createTask(user(), {
      title: "second",
      taskType: "office",
      projectId: project.id,
    });

    expect(t1.sequence).toBe(1);
    expect(t2.sequence).toBe(2);
    expect(t1.displayId).toBe("APP-1");
    expect(t2.displayId).toBe("APP-2");
    // default state ('Todo', is_default) gán tự động khi không chỉ định stateId
    expect(t1.stateName).toBe("Todo");
    expect(t1.stateGroup).toBe("unstarted");
  });

  it("task without a project has null sequence + null displayId", async () => {
    const t = await tasks.createTask(user(), { title: "no-project", taskType: "office" });
    expect(t.sequence).toBeNull();
    expect(t.displayId).toBeNull();
    expect(t.stateId).toBeNull();
  });

  it("createTask with explicit stateId not in project → rejected (BadRequest)", async () => {
    const projectX = await projects.createProject(user(), {
      name: `seqx-${randomUUID().slice(0, 8)}`,
    });
    const projectY = await projects.createProject(user(), {
      name: `seqy-${randomUUID().slice(0, 8)}`,
    });
    // a state of projectY
    const stateY = await direct.query(
      `SELECT id FROM project_states WHERE project_id = $1 LIMIT 1`,
      [projectY.id],
    );
    await expect(
      tasks.createTask(user(), {
        title: "wrong-state",
        taskType: "office",
        projectId: projectX.id,
        stateId: stateY.rows[0].id,
      }),
    ).rejects.toThrow();
  });
});
