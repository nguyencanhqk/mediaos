import { z } from "zod";

/**
 * AI-1 — AI Insight (read-only): tóm tắt KPI + chi phí ĐÃ MASK theo permission qua Claude API.
 *
 * Nguồn sự thật DTO (api ↔ web). Module AI hoàn toàn READ-ONLY: chỉ SELECT kpi_results + cost_records
 * (đã mask SERVER-side), build prompt, gọi Claude → trả summary text. KHÔNG ghi DB, KHÔNG bảng mới,
 * KHÔNG audit/outbox.
 *
 * BẤT BIẾN #3 (mở rộng): số tiền nhạy cảm (cost amount) MASK trước khi nhúng vào prompt LLM nếu caller
 * thiếu view-finance(isSensitive). Output DTO KHÔNG chứa field tiền thô — chỉ summary + meta model id.
 */

/** Model id cho insight — allowlist KHỚP env (AI_MODEL allowlist). KHÔNG hậu tố ngày (404). */
export const AI_MODEL_IDS = ["claude-opus-4-8", "claude-sonnet-4-6"] as const;
export const aiModelIdSchema = z.enum(AI_MODEL_IDS);
export type AiModelId = z.infer<typeof aiModelIdSchema>;

/** Phạm vi tổng hợp insight — kỳ KPI/chi phí. Tất cả OPTIONAL, default ở service. */
export const AI_INSIGHT_PERIODS = ["month", "quarter", "year"] as const;
export const aiInsightPeriodEnum = z.enum(AI_INSIGHT_PERIODS);
export type AiInsightPeriod = z.infer<typeof aiInsightPeriodEnum>;

/** Phạm vi đối tượng tổng hợp — toàn công ty hoặc theo người dùng/đội (server vẫn ép RLS + scope). */
export const AI_INSIGHT_SCOPES = ["company", "team", "self"] as const;
export const aiInsightScopeEnum = z.enum(AI_INSIGHT_SCOPES);
export type AiInsightScope = z.infer<typeof aiInsightScopeEnum>;

/**
 * Query GET /ai/insight. Mọi field OPTIONAL + validate ở boundary (ZodValidationPipe). companyId/userId
 * KHÔNG ở đây — lấy từ req.user (KHÔNG tin client). subjectUserId/Team chỉ là gợi ý lọc; server ép scope.
 */
export const aiInsightQuerySchema = z.object({
  period: aiInsightPeriodEnum.default("month"),
  scope: aiInsightScopeEnum.default("company"),
  /** Số dòng tối đa mỗi nguồn (KPI/cost) đưa vào prompt — clamp chống prompt quá dài. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
  definitionId: z.string().uuid().optional(),
  subjectUserId: z.string().uuid().optional(),
  subjectTeamId: z.string().uuid().optional(),
});
export type AiInsightQuery = z.infer<typeof aiInsightQuerySchema>;

/**
 * Output GET /ai/insight. CHỈ summary (text Claude sinh) + meta. KHÔNG field tiền thô / dữ liệu nhạy cảm
 * (bất biến #3): nếu caller không có view-finance, số tiền đã MASK trước khi vào prompt ⇒ summary cũng
 * không chứa số thật. `financeMasked` báo client biết phần tài chính đã bị ẩn (UI hint).
 */
export const aiInsightSchema = z.object({
  /** Tóm tắt do model sinh (đã qua masking layer; KHÔNG số tiền thật khi thiếu quyền). */
  summary: z.string(),
  /** Model id thực dùng (allowlist). */
  model: aiModelIdSchema,
  period: aiInsightPeriodEnum,
  scope: aiInsightScopeEnum,
  /** true = số tiền (cost) đã bị mask vì caller thiếu view-finance(isSensitive). */
  financeMasked: z.boolean(),
  /** Số bản ghi KPI đưa vào tổng hợp (đã qua RLS + scope). */
  kpiCount: z.number().int().min(0),
  /** Số bản ghi cost đưa vào tổng hợp (đã qua RLS). */
  costCount: z.number().int().min(0),
  generatedAt: z.string().datetime(),
});
export type AiInsightDto = z.infer<typeof aiInsightSchema>;
