/**
 * Workflow FSM types — G4-3.
 * Source of truth: docs/spikes/workflow-state-machine.md + ADR-0016.
 */

export type StepStatus =
  | "not_started"
  | "in_progress"
  | "waiting_review"
  | "approved"
  | "revision"
  | "blocked";

export type InstanceStatus = "active" | "completed" | "cancelled";

export type StepEvent =
  | "start"
  | "submit"
  | "approve"
  | "request_revision"
  | "open_next"
  | "complete_workflow";

/** Allowed transitions seeded for MVP-0 (video_standard_v0). */
export const MVP0_TRANSITIONS: ReadonlyArray<{
  fromState: StepStatus;
  event: StepEvent;
  toState: StepStatus | "completed";
  writtenBy: "service" | "consumer";
}> = [
  // T1: assignee starts step
  { fromState: "not_started", event: "start", toState: "in_progress", writtenBy: "service" },
  // T2: assignee submits work
  { fromState: "in_progress", event: "submit", toState: "waiting_review", writtenBy: "service" },
  // T3: approver approves — CONSUMER ONLY
  { fromState: "waiting_review", event: "approve", toState: "approved", writtenBy: "consumer" },
  // T4: approver requests revision — CONSUMER ONLY
  { fromState: "waiting_review", event: "request_revision", toState: "revision", writtenBy: "consumer" },
  // T5: assignee restarts after revision
  { fromState: "revision", event: "start", toState: "in_progress", writtenBy: "service" },
  // T6: system opens next step after approval — CONSUMER ONLY
  { fromState: "approved", event: "open_next", toState: "in_progress", writtenBy: "consumer" },
  // T7: system completes workflow at last step — CONSUMER ONLY
  { fromState: "approved", event: "complete_workflow", toState: "completed", writtenBy: "consumer" },
] as const;

/** Set of (fromState, event) pairs that SERVICE is allowed to execute directly. */
export const SERVICE_EVENTS: ReadonlySet<string> = new Set(
  MVP0_TRANSITIONS.filter((t) => t.writtenBy === "service").map(
    (t) => `${t.fromState}:${t.event}`,
  ),
);

/** Look up the result state for a (fromState, event) pair. Returns undefined if illegal. */
export function findTransition(
  fromState: StepStatus,
  event: StepEvent,
): (typeof MVP0_TRANSITIONS)[number] | undefined {
  return MVP0_TRANSITIONS.find((t) => t.fromState === fromState && t.event === event);
}

/** IllegalTransitionError is thrown when the FSM rejects a transition. */
export class IllegalTransitionError extends Error {
  readonly fromState: StepStatus;
  readonly event: StepEvent;

  constructor(fromState: StepStatus, event: StepEvent) {
    super(`Illegal FSM transition: ${fromState} + ${event}`);
    this.name = "IllegalTransitionError";
    this.fromState = fromState;
    this.event = event;
  }
}

/** WorkflowNotFoundError when instance or step does not exist (or wrong tenant). */
export class WorkflowNotFoundError extends Error {
  constructor(entity: "instance" | "step", id: string) {
    super(`Workflow ${entity} not found: ${id}`);
    this.name = "WorkflowNotFoundError";
  }
}

/** WorkflowInactiveError when instance is not active. */
export class WorkflowInactiveError extends Error {
  readonly instanceStatus: InstanceStatus;

  constructor(instanceStatus: InstanceStatus) {
    super(`Workflow instance is not active (status=${instanceStatus})`);
    this.name = "WorkflowInactiveError";
    this.instanceStatus = instanceStatus;
  }
}

/** NotStepActorError when the actor is not allowed to perform the action on the step. */
export class NotStepActorError extends Error {
  constructor(reason: string) {
    super(`Not authorized to act on this step: ${reason}`);
    this.name = "NotStepActorError";
  }
}

/** NotCurrentStepError when trying to start a step that is not the current active step. */
export class NotCurrentStepError extends Error {
  constructor(stepOrder: number, currentStepOrder: number) {
    super(
      `Step ${stepOrder} is not the current step (current=${currentStepOrder})`,
    );
    this.name = "NotCurrentStepError";
  }
}

/**
 * DependenciesNotMetError — G7-3c. A step cannot start because not all of its upstream DAG
 * dependencies are approved yet. Replaces the linear `current_step_order` guard (D2/§1.3).
 */
export class DependenciesNotMetError extends Error {
  readonly stepId: string;
  constructor(stepId: string) {
    super(`Step ${stepId} cannot start: upstream dependencies are not all approved`);
    this.name = "DependenciesNotMetError";
    this.stepId = stepId;
  }
}

/**
 * StepLockedError — G7-4a (BR-006/WF-003). A step cannot start/submit because an upstream step is
 * in revision and propagated a `downstream_blocked_by_revision` lock onto it. Released only when
 * every locking source is re-approved (multi-source: LK5). Distinct from DependenciesNotMetError so
 * the UI can show "blocked by an upstream revision" rather than a generic "deps not met".
 */
export class StepLockedError extends Error {
  readonly stepId: string;
  constructor(stepId: string) {
    super(`Step ${stepId} is locked: an upstream step is in revision (downstream_blocked_by_revision)`);
    this.name = "StepLockedError";
    this.stepId = stepId;
  }
}

/**
 * ChecklistIncompleteError — G7-4b. A step cannot be submitted (T2) because not every REQUIRED
 * checklist item of the step has been checked. Required items are resolved from the template's
 * def-step (matched by node_key) → checklists → checklist_items WHERE is_required; "checked" = a
 * row in workflow_step_checklist_states. A step with no required items is never blocked (anti
 * over-gate). Distinct from StepLockedError / DependenciesNotMetError so the UI shows the specific
 * "checklist incomplete" reason. Submit-only (start is not gated by the checklist).
 */
export class ChecklistIncompleteError extends Error {
  readonly stepId: string;
  constructor(stepId: string) {
    super(`Step ${stepId} cannot be submitted: required checklist items are not all checked`);
    this.name = "ChecklistIncompleteError";
    this.stepId = stepId;
  }
}

/** DuplicateWorkflowError when a content item already has an active workflow. */
export class DuplicateWorkflowError extends Error {
  constructor(contentItemId: string) {
    super(`Content item ${contentItemId} already has an active workflow`);
    this.name = "DuplicateWorkflowError";
  }
}

/** ApprovalRequestNotPendingError when trying to act on a non-pending approval request. */
export class ApprovalRequestNotPendingError extends Error {
  readonly currentStatus: string;
  constructor(currentStatus: string) {
    super(`Approval request is not pending (status=${currentStatus})`);
    this.name = "ApprovalRequestNotPendingError";
    this.currentStatus = currentStatus;
  }
}

/** NotReviewerError when the actor is not the designated reviewer for this step. */
export class NotReviewerError extends Error {
  constructor(reason: string) {
    super(`Not authorized to review this step: ${reason}`);
    this.name = "NotReviewerError";
  }
}
