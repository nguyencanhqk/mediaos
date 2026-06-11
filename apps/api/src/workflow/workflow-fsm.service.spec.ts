/**
 * G4-3 — Deny-path RED suite for WorkflowFsmService
 *
 * Source: docs/spikes/workflow-state-machine.md §8 (D1–D12)
 * ALL tests must FAIL (RED) until WorkflowFsmService implements the real algorithm.
 *
 * Coverage target: ≥80% WorkflowFsmService (FULL gate — CLAUDE.md §6)
 *
 * Deny cases covered:
 *   D1  — Approve step in `in_progress` (not waiting_review) → IllegalTransitionError
 *   D2  — Submit work to `approved` step → IllegalTransitionError
 *   D3  — Start step N+1 when N is not current_step_order → NotCurrentStepError
 *   D3b — Start non-current step order → NotCurrentStepError
 *   D5  — Submit/start step not in this instance → WorkflowNotFoundError
 *   D6  — Service tries to write `approved` directly → throws (ADR-0016 boundary)
 *   D10 — Submit/start when instance.status != 'active' → WorkflowInactiveError
 *   D11 — Replay task creation (dedup_key collision) → no duplicate (idempotent)
 *   D12 — revision → submit directly without start → IllegalTransitionError (X5)
 *
 * Allow cases (ensure deny-path tests don't over-block):
 *   A1  — not_started + start → in_progress (happy path T1)
 *   A2  — in_progress + submit → waiting_review (happy path T2)
 *   A3  — revision + start → in_progress (T5)
 */

import { beforeEach, describe, expect, it } from "vitest";
import { WorkflowFsmService } from "./workflow-fsm.service";
import {
  DependenciesNotMetError,
  IllegalTransitionError,
  NotStepActorError,
  StepLockedError,
  WorkflowInactiveError,
  WorkflowNotFoundError,
  type InstanceStatus,
  type StepStatus,
} from "./workflow.types";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const ASSIGNEE_ID = ACTOR_ID;
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";

function makeStep(overrides: {
  status?: StepStatus;
  stepOrder?: number;
  assigneeUserId?: string | null;
}) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    companyId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    workflowInstanceId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    stepOrder: overrides.stepOrder ?? 1,
    stepCode: "script",
    stepName: "Viết kịch bản",
    status: overrides.status ?? "not_started",
    assigneeUserId: overrides.assigneeUserId !== undefined ? overrides.assigneeUserId : ASSIGNEE_ID,
    reviewerUserId: null,
    startedAt: null,
    submittedAt: null,
    approvedAt: null,
    createdAt: new Date(),
  };
}

function makeInstance(overrides: {
  status?: InstanceStatus;
  currentStepOrder?: number;
}) {
  return {
    id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    companyId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    workflowDefinitionId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    contentItemId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    currentStepOrder: overrides.currentStepOrder ?? 1,
    status: overrides.status ?? "active",
    createdBy: null,
    createdAt: new Date(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WorkflowFsmService", () => {
  let fsm: WorkflowFsmService;

  beforeEach(() => {
    fsm = new WorkflowFsmService();
  });

  // ─── D1: Approve step in `in_progress` ─────────────────────────────────────
  describe("D1 — approve step not in waiting_review", () => {
    it("throws IllegalTransitionError when step is in_progress and event=approve", () => {
      const step = makeStep({ status: "in_progress" });
      const instance = makeInstance({});

      expect(() =>
        fsm.validateServiceTransition({ step, instance, event: "approve", actorId: ACTOR_ID }),
      ).toThrow(IllegalTransitionError);
    });

    it("throws IllegalTransitionError when step is not_started and event=approve", () => {
      const step = makeStep({ status: "not_started" });
      const instance = makeInstance({});

      expect(() =>
        fsm.validateServiceTransition({ step, instance, event: "approve", actorId: ACTOR_ID }),
      ).toThrow(IllegalTransitionError);
    });
  });

  // ─── D2: Submit to approved step (X3) ──────────────────────────────────────
  describe("D2 — submit to approved step", () => {
    it("throws IllegalTransitionError when step is approved and event=submit", () => {
      const step = makeStep({ status: "approved" });
      const instance = makeInstance({});

      expect(() =>
        fsm.validateServiceTransition({ step, instance, event: "submit", actorId: ASSIGNEE_ID }),
      ).toThrow(IllegalTransitionError);
    });
  });

  // ─── FS1: start/submit gated by dependency satisfaction (replaces D3 pointer) ─
  // G7-3c (§1.3): step_order is no longer a guard. A step is startable iff ALL upstream
  // deps are approved — the service computes that and passes `dependenciesApproved`.
  describe("FS1 — start/submit gated by allDependenciesApproved (DAG model)", () => {
    it("throws DependenciesNotMetError on start when dependenciesApproved=false", () => {
      const step = makeStep({ status: "not_started", stepOrder: 3 });
      const instance = makeInstance({ currentStepOrder: 1 });

      expect(() =>
        fsm.validateServiceTransition({
          step,
          instance,
          event: "start",
          actorId: ASSIGNEE_ID,
          dependenciesApproved: false,
        }),
      ).toThrow(DependenciesNotMetError);
    });

    it("throws DependenciesNotMetError on submit when dependenciesApproved=false", () => {
      const step = makeStep({ status: "in_progress", stepOrder: 2 });
      const instance = makeInstance({ currentStepOrder: 1 });

      expect(() =>
        fsm.validateServiceTransition({
          step,
          instance,
          event: "submit",
          actorId: ASSIGNEE_ID,
          dependenciesApproved: false,
        }),
      ).toThrow(DependenciesNotMetError);
    });

    it("does NOT throw on a non-sequential step_order when dependenciesApproved=true", () => {
      // step_order 3 with currentStepOrder 1 used to throw NotCurrentStepError — no longer a guard.
      const step = makeStep({ status: "not_started", stepOrder: 3 });
      const instance = makeInstance({ currentStepOrder: 1 });

      expect(() =>
        fsm.validateServiceTransition({
          step,
          instance,
          event: "start",
          actorId: ASSIGNEE_ID,
          dependenciesApproved: true,
        }),
      ).not.toThrow();
    });
  });

  // ─── D5: Step from wrong instance / non-existent ───────────────────────────
  // D5 is enforced by repository (FK + RLS). FsmService validates the step
  // belongs to the given instance via companyId + workflowInstanceId check.
  // ─── LK1 (4a): start/submit blocked by an ACTIVE revision lock (stepLocked) ─
  // The service resolves "is this step locked by an upstream revision?" in its tx and passes it.
  // Lock guard sits BEFORE the deps guard so a locked step reports the specific reason, and it
  // blocks EVEN when deps are approved — proving the guard consults the lock independently.
  describe("LK1 — start/submit blocked by an active revision lock (stepLocked)", () => {
    it("throws StepLockedError on start when stepLocked=true even though deps are approved", () => {
      const step = makeStep({ status: "not_started" });
      const instance = makeInstance({});
      expect(() =>
        fsm.validateServiceTransition({
          step,
          instance,
          event: "start",
          actorId: ASSIGNEE_ID,
          dependenciesApproved: true,
          stepLocked: true,
        }),
      ).toThrow(StepLockedError);
    });

    it("throws StepLockedError on submit when stepLocked=true", () => {
      const step = makeStep({ status: "in_progress" });
      const instance = makeInstance({});
      expect(() =>
        fsm.validateServiceTransition({
          step,
          instance,
          event: "submit",
          actorId: ASSIGNEE_ID,
          dependenciesApproved: true,
          stepLocked: true,
        }),
      ).toThrow(StepLockedError);
    });

    it("does NOT block when stepLocked=false and deps approved (allow path)", () => {
      const step = makeStep({ status: "not_started" });
      const instance = makeInstance({});
      const t = fsm.validateServiceTransition({
        step,
        instance,
        event: "start",
        actorId: ASSIGNEE_ID,
        dependenciesApproved: true,
        stepLocked: false,
      });
      expect(t.toState).toBe("in_progress");
    });
  });

  describe("D5 — step not belonging to the instance", () => {
    it("throws if step workflowInstanceId does not match the supplied instance id", () => {
      const step = { ...makeStep({}), workflowInstanceId: "ffffffff-ffff-ffff-ffff-ffffffffffff" };
      const instance = makeInstance({});

      expect(() =>
        fsm.validateServiceTransition({ step, instance, event: "start", actorId: ASSIGNEE_ID }),
      ).toThrow(WorkflowNotFoundError);
    });
  });

  // ─── D6: Service tries to write 'approved' directly (ADR-0016 boundary) ────
  describe("D6 — service must not write approved/revision directly", () => {
    it("throws IllegalTransitionError for event=approve (must go through consumer)", () => {
      const step = makeStep({ status: "waiting_review" });
      const instance = makeInstance({});

      // approve is consumer-only (writtenBy='consumer' in MVP0_TRANSITIONS)
      expect(() =>
        fsm.validateServiceTransition({ step, instance, event: "approve", actorId: ACTOR_ID }),
      ).toThrow(IllegalTransitionError);
    });

    it("throws IllegalTransitionError for event=request_revision (consumer-only)", () => {
      const step = makeStep({ status: "waiting_review" });
      const instance = makeInstance({});

      expect(() =>
        fsm.validateServiceTransition({
          step,
          instance,
          event: "request_revision",
          actorId: ACTOR_ID,
        }),
      ).toThrow(IllegalTransitionError);
    });

    it("throws IllegalTransitionError for event=open_next (consumer-only)", () => {
      const step = makeStep({ status: "approved" });
      const instance = makeInstance({});

      expect(() =>
        fsm.validateServiceTransition({ step, instance, event: "open_next", actorId: ACTOR_ID }),
      ).toThrow(IllegalTransitionError);
    });
  });

  // ─── FS5: only the consumer path writes approved/revision (invariant §1.4) ──
  // D6 (above) proves the SERVICE path cannot reach approved/revision. FS5 proves the symmetric
  // half: validateConsumerTransition IS that path — approve→approved, request_revision→revision,
  // both writtenBy='consumer'; while start/submit (service) only reach in_progress/waiting_review.
  // Together they pin §1.4: approved/revision are reachable ONLY through the consumer path.
  describe("FS5 — only the consumer path writes approved/revision (invariant §1.4)", () => {
    it("approve (consumer) transitions waiting_review → approved", () => {
      const step = makeStep({ status: "waiting_review" });
      const instance = makeInstance({});

      const result = fsm.validateConsumerTransition({
        step,
        instance,
        event: "approve",
        actorId: ACTOR_ID,
        reviewerUserId: null,
      });

      expect(result.toState).toBe("approved");
      expect(result.writtenBy).toBe("consumer");
    });

    it("request_revision (consumer) transitions waiting_review → revision", () => {
      const step = makeStep({ status: "waiting_review" });
      const instance = makeInstance({});

      const result = fsm.validateConsumerTransition({
        step,
        instance,
        event: "request_revision",
        actorId: ACTOR_ID,
        reviewerUserId: null,
      });

      expect(result.toState).toBe("revision");
      expect(result.writtenBy).toBe("consumer");
    });

    it("service events (start/submit) never reach approved/revision", () => {
      const notStarted = makeStep({ status: "not_started" });
      const inProgress = makeStep({ status: "in_progress" });
      const instance = makeInstance({});

      const started = fsm.validateServiceTransition({
        step: notStarted,
        instance,
        event: "start",
        actorId: ASSIGNEE_ID,
        dependenciesApproved: true,
      });
      const submitted = fsm.validateServiceTransition({
        step: inProgress,
        instance,
        event: "submit",
        actorId: ASSIGNEE_ID,
        dependenciesApproved: true,
      });

      expect(["approved", "revision"]).not.toContain(started.toState);
      expect(["approved", "revision"]).not.toContain(submitted.toState);
    });
  });

  // ─── D10: Instance not active ───────────────────────────────────────────────
  describe("D10 — transition when instance is not active", () => {
    it("throws WorkflowInactiveError when instance is completed", () => {
      const step = makeStep({ status: "not_started" });
      const instance = makeInstance({ status: "completed" });

      expect(() =>
        fsm.validateServiceTransition({ step, instance, event: "start", actorId: ASSIGNEE_ID }),
      ).toThrow(WorkflowInactiveError);
    });

    it("throws WorkflowInactiveError when instance is cancelled", () => {
      const step = makeStep({ status: "not_started" });
      const instance = makeInstance({ status: "cancelled" });

      expect(() =>
        fsm.validateServiceTransition({ step, instance, event: "start", actorId: ASSIGNEE_ID }),
      ).toThrow(WorkflowInactiveError);
    });

    it("throws WorkflowInactiveError on submit when instance is completed", () => {
      const step = makeStep({ status: "in_progress" });
      const instance = makeInstance({ status: "completed" });

      expect(() =>
        fsm.validateServiceTransition({ step, instance, event: "submit", actorId: ASSIGNEE_ID }),
      ).toThrow(WorkflowInactiveError);
    });
  });

  // ─── D12: revision → submit (X5) ───────────────────────────────────────────
  describe("D12 — revision → submit directly without re-starting", () => {
    it("throws IllegalTransitionError for revision + submit (must start first)", () => {
      const step = makeStep({ status: "revision" });
      const instance = makeInstance({});

      expect(() =>
        fsm.validateServiceTransition({ step, instance, event: "submit", actorId: ASSIGNEE_ID }),
      ).toThrow(IllegalTransitionError);
    });
  });

  // ─── X1: not_started → waiting_review (submit without start) ───────────────
  describe("X1 — not_started + submit (skip in_progress)", () => {
    it("throws IllegalTransitionError when trying to submit without starting", () => {
      const step = makeStep({ status: "not_started" });
      const instance = makeInstance({});

      expect(() =>
        fsm.validateServiceTransition({ step, instance, event: "submit", actorId: ASSIGNEE_ID }),
      ).toThrow(IllegalTransitionError);
    });
  });

  // ─── X4: approved → revision direct ────────────────────────────────────────
  describe("X4 — approved + request_revision (no approval bypass)", () => {
    it("throws IllegalTransitionError when trying to revision an approved step directly", () => {
      const step = makeStep({ status: "approved" });
      const instance = makeInstance({});

      expect(() =>
        fsm.validateServiceTransition({
          step,
          instance,
          event: "request_revision",
          actorId: ACTOR_ID,
        }),
      ).toThrow(IllegalTransitionError);
    });
  });

  // ─── Actor check: only assignee can start/submit ────────────────────────────
  describe("Actor validation — only assignee can start/submit", () => {
    it("throws NotStepActorError when non-assignee tries to start", () => {
      const step = makeStep({ status: "not_started", assigneeUserId: ASSIGNEE_ID });
      const instance = makeInstance({});

      expect(() =>
        fsm.validateServiceTransition({
          step,
          instance,
          event: "start",
          actorId: OTHER_USER_ID,
        }),
      ).toThrow(NotStepActorError);
    });

    it("throws NotStepActorError when non-assignee tries to submit", () => {
      const step = makeStep({ status: "in_progress", assigneeUserId: ASSIGNEE_ID });
      const instance = makeInstance({});

      expect(() =>
        fsm.validateServiceTransition({
          step,
          instance,
          event: "submit",
          actorId: OTHER_USER_ID,
        }),
      ).toThrow(NotStepActorError);
    });
  });

  // ─── A1: Happy path — not_started + start → in_progress ────────────────────
  describe("A1 — happy path: start step (T1)", () => {
    it("does not throw for valid start transition", () => {
      const step = makeStep({ status: "not_started", stepOrder: 1 });
      const instance = makeInstance({ currentStepOrder: 1 });

      expect(() =>
        fsm.validateServiceTransition({ step, instance, event: "start", actorId: ASSIGNEE_ID }),
      ).not.toThrow();
    });

    it("returns in_progress as the next state", () => {
      const step = makeStep({ status: "not_started", stepOrder: 1 });
      const instance = makeInstance({ currentStepOrder: 1 });

      const result = fsm.validateServiceTransition({
        step,
        instance,
        event: "start",
        actorId: ASSIGNEE_ID,
      });
      expect(result.toState).toBe("in_progress");
    });
  });

  // ─── A2: Happy path — in_progress + submit → waiting_review ────────────────
  describe("A2 — happy path: submit step (T2)", () => {
    it("does not throw for valid submit transition", () => {
      const step = makeStep({ status: "in_progress", stepOrder: 1 });
      const instance = makeInstance({ currentStepOrder: 1 });

      expect(() =>
        fsm.validateServiceTransition({ step, instance, event: "submit", actorId: ASSIGNEE_ID }),
      ).not.toThrow();
    });

    it("returns waiting_review as the next state", () => {
      const step = makeStep({ status: "in_progress", stepOrder: 1 });
      const instance = makeInstance({ currentStepOrder: 1 });

      const result = fsm.validateServiceTransition({
        step,
        instance,
        event: "submit",
        actorId: ASSIGNEE_ID,
      });
      expect(result.toState).toBe("waiting_review");
    });
  });

  // ─── A3: Happy path — revision + start → in_progress (T5) ─────────────────
  describe("A3 — happy path: restart after revision (T5)", () => {
    it("does not throw for revision + start transition", () => {
      const step = makeStep({ status: "revision", stepOrder: 1 });
      const instance = makeInstance({ currentStepOrder: 1 });

      expect(() =>
        fsm.validateServiceTransition({ step, instance, event: "start", actorId: ASSIGNEE_ID }),
      ).not.toThrow();
    });

    it("returns in_progress as the next state for T5", () => {
      const step = makeStep({ status: "revision", stepOrder: 1 });
      const instance = makeInstance({ currentStepOrder: 1 });

      const result = fsm.validateServiceTransition({
        step,
        instance,
        event: "start",
        actorId: ASSIGNEE_ID,
      });
      expect(result.toState).toBe("in_progress");
    });
  });

  // ─── D11 note: Idempotency tested at repository/service integration level ──
  // dedup_key UNIQUE constraint (workflow_step_id, revision_round) prevents duplicate tasks.
  // Tested via DB integration test (not FSM unit test).
});
