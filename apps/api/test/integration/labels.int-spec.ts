import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { LabelsService } from "../../src/tasks/labels.service";
import { TasksService } from "../../src/tasks/tasks.service";
import { TasksRepository } from "../../src/tasks/tasks.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * PM-1 (apps/projects, mig 0420) — LabelsService + gán/gỡ nhãn cho work item qua Postgres thật.
 * Bao: SEC-1 cross-tenant guard, CRUD + soft-delete, assign/unassign, idempotent add, same-project guard.
 */
describe.skipIf(!hasDb)("PM-1 LabelsService (RLS app role)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let projectA: string;
  let projectB: string;
  let labels: LabelsService;
  let tasks: TasksService;

  const user = () => ({ id: userA, companyId: A.companyId });

  async function seedProjectDirect(companyId: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO projects (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
      [companyId, `pm-lbl-prj-${randomUUID().slice(0, 8)}`],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "lbl-a");
    B = await seedCompany(direct, "lbl-b");
    userA = await seedUser(direct, A.companyId, `lbl-${randomUUID().slice(0, 8)}@a.test`);
    projectA = await seedProjectDirect(A.companyId);
    projectB = await seedProjectDirect(B.companyId);

    const db = new DatabaseService();
    const repo = new TasksRepository(db);
    const audit = new AuditService();
    labels = new LabelsService(db, repo, audit);
    tasks = new TasksService(db, repo, audit);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  it("create + list + update + soft-delete label", async () => {
    const l = await labels.createLabel(user(), projectA, {
      name: `bug-${randomUUID().slice(0, 6)}`,
      color: "#ff0000",
    });
    expect(l.color).toBe("#ff0000");

    let list = await labels.listLabels(A.companyId, projectA);
    expect(list.find((x) => x.id === l.id)).toBeTruthy();

    const updated = await labels.updateLabel(user(), l.id, { color: "#00ff00" });
    expect(updated.color).toBe("#00ff00");

    await labels.deleteLabel(user(), l.id);
    list = await labels.listLabels(A.companyId, projectA);
    expect(list.find((x) => x.id === l.id)).toBeUndefined();
  });

  it("duplicate name in same project → Conflict", async () => {
    const name = `dup-${randomUUID().slice(0, 6)}`;
    await labels.createLabel(user(), projectA, { name });
    await expect(labels.createLabel(user(), projectA, { name })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("SEC-1: create label for cross-tenant project → NotFound", async () => {
    await expect(labels.createLabel(user(), projectB, { name: "x" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("assign + unassign label to task; board exposes labels[]", async () => {
    const l = await labels.createLabel(user(), projectA, { name: `feat-${randomUUID().slice(0, 6)}` });
    const task = await tasks.createTask(user(), {
      title: "labelled-task",
      taskType: "office",
      projectId: projectA,
    });

    await tasks.addLabelToTask(user(), task.id, l.id);
    const board = await tasks.listBoard(A.companyId, { projectId: projectA });
    const row = board.find((b) => b.id === task.id);
    expect(row?.labels.map((x) => x.id)).toContain(l.id);

    await tasks.removeLabelFromTask(user(), task.id, l.id);
    const board2 = await tasks.listBoard(A.companyId, { projectId: projectA });
    const row2 = board2.find((b) => b.id === task.id);
    expect(row2?.labels.map((x) => x.id)).not.toContain(l.id);
  });

  it("idempotent add: assigning the same label twice does not throw or duplicate", async () => {
    const l = await labels.createLabel(user(), projectA, { name: `idem-${randomUUID().slice(0, 6)}` });
    const task = await tasks.createTask(user(), {
      title: "idem-task",
      taskType: "office",
      projectId: projectA,
    });
    await tasks.addLabelToTask(user(), task.id, l.id);
    await tasks.addLabelToTask(user(), task.id, l.id); // no throw
    const board = await tasks.listBoard(A.companyId, { projectId: projectA });
    const row = board.find((b) => b.id === task.id);
    expect(row?.labels.filter((x) => x.id === l.id)).toHaveLength(1);
  });

  it("same-project guard: label + task must share project", async () => {
    const otherProject = await seedProjectDirect(A.companyId);
    const l = await labels.createLabel(user(), otherProject, {
      name: `other-${randomUUID().slice(0, 6)}`,
    });
    const task = await tasks.createTask(user(), {
      title: "wrong-project-task",
      taskType: "office",
      projectId: projectA,
    });
    await expect(tasks.addLabelToTask(user(), task.id, l.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("labelId filter: board returns only tasks carrying the label", async () => {
    const l = await labels.createLabel(user(), projectA, {
      name: `filter-${randomUUID().slice(0, 6)}`,
    });
    const tagged = await tasks.createTask(user(), {
      title: "tagged",
      taskType: "office",
      projectId: projectA,
    });
    const untagged = await tasks.createTask(user(), {
      title: "untagged",
      taskType: "office",
      projectId: projectA,
    });
    await tasks.addLabelToTask(user(), tagged.id, l.id);

    const board = await tasks.listBoard(A.companyId, { labelId: l.id });
    const ids = board.map((b) => b.id);
    expect(ids).toContain(tagged.id);
    expect(ids).not.toContain(untagged.id);
  });
});
