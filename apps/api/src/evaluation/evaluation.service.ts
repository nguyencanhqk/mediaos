import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateEvaluationTemplateRequest,
  RecordScoresRequest,
  UpdateCriteriaRequest,
} from "@mediaos/contracts";
import { EVALUATION_WEIGHT_SUM } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import { EvaluationRepository } from "./evaluation.repository";

/**
 * G8-3 — EvaluationService: template + tiêu chí (trọng số) + chấm điểm gắn workflow step.
 *
 * 4 chốt fail-closed:
 *  (a) RLS 2-tenant — mọi đọc/ghi qua withTenant (RLS ép company_id ở DB).
 *  (b) Append-only — results/scores chỉ INSERT (DB từ chối UPDATE/DELETE cho app role); chấm trùng → 409.
 *  (c) Permission — manage:evaluation-template (CRUD template/criteria) · score:evaluation (chấm điểm)
 *                   check TRƯỚC khi mở tx → deny ⇒ KHÔNG side-effect.
 *  (d) Audit — recordScores() ghi audit_logs object_type='evaluation_result' CÙNG tx.
 */

const TEMPLATE_RESOURCE = "evaluation-template";
const TEMPLATE_ACTION = "manage";
const SCORE_RESOURCE = "evaluation";
const SCORE_ACTION = "score";

const PG_UNIQUE_VIOLATION = "23505";
const WEIGHT_EPSILON = 0.0001;

/** Mã lỗi Postgres trên unknown error (driver pg). */
function pgCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** numeric (number) → string cho Drizzle; chặn giá trị không hữu hạn ở boundary. */
function numToStr(value: number, scale = 2): string {
  if (!Number.isFinite(value)) throw new BadRequestException(`Giá trị không hợp lệ: ${value}`);
  return value.toFixed(scale);
}

@Injectable()
export class EvaluationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: EvaluationRepository,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ─── Templates / criteria (manage:evaluation-template) ──────────────────────

  listTemplates(
    companyId: string,
    _userId: string,
    opts: { workflowStepCode?: string; includeInactive?: boolean } = {},
  ) {
    return this.repo.listTemplates(companyId, opts);
  }

  /** Tạo template + bộ tiêu chí. Tổng trọng số = 100 (chốt service). audit TemplateCreated cùng tx. */
  async createTemplate(companyId: string, userId: string, dto: CreateEvaluationTemplateRequest) {
    await this.assertCan(companyId, userId, TEMPLATE_ACTION, TEMPLATE_RESOURCE);
    this.assertWeightSum(dto.criteria);

    return this.db.withTenant(companyId, async (tx) => {
      const tpl = await this.repo.insertTemplateTx(tx, {
        name: dto.name,
        description: dto.description ?? null,
        workflowStepCode: dto.workflowStepCode ?? null,
      });
      for (const c of dto.criteria) {
        await this.repo.insertCriterionTx(tx, {
          templateId: tpl.id,
          name: c.name,
          description: c.description ?? null,
          weight: numToStr(c.weight),
          minScore: numToStr(c.minScore),
          maxScore: numToStr(c.maxScore),
          sortOrder: c.sortOrder,
        });
      }
      await this.audit.record(tx, {
        action: "EvaluationTemplateCreated",
        objectType: "evaluation_template",
        objectId: tpl.id,
        actorUserId: userId,
        after: { name: tpl.name, criteriaCount: dto.criteria.length },
      });
      return { ...tpl, criteriaCount: dto.criteria.length };
    });
  }

  /** Thay toàn bộ bộ tiêu chí (soft-delete cũ + insert mới). Tổng trọng số = 100. */
  async updateCriteria(
    companyId: string,
    userId: string,
    templateId: string,
    dto: UpdateCriteriaRequest,
  ) {
    await this.assertCan(companyId, userId, TEMPLATE_ACTION, TEMPLATE_RESOURCE);
    this.assertWeightSum(dto.criteria);

    return this.db.withTenant(companyId, async (tx) => {
      const tpl = await this.repo.findTemplateByIdTx(tx, companyId, templateId);
      if (!tpl) throw new NotFoundException(`Template không tồn tại: ${templateId}`);

      await this.repo.softDeleteCriteriaTx(tx, companyId, templateId);
      for (const c of dto.criteria) {
        await this.repo.insertCriterionTx(tx, {
          templateId,
          name: c.name,
          description: c.description ?? null,
          weight: numToStr(c.weight),
          minScore: numToStr(c.minScore),
          maxScore: numToStr(c.maxScore),
          sortOrder: c.sortOrder,
        });
      }
      await this.repo.touchTemplateTx(tx, companyId, templateId);
      await this.audit.record(tx, {
        action: "EvaluationCriteriaUpdated",
        objectType: "evaluation_template",
        objectId: templateId,
        actorUserId: userId,
        after: { criteriaCount: dto.criteria.length },
      });
      return { ...tpl, criteriaCount: dto.criteria.length };
    });
  }

  // ─── Scoring (score:evaluation) ─────────────────────────────────────────────

  /**
   * Chấm điểm 1 bước workflow theo 1 template. APPEND-ONLY: ghi 1 result + n scores cùng tx.
   * Validate: criteriaId thuộc template + active; score trong [min,max]; phủ đủ tiêu chí. audit cùng tx.
   * Chấm lại trùng (result,criteria) → DB uq → 23505 → 409.
   */
  async recordScores(companyId: string, userId: string, dto: RecordScoresRequest) {
    await this.assertCan(companyId, userId, SCORE_ACTION, SCORE_RESOURCE);

    return this.db.withTenant(companyId, async (tx) => {
      const tpl = await this.repo.findTemplateByIdTx(tx, companyId, dto.templateId);
      if (!tpl) throw new NotFoundException(`Template không tồn tại: ${dto.templateId}`);

      const criteria = await this.repo.findActiveCriteriaTx(tx, companyId, dto.templateId);
      if (criteria.length === 0) {
        throw new BadRequestException("Template chưa có tiêu chí.");
      }
      const byId = new Map(criteria.map((c) => [c.id, c]));

      // Mọi score phải trỏ tới 1 tiêu chí active của template + nằm trong [min,max].
      for (const s of dto.scores) {
        const crit = byId.get(s.criteriaId);
        if (!crit) {
          throw new BadRequestException(
            `criteriaId không thuộc template (hoặc đã xoá): ${s.criteriaId}`,
          );
        }
        const min = Number(crit.minScore);
        const max = Number(crit.maxScore);
        if (s.score < min || s.score > max) {
          throw new BadRequestException(
            `Điểm ${s.score} ngoài khoảng [${min}, ${max}] của tiêu chí ${crit.name}`,
          );
        }
      }

      // Phải chấm đủ MỌI tiêu chí active (không bỏ sót → totalScore mới có nghĩa).
      if (dto.scores.length !== criteria.length) {
        throw new BadRequestException(
          `Phải chấm đủ ${criteria.length} tiêu chí (nhận ${dto.scores.length}).`,
        );
      }

      // totalScore = Σ (score/max * weight)  → thang 0..100 theo trọng số.
      let total = 0;
      for (const s of dto.scores) {
        const crit = byId.get(s.criteriaId)!;
        const min = Number(crit.minScore);
        const max = Number(crit.maxScore);
        const weight = Number(crit.weight);
        const normalized = (s.score - min) / (max - min); // [0,1]
        total += normalized * weight;
      }

      try {
        const result = await this.repo.insertResultTx(tx, {
          templateId: dto.templateId,
          workflowStepId: dto.workflowStepId,
          subjectUserId: dto.subjectUserId ?? null,
          evaluatorUserId: userId,
          totalScore: numToStr(total),
        });
        for (const s of dto.scores) {
          await this.repo.insertScoreTx(tx, {
            resultId: result.id,
            criteriaId: s.criteriaId,
            score: numToStr(s.score),
            comment: s.comment ?? null,
          });
        }
        await this.audit.record(tx, {
          action: "EvaluationScored",
          objectType: "evaluation_result",
          objectId: result.id,
          actorUserId: userId,
          after: {
            templateId: dto.templateId,
            workflowStepId: dto.workflowStepId,
            totalScore: result.totalScore,
          },
        });
        await this.outbox.enqueue(tx, {
          eventType: "evaluation.scored",
          payload: {
            evaluationResultId: result.id,
            workflowStepId: dto.workflowStepId,
            actorUserId: userId,
          },
        });
        return result;
      } catch (err) {
        if (pgCode(err) === PG_UNIQUE_VIOLATION) {
          throw new ConflictException("Đã chấm điểm tiêu chí này cho bước (append-only).");
        }
        throw err;
      }
    });
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  /** Tổng trọng số tiêu chí phải bằng 100 (chốt service, song song với refine Zod + CHECK weight ở DB). */
  private assertWeightSum(criteria: ReadonlyArray<{ weight: number }>): void {
    const sum = criteria.reduce((s, c) => s + c.weight, 0);
    if (Math.abs(sum - EVALUATION_WEIGHT_SUM) > WEIGHT_EPSILON) {
      throw new ConflictException(
        `Tổng trọng số tiêu chí phải bằng ${EVALUATION_WEIGHT_SUM} (hiện ${sum}).`,
      );
    }
  }

  /** Fail-closed permission gate. KIỂM TRA NGOÀI tx → deny không mở transaction ⇒ KHÔNG side-effect. */
  private async assertCan(
    companyId: string,
    userId: string,
    action: string,
    resourceType: string,
  ): Promise<void> {
    const decision = await this.permissions.can({ userId, companyId, action, resourceType });
    if (!decision.allow) {
      throw new ForbiddenException(`Permission denied: ${decision.reason}`);
    }
  }
}
