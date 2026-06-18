/**
 * PM-1 (apps/projects, mig 0420) — TasksService.updateTaskFields + addLabelToTask deny-path RED suite.
 *
 * Hành vi MONG MUỐN:
 *  - updateTaskFields đặt priority/state/description → repo.updateTaskFieldsTx nhận đúng patch + audit TaskUpdated.
 *  - REJECT task workflow-driven (workflowStepId set HOẶC task_type ∈ FSM) — KHÔNG update, KHÔNG audit.
 *  - stateId mới PHẢI thuộc ĐÚNG project của task (guard stateInProjectTx) — state lệch project → BadRequest.
 *  - task chưa gắn project mà set stateId → BadRequest.
 *  - addLabelToTask: nhãn + task khác project → BadRequest; idempotent (đã gán) → no-op không audit.
 *
 * Mock repo/db/audit (đồng bộ tasks.service.spec.ts) — không boot Nest/DB.
 */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TasksService } from "./tasks.service";

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const ACTOR_ID = "22222222-2222-2222-2222-222222222222";
const TASK_ID = "33333333-3333-3333-3333-333333333333";
const PROJECT_ID = "55555555-5555-5555-5555-555555555555";
const STATE_ID = "66666666-6666-6666-6666-666666666666";
const LABEL_ID = "77777777-7777-7777-7777-777777777777";

const USER = { id: ACTOR_ID, companyId: COMPANY_ID };

function makeRepo() {
  return {
    findRawByIdTx: vi.fn().mockResolvedValue([
      { id: TASK_ID, taskType: "office", workflowStepId: null, status: "not_started", projectId: PROJECT_ID },
    ]),
    assigneeActiveTx: vi.fn().mockResolvedValue(true),
    stateInProjectTx: vi.fn().mockResolvedValue(true),
    updateTaskFieldsTx: vi.fn().mockResolvedValue([{ id: TASK_ID }]),
    findByIdFull: vi
      .fn()
      .mockResolvedValue([
        { id: TASK_ID, taskType: "office", title: "t", projectIdentifier: "WEB", sequence: 12 },
      ]),
    // label assign
    findLabelByIdTx: vi.fn().mockResolvedValue([{ id: LABEL_ID, projectId: PROJECT_ID }]),
    taskLabelExistsTx: vi.fn().mockResolvedValue(false),
    addTaskLabelTx: vi.fn().mockResolvedValue([{ id: "tl-1" }]),
    removeTaskLabelTx: vi.fn().mockResolvedValue([{ id: "tl-1" }]),
  };
}

function makeDb() {
  return {
    withTenant: vi
      .fn()
      .mockImplementation((_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({ __tx: true }),
      ),
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makeService(repo = makeRepo()) {
  const db = makeDb();
  const audit = makeAudit();
  const service = new TasksService(db as never, repo as never, audit as never);
  return { service, repo, db, audit };
}

describe("TasksService.updateTaskFields — PM-1 field update", () => {
  beforeEach(() => vi.clearAllMocks());

  it("office task: set priority/description/state → updateTaskFieldsTx + audit TaskUpdated; displayId computed", async () => {
    const { service, repo, audit } = makeService();
    const result = await service.updateTaskFields(USER, TASK_ID, {
      priority: "high",
      description: "desc",
      stateId: STATE_ID,
    });
    expect(repo.stateInProjectTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      PROJECT_ID,
      STATE_ID,
    );
    expect(repo.updateTaskFieldsTx).toHaveBeenCalledWith(
      COMPANY_ID,
      TASK_ID,
      { priority: "high", description: "desc", stateId: STATE_ID },
      expect.anything(),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "TaskUpdated", objectType: "task", objectId: TASK_ID }),
    );
    // displayId = identifier + '-' + sequence
    expect(result).toMatchObject({ displayId: "WEB-12" });
  });

  it("REJECT workflow-driven task (workflowStepId set) → BadRequest, no update/audit", async () => {
    const repo = makeRepo();
    repo.findRawByIdTx.mockResolvedValueOnce([
      { id: TASK_ID, taskType: "workflow_step", workflowStepId: "step-1", status: "in_progress", projectId: PROJECT_ID },
    ]);
    const { service, audit } = makeService(repo);
    await expect(
      service.updateTaskFields(USER, TASK_ID, { priority: "low" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateTaskFieldsTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("REJECT FSM task_type (production) even when step is null", async () => {
    const repo = makeRepo();
    repo.findRawByIdTx.mockResolvedValueOnce([
      { id: TASK_ID, taskType: "production", workflowStepId: null, status: "in_progress", projectId: PROJECT_ID },
    ]);
    const { service } = makeService(repo);
    await expect(
      service.updateTaskFields(USER, TASK_ID, { title: "x" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("stateId not belonging to task's project → BadRequest", async () => {
    const repo = makeRepo();
    repo.stateInProjectTx.mockResolvedValueOnce(false);
    const { service, audit } = makeService(repo);
    await expect(
      service.updateTaskFields(USER, TASK_ID, { stateId: STATE_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateTaskFieldsTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("set stateId on a project-less task → BadRequest", async () => {
    const repo = makeRepo();
    repo.findRawByIdTx.mockResolvedValueOnce([
      { id: TASK_ID, taskType: "office", workflowStepId: null, status: "not_started", projectId: null },
    ]);
    const { service } = makeService(repo);
    await expect(
      service.updateTaskFields(USER, TASK_ID, { stateId: STATE_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("task not found → NotFound", async () => {
    const repo = makeRepo();
    repo.findRawByIdTx.mockResolvedValueOnce([]);
    const { service } = makeService(repo);
    await expect(
      service.updateTaskFields(USER, TASK_ID, { priority: "low" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("TasksService.addLabelToTask — same-project + idempotent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("label of a different project → BadRequest, no insert/audit", async () => {
    const repo = makeRepo();
    repo.findLabelByIdTx.mockResolvedValueOnce([{ id: LABEL_ID, projectId: "99999999-9999-9999-9999-999999999999" }]);
    const { service, audit } = makeService(repo);
    await expect(service.addLabelToTask(USER, TASK_ID, LABEL_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.addTaskLabelTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("idempotent: already assigned → no insert, no audit", async () => {
    const repo = makeRepo();
    repo.taskLabelExistsTx.mockResolvedValueOnce(true);
    const { service, audit } = makeService(repo);
    await service.addLabelToTask(USER, TASK_ID, LABEL_ID);
    expect(repo.addTaskLabelTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("new assignment → insert + audit TaskLabelAdded", async () => {
    const { service, repo, audit } = makeService();
    await service.addLabelToTask(USER, TASK_ID, LABEL_ID);
    expect(repo.addTaskLabelTx).toHaveBeenCalledWith(COMPANY_ID, TASK_ID, LABEL_ID, expect.anything());
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "TaskLabelAdded", objectType: "task", objectId: TASK_ID }),
    );
  });
});
