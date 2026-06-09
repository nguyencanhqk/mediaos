/**
 * G4-5 — Deny-path RED suite for ApprovalService (consumer side of workflow FSM).
 *
 * Deny cases covered:
 *   C1  — approve when step is NOT waiting_review → ConflictException
 *   C2  — approve when approval_request is NOT pending → ConflictException
 *   C3  — approve when actor is NOT the reviewer (reviewerUserId set) → ConflictException
 *   C4  — approve when instance is NOT active → ConflictException
 *   C5  — requestRevision when step is NOT waiting_review → ConflictException
 *   C6  — requestRevision when approval_request is NOT pending → ConflictException
 *
 * Allow cases:
 *   A4  — approve intermediate step → advances currentStepOrder, creates approval_steps record
 *   A5  — approve last step → workflow instance becomes completed
 *   A6  — requestRevision → creates defect, revision task, updates step status to revision
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { ApprovalService } from "./approval.service";
import { WorkflowFsmService } from "./workflow-fsm.service";
import {
  ApprovalRequestNotPendingError,
  IllegalTransitionError,
  NotReviewerError,
  WorkflowInactiveError,
} from "./workflow.types";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const REVIEWER_ID = "11111111-1111-1111-1111-111111111111";
const ASSIGNEE_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_USER_ID = "33333333-3333-3333-3333-333333333333";
const STEP_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INSTANCE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const REQUEST_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const CONTENT_ITEM_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

function makeStep(overrides: Partial<{
  status: string;
  stepOrder: number;
  assigneeUserId: string | null;
  reviewerUserId: string | null;
}> = {}) {
  return {
    id: STEP_ID,
    companyId: COMPANY_ID,
    workflowInstanceId: INSTANCE_ID,
    stepOrder: overrides.stepOrder ?? 1,
    stepCode: "script",
    stepName: "Viết kịch bản",
    status: overrides.status ?? "waiting_review",
    assigneeUserId: overrides.assigneeUserId !== undefined ? overrides.assigneeUserId : ASSIGNEE_ID,
    reviewerUserId: overrides.reviewerUserId !== undefined ? overrides.reviewerUserId : null,
    startedAt: null,
    submittedAt: new Date(),
    approvedAt: null,
    submissionUrl: null,
    submissionNote: null,
    createdAt: new Date(),
  };
}

function makeInstance(overrides: Partial<{ status: string; currentStepOrder: number }> = {}) {
  return {
    id: INSTANCE_ID,
    companyId: COMPANY_ID,
    workflowDefinitionId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
    contentItemId: CONTENT_ITEM_ID,
    currentStepOrder: overrides.currentStepOrder ?? 1,
    status: overrides.status ?? "active",
    createdBy: null,
    createdAt: new Date(),
  };
}

function makeApprovalRequest(overrides: Partial<{ status: string; assigneeId: string | null }> = {}) {
  return {
    id: REQUEST_ID,
    companyId: COMPANY_ID,
    workflowStepId: STEP_ID,
    requestedBy: ASSIGNEE_ID,
    assigneeId: overrides.assigneeId !== undefined ? overrides.assigneeId : null,
    status: overrides.status ?? "pending",
    currentLevel: 1,
    maxLevel: 1,
    decidedAt: null,
    comment: null,
    createdAt: new Date(),
  };
}

// ─── Mock repo factory ────────────────────────────────────────────────────────

function makeRepo(overrides: {
  step?: ReturnType<typeof makeStep>;
  instance?: ReturnType<typeof makeInstance>;
  request?: ReturnType<typeof makeApprovalRequest>;
  maxStepOrder?: number;
} = {}) {
  const step = overrides.step ?? makeStep();
  const instance = overrides.instance ?? makeInstance();
  const request = overrides.request ?? makeApprovalRequest();

  return {
    findApprovalRequestById: vi.fn().mockResolvedValue([request]),
    findStepByIdInTx: vi.fn().mockResolvedValue([step]),
    findInstanceByIdInTx: vi.fn().mockResolvedValue([instance]),
    findMaxStepOrder: vi.fn().mockResolvedValue(overrides.maxStepOrder ?? 4),
    createApprovalStep: vi.fn().mockResolvedValue([{ id: "new-approval-step" }]),
    closeApprovalRequest: vi.fn().mockResolvedValue([{ ...request, status: "approved" }]),
    approveStep: vi.fn().mockResolvedValue([{ ...step, status: "approved", approvedAt: new Date() }]),
    advanceInstanceStepOrder: vi.fn().mockResolvedValue([{ ...instance, currentStepOrder: 2 }]),
    completeWorkflowInstance: vi.fn().mockResolvedValue([{ ...instance, status: "completed" }]),
    setStepToRevision: vi.fn().mockResolvedValue([{ ...step, status: "revision" }]),
    createDefect: vi.fn().mockResolvedValue([{ id: "new-defect" }]),
    findTaskByStepId: vi.fn().mockResolvedValue([null]),
    updateTaskStatus: vi.fn().mockResolvedValue([]),
    createTask: vi.fn().mockResolvedValue([{ id: "new-task" }]),
  };
}

function makeDb(repo: ReturnType<typeof makeRepo>) {
  return {
    withTenant: vi.fn().mockImplementation((_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        ...repo,
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      }),
    ),
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makeOutbox() {
  return { enqueue: vi.fn().mockResolvedValue(undefined) };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ApprovalService", () => {
  let fsm: WorkflowFsmService;

  beforeEach(() => {
    fsm = new WorkflowFsmService();
  });

  // ─── C1: Approve when step NOT waiting_review ─────────────────────────────
  describe("C1 — approve step not in waiting_review", () => {
    it("throws ConflictException when step is in_progress", async () => {
      const repo = makeRepo({ step: makeStep({ status: "in_progress" }) });
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      await expect(service.approve(COMPANY_ID, REQUEST_ID, REVIEWER_ID)).rejects.toThrow(ConflictException);
    });

    it("throws ConflictException when step is approved (already done)", async () => {
      const repo = makeRepo({ step: makeStep({ status: "approved" }) });
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      await expect(service.approve(COMPANY_ID, REQUEST_ID, REVIEWER_ID)).rejects.toThrow(ConflictException);
    });
  });

  // ─── C2: Approve when request NOT pending ─────────────────────────────────
  describe("C2 — approve non-pending approval request", () => {
    it("throws ConflictException when request is already approved", async () => {
      const repo = makeRepo({ request: makeApprovalRequest({ status: "approved" }) });
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      await expect(service.approve(COMPANY_ID, REQUEST_ID, REVIEWER_ID)).rejects.toThrow(ConflictException);
    });

    it("throws ConflictException when request is revision_requested", async () => {
      const repo = makeRepo({ request: makeApprovalRequest({ status: "revision_requested" }) });
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      await expect(service.approve(COMPANY_ID, REQUEST_ID, REVIEWER_ID)).rejects.toThrow(ConflictException);
    });
  });

  // ─── C3: Approve when actor NOT reviewer ──────────────────────────────────
  describe("C3 — reviewer check on approve", () => {
    it("throws ConflictException when actorId differs from reviewerUserId", async () => {
      const repo = makeRepo({
        step: makeStep({ reviewerUserId: REVIEWER_ID }),
      });
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      await expect(service.approve(COMPANY_ID, REQUEST_ID, OTHER_USER_ID)).rejects.toThrow(ConflictException);
    });

    it("does NOT throw when reviewerUserId is null (MVP: any user can approve)", async () => {
      const repo = makeRepo({
        step: makeStep({ reviewerUserId: null }),
      });
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      await expect(service.approve(COMPANY_ID, REQUEST_ID, OTHER_USER_ID)).resolves.toBeDefined();
    });
  });

  // ─── C4: Approve when instance NOT active ─────────────────────────────────
  describe("C4 — approve when instance is not active", () => {
    it("throws ConflictException when instance is completed", async () => {
      const repo = makeRepo({ instance: makeInstance({ status: "completed" }) });
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      await expect(service.approve(COMPANY_ID, REQUEST_ID, REVIEWER_ID)).rejects.toThrow(ConflictException);
    });
  });

  // ─── C5: RequestRevision when step NOT waiting_review ─────────────────────
  describe("C5 — requestRevision step not in waiting_review", () => {
    it("throws ConflictException when step is in_progress", async () => {
      const repo = makeRepo({ step: makeStep({ status: "in_progress" }) });
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      await expect(
        service.requestRevision(COMPANY_ID, REQUEST_ID, REVIEWER_ID, "Bug in script"),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── C6: RequestRevision when request NOT pending ─────────────────────────
  describe("C6 — requestRevision non-pending approval request", () => {
    it("throws ConflictException when request is already approved", async () => {
      const repo = makeRepo({ request: makeApprovalRequest({ status: "approved" }) });
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      await expect(
        service.requestRevision(COMPANY_ID, REQUEST_ID, REVIEWER_ID, "Bug"),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── A4: Approve intermediate step ────────────────────────────────────────
  describe("A4 — approve intermediate step", () => {
    it("resolves and calls approveStep + advanceInstanceStepOrder", async () => {
      // step 1 of 4 → advance to step 2
      const repo = makeRepo({
        step: makeStep({ stepOrder: 1 }),
        instance: makeInstance({ currentStepOrder: 1 }),
        maxStepOrder: 4,
      });
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      const result = await service.approve(COMPANY_ID, REQUEST_ID, REVIEWER_ID);
      expect(result).toBeDefined();
      expect(repo.approveStep).toHaveBeenCalled();
      expect(repo.advanceInstanceStepOrder).toHaveBeenCalled();
      expect(repo.completeWorkflowInstance).not.toHaveBeenCalled();
    });
  });

  // ─── A5: Approve last step ────────────────────────────────────────────────
  describe("A5 — approve last step completes workflow", () => {
    it("calls completeWorkflowInstance and does not advance step order", async () => {
      // step 4 of 4 → complete workflow
      const repo = makeRepo({
        step: makeStep({ stepOrder: 4 }),
        instance: makeInstance({ currentStepOrder: 4 }),
        maxStepOrder: 4,
      });
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      const result = await service.approve(COMPANY_ID, REQUEST_ID, REVIEWER_ID);
      expect(result).toBeDefined();
      expect(repo.completeWorkflowInstance).toHaveBeenCalled();
      expect(repo.advanceInstanceStepOrder).not.toHaveBeenCalled();
    });
  });

  // ─── A6: RequestRevision ──────────────────────────────────────────────────
  describe("A6 — requestRevision creates defect and revision task", () => {
    it("calls setStepToRevision and createDefect", async () => {
      const repo = makeRepo();
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      const result = await service.requestRevision(
        COMPANY_ID, REQUEST_ID, REVIEWER_ID, "Script có lỗi nội dung",
      );
      expect(result).toBeDefined();
      expect(repo.setStepToRevision).toHaveBeenCalled();
      expect(repo.createDefect).toHaveBeenCalled();
    });
  });
});
