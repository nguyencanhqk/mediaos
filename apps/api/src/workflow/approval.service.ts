import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { WorkflowFsmService } from "./workflow-fsm.service";
import { WorkflowRepository } from "./workflow.repository";
import { LockPropagationService } from "./lock-propagation.service";
import {
  computeNewlyUnblockedStepIds,
  isWorkflowComplete,
  type DagContext,
} from "./workflow-dag";
import {
  ApprovalRequestNotPendingError,
  IllegalTransitionError,
  NotReviewerError,
  WorkflowInactiveError,
  WorkflowNotFoundError,
  type InstanceStatus,
  type StepStatus,
} from "./workflow.types";

const PG_UNIQUE_VIOLATION = "23505";

/**
 * True when `err` is a Postgres unique-constraint violation. A concurrent same-request approve()
 * (or request-revision) loses the per-instance lock race, then its createApprovalStep hits
 * approval_steps_request_level_uq → 23505 → the whole tx rolls back (integrity safe). Map it to a
 * 409 instead of leaking a raw 500, mirroring workflow.service.ts startWorkflow/applyTemplate.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as Record<string, unknown>)["code"] === PG_UNIQUE_VIOLATION
  );
}

function toFsmStep(row: {
  id: string;
  workflowInstanceId: string;
  stepOrder: number;
  status: string;
  assigneeUserId: string | null;
}) {
  return { ...row, status: row.status as StepStatus };
}

function toFsmInstance(row: { id: string; currentStepOrder: number; status: string }) {
  return { ...row, status: row.status as InstanceStatus };
}

function mapFsmError(err: unknown): never {
  if (err instanceof WorkflowInactiveError)
    throw new ConflictException(`Workflow is not active (status=${err.instanceStatus})`);
  if (err instanceof IllegalTransitionError)
    throw new ConflictException(
      `Illegal transition: step is '${err.fromState}', cannot apply event '${err.event}'`,
    );
  if (err instanceof NotReviewerError)
    throw new ConflictException("Not authorized to review this step");
  if (err instanceof WorkflowNotFoundError) throw new NotFoundException(err.message);
  if (err instanceof ApprovalRequestNotPendingError)
    throw new ConflictException(err.message);
  throw err;
}

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WorkflowRepository,
    private readonly fsm: WorkflowFsmService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly lockPropagation: LockPropagationService,
  ) {}

  /** GET /workflow/approval-requests — list all pending requests (reviewer queue). */
  async listPending(companyId: string) {
    return this.repo.findPendingApprovalRequests(companyId);
  }

  /**
   * POST /workflow/approval-requests/:id/approve — T3.
   * Side-effects (atomic):
   *   - Creates approval_steps record (decision=approved)
   *   - Updates approval_request.status = approved
   *   - Updates workflow_steps.status = approved
   *   - Updates task.status = approved (if exists)
   *   - Fans out: opens (auto-task) every downstream step the approval unblocked (DAG, 0..n)
   *   - Completes the instance iff every required step is approved (G7-3c-ii, NOT by step_order)
   */
  async approve(
    companyId: string,
    requestId: string,
    actorId: string,
    comment?: string,
  ) {
    const [request] = await this.repo.findApprovalRequestById(companyId, requestId);
    if (!request) throw new NotFoundException(`Approval request not found: ${requestId}`);

    if (request.status !== "pending") {
      return mapFsmError(new ApprovalRequestNotPendingError(request.status));
    }

    return this.db.withTenant(companyId, async (tx) => {
      const [step] = await this.repo.findStepByIdInTx(companyId, request.workflowStepId, tx);
      if (!step) throw new NotFoundException(`Step not found: ${request.workflowStepId}`);

      const [instance] = await this.repo.findInstanceByIdInTx(companyId, step.workflowInstanceId, tx);
      if (!instance) throw new NotFoundException(`Instance not found: ${step.workflowInstanceId}`);

      // 3c-iii race-safety (FS10): serialize per-instance BEFORE any dep-state read. Two approvers
      // closing a join's last two deps now queue on this row lock instead of lost-updating each other.
      await this.repo.lockInstanceForUpdateInTx(companyId, instance.id, tx);

      try {
        this.fsm.validateConsumerTransition({
          step: toFsmStep(step),
          instance: toFsmInstance(instance),
          event: "approve",
          actorId,
          reviewerUserId: step.reviewerUserId,
        });
      } catch (err) {
        return mapFsmError(err);
      }

      // 1. Create approval_steps record
      const [approvalStepRow] = await this.repo.createApprovalStep(
        companyId,
        {
          approvalRequestId: requestId,
          level: request.currentLevel,
          approverUserId: actorId,
          decision: "approved",
          comment: comment ?? null,
        },
        tx,
      );

      // 2. Close approval request — guard the row count: a 0-row update would leave the request
      // 'pending' while the step is approved (inconsistent state committed in-tx). Fail-closed.
      const [closedRequest] = await this.repo.closeApprovalRequest(
        companyId,
        requestId,
        { status: "approved", comment: comment ?? null },
        tx,
      );
      if (!closedRequest) throw new InternalServerErrorException("Failed to close approval request");

      // 3. Mark step approved
      const [updatedStep] = await this.repo.approveStep(companyId, step.id, tx);
      if (!updatedStep) throw new InternalServerErrorException("Failed to approve step");

      // 3b. (G7-4a/BR-006) Re-approving this step clears every revision lock it caused. A descendant
      // re-opens only when NO active lock remains on it (multi-source: LK5) — enforced by the
      // open-filter below. Soft-release inside the per-instance FOR UPDATE lock → serialized.
      await this.lockPropagation.releaseLocksForReapproved(companyId, step.id, tx);

      // 4. Update task status if exists (read within tx — ready for the 3c-iii FOR UPDATE lock)
      const [task] = await this.repo.findActiveTaskByStepIdInTx(companyId, step.id, tx);
      if (task) {
        await this.repo.updateTaskStatus(companyId, task.id, "approved", tx);
      }

      // 5. DAG resolution (G7-3c-ii) — replaces the linear current_step_order pointer.
      // Read the POST-approve DAG view WITHIN this tx. Sequential awaits, NOT Promise.all:
      // node-postgres cannot run concurrent queries on one tx connection; staying on the
      // caller's tx keeps these reads inside the per-instance FOR UPDATE lock added in 3c-iii.
      const defStepRows = await this.repo.findDefinitionStepsInTx(
        companyId,
        instance.workflowDefinitionId,
        tx,
      );
      const depRows = await this.repo.findTemplateDependenciesInTx(
        companyId,
        instance.workflowDefinitionId,
        tx,
      );
      const instanceStepRows = await this.repo.findStepsByInstanceIdInTx(companyId, instance.id, tx);

      const dagCtx: DagContext = {
        defSteps: defStepRows.map((d) => ({ id: d.id, nodeKey: d.nodeKey, isRequired: d.isRequired })),
        deps: depRows.map((dep) => ({ fromStepId: dep.fromStepId, toStepId: dep.toStepId })),
        instanceSteps: instanceStepRows.map((s) => ({
          id: s.id,
          nodeKey: s.nodeKey,
          stepCode: s.stepCode,
          status: s.status,
        })),
      };

      // 6. Fan out: open every step this approval unblocked (0..n). Mirror applyTemplate root-open —
      // idempotent createTask (dedup_key onConflictDoNothing), assignee NULL (PM assigns later).
      // (G7-4a) A candidate with deps approved may STILL carry an active lock from another source in
      // revision (LK5) — skip it; it opens when that source is re-approved. Sequential await (one tx
      // connection). In MVP this filter is belt-and-suspenders (the dep-guard already keeps such a
      // step closed) but it is the explicit BR-006 gate "open only when no active lock remains".
      const unblockedCandidateIds = computeNewlyUnblockedStepIds(
        { nodeKey: step.nodeKey, stepCode: step.stepCode },
        dagCtx,
      );
      // One query (no N+1): which candidates still carry an active lock from ANOTHER source in
      // revision (LK5)? Those are held back; they open when that source is re-approved.
      const lockedCandidateIds = await this.lockPropagation.findLockedStepIds(
        companyId,
        unblockedCandidateIds,
        tx,
      );
      const newlyOpenedStepIds: string[] = [];
      for (const candidateId of unblockedCandidateIds) {
        if (lockedCandidateIds.has(candidateId)) {
          // Deps satisfied but still locked → do NOT open. Log it so an unexpected stall (a step
          // that should have opened) is observable rather than silently skipped.
          this.logger.warn("approve fan-out: candidate still locked by another revision — not opening", {
            candidateId,
            approvedStepId: step.id,
            instanceId: instance.id,
          });
          continue;
        }
        newlyOpenedStepIds.push(candidateId);
      }
      for (const openStepId of newlyOpenedStepIds) {
        const openStep = instanceStepRows.find((s) => s.id === openStepId);
        if (!openStep) continue;
        const openDef = defStepRows.find((d) => d.nodeKey === (openStep.nodeKey ?? openStep.stepCode));
        const [openedTask] = await this.repo.createTask(
          companyId,
          {
            workflowStepId: openStepId,
            contentItemId: instance.contentItemId,
            title: openDef?.defaultTaskTitle ?? openStep.stepName,
            assigneeUserId: null,
            origin: "initial",
            revisionRound: 0,
          },
          tx,
        );
        // No-op = dedup collision (task already exists from a prior open). Mirror applyTemplate's
        // warn so a genuine under-open is observable instead of silently swallowed.
        if (!openedTask) {
          this.logger.warn("approve fan-out createTask no-op (dedup collision)", {
            openStepId,
            instanceId: instance.id,
          });
        }
      }

      // 7. Complete the instance iff every required step is approved (NOT by step_order — §1.3).
      const workflowComplete = isWorkflowComplete(dagCtx);
      if (workflowComplete) {
        await this.repo.completeWorkflowInstance(companyId, instance.id, tx);
        await this.audit.record(tx, {
          action: "WorkflowCompleted",
          objectType: "workflow_instance",
          objectId: instance.id,
          actorUserId: actorId,
          after: { status: "completed" },
        });
        await this.outbox.enqueue(tx, {
          eventType: "workflow.completed",
          payload: { instanceId: instance.id, lastStepId: step.id, approvedBy: actorId },
        });
      }

      // step.approved drives notifications whether or not the workflow completed.
      await this.outbox.enqueue(tx, {
        eventType: "step.approved",
        payload: {
          stepId: step.id,
          instanceId: instance.id,
          approvedBy: actorId,
          newlyOpenedStepIds,
        },
      });

      // 4c-i: evaluation hook. A step flagged requires_evaluation emits step.evaluation_required when
      // approved — IN THIS tx (transactional outbox: rollback ⇒ no ghost event). Match the approved
      // step's def-step by node_key (same linkage as the fan-out above). Consumer = G8 (not yet built);
      // the outbox worker treats a zero-consumer event as done (no dead-letter). G7 only emits + audits.
      const approvedDef = defStepRows.find(
        (d) => d.nodeKey === (step.nodeKey ?? step.stepCode),
      );
      if (!approvedDef) {
        // No def-step matched the just-approved step (node_key is nullable on legacy G4 rows, or a data
        // integrity anomaly). Unlike the cosmetic fan-out fallback (line ~236), silently dropping the
        // eval requirement loses a contractual side-effect → make it observable (mirror the locked-
        // candidate warn above) instead of swallowing it.
        this.logger.error("approve eval-hook: no def-step matched approved step — eval flag unverifiable", {
          stepId: step.id,
          nodeKey: step.nodeKey,
          stepCode: step.stepCode,
          instanceId: instance.id,
        });
      } else if (approvedDef.requiresEvaluation) {
        await this.outbox.enqueue(tx, {
          eventType: "step.evaluation_required",
          payload: {
            stepId: step.id,
            instanceId: instance.id,
            evaluationTemplateId: approvedDef.evaluationTemplateId,
            approvedBy: actorId,
          },
        });
        await this.audit.record(tx, {
          action: "StepEvaluationRequired",
          objectType: "workflow_step",
          objectId: step.id,
          actorUserId: actorId,
          after: { instanceId: instance.id, evaluationTemplateId: approvedDef.evaluationTemplateId },
        });
      }

      await this.audit.record(tx, {
        action: "StepApproved",
        objectType: "workflow_step",
        objectId: step.id,
        actorUserId: actorId,
        after: {
          status: "approved",
          approvalStepId: approvalStepRow?.id,
          isWorkflowComplete: workflowComplete,
          newlyOpenedStepIds,
        },
      });

      return { step: updatedStep, isWorkflowComplete: workflowComplete, isLastStep: workflowComplete };
    }).catch((err: unknown) => {
      if (
        err instanceof NotFoundException ||
        err instanceof ConflictException ||
        err instanceof InternalServerErrorException
      ) throw err;
      // Concurrent same-request approve loses the lock race → 23505 on approval_steps_request_level_uq
      // (tx already rolled back). Surface a clean 409 instead of a raw 500.
      if (isUniqueViolation(err)) {
        throw new ConflictException("Approval request has already been decided");
      }
      this.logger.error("approve unexpected error", { err, companyId, requestId });
      throw err;
    });
  }

  /**
   * POST /workflow/approval-requests/:id/request-revision — T4.
   * Side-effects (atomic):
   *   - Creates approval_steps record (decision=revision_requested)
   *   - Updates approval_request.status = revision_requested
   *   - Updates workflow_steps.status = revision
   *   - Updates task.status = revision (if exists)
   *   - Creates defect record
   *   - Creates new revision task (origin=revision, revisionRound+1)
   */
  async requestRevision(
    companyId: string,
    requestId: string,
    actorId: string,
    description: string,
    comment?: string,
  ) {
    const [request] = await this.repo.findApprovalRequestById(companyId, requestId);
    if (!request) throw new NotFoundException(`Approval request not found: ${requestId}`);

    if (request.status !== "pending") {
      return mapFsmError(new ApprovalRequestNotPendingError(request.status));
    }

    return this.db.withTenant(companyId, async (tx) => {
      const [step] = await this.repo.findStepByIdInTx(companyId, request.workflowStepId, tx);
      if (!step) throw new NotFoundException(`Step not found: ${request.workflowStepId}`);

      const [instance] = await this.repo.findInstanceByIdInTx(companyId, step.workflowInstanceId, tx);
      if (!instance) throw new NotFoundException(`Instance not found: ${step.workflowInstanceId}`);

      // 3c-iii race-safety (parity with approve()): serialize per-instance BEFORE any dep-state read.
      // requestRevision reads the DAG view + propagates revision locks below; without this FOR UPDATE
      // a concurrent approve()/requestRevision() on the same instance could interleave on stale state.
      await this.repo.lockInstanceForUpdateInTx(companyId, instance.id, tx);

      try {
        this.fsm.validateConsumerTransition({
          step: toFsmStep(step),
          instance: toFsmInstance(instance),
          event: "request_revision",
          actorId,
          reviewerUserId: step.reviewerUserId,
        });
      } catch (err) {
        return mapFsmError(err);
      }

      // 1. Create approval_steps record
      const [approvalStepRow] = await this.repo.createApprovalStep(
        companyId,
        {
          approvalRequestId: requestId,
          level: request.currentLevel,
          approverUserId: actorId,
          decision: "revision_requested",
          comment: comment ?? null,
        },
        tx,
      );

      // 2. Close approval request — guard the row count (parity with approve()): a 0-row update would
      // leave the request 'pending' while the step is set to revision (inconsistent state). Fail-closed.
      const [closedRequest] = await this.repo.closeApprovalRequest(
        companyId,
        requestId,
        { status: "revision_requested", comment: comment ?? null },
        tx,
      );
      if (!closedRequest) throw new InternalServerErrorException("Failed to close approval request");

      // 3. Mark step as revision
      const [updatedStep] = await this.repo.setStepToRevision(companyId, step.id, tx);
      if (!updatedStep) throw new InternalServerErrorException("Failed to set step to revision");

      // 3b. (G7-4a/BR-006) Lock every TRANSITIVE descendant of this step in the DAG — independent
      // branches untouched (LK2). Read the DAG view WITHIN this tx, sequential awaits (one pg
      // connection per tx). Released when this step is re-approved (approve() step 3b).
      const defStepRows = await this.repo.findDefinitionStepsInTx(
        companyId,
        instance.workflowDefinitionId,
        tx,
      );
      const depRows = await this.repo.findTemplateDependenciesInTx(
        companyId,
        instance.workflowDefinitionId,
        tx,
      );
      const instanceStepRows = await this.repo.findStepsByInstanceIdInTx(companyId, instance.id, tx);
      const dagCtx: DagContext = {
        defSteps: defStepRows.map((d) => ({ id: d.id, nodeKey: d.nodeKey, isRequired: d.isRequired })),
        deps: depRows.map((dep) => ({ fromStepId: dep.fromStepId, toStepId: dep.toStepId })),
        instanceSteps: instanceStepRows.map((s) => ({
          id: s.id,
          nodeKey: s.nodeKey,
          stepCode: s.stepCode,
          status: s.status,
        })),
      };
      await this.lockPropagation.propagateRevisionLock(
        companyId,
        { id: step.id, nodeKey: step.nodeKey, stepCode: step.stepCode },
        dagCtx,
        tx,
      );

      // 4. Update existing task status (read WITHIN the tx — F2: was a non-tx self-opened read that
      // escaped this transaction, a TOCTOU on nextRevisionRound. Use the tx variant approve() uses.)
      const [existingTask] = await this.repo.findActiveTaskByStepIdInTx(companyId, step.id, tx);
      const nextRevisionRound = existingTask ? existingTask.revisionRound + 1 : 1;
      if (existingTask) {
        await this.repo.updateTaskStatus(companyId, existingTask.id, "revision", tx);
      }

      // 5. Create defect record
      const [defect] = await this.repo.createDefect(
        companyId,
        {
          workflowStepId: step.id,
          responsibleUserId: step.assigneeUserId,
          causedByApprovalStepId: approvalStepRow?.id ?? null,
          description,
        },
        tx,
      );

      // 6. Create new revision task (dedup-safe via onConflictDoNothing)
      await this.repo.createTask(
        companyId,
        {
          workflowStepId: step.id,
          contentItemId: instance.contentItemId,
          title: `[Sửa lần ${nextRevisionRound}] ${step.stepName}`,
          assigneeUserId: step.assigneeUserId,
          origin: "revision",
          revisionRound: nextRevisionRound,
        },
        tx,
      );

      await this.audit.record(tx, {
        action: "StepRevisionRequested",
        objectType: "workflow_step",
        objectId: step.id,
        actorUserId: actorId,
        after: {
          status: "revision",
          defectId: defect?.id,
          description,
          approvalStepId: approvalStepRow?.id,
        },
      });

      await this.outbox.enqueue(tx, {
        eventType: "step.revision_requested",
        payload: {
          stepId: step.id,
          instanceId: instance.id,
          requestedBy: actorId,
          assigneeUserId: step.assigneeUserId,
          defectId: defect?.id,
        },
      });

      return { step: updatedStep, defect };
    }).catch((err: unknown) => {
      if (
        err instanceof NotFoundException ||
        err instanceof ConflictException ||
        err instanceof InternalServerErrorException
      ) throw err;
      // Same concurrent-decision race as approve(): map 23505 → 409 instead of a raw 500.
      if (isUniqueViolation(err)) {
        throw new ConflictException("Approval request has already been decided");
      }
      this.logger.error("requestRevision unexpected error", { err, companyId, requestId });
      throw err;
    });
  }
}
