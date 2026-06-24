import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  CreateDependencyRequest,
  CreateTemplateRequest,
  CreateTemplateStepRequest,
  UpdateTemplateRequest,
  UpdateTemplateStepRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import type { TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import {
  WorkflowTemplatesRepository,
  type StepUpdateFields,
} from "./workflow-templates.repository";
import { DagValidatorService } from "./dag-validator.service";
import { buildDagInput, toDagValidationResultDto } from "./dag-result.adapter";
import {
  TemplateDagInvalidError,
  TemplateNotFoundError,
  TemplatePublishedImmutableError,
} from "./workflow-templates.types";
import {
  isUniqueViolation,
  isForeignKeyViolation,
  pgErrorCode,
  pgErrorField,
  PG_UNIQUE_VIOLATION,
} from "../common/db-error";

// Partial-unique index (company_id, code, version) WHERE deleted_at IS NULL — định nghĩa ở schema/0032.
const TEMPLATE_CODE_VERSION_UQ = "workflow_defs_company_code_version_active_uq";

/** True CHỈ khi 23505 đến từ ĐÚNG unique index (code,version) — tránh nuốt nhầm constraint khác. */
function isTemplateCodeConflict(err: unknown): boolean {
  return uniqueConstraintName(err) === TEMPLATE_CODE_VERSION_UQ;
}

// Unique index names cho step (schema/0032) — scope 23505 để báo lỗi đúng nguyên nhân.
const STEP_NODE_KEY_UQ = "wf_def_steps_def_node_key_uq";
const STEP_ORDER_UQ = "wf_def_steps_def_order_uq";
const DEP_EDGE_UQ = "wf_step_deps_edge_uq";

/** Trả tên unique-constraint nếu err là 23505, ngược lại null. */
function uniqueConstraintName(err: unknown): string | null {
  if (pgErrorCode(err) !== PG_UNIQUE_VIOLATION) return null;
  const constraint = pgErrorField(err, "constraint");
  return constraint ?? null;
}

/** Chỉ lấy field được gửi (Zod partial); null hợp lệ (clear cột nullable). nodeKey BẤT BIẾN — không có ở đây. */
function buildStepUpdate(dto: UpdateTemplateStepRequest): StepUpdateFields {
  const f: StepUpdateFields = {};
  if (dto.code !== undefined) f.code = dto.code;
  if (dto.name !== undefined) f.name = dto.name;
  if (dto.defaultTaskTitle !== undefined) f.defaultTaskTitle = dto.defaultTaskTitle;
  if (dto.stepType !== undefined) f.stepType = dto.stepType;
  if (dto.assigneeRoleCode !== undefined) f.assigneeRoleCode = dto.assigneeRoleCode;
  if (dto.reviewerRoleCode !== undefined) f.reviewerRoleCode = dto.reviewerRoleCode;
  if (dto.isRequired !== undefined) f.isRequired = dto.isRequired;
  if (dto.stepOrder !== undefined) f.stepOrder = dto.stepOrder;
  if (dto.positionX !== undefined) f.positionX = dto.positionX;
  if (dto.positionY !== undefined) f.positionY = dto.positionY;
  return f;
}

/**
 * WorkflowTemplatesService (G7-1c) — CRUD aggregate template (DRAFT).
 * Tách khỏi WorkflowService (runtime instance) theo §3.3 handoff G6.
 *
 * Bất biến:
 *   - BẤT BIẾN #1: mọi mutation trong db.withTenant(companyId) (RLS).
 *   - Audit-in-tx: audit.record(tx, …) CÙNG transaction với mutation (objectType 'workflow_template').
 *   - D4: chỉ template 'draft' sửa/soft-delete được; 'published'/'archived' BẤT BIẾN (clone = 2b).
 *   - Không hard-delete template (soft-delete deleted_at).
 */
@Injectable()
export class WorkflowTemplatesService {
  private readonly logger = new Logger(WorkflowTemplatesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WorkflowTemplatesRepository,
    private readonly audit: AuditService,
    private readonly dagValidator: DagValidatorService,
  ) {}

  /** POST /workflow-templates — tạo template draft (version 1). */
  async createTemplate(companyId: string, actorId: string, dto: CreateTemplateRequest) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const [created] = await this.repo.createTemplate(
          companyId,
          { code: dto.code, name: dto.name, appliesTo: dto.appliesTo, createdBy: actorId },
          tx,
        );
        if (!created) throw new InternalServerErrorException("Failed to create workflow template");

        await this.audit.record(tx, {
          action: "WorkflowTemplateCreated",
          objectType: "workflow_template",
          objectId: created.id,
          actorUserId: actorId,
          after: {
            code: created.code,
            name: created.name,
            version: created.version,
            status: created.status,
          },
        });

        return created;
      });
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err;
      if (isTemplateCodeConflict(err)) {
        throw new ConflictException(
          `Workflow template code '${dto.code}' (version 1) already exists`,
        );
      }
      if (isUniqueViolation(err)) {
        throw new ConflictException("A unique constraint was violated creating this template");
      }
      this.logger.error("createTemplate unexpected error", { err, companyId });
      throw err;
    }
  }

  /** GET /workflow-templates — list template draft/published của tenant (loại soft-deleted). */
  listTemplates(companyId: string) {
    return this.repo.list(companyId);
  }

  /**
   * GET /workflow-templates/:id — template + steps + dependencies + checklists (templateDetail).
   * 1 withTenant → cùng 1 snapshot (không non-repeatable read; tránh trả detail cho template vừa bị xoá).
   * Reads tuần tự (cùng 1 connection của tx — KHÔNG Promise.all để khỏi đụng "query in progress").
   */
  async getTemplateDetail(companyId: string, id: string) {
    return this.db.withTenant(companyId, async (tx) => {
      const [template] = await this.repo.findByIdInTx(companyId, id, tx);
      if (!template) throw new NotFoundException(`Workflow template not found: ${id}`);

      const steps = await this.repo.findStepsInTx(companyId, id, tx);
      const dependencies = await this.repo.findDependenciesInTx(companyId, id, tx);
      const checklists = await this.repo.findChecklistsInTx(companyId, id, tx);

      return { template, steps, dependencies, checklists };
    });
  }

  /** PATCH /workflow-templates/:id — đổi name (draft-only). */
  async updateTemplate(companyId: string, actorId: string, id: string, dto: UpdateTemplateRequest) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const [existing] = await this.repo.findByIdInTx(companyId, id, tx);
        if (!existing) throw new TemplateNotFoundError(id);
        if (existing.status !== "draft") {
          throw new TemplatePublishedImmutableError(id, existing.status);
        }
        if (dto.name === undefined) {
          this.logger.debug("updateTemplate no-op (no fields to change)", { companyId, id });
          return existing;
        }

        const [updated] = await this.repo.updateName(companyId, id, dto.name, tx);
        if (!updated) throw new InternalServerErrorException(`Failed to update template ${id}`);

        await this.audit.record(tx, {
          action: "WorkflowTemplateUpdated",
          objectType: "workflow_template",
          objectId: id,
          actorUserId: actorId,
          before: { name: existing.name },
          after: { name: updated.name },
        });

        return updated;
      });
    } catch (err) {
      this.mapError(err, "updateTemplate", { companyId, id });
    }
  }

  /** DELETE /workflow-templates/:id — soft-delete (draft-only). */
  async deleteTemplate(companyId: string, actorId: string, id: string) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const [existing] = await this.repo.findByIdInTx(companyId, id, tx);
        if (!existing) throw new TemplateNotFoundError(id);
        if (existing.status !== "draft") {
          throw new TemplatePublishedImmutableError(id, existing.status);
        }

        const [deleted] = await this.repo.softDelete(companyId, id, tx);
        if (!deleted) throw new InternalServerErrorException(`Failed to delete template ${id}`);

        await this.audit.record(tx, {
          action: "WorkflowTemplateDeleted",
          objectType: "workflow_template",
          objectId: id,
          actorUserId: actorId,
          before: { status: existing.status },
          after: { deletedAt: deleted.deletedAt },
        });

        return { id, deleted: true as const };
      });
    } catch (err) {
      this.mapError(err, "deleteTemplate", { companyId, id });
    }
  }

  // ─── Publish / clone lifecycle (2b) — crown-jewel (DAG gate + D4 versioning) ──

  /**
   * POST /workflow-templates/:id/publish — gate the DAG then lock the template.
   * Runs DagValidatorService over the persisted graph; if valid: draft→published
   * (published_at set, edits now blocked by `loadDraftTemplate`). If invalid: throws
   * TemplateDagInvalidError (→ 422 with the full error list) and the status is unchanged.
   */
  async publishTemplate(companyId: string, actorId: string, id: string) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const template = await this.loadDraftTemplate(companyId, id, tx);

        // Reads in the same tx → one snapshot (no graph change between validate and lock).
        const steps = await this.repo.findStepsInTx(companyId, id, tx);
        const deps = await this.repo.findDependenciesInTx(companyId, id, tx);
        const input = buildDagInput(steps, deps);
        const validation = toDagValidationResultDto(
          this.dagValidator.validateDag(input.steps, input.deps),
        );
        if (!validation.valid) {
          throw new TemplateDagInvalidError(validation);
        }

        const [published] = await this.repo.publishTemplate(companyId, id, tx);
        // loadDraftTemplate already confirmed draft → 0 rows means a concurrent publish/delete won the
        // race (atomic WHERE status='draft'). Surface 409, not a misleading 500.
        if (!published) {
          throw new ConflictException(
            `Template ${id} was published or modified by a concurrent request`,
          );
        }

        await this.audit.record(tx, {
          action: "WorkflowTemplatePublished",
          objectType: "workflow_template",
          objectId: id,
          actorUserId: actorId,
          before: { status: template.status, version: template.version },
          after: {
            status: published.status,
            version: published.version,
            publishedAt: published.publishedAt,
          },
        });

        return published;
      });
    } catch (err) {
      this.mapError(err, "publishTemplate", { companyId, id });
    }
  }

  /**
   * POST /workflow-templates/:id/clone — D4: published is immutable; editing = clone to a
   * new DRAFT version. Copies steps (new id, node_key PRESERVED), dependencies (remapped
   * by node_key→new step id), checklists + items (remapped). version = max(code)+1 → never
   * collides with an existing draft. Source must be `published`.
   */
  async cloneTemplate(companyId: string, actorId: string, id: string) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const [source] = await this.repo.findByIdInTx(companyId, id, tx);
        if (!source) throw new TemplateNotFoundError(id);
        if (source.status !== "published") {
          throw new BadRequestException(
            `Only a published template can be cloned (status: '${source.status}')`,
          );
        }

        const versionRows = await this.repo.maxVersionInTx(companyId, source.code, tx);
        const newVersion = (versionRows[0]?.maxVersion ?? source.version) + 1;

        const [clone] = await this.repo.cloneTemplateRow(
          companyId,
          {
            code: source.code,
            name: source.name,
            appliesTo: source.appliesTo,
            maxApprovalLevel: source.maxApprovalLevel,
            allowParallelSteps: source.allowParallelSteps,
            version: newVersion,
            createdBy: actorId,
          },
          tx,
        );
        if (!clone) throw new InternalServerErrorException("Failed to clone template");

        // Steps: copy with a fresh id; node_key is the stable DAG identity → preserved.
        // NOTE: `defaultChecklistId` is intentionally NOT copied — it is always NULL before 3b
        // (createStep does not set it; 1c-iv deferred it to runtime apply). When 3b starts setting
        // it, clone must add a second pass remapping it via checklistIdMap (residual, plan §10).
        const sourceSteps = await this.repo.findStepsInTx(companyId, id, tx);
        const stepIdMap = new Map<string, string>();
        for (const step of sourceSteps) {
          const [newStep] = await this.repo.createStep(
            companyId,
            {
              templateId: clone.id,
              nodeKey: step.nodeKey,
              code: step.code,
              name: step.name,
              defaultTaskTitle: step.defaultTaskTitle,
              stepType: step.stepType,
              assigneeRoleCode: step.assigneeRoleCode,
              reviewerRoleCode: step.reviewerRoleCode,
              isRequired: step.isRequired,
              stepOrder: step.stepOrder,
              positionX: step.positionX,
              positionY: step.positionY,
            },
            tx,
          );
          if (!newStep) throw new InternalServerErrorException("Failed to clone template step");
          stepIdMap.set(step.id, newStep.id);
        }

        // Dependencies: remap both endpoints to the cloned step ids.
        const sourceDeps = await this.repo.findDependenciesInTx(companyId, id, tx);
        for (const dep of sourceDeps) {
          const fromStepId = stepIdMap.get(dep.fromStepId);
          const toStepId = stepIdMap.get(dep.toStepId);
          if (!fromStepId || !toStepId) {
            throw new InternalServerErrorException(
              "Dependency references a step missing from the clone",
            );
          }
          await this.repo.createDependency(
            companyId,
            { templateId: clone.id, fromStepId, toStepId, dependencyType: dep.dependencyType },
            tx,
          );
        }

        // Checklists (attached to a step) → remap step id; track old→new checklist id for items.
        const sourceChecklists = await this.repo.findChecklistsInTx(companyId, id, tx);
        const checklistIdMap = new Map<string, string>();
        for (const checklist of sourceChecklists) {
          const newStepId = checklist.workflowDefinitionStepId
            ? stepIdMap.get(checklist.workflowDefinitionStepId)
            : undefined;
          // findChecklistsInTx INNER JOINs steps → workflowDefinitionStepId is always a live, mapped step.
          if (!newStepId) {
            throw new InternalServerErrorException(
              "Checklist references a step missing from the clone",
            );
          }
          const [newChecklist] = await this.repo.createChecklist(
            companyId,
            { name: checklist.name, workflowDefinitionStepId: newStepId },
            tx,
          );
          if (!newChecklist) throw new InternalServerErrorException("Failed to clone checklist");
          checklistIdMap.set(checklist.id, newChecklist.id);
        }

        // Checklist items → remap checklist id.
        const sourceItems = await this.repo.findChecklistItemsForTemplateInTx(companyId, id, tx);
        for (const item of sourceItems) {
          const newChecklistId = checklistIdMap.get(item.checklistId);
          if (!newChecklistId) {
            throw new InternalServerErrorException(
              "Checklist item references a checklist missing from the clone",
            );
          }
          const [newItem] = await this.repo.createChecklistItem(
            companyId,
            {
              checklistId: newChecklistId,
              label: item.label,
              isRequired: item.isRequired,
              sortOrder: item.sortOrder,
            },
            tx,
          );
          if (!newItem) throw new InternalServerErrorException("Failed to clone checklist item");
        }

        await this.audit.record(tx, {
          action: "WorkflowTemplateCloned",
          objectType: "workflow_template",
          objectId: id,
          actorUserId: actorId,
          before: { status: source.status, version: source.version },
          after: { cloneId: clone.id, version: clone.version, status: clone.status },
        });

        return clone;
      });
    } catch (err) {
      if (uniqueConstraintName(err) === TEMPLATE_CODE_VERSION_UQ) {
        throw new ConflictException("A draft of this template version already exists");
      }
      this.mapError(err, "cloneTemplate", { companyId, id });
    }
  }

  // ─── Template steps (1c-ii) ─────────────────────────────────────────────────

  /** Guard chung: template tồn tại + draft (chỉ draft sửa được cấu hình step). Throw nếu không. */
  private async loadDraftTemplate(companyId: string, templateId: string, tx: TenantTx) {
    const [template] = await this.repo.findByIdInTx(companyId, templateId, tx);
    if (!template) throw new TemplateNotFoundError(templateId);
    if (template.status !== "draft") {
      throw new TemplatePublishedImmutableError(templateId, template.status);
    }
    return template;
  }

  /** POST /workflow-templates/:id/steps — thêm step (stepOrder omit → max+1). */
  async addStep(
    companyId: string,
    actorId: string,
    templateId: string,
    dto: CreateTemplateStepRequest,
  ) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        await this.loadDraftTemplate(companyId, templateId, tx);

        let stepOrder = dto.stepOrder;
        if (stepOrder === undefined) {
          const [row] = await this.repo.maxStepOrderInTx(companyId, templateId, tx);
          stepOrder = (row?.maxOrder ?? 0) + 1;
        }

        const [created] = await this.repo.createStep(
          companyId,
          {
            templateId,
            nodeKey: dto.nodeKey,
            code: dto.code,
            name: dto.name,
            defaultTaskTitle: dto.defaultTaskTitle,
            stepType: dto.stepType,
            assigneeRoleCode: dto.assigneeRoleCode ?? null,
            reviewerRoleCode: dto.reviewerRoleCode ?? null,
            isRequired: dto.isRequired,
            stepOrder,
            positionX: dto.positionX ?? null,
            positionY: dto.positionY ?? null,
          },
          tx,
        );
        if (!created) throw new InternalServerErrorException("Failed to create template step");

        await this.audit.record(tx, {
          action: "WorkflowTemplateStepAdded",
          objectType: "workflow_template",
          objectId: templateId,
          actorUserId: actorId,
          after: {
            stepId: created.id,
            nodeKey: created.nodeKey,
            code: created.code,
            stepOrder: created.stepOrder,
          },
        });

        return created;
      });
    } catch (err) {
      const uq = uniqueConstraintName(err);
      if (uq === STEP_NODE_KEY_UQ) {
        throw new ConflictException(`Node key '${dto.nodeKey}' already exists in this template`);
      }
      if (uq === STEP_ORDER_UQ) {
        throw new ConflictException("Step order already exists in this template");
      }
      this.mapError(err, "addStep", { companyId, id: templateId });
    }
  }

  /** PATCH /workflow-templates/:id/steps/:stepId — sửa step (KHÔNG đổi nodeKey — contract đã omit). */
  async updateStep(
    companyId: string,
    actorId: string,
    templateId: string,
    stepId: string,
    dto: UpdateTemplateStepRequest,
  ) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        await this.loadDraftTemplate(companyId, templateId, tx);
        const [existing] = await this.repo.findStepByIdInTx(companyId, templateId, stepId, tx);
        if (!existing) throw new NotFoundException(`Template step not found: ${stepId}`);

        const fields = buildStepUpdate(dto);
        if (Object.keys(fields).length === 0) {
          this.logger.debug("updateStep no-op (no fields to change)", {
            companyId,
            templateId,
            stepId,
          });
          return existing;
        }

        const [updated] = await this.repo.updateStep(companyId, stepId, fields, tx);
        if (!updated) throw new InternalServerErrorException(`Failed to update step ${stepId}`);

        await this.audit.record(tx, {
          action: "WorkflowTemplateStepUpdated",
          objectType: "workflow_template",
          objectId: templateId,
          actorUserId: actorId,
          before: {
            stepId,
            code: existing.code,
            name: existing.name,
            stepOrder: existing.stepOrder,
          },
          after: { code: updated.code, name: updated.name, stepOrder: updated.stepOrder },
        });

        return updated;
      });
    } catch (err) {
      if (uniqueConstraintName(err) === STEP_ORDER_UQ) {
        throw new ConflictException("Step order already exists in this template");
      }
      this.mapError(err, "updateStep", { companyId, id: templateId });
    }
  }

  /** DELETE /workflow-templates/:id/steps/:stepId — hard-delete (draft-only; FK cascade deps). */
  async removeStep(companyId: string, actorId: string, templateId: string, stepId: string) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        await this.loadDraftTemplate(companyId, templateId, tx);
        const [existing] = await this.repo.findStepByIdInTx(companyId, templateId, stepId, tx);
        if (!existing) throw new NotFoundException(`Template step not found: ${stepId}`);

        const [deleted] = await this.repo.deleteStep(companyId, stepId, tx);
        if (!deleted) throw new InternalServerErrorException(`Failed to delete step ${stepId}`);

        await this.audit.record(tx, {
          action: "WorkflowTemplateStepRemoved",
          objectType: "workflow_template",
          objectId: templateId,
          actorUserId: actorId,
          before: { stepId, nodeKey: existing.nodeKey, code: existing.code },
        });

        return { id: stepId, deleted: true as const };
      });
    } catch (err) {
      this.mapError(err, "removeStep", { companyId, id: templateId });
    }
  }

  // ─── Step dependencies (1c-iii) — KHÔNG validate DAG/cycle ở đây (→ 2b publish) ──

  /** POST /workflow-templates/:id/dependencies — thêm cạnh (chỉ referential integrity, không cycle). */
  async addDependency(
    companyId: string,
    actorId: string,
    templateId: string,
    dto: CreateDependencyRequest,
  ) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        await this.loadDraftTemplate(companyId, templateId, tx);

        if (dto.fromStepId === dto.toStepId) {
          throw new BadRequestException("A step cannot depend on itself (self-dependency)");
        }
        // from/to PHẢI thuộc đúng template này (chặn cross-template edge ở add-time — DV3 backstop).
        const [fromStep] = await this.repo.findStepByIdInTx(
          companyId,
          templateId,
          dto.fromStepId,
          tx,
        );
        if (!fromStep) {
          throw new BadRequestException(`from_step not found in this template: ${dto.fromStepId}`);
        }
        const [toStep] = await this.repo.findStepByIdInTx(companyId, templateId, dto.toStepId, tx);
        if (!toStep) {
          throw new BadRequestException(`to_step not found in this template: ${dto.toStepId}`);
        }

        const [created] = await this.repo.createDependency(
          companyId,
          {
            templateId,
            fromStepId: dto.fromStepId,
            toStepId: dto.toStepId,
            dependencyType: dto.dependencyType,
          },
          tx,
        );
        if (!created) throw new InternalServerErrorException("Failed to create dependency");

        await this.audit.record(tx, {
          action: "WorkflowTemplateDependencyAdded",
          objectType: "workflow_template",
          objectId: templateId,
          actorUserId: actorId,
          after: {
            dependencyId: created.id,
            fromStepId: created.fromStepId,
            toStepId: created.toStepId,
            dependencyType: created.dependencyType,
          },
        });

        return created;
      });
    } catch (err) {
      if (uniqueConstraintName(err) === DEP_EDGE_UQ) {
        throw new ConflictException("This dependency edge already exists");
      }
      this.mapError(err, "addDependency", { companyId, id: templateId });
    }
  }

  /** DELETE /workflow-templates/:id/dependencies/:depId — hard-delete cạnh (draft-only). */
  async removeDependency(companyId: string, actorId: string, templateId: string, depId: string) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        await this.loadDraftTemplate(companyId, templateId, tx);
        const [existing] = await this.repo.findDependencyByIdInTx(companyId, templateId, depId, tx);
        if (!existing) throw new NotFoundException(`Dependency not found: ${depId}`);

        const [deleted] = await this.repo.deleteDependency(companyId, templateId, depId, tx);
        if (!deleted)
          throw new InternalServerErrorException(`Failed to delete dependency ${depId}`);

        await this.audit.record(tx, {
          action: "WorkflowTemplateDependencyRemoved",
          objectType: "workflow_template",
          objectId: templateId,
          actorUserId: actorId,
          before: {
            dependencyId: depId,
            fromStepId: existing.fromStepId,
            toStepId: existing.toStepId,
          },
        });

        return { id: depId, deleted: true as const };
      });
    } catch (err) {
      this.mapError(err, "removeDependency", { companyId, id: templateId });
    }
  }

  // ─── Checklists + items (1c-iv) — gắn step của draft template ─────────────────

  /** POST /workflow-templates/:id/steps/:stepId/checklists — tạo checklist cho step. */
  async createChecklist(
    companyId: string,
    actorId: string,
    templateId: string,
    stepId: string,
    dto: { name: string },
  ) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        await this.loadDraftTemplate(companyId, templateId, tx);
        const [step] = await this.repo.findStepByIdInTx(companyId, templateId, stepId, tx);
        if (!step) throw new NotFoundException(`Template step not found: ${stepId}`);

        const [created] = await this.repo.createChecklist(
          companyId,
          { name: dto.name, workflowDefinitionStepId: stepId },
          tx,
        );
        if (!created) throw new InternalServerErrorException("Failed to create checklist");

        await this.audit.record(tx, {
          action: "WorkflowTemplateChecklistAdded",
          objectType: "workflow_template",
          objectId: templateId,
          actorUserId: actorId,
          after: { checklistId: created.id, stepId, name: created.name },
        });

        return created;
      });
    } catch (err) {
      this.mapError(err, "createChecklist", { companyId, id: templateId });
    }
  }

  /** DELETE /workflow-templates/:id/steps/:stepId/checklists/:checklistId — hard-delete (cascade items). */
  async removeChecklist(
    companyId: string,
    actorId: string,
    templateId: string,
    stepId: string,
    checklistId: string,
  ) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        await this.loadDraftTemplate(companyId, templateId, tx);
        const [step] = await this.repo.findStepByIdInTx(companyId, templateId, stepId, tx);
        if (!step) throw new NotFoundException(`Template step not found: ${stepId}`);
        const [existing] = await this.repo.findChecklistByStepInTx(
          companyId,
          stepId,
          checklistId,
          tx,
        );
        if (!existing) throw new NotFoundException(`Checklist not found: ${checklistId}`);

        const [deleted] = await this.repo.deleteChecklist(companyId, stepId, checklistId, tx);
        // !deleted = race: step bị xoá đồng thời NULL-hoá workflow_definition_step_id → 404 (không phải 500).
        if (!deleted) throw new NotFoundException(`Checklist not found: ${checklistId}`);

        await this.audit.record(tx, {
          action: "WorkflowTemplateChecklistRemoved",
          objectType: "workflow_template",
          objectId: templateId,
          actorUserId: actorId,
          before: { checklistId, stepId, name: existing.name },
        });

        return { id: checklistId, deleted: true as const };
      });
    } catch (err) {
      this.mapError(err, "removeChecklist", { companyId, id: templateId });
    }
  }

  /** POST /workflow-templates/:id/checklists/:checklistId/items — thêm item. */
  async addChecklistItem(
    companyId: string,
    actorId: string,
    templateId: string,
    checklistId: string,
    dto: { label: string; isRequired: boolean; sortOrder: number },
  ) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        await this.loadDraftTemplate(companyId, templateId, tx);
        const [checklist] = await this.repo.findChecklistInTemplateInTx(
          companyId,
          templateId,
          checklistId,
          tx,
        );
        if (!checklist) {
          throw new NotFoundException(`Checklist not found in this template: ${checklistId}`);
        }

        const [created] = await this.repo.createChecklistItem(
          companyId,
          { checklistId, label: dto.label, isRequired: dto.isRequired, sortOrder: dto.sortOrder },
          tx,
        );
        if (!created) throw new InternalServerErrorException("Failed to create checklist item");

        await this.audit.record(tx, {
          action: "WorkflowTemplateChecklistItemAdded",
          objectType: "workflow_template",
          objectId: templateId,
          actorUserId: actorId,
          after: {
            itemId: created.id,
            checklistId,
            label: created.label,
            isRequired: created.isRequired,
          },
        });

        return created;
      });
    } catch (err) {
      this.mapError(err, "addChecklistItem", { companyId, id: templateId });
    }
  }

  /** DELETE /workflow-templates/:id/checklists/:checklistId/items/:itemId — hard-delete item. */
  async removeChecklistItem(
    companyId: string,
    actorId: string,
    templateId: string,
    checklistId: string,
    itemId: string,
  ) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        await this.loadDraftTemplate(companyId, templateId, tx);
        const [checklist] = await this.repo.findChecklistInTemplateInTx(
          companyId,
          templateId,
          checklistId,
          tx,
        );
        if (!checklist) {
          throw new NotFoundException(`Checklist not found in this template: ${checklistId}`);
        }
        const [existing] = await this.repo.findChecklistItemByIdInTx(
          companyId,
          checklistId,
          itemId,
          tx,
        );
        if (!existing) throw new NotFoundException(`Checklist item not found: ${itemId}`);

        const [deleted] = await this.repo.deleteChecklistItem(companyId, checklistId, itemId, tx);
        if (!deleted)
          throw new InternalServerErrorException(`Failed to delete checklist item ${itemId}`);

        await this.audit.record(tx, {
          action: "WorkflowTemplateChecklistItemRemoved",
          objectType: "workflow_template",
          objectId: templateId,
          actorUserId: actorId,
          before: { itemId, checklistId, label: existing.label },
        });

        return { id: itemId, deleted: true as const };
      });
    } catch (err) {
      this.mapError(err, "removeChecklistItem", { companyId, id: templateId });
    }
  }

  /**
   * Map domain → HTTP exception; rethrow known HTTP exceptions; log + rethrow unknown (giữ error gốc).
   * `never` để TypeScript ÉP caller phải có `throw`/return path — không thể vô tình nuốt lỗi.
   */
  private mapError(err: unknown, op: string, ctx: { companyId: string; id: string }): never {
    if (err instanceof TemplateNotFoundError) throw new NotFoundException(err.message);
    if (err instanceof TemplatePublishedImmutableError) throw new ConflictException(err.message);
    // DAG-invalid publish → 422 with the full validation result for the builder to render inline.
    if (err instanceof TemplateDagInvalidError) {
      throw new UnprocessableEntityException({
        message: err.message,
        dagValidation: err.result,
      });
    }
    if (
      err instanceof NotFoundException ||
      err instanceof ConflictException ||
      err instanceof BadRequestException ||
      err instanceof UnprocessableEntityException ||
      err instanceof InternalServerErrorException
    ) {
      throw err;
    }
    // Fallback chống raw pg-error 500 rò tên bảng/schema:
    if (isForeignKeyViolation(err)) {
      throw new BadRequestException("A referenced entity no longer exists");
    }
    if (isUniqueViolation(err)) {
      throw new ConflictException("A unique constraint was violated");
    }
    this.logger.error(`${op} unexpected error`, { err, ...ctx });
    throw err instanceof Error ? err : new Error(String(err));
  }
}
