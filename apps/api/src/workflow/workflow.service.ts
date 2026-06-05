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
  IllegalTransitionError,
  NotCurrentStepError,
  NotStepActorError,
  WorkflowInactiveError,
  WorkflowNotFoundError,
  type InstanceStatus,
  type StepStatus,
} from "./workflow.types";
import type { FsmInstanceInput, FsmStepInput } from "./workflow-fsm.service";

const MVP0_WORKFLOW_CODE = "video_standard_v0";
const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as Record<string, unknown>)["code"] === PG_UNIQUE_VIOLATION
  );
}

// Drizzle infers text columns as `string`; cast to narrower FSM types at the boundary.
// stepStatusSchema.parse() would be safer but adds a dependency on contracts inside api —
// the cast is safe because status values are written only by this service or the migration.
function toFsmStep(row: {
  id: string;
  workflowInstanceId: string;
  stepOrder: number;
  status: string;
  assigneeUserId: string | null;
}): FsmStepInput {
  return { ...row, status: row.status as StepStatus };
}

function toFsmInstance(row: {
  id: string;
  currentStepOrder: number;
  status: string;
}): FsmInstanceInput {
  return { ...row, status: row.status as InstanceStatus };
}

/** Maps typed FSM / domain errors to NestJS HTTP exceptions. Marked `never` so callers can `return mapFsmError(err)`. */
function mapFsmError(err: unknown): never {
  if (err instanceof WorkflowInactiveError) {
    throw new ConflictException(`Workflow is not active (status=${err.instanceStatus})`);
  }
  if (err instanceof IllegalTransitionError) {
    throw new ConflictException(
      `Illegal transition: step is '${err.fromState}', cannot apply event '${err.event}'`,
    );
  }
  if (err instanceof NotCurrentStepError) {
    throw new ConflictException(err.message);
  }
  if (err instanceof NotStepActorError) {
    throw new ConflictException("Not authorized to act on this step");
  }
  if (err instanceof WorkflowNotFoundError) {
    throw new NotFoundException(err.message);
  }
  throw err;
}

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WorkflowRepository,
    private readonly fsm: WorkflowFsmService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * POST /workflow/start — tạo workflow instance + 4 steps + task cho bước 1.
   * Guard: content item tồn tại; chưa có active workflow.
   * Idempotency: UNIQUE constraint (content_item_id) WHERE status='active' chặn duplicate.
   */
  async startWorkflow(
    companyId: string,
    contentItemId: string,
    createdBy: string,
  ) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        // Validate content item exists in this tenant
        const [contentItem] = await this.repo.findContentItemById(companyId, contentItemId, tx);
        if (!contentItem) {
          throw new NotFoundException(`Content item not found: ${contentItemId}`);
        }

        // Find MVP-0 workflow definition (must be seeded per company)
        const [definition] = await this.repo.findActiveDefinitionInTx(companyId, MVP0_WORKFLOW_CODE, tx);
        if (!definition) {
          throw new InternalServerErrorException(
            `Workflow definition '${MVP0_WORKFLOW_CODE}' not found. Run scripts/seed-workflow-definition.sql first.`,
          );
        }

        // Load definition steps (same transaction)
        const defSteps = await this.repo.findDefinitionStepsInTx(companyId, definition.id, tx);
        if (defSteps.length === 0) {
          throw new InternalServerErrorException("Workflow definition has no steps");
        }

        // Create instance
        const [instance] = await this.repo.createInstance(
          companyId,
          { workflowDefinitionId: definition.id, contentItemId, createdBy },
          tx,
        );
        if (!instance) throw new InternalServerErrorException("Failed to create workflow instance");

        // Create all 4 steps (status=not_started; assignee set later by PM via G4-5)
        const createdSteps = await this.repo.createSteps(
          companyId,
          instance.id,
          defSteps.map((s) => ({
            stepOrder: s.stepOrder,
            stepCode: s.code,
            stepName: s.name,
            assigneeUserId: null,
            reviewerUserId: null,
          })),
          tx,
        );

        const step1 = createdSteps.find((s) => s.stepOrder === 1);
        if (!step1) throw new InternalServerErrorException("Step 1 not created");

        // Create initial task for step 1 (idempotent via dedup_key)
        const defStep1 = defSteps.find((s) => s.stepOrder === 1);
        const [task] = await this.repo.createTask(
          companyId,
          {
            workflowStepId: step1.id,
            contentItemId,
            title: defStep1?.defaultTaskTitle ?? "Bước 1",
            assigneeUserId: null,
            origin: "initial",
            revisionRound: 0,
          },
          tx,
        );
        if (!task) {
          this.logger.warn(`createTask no-op (dedup collision) for step ${step1.id} — task already exists`);
        }

        // Audit: WorkflowStarted
        await this.audit.record(tx, {
          action: "WorkflowStarted",
          objectType: "workflow_instance",
          objectId: instance.id,
          actorUserId: createdBy,
          after: { contentItemId, definitionCode: MVP0_WORKFLOW_CODE },
        });

        // Outbox: workflow.started (idempotent consumer for notifications)
        await this.outbox.enqueue(tx, {
          eventType: "workflow.started",
          payload: { instanceId: instance.id, contentItemId, createdBy },
        });

        return { instance, steps: createdSteps };
      });
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof InternalServerErrorException) {
        throw err;
      }
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `Content item ${contentItemId} already has an active workflow`,
        );
      }
      this.logger.error("startWorkflow unexpected error", { err, companyId, contentItemId });
      throw err;
    }
  }

  /**
   * GET /workflow/:instanceId — trả full instance + steps.
   */
  async getWorkflow(companyId: string, instanceId: string) {
    const [instance] = await this.repo.findInstanceById(companyId, instanceId);
    if (!instance) throw new NotFoundException(`Workflow instance not found: ${instanceId}`);

    const steps = await this.repo.findStepsByInstanceId(companyId, instanceId);
    return { instance, steps };
  }

  /**
   * POST /workflow/steps/:stepId/start — assignee starts a step (T1 or T5).
   * Guard: actor = assignee, step = current_step_order, instance active.
   */
  async startStep(companyId: string, stepId: string, actorId: string) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const [step] = await this.repo.findStepByIdInTx(companyId, stepId, tx);
        if (!step) throw new NotFoundException(`Step not found: ${stepId}`);

        const [instance] = await this.repo.findInstanceByIdInTx(companyId, step.workflowInstanceId, tx);
        if (!instance) throw new WorkflowNotFoundError("instance", step.workflowInstanceId);

        try {
          this.fsm.validateServiceTransition({
            step: toFsmStep(step),
            instance: toFsmInstance(instance),
            event: "start",
            actorId,
          });
        } catch (err) {
          return mapFsmError(err);
        }

        const [updated] = await this.repo.startStep(companyId, stepId, tx);
        if (!updated) throw new InternalServerErrorException(`Failed to update step ${stepId}`);

        await this.audit.record(tx, {
          action: "StepStarted",
          objectType: "workflow_step",
          objectId: stepId,
          actorUserId: actorId,
          after: { status: "in_progress", stepOrder: step.stepOrder },
        });

        return updated;
      });
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof ConflictException ||
        err instanceof InternalServerErrorException
      ) {
        throw err;
      }
      if (err instanceof WorkflowNotFoundError) {
        throw new NotFoundException(err.message);
      }
      this.logger.error("startStep unexpected error", { err, companyId, stepId, actorId });
      throw err;
    }
  }

  /**
   * POST /workflow/steps/:stepId/submit — assignee submits work (T2).
   * Side-effects: step → waiting_review, create approval_request, emit ApprovalRequested.
   */
  async submitStep(
    companyId: string,
    stepId: string,
    actorId: string,
    submission: { submissionUrl?: string | null; submissionNote?: string | null } = {},
  ) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const [step] = await this.repo.findStepByIdInTx(companyId, stepId, tx);
        if (!step) throw new NotFoundException(`Step not found: ${stepId}`);

        const [instance] = await this.repo.findInstanceByIdInTx(companyId, step.workflowInstanceId, tx);
        if (!instance) throw new WorkflowNotFoundError("instance", step.workflowInstanceId);

        try {
          this.fsm.validateServiceTransition({
            step: toFsmStep(step),
            instance: toFsmInstance(instance),
            event: "submit",
            actorId,
          });
        } catch (err) {
          return mapFsmError(err);
        }

        // Update step status → waiting_review, store submission URL/note
        const [updated] = await this.repo.submitStep(companyId, stepId, submission, tx);
        if (!updated) throw new InternalServerErrorException(`Failed to update step ${stepId}`);

        // Create approval request (reviewer assigned later by PM via G4-5)
        const [approvalReq] = await this.repo.createApprovalRequest(
          companyId,
          { workflowStepId: stepId, requestedBy: actorId, assigneeId: step.reviewerUserId },
          tx,
        );
        if (!approvalReq) {
          // UNIQUE index approval_reqs_step_pending_uq prevents duplicate — means already pending
          throw new ConflictException("An approval request for this step is already pending");
        }

        await this.audit.record(tx, {
          action: "StepSubmitted",
          objectType: "workflow_step",
          objectId: stepId,
          actorUserId: actorId,
          after: { status: "waiting_review", approvalRequestId: approvalReq.id },
        });

        await this.outbox.enqueue(tx, {
          eventType: "approval.requested",
          payload: {
            approvalRequestId: approvalReq.id,
            workflowStepId: stepId,
            instanceId: instance.id,
            requestedBy: actorId,
          },
        });

        return { step: updated, approvalRequest: approvalReq };
      });
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof ConflictException ||
        err instanceof InternalServerErrorException
      ) {
        throw err;
      }
      if (err instanceof WorkflowNotFoundError) {
        throw new NotFoundException(err.message);
      }
      this.logger.error("submitStep unexpected error", { err, companyId, stepId, actorId });
      throw err;
    }
  }
}
