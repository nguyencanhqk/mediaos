import { z } from "zod";

/**
 * G8-3 Evaluation — template + tiêu chí (trọng số) + chấm điểm gắn vào workflow step.
 *
 * Nguồn sự thật DTO (api ↔ web). `evaluation_results`/`evaluation_scores` là APPEND-ONLY (bất biến #2):
 * chấm lại = bản ghi mới; không UPDATE/DELETE. `evaluation_templates`/`evaluation_criteria` soft-delete.
 *
 * Quy ước trọng số: tổng `weight` các tiêu chí ACTIVE của 1 template phải = 100 (EVAL-WEIGHT-SUM).
 * Điểm mỗi tiêu chí phải nằm trong [minScore, maxScore] khai báo ở tiêu chí (EVAL-SCORE-RANGE).
 */

/** Tổng trọng số tiêu chí hợp lệ của 1 template (phần trăm). */
export const EVALUATION_WEIGHT_SUM = 100;

// ─── Criteria ────────────────────────────────────────────────────────────────

export const evaluationCriterionSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  templateId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  /** Trọng số phần trăm — dương, tối đa 100. Tổng các tiêu chí active = 100. */
  weight: z.number(),
  minScore: z.number(),
  maxScore: z.number(),
  sortOrder: z.number().int(),
  createdAt: z.string().datetime(),
});
export type EvaluationCriterionDto = z.infer<typeof evaluationCriterionSchema>;

/** Input 1 tiêu chí khi tạo/cập nhật template. minScore < maxScore, weight (0,100]. */
export const criterionInputSchema = z
  .object({
    name: z.string().min(1).max(300),
    description: z.string().max(2000).optional(),
    weight: z.number().positive().max(100),
    minScore: z.number().default(0),
    maxScore: z.number().default(10),
    sortOrder: z.number().int().nonnegative().default(0),
  })
  .refine((c) => c.maxScore > c.minScore, {
    message: "maxScore phải lớn hơn minScore",
    path: ["maxScore"],
  });
export type CriterionInput = z.infer<typeof criterionInputSchema>;

// ─── Template ────────────────────────────────────────────────────────────────

export const evaluationTemplateSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  /** Gắn template với 1 loại bước workflow (advisory; nullable). */
  workflowStepCode: z.string().nullable().optional(),
  isActive: z.boolean(),
  criteria: z.array(evaluationCriterionSchema).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EvaluationTemplateDto = z.infer<typeof evaluationTemplateSchema>;

/** Tạo template + danh sách tiêu chí. Tổng weight các tiêu chí = 100 (chốt ở service + DB). */
export const createEvaluationTemplateSchema = z
  .object({
    name: z.string().min(1).max(300),
    description: z.string().max(2000).optional(),
    workflowStepCode: z.string().max(100).optional(),
    criteria: z.array(criterionInputSchema).min(1).max(50),
  })
  .refine(
    (d) => Math.abs(d.criteria.reduce((s, c) => s + c.weight, 0) - EVALUATION_WEIGHT_SUM) < 0.0001,
    { message: `Tổng trọng số tiêu chí phải bằng ${EVALUATION_WEIGHT_SUM}`, path: ["criteria"] },
  );
export type CreateEvaluationTemplateRequest = z.infer<typeof createEvaluationTemplateSchema>;

/** Cập nhật toàn bộ bộ tiêu chí của template (thay thế). Tổng weight = 100. */
export const updateCriteriaSchema = z
  .object({
    criteria: z.array(criterionInputSchema).min(1).max(50),
  })
  .refine(
    (d) => Math.abs(d.criteria.reduce((s, c) => s + c.weight, 0) - EVALUATION_WEIGHT_SUM) < 0.0001,
    { message: `Tổng trọng số tiêu chí phải bằng ${EVALUATION_WEIGHT_SUM}`, path: ["criteria"] },
  );
export type UpdateCriteriaRequest = z.infer<typeof updateCriteriaSchema>;

// ─── Score / Result (append-only) ────────────────────────────────────────────

export const evaluationScoreSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  resultId: z.string().uuid(),
  criteriaId: z.string().uuid(),
  score: z.number(),
  comment: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type EvaluationScoreDto = z.infer<typeof evaluationScoreSchema>;

export const evaluationResultSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  templateId: z.string().uuid(),
  /** Bước workflow được chấm (gắn evaluation vào workflow step). */
  workflowStepId: z.string().uuid(),
  /** Người được đánh giá (chủ thể). */
  subjectUserId: z.string().uuid().nullable().optional(),
  evaluatorUserId: z.string().uuid(),
  /** Điểm tổng có trọng số (server tính). */
  totalScore: z.number().nullable(),
  scores: z.array(evaluationScoreSchema).optional(),
  createdAt: z.string().datetime(),
});
export type EvaluationResultDto = z.infer<typeof evaluationResultSchema>;

/** 1 điểm tiêu chí khi chấm. criteriaId bắt buộc; score là số hữu hạn. */
export const scoreInputSchema = z.object({
  criteriaId: z.string().uuid(),
  score: z.number().finite(),
  comment: z.string().max(2000).optional(),
});
export type ScoreInput = z.infer<typeof scoreInputSchema>;

/** Chấm điểm 1 bước workflow theo 1 template. Mỗi tiêu chí 1 điểm; không trùng criteriaId. */
export const recordScoresSchema = z
  .object({
    templateId: z.string().uuid(),
    workflowStepId: z.string().uuid(),
    subjectUserId: z.string().uuid().optional(),
    scores: z.array(scoreInputSchema).min(1).max(50),
  })
  .refine((d) => new Set(d.scores.map((s) => s.criteriaId)).size === d.scores.length, {
    message: "Trùng criteriaId trong scores",
    path: ["scores"],
  });
export type RecordScoresRequest = z.infer<typeof recordScoresSchema>;

export const listEvaluationTemplateQuerySchema = z.object({
  workflowStepCode: z.string().max(100).optional(),
  includeInactive: z.coerce.boolean().optional(),
});
export type ListEvaluationTemplateQuery = z.infer<typeof listEvaluationTemplateQuerySchema>;
