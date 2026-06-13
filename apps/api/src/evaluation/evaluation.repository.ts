import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import {
  evaluationCriteria,
  evaluationResults,
  evaluationScores,
  evaluationTemplates,
} from "../db/schema";

/**
 * G8-3 — Repository đánh giá. withTenant mọi query nghiệp vụ (RLS ép company_id ở DB, bất biến #1).
 * templates/criteria: CRUD soft-delete. results/scores: APPEND-ONLY insert (bất biến #2) — no update/delete.
 * Write methods nhận `tx` để chạy CÙNG transaction với audit/outbox.
 */

export interface InsertTemplateData {
  name: string;
  description?: string | null;
  workflowStepCode?: string | null;
}

export interface InsertCriterionData {
  templateId: string;
  name: string;
  description?: string | null;
  weight: string; // numeric → string (Drizzle)
  minScore: string;
  maxScore: string;
  sortOrder: number;
}

export interface InsertResultData {
  templateId: string;
  workflowStepId: string;
  subjectUserId?: string | null;
  evaluatorUserId: string;
  totalScore: string;
}

export interface InsertScoreData {
  resultId: string;
  criteriaId: string;
  score: string;
  comment?: string | null;
}

@Injectable()
export class EvaluationRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Liệt kê template active (chưa soft-delete) của tenant. */
  listTemplates(
    companyId: string,
    opts: { workflowStepCode?: string; includeInactive?: boolean } = {},
  ) {
    return this.db.withTenant(companyId, async (tx) => {
      const conds = [
        eq(evaluationTemplates.companyId, companyId),
        isNull(evaluationTemplates.deletedAt),
      ];
      if (opts.workflowStepCode) {
        conds.push(eq(evaluationTemplates.workflowStepCode, opts.workflowStepCode));
      }
      if (!opts.includeInactive) {
        conds.push(eq(evaluationTemplates.isActive, true));
      }
      return tx
        .select()
        .from(evaluationTemplates)
        .where(and(...conds))
        .orderBy(evaluationTemplates.createdAt);
    });
  }

  /** Template + tiêu chí active theo id (cùng tenant). null nếu không có / đã soft-delete. */
  async findTemplateByIdTx(tx: TenantTx, companyId: string, id: string) {
    const [tpl] = await tx
      .select()
      .from(evaluationTemplates)
      .where(
        and(
          eq(evaluationTemplates.companyId, companyId),
          eq(evaluationTemplates.id, id),
          isNull(evaluationTemplates.deletedAt),
        ),
      )
      .limit(1);
    return tpl ?? null;
  }

  /** Tiêu chí ACTIVE của 1 template (cùng tenant, company_id pin 2 phía). */
  findActiveCriteriaTx(tx: TenantTx, companyId: string, templateId: string) {
    return tx
      .select()
      .from(evaluationCriteria)
      .where(
        and(
          eq(evaluationCriteria.companyId, companyId),
          eq(evaluationCriteria.templateId, templateId),
          isNull(evaluationCriteria.deletedAt),
        ),
      )
      .orderBy(evaluationCriteria.sortOrder);
  }

  async insertTemplateTx(tx: TenantTx, data: InsertTemplateData) {
    const [row] = await tx
      .insert(evaluationTemplates)
      .values({
        name: data.name,
        description: data.description ?? null,
        workflowStepCode: data.workflowStepCode ?? null,
      })
      .returning();
    return row;
  }

  async insertCriterionTx(tx: TenantTx, data: InsertCriterionData) {
    const [row] = await tx
      .insert(evaluationCriteria)
      .values({
        templateId: data.templateId,
        name: data.name,
        description: data.description ?? null,
        weight: data.weight,
        minScore: data.minScore,
        maxScore: data.maxScore,
        sortOrder: data.sortOrder,
      })
      .returning();
    return row;
  }

  /** Soft-delete toàn bộ tiêu chí ACTIVE của template (khi thay bộ tiêu chí). company_id pin 2 phía. */
  async softDeleteCriteriaTx(tx: TenantTx, companyId: string, templateId: string) {
    await tx
      .update(evaluationCriteria)
      .set({ deletedAt: sql`now()` })
      .where(
        and(
          eq(evaluationCriteria.companyId, companyId),
          eq(evaluationCriteria.templateId, templateId),
          isNull(evaluationCriteria.deletedAt),
        ),
      );
  }

  /** Cập nhật updated_at template (khi đổi tiêu chí). company_id pin 2 phía. */
  async touchTemplateTx(tx: TenantTx, companyId: string, templateId: string) {
    await tx
      .update(evaluationTemplates)
      .set({ updatedAt: sql`now()` })
      .where(
        and(eq(evaluationTemplates.companyId, companyId), eq(evaluationTemplates.id, templateId)),
      );
  }

  async insertResultTx(tx: TenantTx, data: InsertResultData) {
    const [row] = await tx
      .insert(evaluationResults)
      .values({
        templateId: data.templateId,
        workflowStepId: data.workflowStepId,
        subjectUserId: data.subjectUserId ?? null,
        evaluatorUserId: data.evaluatorUserId,
        totalScore: data.totalScore,
      })
      .returning();
    return row;
  }

  async insertScoreTx(tx: TenantTx, data: InsertScoreData) {
    const [row] = await tx
      .insert(evaluationScores)
      .values({
        resultId: data.resultId,
        criteriaId: data.criteriaId,
        score: data.score,
        comment: data.comment ?? null,
      })
      .returning();
    return row;
  }
}
