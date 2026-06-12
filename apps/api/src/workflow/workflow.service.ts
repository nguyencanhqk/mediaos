import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import type { TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { WorkflowFsmService } from "./workflow-fsm.service";
import { WorkflowRepository } from "./workflow.repository";
import { LockPropagationService } from "./lock-propagation.service";
import { allDependenciesApproved } from "./workflow-dag";
import {
  ChecklistIncompleteError,
  DependenciesNotMetError,
  IllegalTransitionError,
  NotCurrentStepError,
  NotStepActorError,
  StepLockedError,
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
  if (err instanceof DependenciesNotMetError) {
    throw new ConflictException(err.message);
  }
  if (err instanceof StepLockedError) {
    throw new ConflictException(err.message);
  }
  if (err instanceof ChecklistIncompleteError) {
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
    private readonly locks: LockPropagationService,
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
            // G7-3c: carry node_key so DAG dep resolution keys uniformly across MVP-0 + applied
            // instances (def-step.node_key is NOT NULL; for video_standard_v0 it equals code).
            nodeKey: s.nodeKey,
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
   * POST /workflow-templates/:id/apply — áp 1 template PUBLISHED lên đúng-một target (content_item XOR
   * project). Snapshot steps (node_key, assignee NULL — PM gán sau), pin definition_version, mở bước ROOT
   * (không dep upstream) bằng auto-task idempotent. Bước non-root mở khi dep approved (3c).
   * Deny: template draft/archived (FS8a); target đã có active instance (FS8b, uq→409); sai appliesTo (FS8c).
   */
  async applyTemplate(
    companyId: string,
    actorId: string,
    templateId: string,
    target: { contentItemId?: string | null; projectId?: string | null },
  ) {
    // Effective target — null-hoá phía không khớp appliesTo để ÉP đúng-một (khớp DB CHECK, chống 500).
    let contentItemId: string | null = null;
    let projectId: string | null = null;
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const [template] = await this.repo.findPublishedTemplateInTx(companyId, templateId, tx);
        if (!template) {
          // Không tồn tại / draft / archived / đã xoá → fail-closed (chỉ published mới apply — D4).
          throw new NotFoundException(`Published workflow template not found: ${templateId}`);
        }

        // Validate target khớp appliesTo + tồn tại trong tenant; chỉ giữ target khớp.
        if (template.appliesTo === "content_item") {
          if (!target.contentItemId) {
            throw new BadRequestException("This template applies to a content_item — provide contentItemId");
          }
          const [ci] = await this.repo.findContentItemById(companyId, target.contentItemId, tx);
          if (!ci) throw new NotFoundException(`Content item not found: ${target.contentItemId}`);
          contentItemId = target.contentItemId;
        } else if (template.appliesTo === "project") {
          if (!target.projectId) {
            throw new BadRequestException("This template applies to a project — provide projectId");
          }
          const [prj] = await this.repo.findProjectByIdInTx(companyId, target.projectId, tx);
          if (!prj) throw new NotFoundException(`Project not found: ${target.projectId}`);
          projectId = target.projectId;
        } else {
          throw new BadRequestException(`Unsupported template appliesTo: '${template.appliesTo}'`);
        }

        const defSteps = await this.repo.findDefinitionStepsInTx(companyId, templateId, tx);
        if (defSteps.length === 0) {
          throw new BadRequestException("Cannot apply a template with no steps");
        }

        // Bước ROOT = không là `to_step_id` của bất kỳ cạnh nào (không có dep upstream).
        const deps = await this.repo.findTemplateDependenciesInTx(companyId, templateId, tx);
        const toStepIds = new Set(deps.map((d) => d.toStepId));
        const rootNodeKeys = new Set(
          defSteps.filter((s) => !toStepIds.has(s.id)).map((s) => s.nodeKey),
        );

        const [instance] = await this.repo.createInstanceForTemplate(
          companyId,
          {
            workflowDefinitionId: templateId,
            contentItemId,
            projectId,
            definitionVersion: template.version,
            createdBy: actorId,
          },
          tx,
        );
        if (!instance) throw new InternalServerErrorException("Failed to create workflow instance");

        // Snapshot mọi step (assignee NULL — PM gán sau qua assignStep). node_key giữ để tra deps theo version.
        const createdSteps = await this.repo.createSteps(
          companyId,
          instance.id,
          defSteps.map((s) => ({
            stepOrder: s.stepOrder,
            stepCode: s.code,
            stepName: s.name,
            nodeKey: s.nodeKey,
            assigneeUserId: null,
            reviewerUserId: null,
          })),
          tx,
        );
        // Partial insert (Drizzle returning() thiếu hàng) → lỗi to, KHÔNG để instance nửa vời.
        if (createdSteps.length !== defSteps.length) {
          throw new InternalServerErrorException(
            `applyTemplate: snapshot mismatch (${createdSteps.length}/${defSteps.length} steps)`,
          );
        }

        // Mở bước ROOT: auto-task (dedup_key idempotent). Non-root chờ dep approved (3c).
        // step.nodeKey nullable trên workflow_steps, nhưng snapshot copy từ def-step NOT NULL → luôn có giá trị;
        // bỏ qua null an toàn (không node_key thật nào là "" hay null). contentItemId null cho project-target
        // là CỐ Ý (tasks chưa có project FK — tra task project qua workflow_step_id; residual 3c, plan §10).
        let rootTasksSpawned = 0;
        for (const step of createdSteps) {
          const nodeKey = step.nodeKey;
          if (!nodeKey || !rootNodeKeys.has(nodeKey)) continue;
          const defStep = defSteps.find((d) => d.nodeKey === nodeKey);
          const [task] = await this.repo.createTask(
            companyId,
            {
              workflowStepId: step.id,
              contentItemId,
              title: defStep?.defaultTaskTitle ?? step.stepName,
              assigneeUserId: null,
              origin: "initial",
              revisionRound: 0,
            },
            tx,
          );
          if (task) rootTasksSpawned++;
          else this.logger.warn("applyTemplate createTask no-op (dedup collision)", { stepId: step.id, instanceId: instance.id });
        }
        // Published template LUÔN có ≥1 root (DagValidator chặn NO_ROOT/cycle ở publish). 0 task mở = instance
        // kẹt vĩnh viễn → fail to thay vì âm thầm. Rollback toàn bộ tx.
        if (rootNodeKeys.size > 0 && rootTasksSpawned === 0) {
          throw new InternalServerErrorException("applyTemplate: no root task opened — workflow would stall");
        }

        await this.audit.record(tx, {
          action: "WorkflowApplied",
          objectType: "workflow_instance",
          objectId: instance.id,
          actorUserId: actorId,
          after: {
            templateId,
            definitionVersion: template.version,
            contentItemId,
            projectId,
            rootSteps: [...rootNodeKeys],
          },
        });

        await this.outbox.enqueue(tx, {
          eventType: "workflow.started",
          payload: { instanceId: instance.id, templateId, contentItemId, projectId, createdBy: actorId },
        });

        return { instance, steps: createdSteps };
      });
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException ||
        err instanceof ConflictException ||
        err instanceof InternalServerErrorException
      ) {
        throw err;
      }
      if (isUniqueViolation(err)) {
        throw new ConflictException("This target already has an active workflow");
      }
      this.logger.error("applyTemplate unexpected error", { err, companyId, templateId });
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
   * GET /workflow/by-content/:contentItemId — workflow của 1 content item (hoặc null nếu chưa start).
   * FE content-detail chỉ biết contentId nên cần lookup này để hiển thị board / nút "Bắt đầu".
   */
  async getWorkflowByContent(companyId: string, contentItemId: string) {
    const [instance] = await this.repo.findInstanceByContentItemId(companyId, contentItemId);
    if (!instance) return null;

    const steps = await this.repo.findStepsByInstanceId(companyId, instance.id);
    return { instance, steps };
  }

  /**
   * POST /workflow/steps/:stepId/assign — PM gán assignee + reviewer cho 1 bước.
   * Đồng bộ assignee sang task của bước (để task hiện trong "Công việc của tôi").
   * Guard quyền ở controller (@RequirePermission update content); không phải FSM transition.
   */
  async assignStep(
    companyId: string,
    stepId: string,
    actorId: string,
    data: { assigneeUserId: string | null; reviewerUserId: string | null },
  ) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const [step] = await this.repo.findStepByIdInTx(companyId, stepId, tx);
        if (!step) throw new NotFoundException(`Step not found: ${stepId}`);

        const [instance] = await this.repo.findInstanceByIdInTx(companyId, step.workflowInstanceId, tx);
        if (!instance) throw new WorkflowNotFoundError("instance", step.workflowInstanceId);
        if (instance.status !== "active") {
          throw new ConflictException(`Workflow is not active (status=${instance.status})`);
        }

        const [updated] = await this.repo.assignStep(companyId, stepId, data, tx);
        if (!updated) throw new InternalServerErrorException(`Failed to assign step ${stepId}`);

        // Đồng bộ assignee sang task hiện hành của bước (nếu có).
        const [task] = await this.repo.findActiveTaskByStepIdInTx(companyId, stepId, tx);
        if (task) {
          await this.repo.updateTaskAssignee(companyId, task.id, data.assigneeUserId, tx);
        }

        await this.audit.record(tx, {
          action: "StepAssigned",
          objectType: "workflow_step",
          objectId: stepId,
          actorUserId: actorId,
          after: {
            assigneeUserId: data.assigneeUserId,
            reviewerUserId: data.reviewerUserId,
            stepOrder: step.stepOrder,
          },
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
      this.logger.error("assignStep unexpected error", { err, companyId, stepId, actorId });
      throw err;
    }
  }

  /**
   * G7-3c: resolve "are ALL upstream DAG deps of `step` approved?" within the caller's tx.
   * Reads def-steps + deps (by the instance's pinned workflow_definition_id) + sibling instance
   * steps — all tx-scoped (never self-opening withTenant) so they sit inside any row lock.
   */
  private async resolveDependenciesApproved(
    companyId: string,
    step: { nodeKey: string | null; stepCode: string; workflowInstanceId: string },
    instance: { workflowDefinitionId: string },
    tx: TenantTx,
  ): Promise<boolean> {
    // Sequential awaits, NOT Promise.all — node-postgres cannot run concurrent queries on one tx
    // connection (Promise.all triggers a pg deprecation warning and breaks on pg@9). Staying on
    // the caller's tx keeps these ready for the per-instance FOR UPDATE lock added in 3c-iii.
    const defSteps = await this.repo.findDefinitionStepsInTx(companyId, instance.workflowDefinitionId, tx);
    const deps = await this.repo.findTemplateDependenciesInTx(companyId, instance.workflowDefinitionId, tx);
    const instanceSteps = await this.repo.findStepsByInstanceIdInTx(companyId, step.workflowInstanceId, tx);
    return allDependenciesApproved(
      { nodeKey: step.nodeKey, stepCode: step.stepCode },
      {
        defSteps: defSteps.map((d) => ({ id: d.id, nodeKey: d.nodeKey, isRequired: d.isRequired })),
        deps: deps.map((dep) => ({ fromStepId: dep.fromStepId, toStepId: dep.toStepId })),
        instanceSteps: instanceSteps.map((s) => ({
          id: s.id,
          nodeKey: s.nodeKey,
          stepCode: s.stepCode,
          status: s.status,
        })),
      },
    );
  }

  /**
   * G7-4b: resolve "are ALL REQUIRED checklist items of `step` checked?" within the caller's tx.
   * Linkage = ĐƯỜNG A (QUYẾT ĐỊNH #1): step.nodeKey → def-step (by instance.workflowDefinitionId +
   * node_key) → checklists → required items, minus the ticked rows in workflow_step_checklist_states.
   * A step with no node_key or no required items is complete (never over-gated). One NOT EXISTS query.
   */
  private async resolveChecklistComplete(
    companyId: string,
    step: { id: string; nodeKey: string | null },
    instance: { workflowDefinitionId: string },
    tx: TenantTx,
  ): Promise<boolean> {
    // No node_key (legacy / un-snapshotted step) → no def-step resolvable → no checklist exists → not
    // gated (vacuously complete). Log so this rare path is visible if a future spawn skips the snapshot.
    if (!step.nodeKey) {
      this.logger.debug(`resolveChecklistComplete: step ${step.id} has no node_key — checklist gate skipped`);
      return true;
    }
    const [row] = await this.repo.countUnmetRequiredChecklistItemsForStepInTx(
      companyId,
      { workflowDefinitionId: instance.workflowDefinitionId, nodeKey: step.nodeKey, stepId: step.id },
      tx,
    );
    // count(*) ALWAYS returns one row; a missing row signals a query/driver fault → fail CLOSED
    // (block submit) rather than silently allowing it (`?? 0` would have been a fail-open gate bypass).
    if (!row) {
      throw new InternalServerErrorException(
        `Checklist completeness query returned no row for step ${step.id}`,
      );
    }
    return row.count === 0;
  }

  /**
   * POST /workflow/steps/:stepId/start — assignee starts a step (T1 or T5).
   * Guard: actor = assignee, ALL upstream deps approved (G7-3c), instance active.
   */
  async startStep(companyId: string, stepId: string, actorId: string) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const [step] = await this.repo.findStepByIdInTx(companyId, stepId, tx);
        if (!step) throw new NotFoundException(`Step not found: ${stepId}`);

        const [instance] = await this.repo.findInstanceByIdInTx(companyId, step.workflowInstanceId, tx);
        if (!instance) throw new WorkflowNotFoundError("instance", step.workflowInstanceId);

        // Sequential awaits (one pg connection per tx): resolve deps, then the revision lock.
        const dependenciesApproved = await this.resolveDependenciesApproved(
          companyId,
          step,
          instance,
          tx,
        );
        const stepLocked = await this.locks.isStepLocked(companyId, stepId, tx);
        try {
          this.fsm.validateServiceTransition({
            step: toFsmStep(step),
            instance: toFsmInstance(instance),
            event: "start",
            actorId,
            dependenciesApproved,
            stepLocked,
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
        // FOR UPDATE on the step row: serialize submit against a concurrent un-tick of the same step
        // so the checklist gate-check and the status write are atomic (G7-4b race-safety).
        const [step] = await this.repo.findStepByIdForUpdateInTx(companyId, stepId, tx);
        if (!step) throw new NotFoundException(`Step not found: ${stepId}`);

        const [instance] = await this.repo.findInstanceByIdInTx(companyId, step.workflowInstanceId, tx);
        if (!instance) throw new WorkflowNotFoundError("instance", step.workflowInstanceId);

        // Sequential awaits (one pg connection per tx): resolve deps, the revision lock, then the
        // required-checklist completion (G7-4b submit gate).
        const dependenciesApproved = await this.resolveDependenciesApproved(
          companyId,
          step,
          instance,
          tx,
        );
        const stepLocked = await this.locks.isStepLocked(companyId, stepId, tx);
        const checklistComplete = await this.resolveChecklistComplete(companyId, step, instance, tx);
        try {
          this.fsm.validateServiceTransition({
            step: toFsmStep(step),
            instance: toFsmInstance(instance),
            event: "submit",
            actorId,
            dependenciesApproved,
            stepLocked,
            checklistComplete,
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

  /**
   * POST /workflow/steps/:stepId/checklist-items/:itemId — assignee ticks a checklist item (G7-4b).
   * Idempotent (uq step+item, onConflictDoNothing). Scope: item must belong to a checklist of this
   * step's def-step (anti tick-stray-item); DECISION #2(A) only the step assignee may tick.
   * Audit only on a real state change (replayed tick = no-op, no audit spam).
   */
  async checkItem(companyId: string, stepId: string, itemId: string, actorId: string) {
    return this.toggleChecklistItem(companyId, stepId, itemId, actorId, true);
  }

  /**
   * DELETE /workflow/steps/:stepId/checklist-items/:itemId — assignee un-ticks an item (G7-4b).
   * Un-tick = DELETE the state row (intentional per schema — operational state, not audit-data).
   * Idempotent (deleting an absent row is a no-op). Same scope/actor guards as checkItem.
   */
  async uncheckItem(companyId: string, stepId: string, itemId: string, actorId: string) {
    return this.toggleChecklistItem(companyId, stepId, itemId, actorId, false);
  }

  /**
   * GET /workflow/steps/:stepId/checklist — the step's checklist items + current tick state, for the
   * FE to render the checklist and mirror the submit gate. Company-scoped read (like getWorkflow); no
   * assignee gate so a reviewer can see progress too. A step with no node_key / no def-step checklist
   * returns an empty list (submit is then never gated). Same ĐƯỜNG A linkage as resolveChecklistComplete.
   */
  async getStepChecklist(companyId: string, stepId: string) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const [step] = await this.repo.findStepByIdInTx(companyId, stepId, tx);
        if (!step) throw new NotFoundException(`Step not found: ${stepId}`);
        // No node_key → no resolvable def-step checklist (legacy/un-snapshotted) → empty (not gated).
        if (!step.nodeKey) return { stepId, items: [] };

        const [instance] = await this.repo.findInstanceByIdInTx(companyId, step.workflowInstanceId, tx);
        if (!instance) throw new WorkflowNotFoundError("instance", step.workflowInstanceId);

        const items = await this.repo.findChecklistItemsForStepInTx(
          companyId,
          { workflowDefinitionId: instance.workflowDefinitionId, nodeKey: step.nodeKey, stepId },
          tx,
        );
        return {
          stepId,
          items: items.map((i) => ({
            id: i.id,
            label: i.label,
            isRequired: i.isRequired,
            checked: i.checked,
          })),
        };
      });
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof InternalServerErrorException) {
        throw err;
      }
      if (err instanceof WorkflowNotFoundError) {
        throw new NotFoundException(err.message);
      }
      this.logger.error("getStepChecklist unexpected error", { err, companyId, stepId });
      throw err;
    }
  }

  private async toggleChecklistItem(
    companyId: string,
    stepId: string,
    itemId: string,
    actorId: string,
    checked: boolean,
  ) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        // FOR UPDATE on the step row: serialize tick/untick against a concurrent submit of the same
        // step so the gate-check (in submit) cannot race a state change (G7-4b race-safety, pairs with submit).
        const [step] = await this.repo.findStepByIdForUpdateInTx(companyId, stepId, tx);
        if (!step) throw new NotFoundException(`Step not found: ${stepId}`);

        const [instance] = await this.repo.findInstanceByIdInTx(companyId, step.workflowInstanceId, tx);
        if (!instance) throw new WorkflowNotFoundError("instance", step.workflowInstanceId);
        if (instance.status !== "active") {
          throw new ConflictException(`Workflow is not active (status=${instance.status})`);
        }

        // DECISION #2(A): only the step assignee may modify its checklist (consistent with submit).
        if (!step.assigneeUserId || step.assigneeUserId !== actorId) {
          throw new ForbiddenException("Only the step assignee can modify this checklist");
        }

        // Cross-item guard: the item must belong to a checklist of this step's def-step (node_key).
        if (!step.nodeKey) throw new NotFoundException(`Checklist item not found for step: ${itemId}`);
        const [item] = await this.repo.findChecklistItemForStepInTx(
          companyId,
          { workflowDefinitionId: instance.workflowDefinitionId, nodeKey: step.nodeKey, itemId },
          tx,
        );
        if (!item) throw new NotFoundException(`Checklist item not found for step: ${itemId}`);

        const changed = checked
          ? (
              await this.repo.insertChecklistStateInTx(
                companyId,
                { workflowStepId: stepId, checklistItemId: itemId, checkedBy: actorId },
                tx,
              )
            ).length > 0
          : (await this.repo.deleteChecklistStateInTx(companyId, stepId, itemId, tx)).length > 0;

        // Audit only when a row actually changed — replayed tick/untick is a true no-op.
        if (changed) {
          await this.audit.record(tx, {
            action: checked ? "ChecklistItemChecked" : "ChecklistItemUnchecked",
            objectType: "workflow_step",
            objectId: stepId,
            actorUserId: actorId,
            ...(checked
              ? { after: { checklistItemId: itemId } }
              : { before: { checklistItemId: itemId } }),
          });
        }

        // `changed` lets the caller distinguish a real state change from an idempotent no-op replay.
        return { stepId, checklistItemId: itemId, checked, changed };
      });
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof ConflictException ||
        err instanceof ForbiddenException ||
        err instanceof InternalServerErrorException
      ) {
        throw err;
      }
      if (err instanceof WorkflowNotFoundError) {
        throw new NotFoundException(err.message);
      }
      this.logger.error("toggleChecklistItem unexpected error", {
        err,
        companyId,
        stepId,
        itemId,
        actorId,
        checked,
      });
      throw err;
    }
  }
}
