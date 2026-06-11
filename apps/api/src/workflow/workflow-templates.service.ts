import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { CreateTemplateRequest, UpdateTemplateRequest } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { WorkflowTemplatesRepository } from "./workflow-templates.repository";
import {
  TemplateNotFoundError,
  TemplatePublishedImmutableError,
} from "./workflow-templates.types";

const PG_UNIQUE_VIOLATION = "23505";
// Partial-unique index (company_id, code, version) WHERE deleted_at IS NULL — định nghĩa ở schema/0032.
const TEMPLATE_CODE_VERSION_UQ = "workflow_defs_company_code_version_active_uq";

/** True CHỈ khi 23505 đến từ ĐÚNG unique index (code,version) — tránh nuốt nhầm constraint khác. */
function isTemplateCodeConflict(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  return e["code"] === PG_UNIQUE_VIOLATION && e["constraint"] === TEMPLATE_CODE_VERSION_UQ;
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
        if (dto.name === undefined) return existing; // no-op: không có field nào để đổi

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
    this.logger.error(`${op} unexpected error`, { err, ...ctx });
    throw err instanceof Error ? err : new Error(String(err));
  }
}
