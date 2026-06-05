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
   *   - If last step → complete workflow instance
   *   - Else → advance currentStepOrder (open_next)
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

      // 4. Update task status if exists
      const [task] = await this.repo.findTaskByStepId(companyId, step.id);
      if (task) {
        await this.repo.updateTaskStatus(companyId, task.id, "approved", tx);
      }

      // 5. Determine if last step
      const maxStepOrder = await this.repo.findMaxStepOrder(companyId, instance.id);
      const isLastStep = step.stepOrder >= maxStepOrder;

      if (isLastStep) {
        // T7: complete workflow
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
      } else {
        // T6: open next step (advance pointer)
        const nextOrder = step.stepOrder + 1;
        await this.repo.advanceInstanceStepOrder(companyId, instance.id, nextOrder, tx);
        await this.outbox.enqueue(tx, {
          eventType: "step.approved",
          payload: {
            stepId: step.id,
            instanceId: instance.id,
            nextStepOrder: nextOrder,
            approvedBy: actorId,
          },
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
          isLastStep,
        },
      });

      return { step: updatedStep, isLastStep };
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
