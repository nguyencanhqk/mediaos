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
 *   A4  — approve intermediate step (deps remain) → no completion, no pointer advance (G7-3c-ii)
 *   A5  — approve final step (all required approved) → workflow instance becomes completed
 *   A6  — requestRevision → creates defect, revision task, updates step status to revision
 *   A7  — approve a fork step → fans out: createTask for each newly-unblocked downstream (G7-3c-ii)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConflictException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
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

// ─── DAG context fixtures (G7-3c-ii) ────────────────────────────────────────────
// approve() reads def-steps + deps + instance-steps WITHIN its tx (post-approveStep view)
// and feeds them to the pure workflow-dag helpers. These fixtures emulate that read.

interface DagFixture {
  defSteps: Array<Record<string, unknown>>;
  deps: Array<{ fromStepId: string; toStepId: string }>;
  instanceSteps: Array<Record<string, unknown>>;
}

// Current step under approval = "script" (makeStep.stepCode); nodeKey null → key falls back to stepCode.
const DEF_SCRIPT = { id: "def-script", nodeKey: "script", isRequired: true, defaultTaskTitle: "Viết kịch bản", name: "Viết kịch bản", code: "script", stepOrder: 1 };
const DEF_EDIT = { id: "def-edit", nodeKey: "edit", isRequired: true, defaultTaskTitle: "Dựng video", name: "Dựng video", code: "edit", stepOrder: 2 };
const APPROVED_SCRIPT_STEP = { id: STEP_ID, workflowInstanceId: INSTANCE_ID, nodeKey: null, stepCode: "script", stepName: "Viết kịch bản", status: "approved" };
const NOTSTARTED_EDIT_STEP = { id: "edit-step", workflowInstanceId: INSTANCE_ID, nodeKey: null, stepCode: "edit", stepName: "Dựng video", status: "not_started" };

/** Default DAG: 2-step instance, current(script) approved, edit not_started, NO edges →
 *  not complete (edit still pending) and nothing to fan out. Matches A4 (intermediate). */
function defaultDag(): DagFixture {
  return { defSteps: [DEF_SCRIPT, DEF_EDIT], deps: [], instanceSteps: [APPROVED_SCRIPT_STEP, NOTSTARTED_EDIT_STEP] };
}

// ─── Mock repo factory ────────────────────────────────────────────────────────

function makeRepo(overrides: {
  step?: ReturnType<typeof makeStep>;
  instance?: ReturnType<typeof makeInstance>;
  request?: ReturnType<typeof makeApprovalRequest>;
  dag?: DagFixture;
} = {}) {
  const step = overrides.step ?? makeStep();
  const instance = overrides.instance ?? makeInstance();
  const request = overrides.request ?? makeApprovalRequest();
  const dag = overrides.dag ?? defaultDag();

  return {
    findApprovalRequestById: vi.fn().mockResolvedValue([request]),
    findStepByIdInTx: vi.fn().mockResolvedValue([step]),
    findInstanceByIdInTx: vi.fn().mockResolvedValue([instance]),
    lockInstanceForUpdateInTx: vi.fn().mockResolvedValue([{ id: instance.id }]),
    createApprovalStep: vi.fn().mockResolvedValue([{ id: "new-approval-step" }]),
    closeApprovalRequest: vi.fn().mockResolvedValue([{ ...request, status: "approved" }]),
    approveStep: vi.fn().mockResolvedValue([{ ...step, status: "approved", approvedAt: new Date() }]),
    advanceInstanceStepOrder: vi.fn().mockResolvedValue([{ ...instance, currentStepOrder: 2 }]),
    completeWorkflowInstance: vi.fn().mockResolvedValue([{ ...instance, status: "completed" }]),
    setStepToRevision: vi.fn().mockResolvedValue([{ ...step, status: "revision" }]),
    createDefect: vi.fn().mockResolvedValue([{ id: "new-defect" }]),
    findTaskByStepId: vi.fn().mockResolvedValue([null]),
    findActiveTaskByStepIdInTx: vi.fn().mockResolvedValue([null]),
    updateTaskStatus: vi.fn().mockResolvedValue([]),
    createTask: vi.fn().mockResolvedValue([{ id: "new-task" }]),
    // G7-3c-ii: DAG context reads (within tx) used by approve() fan-out + completion.
    findDefinitionStepsInTx: vi.fn().mockResolvedValue(dag.defSteps),
    findTemplateDependenciesInTx: vi.fn().mockResolvedValue(dag.deps),
    findStepsByInstanceIdInTx: vi.fn().mockResolvedValue(dag.instanceSteps),
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

  // ─── A4: Approve intermediate step (deps remain) ──────────────────────────
  describe("A4 — approve intermediate step does not complete or advance", () => {
    it("does NOT complete the workflow and does NOT advance the (legacy) step pointer", async () => {
      // default DAG: 'edit' still not_started → workflow not complete; no edges → nothing to open.
      const repo = makeRepo({ step: makeStep({ stepOrder: 1 }) });
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      const result = await service.approve(COMPANY_ID, REQUEST_ID, REVIEWER_ID);
      expect(result.isWorkflowComplete).toBe(false);
      expect((result as { isLastStep: boolean }).isLastStep).toBe(false);
      expect(repo.approveStep).toHaveBeenCalled();
      expect(repo.completeWorkflowInstance).not.toHaveBeenCalled();
    });
  });

  // ─── A5: Approve final step (all required approved) ────────────────────────
  describe("A5 — approve final step completes workflow", () => {
    it("completes the instance when every required step is approved (not by step_order)", async () => {
      const repo = makeRepo({
        step: makeStep({ stepOrder: 4 }),
        dag: { defSteps: [DEF_SCRIPT], deps: [], instanceSteps: [APPROVED_SCRIPT_STEP] },
      });
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      const result = await service.approve(COMPANY_ID, REQUEST_ID, REVIEWER_ID);
      expect(result.isWorkflowComplete).toBe(true);
      expect((result as { isLastStep: boolean }).isLastStep).toBe(true);
      expect(repo.completeWorkflowInstance).toHaveBeenCalled();
    });
  });

  // ─── A7: Approve a fork step → fan out to newly-unblocked downstream ───────
  describe("A7 — approve fork step opens newly-unblocked downstream steps", () => {
    it("creates a task for each downstream step whose deps are now all approved", async () => {
      // script→edit; after script approved, edit's only dep is satisfied → edit opens.
      const repo = makeRepo({
        step: makeStep({ stepOrder: 1 }),
        dag: {
          defSteps: [DEF_SCRIPT, DEF_EDIT],
          deps: [{ fromStepId: "def-script", toStepId: "def-edit" }],
          instanceSteps: [APPROVED_SCRIPT_STEP, NOTSTARTED_EDIT_STEP],
        },
      });
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      const result = await service.approve(COMPANY_ID, REQUEST_ID, REVIEWER_ID);
      expect(result.isWorkflowComplete).toBe(false); // 'edit' now open but not yet approved
      expect(repo.createTask).toHaveBeenCalledWith(
        COMPANY_ID,
        expect.objectContaining({ workflowStepId: "edit-step", origin: "initial", revisionRound: 0 }),
        expect.anything(),
      );
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

  // ─── Branch coverage: side-effect & error paths ───────────────────────────
  // The deny/happy suites above always run with findTaskByStepId → [null], no
  // comment, and never exercise the InternalServerError guards or the unexpected-
  // error rethrow in withTenant().catch. These cover those remaining branches so
  // the sensitive-module threshold (≥80% branch) holds on real behaviour.
  describe("branch coverage — task-linked + comment + failure paths", () => {
    // Silence the intentional logger.error on the unexpected-error path.
    beforeEach(() => {
      vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    });

    it("approve: when a task is linked + comment given → updates task status to approved", async () => {
      const repo = makeRepo();
      // 3c-ii: approve() reads the linked task within its tx (findActiveTaskByStepIdInTx).
      repo.findActiveTaskByStepIdInTx = vi.fn().mockResolvedValue([{ id: "task-1", revisionRound: 0 }]);
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      const result = await service.approve(COMPANY_ID, REQUEST_ID, REVIEWER_ID, "LGTM");
      expect(result).toBeDefined();
      expect(repo.updateTaskStatus).toHaveBeenCalledWith(COMPANY_ID, "task-1", "approved", expect.anything());
    });

    it("approve: throws InternalServerError when approveStep returns no row", async () => {
      const repo = makeRepo();
      repo.approveStep = vi.fn().mockResolvedValue([undefined]);
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      await expect(service.approve(COMPANY_ID, REQUEST_ID, REVIEWER_ID)).rejects.toThrow(InternalServerErrorException);
    });

    it("approve: rethrows an unexpected (non-HTTP) repo error via withTenant.catch", async () => {
      const repo = makeRepo();
      repo.approveStep = vi.fn().mockRejectedValue(new Error("db connection lost"));
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      await expect(service.approve(COMPANY_ID, REQUEST_ID, REVIEWER_ID)).rejects.toThrow("db connection lost");
    });

    it("requestRevision: when a task is linked + comment given → increments revision round and updates task", async () => {
      const repo = makeRepo();
      // F2: requestRevision now reads the linked task within its tx (findActiveTaskByStepIdInTx),
      // matching approve(). Previously it read via the non-tx findTaskByStepId.
      repo.findActiveTaskByStepIdInTx = vi.fn().mockResolvedValue([{ id: "task-9", revisionRound: 2 }]);
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      const result = await service.requestRevision(COMPANY_ID, REQUEST_ID, REVIEWER_ID, "Lỗi nội dung", "xem lại đoạn 2");
      expect(result).toBeDefined();
      expect(repo.updateTaskStatus).toHaveBeenCalledWith(COMPANY_ID, "task-9", "revision", expect.anything());
      // nextRevisionRound = existing(2) + 1 = 3
      expect(repo.createTask).toHaveBeenCalledWith(
        COMPANY_ID,
        expect.objectContaining({ revisionRound: 3, origin: "revision" }),
        expect.anything(),
      );
    });

    it("requestRevision: throws InternalServerError when setStepToRevision returns no row", async () => {
      const repo = makeRepo();
      repo.setStepToRevision = vi.fn().mockResolvedValue([undefined]);
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      await expect(
        service.requestRevision(COMPANY_ID, REQUEST_ID, REVIEWER_ID, "Lỗi"),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("requestRevision: rethrows an unexpected (non-HTTP) repo error via withTenant.catch", async () => {
      const repo = makeRepo();
      repo.createDefect = vi.fn().mockRejectedValue(new Error("outbox down"));
      const db = makeDb(repo);
      const service = new ApprovalService(db as never, repo as never, fsm, makeAudit() as never, makeOutbox() as never);

      await expect(
        service.requestRevision(COMPANY_ID, REQUEST_ID, REVIEWER_ID, "Lỗi"),
      ).rejects.toThrow("outbox down");
    });
  });
});
