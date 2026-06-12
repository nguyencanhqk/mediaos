import { Injectable } from "@nestjs/common";
import {
  ChecklistIncompleteError,
  DependenciesNotMetError,
  findTransition,
  IllegalTransitionError,
  NotReviewerError,
  NotStepActorError,
  StepLockedError,
  SERVICE_EVENTS,
  WorkflowInactiveError,
  WorkflowNotFoundError,
  type InstanceStatus,
  type StepEvent,
  type StepStatus,
  type MVP0_TRANSITIONS,
} from "./workflow.types";

export interface FsmStepInput {
  id: string;
  workflowInstanceId: string;
  stepOrder: number;
  status: StepStatus;
  assigneeUserId: string | null;
}

export interface FsmInstanceInput {
  id: string;
  currentStepOrder: number;
  status: InstanceStatus;
}

export interface ValidateTransitionInput {
  step: FsmStepInput;
  instance: FsmInstanceInput;
  event: StepEvent;
  actorId: string;
  /**
   * G7-3c: caller-computed answer to "are ALL upstream DAG deps of this step approved?".
   * The FSM stays pure (no DB) — the service resolves deps within its tx and passes the result.
   * Undefined = not evaluated (e.g. consumer events) → the dependency guard is skipped.
   */
  dependenciesApproved?: boolean;
  /**
   * G7-4a: caller-computed answer to "does this step still carry an active revision lock?"
   * (a transitive descendant of a step in revision — BR-006). The service resolves it within its
   * tx and passes the result; true → start/submit is rejected. Undefined/false = not locked.
   */
  stepLocked?: boolean;
  /**
   * G7-4b: caller-computed answer to "are ALL REQUIRED checklist items of this step checked?".
   * Resolved by the service within its tx (def-step by node_key → checklists → required items vs
   * workflow_step_checklist_states). Only consulted for 'submit'; false → submit is rejected.
   * Undefined = not evaluated (e.g. start, or no checklist) → the checklist guard is skipped.
   */
  checklistComplete?: boolean;
}

export interface ValidateConsumerTransitionInput {
  step: FsmStepInput;
  instance: FsmInstanceInput;
  event: "approve" | "request_revision" | "open_next" | "complete_workflow";
  actorId: string;
  reviewerUserId: string | null;
}

export type TransitionResult = (typeof MVP0_TRANSITIONS)[number];

/**
 * WorkflowFsmService — validates FSM transitions at service layer (ADR-0016).
 *
 * Pure logic: no DB access. Call validateServiceTransition() before writing any state.
 * - Only SERVICE transitions (writtenBy='service') are validated here.
 * - CONSUMER transitions (approve, request_revision, open_next, complete_workflow)
 *   are rejected — they must go through the event consumer pipeline.
 *
 * Guard order (checked before transition lookup):
 *   1.  instance.status === 'active'  (D10 / X7)
 *   2.  step.workflowInstanceId === instance.id  (D5)
 *   3a. stepLocked !== true  (G7-4a, BR-006) — for 'start'/'submit' (blocked by upstream revision)
 *   3b. dependenciesApproved !== false  (G7-3c, §1.3) — for 'start'/'submit' (replaces D3 pointer)
 *   4.  actor === step.assigneeUserId  (actor check)
 *   5.  (fromState, event) found in allowed transitions  (FSM check)
 *   6.  event is a SERVICE event (not consumer-only)  (D6 / ADR-0016)
 *   7.  checklistComplete !== false  (G7-4b) — for 'submit' (all required checklist items checked)
 */
@Injectable()
export class WorkflowFsmService {
  /**
   * Validates a service-initiated transition and returns the resulting transition descriptor.
   * Throws a typed error if the transition is illegal.
   */
  validateServiceTransition(input: ValidateTransitionInput): TransitionResult {
    const { step, instance, event, actorId } = input;

    // Guard 1: instance must be active (D10, X7)
    if (instance.status !== "active") {
      throw new WorkflowInactiveError(instance.status);
    }

    // Guard 2: step must belong to this instance (D5)
    if (step.workflowInstanceId !== instance.id) {
      throw new WorkflowNotFoundError("step", step.id);
    }

    // Guard 3a (G7-4a): for start/submit, a step carrying an active revision lock is blocked
    // (BR-006). Checked BEFORE the deps guard so a locked descendant reports the specific
    // "blocked by an upstream revision" reason, and it blocks even when deps happen to be approved.
    if (event === "start" || event === "submit") {
      if (input.stepLocked === true) {
        throw new StepLockedError(step.id);
      }
    }

    // Guard 3b (G7-3c): for start/submit, ALL upstream DAG deps must be approved (§1.3).
    // Replaces the linear current_step_order guard (D2 — step_order is now advisory only).
    // The service resolves deps within its tx and passes the result; undefined = not evaluated.
    if (event === "start" || event === "submit") {
      if (input.dependenciesApproved === false) {
        throw new DependenciesNotMetError(step.id);
      }
    }

    // Guard 4: actor must be the step assignee (for service events)
    if (event === "start" || event === "submit") {
      if (!step.assigneeUserId || step.assigneeUserId !== actorId) {
        throw new NotStepActorError(
          `actorId=${actorId} is not assignee=${step.assigneeUserId ?? "null"}`,
        );
      }
    }

    // Guard 5: look up transition in allowed table
    const transition = findTransition(step.status, event);
    if (!transition) {
      throw new IllegalTransitionError(step.status, event);
    }

    // Guard 6: reject consumer-only events from service layer (D6, ADR-0016)
    if (!SERVICE_EVENTS.has(`${step.status}:${event}`)) {
      throw new IllegalTransitionError(step.status, event);
    }

    // Guard 7 (G7-4b): submit requires every REQUIRED checklist item to be checked. Checked LAST so
    // it only fires once the submit is otherwise legal (correct from-state, actor, deps, not locked).
    // Submit-only; undefined = no checklist evaluated → not over-gated. The service resolves it in-tx.
    if (event === "submit" && input.checklistComplete === false) {
      throw new ChecklistIncompleteError(step.id);
    }

    return transition;
  }

  /**
   * Validates a consumer-initiated transition (approve / request_revision / open_next / complete_workflow).
   * Pure logic — no DB access. Guards:
   *   1. instance.status === 'active'
   *   2. step.workflowInstanceId === instance.id
   *   3. (fromState, event) found in allowed transitions
   *   4. transition.writtenBy === 'consumer'
   *   5. reviewer check — approve/request_revision require an ASSIGNED reviewer === actor (fail-closed)
   */
  validateConsumerTransition(input: ValidateConsumerTransitionInput): TransitionResult {
    const { step, instance, event, actorId, reviewerUserId } = input;

    // Guard 1: instance must be active
    if (instance.status !== "active") {
      throw new WorkflowInactiveError(instance.status);
    }

    // Guard 2: step must belong to this instance
    if (step.workflowInstanceId !== instance.id) {
      throw new WorkflowNotFoundError("step", step.id);
    }

    // Guard 3: look up transition
    const transition = findTransition(step.status, event);
    if (!transition) {
      throw new IllegalTransitionError(step.status, event);
    }

    // Guard 4: must be a consumer event
    if (transition.writtenBy !== "consumer") {
      throw new IllegalTransitionError(step.status, event);
    }

    // Guard 5: reviewer check for approve / request_revision — FAIL-CLOSED (G7-merge gate S2).
    // open_next and complete_workflow are system-triggered (no actor restriction).
    // A null reviewer means the PM has not assigned one yet (submitStep creates the approval request
    // before assignment). Denying here prevents ANY tenant member — including the assignee — from
    // self-approving an unassigned step. A reviewer MUST be assigned before the decision is allowed.
    if (event === "approve" || event === "request_revision") {
      if (reviewerUserId === null) {
        throw new NotReviewerError(
          `no reviewer assigned for step=${step.id} — assign a reviewer before ${event}`,
        );
      }
      if (reviewerUserId !== actorId) {
        throw new NotReviewerError(
          `actorId=${actorId} is not reviewer=${reviewerUserId}`,
        );
      }
    }

    return transition;
  }
}
