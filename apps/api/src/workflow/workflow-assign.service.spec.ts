/**
 * G4 close-out — assignStep (PM gán assignee + reviewer cho 1 bước).
 *
 * Deny:
 *   N1 — step không tồn tại → NotFoundException
 *   N2 — instance không active (completed/cancelled) → ConflictException
 * Allow:
 *   A1 — gán assignee + reviewer → cập nhật step
 *   A2 — đồng bộ assignee sang task hiện hành của bước (task hiện trong "Công việc của tôi")
 *   A3 — bước chưa có task → vẫn cập nhật step, không crash
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { WorkflowService } from "./workflow.service";
import { WorkflowFsmService } from "./workflow-fsm.service";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const STEP_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INSTANCE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const TASK_ID = "44444444-4444-4444-4444-444444444444";
const PM_ID = "11111111-1111-1111-1111-111111111111";
const ASSIGNEE_ID = "22222222-2222-2222-2222-222222222222";
const REVIEWER_ID = "33333333-3333-3333-3333-333333333333";

function makeStep(overrides: Partial<{ status: string }> = {}) {
  return {
    id: STEP_ID,
    companyId: COMPANY_ID,
    workflowInstanceId: INSTANCE_ID,
    stepOrder: 1,
    stepCode: "script",
    stepName: "Viết kịch bản",
    status: overrides.status ?? "not_started",
    assigneeUserId: null,
    reviewerUserId: null,
    startedAt: null,
    submittedAt: null,
    approvedAt: null,
    submissionUrl: null,
    submissionNote: null,
    createdAt: new Date(),
  };
}

function makeInstance(overrides: Partial<{ status: string }> = {}) {
  return {
    id: INSTANCE_ID,
    companyId: COMPANY_ID,
    workflowDefinitionId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
    contentItemId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    currentStepOrder: 1,
    status: overrides.status ?? "active",
    createdBy: null,
    createdAt: new Date(),
  };
}

function makeRepo(overrides: {
  step?: ReturnType<typeof makeStep> | null;
  instance?: ReturnType<typeof makeInstance> | null;
  task?: { id: string } | null;
} = {}) {
  const step = overrides.step !== undefined ? overrides.step : makeStep();
  const instance = overrides.instance !== undefined ? overrides.instance : makeInstance();
  const task = overrides.task !== undefined ? overrides.task : { id: TASK_ID };

  return {
    findStepByIdInTx: vi.fn().mockResolvedValue([step]),
    findInstanceByIdInTx: vi.fn().mockResolvedValue([instance]),
    assignStep: vi
      .fn()
      .mockResolvedValue([{ ...(step ?? makeStep()), assigneeUserId: ASSIGNEE_ID, reviewerUserId: REVIEWER_ID }]),
    findActiveTaskByStepIdInTx: vi.fn().mockResolvedValue([task]),
    updateTaskAssignee: vi.fn().mockResolvedValue([{ id: TASK_ID }]),
  };
}

function makeDb(repo: ReturnType<typeof makeRepo>) {
  return {
    withTenant: vi
      .fn()
      .mockImplementation((_companyId: string, fn: (tx: unknown) => Promise<unknown>) => fn(repo)),
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makeOutbox() {
  return { enqueue: vi.fn().mockResolvedValue(undefined) };
}

function makeService(repo: ReturnType<typeof makeRepo>) {
  const db = makeDb(repo);
  return new WorkflowService(
    db as never,
    repo as never,
    new WorkflowFsmService(),
    makeAudit() as never,
    makeOutbox() as never,
  );
}

const ASSIGN = { assigneeUserId: ASSIGNEE_ID, reviewerUserId: REVIEWER_ID };

describe("WorkflowService.assignStep", () => {
  beforeEach(() => vi.clearAllMocks());

  // ─── N1 ───
  it("throws NotFoundException when step does not exist", async () => {
    const repo = makeRepo({ step: null });
    await expect(makeService(repo).assignStep(COMPANY_ID, STEP_ID, PM_ID, ASSIGN)).rejects.toThrow(
      NotFoundException,
    );
  });

  // ─── N2 ───
  it("throws ConflictException when workflow instance is completed", async () => {
    const repo = makeRepo({ instance: makeInstance({ status: "completed" }) });
    await expect(makeService(repo).assignStep(COMPANY_ID, STEP_ID, PM_ID, ASSIGN)).rejects.toThrow(
      ConflictException,
    );
  });

  // ─── A1 ───
  it("updates step with assignee + reviewer", async () => {
    const repo = makeRepo();
    const updated = await makeService(repo).assignStep(COMPANY_ID, STEP_ID, PM_ID, ASSIGN);
    expect(repo.assignStep).toHaveBeenCalledWith(COMPANY_ID, STEP_ID, ASSIGN, repo);
    expect(updated.assigneeUserId).toBe(ASSIGNEE_ID);
    expect(updated.reviewerUserId).toBe(REVIEWER_ID);
  });

  // ─── A2 ───
  it("syncs assignee onto the step's active task", async () => {
    const repo = makeRepo();
    await makeService(repo).assignStep(COMPANY_ID, STEP_ID, PM_ID, ASSIGN);
    expect(repo.updateTaskAssignee).toHaveBeenCalledWith(COMPANY_ID, TASK_ID, ASSIGNEE_ID, repo);
  });

  // ─── A3 ───
  it("does not crash when the step has no task yet", async () => {
    const repo = makeRepo({ task: null });
    await expect(
      makeService(repo).assignStep(COMPANY_ID, STEP_ID, PM_ID, ASSIGN),
    ).resolves.toBeDefined();
    expect(repo.updateTaskAssignee).not.toHaveBeenCalled();
  });
});
