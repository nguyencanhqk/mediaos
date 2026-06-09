import { Injectable } from "@nestjs/common";
import {
  findTransition,
  IllegalTransitionError,
  NotCurrentStepError,
  NotReviewerError,
  NotStepActorError,
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
 *   1. instance.status === 'active'  (D10 / X7)
 *   2. step.workflowInstanceId === instance.id  (D5)
 *   3. step.stepOrder === instance.currentStepOrder  (D3) — for 'start'/'submit'
 *   4. actor === step.assigneeUserId  (actor check)
 *   5. (fromState, event) found in allowed transitions  (FSM check)
 *   6. event is a SERVICE event (not consumer-only)  (D6 / ADR-0016)
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

    // Guard 3: for start/submit, step must be the current step (D3, X6)
    // (revision + start uses same current_step_order since pointer does not advance on revision)
    if (event === "start" || event === "submit") {
      if (step.stepOrder !== instance.currentStepOrder) {
        throw new NotCurrentStepError(step.stepOrder, instance.currentStepOrder);
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

    return transition;
  }

  /**
   * Validates a consumer-initiated transition (approve / request_revision / open_next / complete_workflow).
   * Pure logic — no DB access. Guards:
   *   1. instance.status === 'active'
   *   2. step.workflowInstanceId === instance.id
   *   3. (fromState, event) found in allowed transitions
   *   4. transition.writtenBy === 'consumer'
   *   5. reviewer check — for approve/request_revision only when reviewerUserId is set
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

    // Guard 5: reviewer check for approve / request_revision
    // open_next and complete_workflow are system-triggered (no actor restriction)
    if (event === "approve" || event === "request_revision") {
      if (reviewerUserId !== null && reviewerUserId !== actorId) {
        throw new NotReviewerError(
          `actorId=${actorId} is not reviewer=${reviewerUserId}`,
        );
      }
    }

    return transition;
  }
}
