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

      // 2. Close approval request
      await this.repo.closeApprovalRequest(
        companyId,
        requestId,
        { status: "approved", comment: comment ?? null },
        tx,
      );

      // 3. Mark step approved
      const [updatedStep] = await this.repo.approveStep(companyId, step.id, tx);
      if (!updatedStep) throw new InternalServerErrorException("Failed to approve step");

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
      const newlyOpenedStepIds = computeNewlyUnblockedStepIds(
        { nodeKey: step.nodeKey, stepCode: step.stepCode },
        dagCtx,
      );
      for (const openStepId of newlyOpenedStepIds) {
        const openStep = instanceStepRows.find((s) => s.id === openStepId);
        if (!openStep) continue;
        const openDef = defStepRows.find((d) => d.nodeKey === (openStep.nodeKey ?? openStep.stepCode));
        await this.repo.createTask(
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

      // 2. Close approval request
      await this.repo.closeApprovalRequest(
        companyId,
        requestId,
        { status: "revision_requested", comment: comment ?? null },
        tx,
      );

      // 3. Mark step as revision
      const [updatedStep] = await this.repo.setStepToRevision(companyId, step.id, tx);
      if (!updatedStep) throw new InternalServerErrorException("Failed to set step to revision");

      // 4. Update existing task status
      const [existingTask] = await this.repo.findTaskByStepId(companyId, step.id);
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
      this.logger.error("requestRevision unexpected error", { err, companyId, requestId });
      throw err;
    });
  }
}
