import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
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
import {
  TemplateNotFoundError,
  TemplatePublishedImmutableError,
} from "./workflow-templates.types";

const PG_UNIQUE_VIOLATION = "23505";
// Partial-unique index (company_id, code, version) WHERE deleted_at IS NULL — định nghĩa ở schema/0032.
const TEMPLATE_CODE_VERSION_UQ = "workflow_defs_company_code_version_active_uq";

/** True CHỈ khi 23505 đến từ ĐÚNG unique index (code,version) — tránh nuốt nhầm constraint khác. */
function isTemplateCodeConflict(err: unknown): boolean {
  return uniqueConstraintName(err) === TEMPLATE_CODE_VERSION_UQ;
}

// Unique index names cho step (schema/0032) — scope 23505 để báo lỗi đúng nguyên nhân.
const STEP_NODE_KEY_UQ = "wf_def_steps_def_node_key_uq";
const STEP_ORDER_UQ = "wf_def_steps_def_order_uq";

/** Trả tên unique-constraint nếu err là 23505, ngược lại null. */
function uniqueConstraintName(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as Record<string, unknown>;
  if (e["code"] !== PG_UNIQUE_VIOLATION) return null;
  return typeof e["constraint"] === "string" ? (e["constraint"] as string) : null;
}

/** True nếu err là 23505 BẤT KỲ (kể cả thiếu tên constraint) — fallback chống raw 500 rò schema. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as Record<string, unknown>)["code"] === PG_UNIQUE_VIOLATION
  );
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
        throw new ConflictException(`Workflow template code '${dto.code}' (version 1) already exists`);
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
  async updateTemplate(
    companyId: string,
    actorId: string,
    id: string,
    dto: UpdateTemplateRequest,
  ) {
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
          this.logger.debug("updateStep no-op (no fields to change)", { companyId, templateId, stepId });
          return existing;
        }

        const [updated] = await this.repo.updateStep(companyId, stepId, fields, tx);
        if (!updated) throw new InternalServerErrorException(`Failed to update step ${stepId}`);

        await this.audit.record(tx, {
          action: "WorkflowTemplateStepUpdated",
          objectType: "workflow_template",
          objectId: templateId,
          actorUserId: actorId,
          before: { stepId, code: existing.code, name: existing.name, stepOrder: existing.stepOrder },
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

  /**
   * Map domain → HTTP exception; rethrow known HTTP exceptions; log + rethrow unknown (giữ error gốc).
   * `never` để TypeScript ÉP caller phải có `throw`/return path — không thể vô tình nuốt lỗi.
   */
  private mapError(err: unknown, op: string, ctx: { companyId: string; id: string }): never {
    if (err instanceof TemplateNotFoundError) throw new NotFoundException(err.message);
    if (err instanceof TemplatePublishedImmutableError) throw new ConflictException(err.message);
    if (
      err instanceof NotFoundException ||
      err instanceof ConflictException ||
      err instanceof InternalServerErrorException
    ) {
      throw err;
    }
    // Fallback: 23505 không khớp constraint cụ thể → 409 chung (chống raw pg-error 500 rò tên bảng/schema).
    if (isUniqueViolation(err)) {
      throw new ConflictException("A unique constraint was violated");
    }
    this.logger.error(`${op} unexpected error`, { err, ...ctx });
    throw err instanceof Error ? err : new Error(String(err));
  }
}
