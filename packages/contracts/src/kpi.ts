import { z } from "zod";

/**
 * G8-4 KPI cá nhân/team — định nghĩa công thức (trọng số 5 thành phần) + kết quả KPI (snapshot append-only).
 *
 * Nguồn sự thật DTO (api ↔ web). `kpi_results` là APPEND-ONLY (bất biến #2): tính lại / xác nhận = bản
 * ghi mới; KHÔNG UPDATE/DELETE. `kpi_definitions` mutable có kiểm soát (soft-delete deleted_at).
 *
 * BR-007: KPI ban đầu = THAM KHẢO. confirmedBy/confirmedAt mặc định NULL = chưa xác nhận; chỉ user có
 * quyền confirm:kpi (HR/quản lý) mới set qua bản snapshot MỚI (append-only). KHÔNG tự đẩy vào lương.
 *
 * Quy ước trọng số: tổng `weight` của 5 thành phần phải = 100 (KPI_WEIGHT_SUM).
 */

/** Tổng trọng số 5 thành phần KPI hợp lệ (phần trăm). */
export const KPI_WEIGHT_SUM = 100;

/** Sai số dấu phẩy động khi so tổng trọng số (song song với epsilon ở service). */
export const KPI_WEIGHT_EPSILON = 0.0001;

/** Điểm KPI tổng nằm trong [0, 100] (clamp ở service). */
export const KPI_SCORE_MIN = 0;
export const KPI_SCORE_MAX = 100;

// ─── Component weights (5 thành phần) ────────────────────────────────────────

/**
 * Trọng số 5 thành phần KPI. Tổng = 100 (refine). Mỗi trọng số ∈ [0, 100].
 *  - tasksDone:           hoàn thành khối lượng task (tỷ lệ task xong trên task đến hạn).
 *  - onTimeRate:          đúng deadline (tỷ lệ task xong đúng hạn).
 *  - evaluationScore:     điểm đánh giá chất lượng (G8-3 evaluation_results, thang 0..100).
 *  - defectScore:         ít lỗi (suy từ số lỗi loại 1/loại 2, G8-2 defects — càng ít lỗi điểm càng cao).
 *  - firstPassApprovalRate: tỷ lệ duyệt đạt ngay lần đầu (không bị trả sửa).
 */
export const kpiComponentWeightsSchema = z
  .object({
    tasksDone: z.number().min(0).max(100),
    onTimeRate: z.number().min(0).max(100),
    evaluationScore: z.number().min(0).max(100),
    defectScore: z.number().min(0).max(100),
    firstPassApprovalRate: z.number().min(0).max(100),
  })
  .refine(
    (w) =>
      Math.abs(
        w.tasksDone +
          w.onTimeRate +
          w.evaluationScore +
          w.defectScore +
          w.firstPassApprovalRate -
          KPI_WEIGHT_SUM,
      ) < KPI_WEIGHT_EPSILON,
    { message: `Tổng trọng số 5 thành phần phải bằng ${KPI_WEIGHT_SUM}`, path: ["weights"] },
  );
export type KpiComponentWeights = z.infer<typeof kpiComponentWeightsSchema>;

/** Khoá thành phần KPI — dùng cố định 5 thành phần (đồng bộ với weights + kết quả). */
export const KPI_COMPONENT_KEYS = [
  "tasksDone",
  "onTimeRate",
  "evaluationScore",
  "defectScore",
  "firstPassApprovalRate",
] as const;
export type KpiComponentKey = (typeof KPI_COMPONENT_KEYS)[number];

// ─── Definition ──────────────────────────────────────────────────────────────

export const kpiDefinitionSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  /** Trọng số 5 thành phần — tổng = 100. */
  weights: kpiComponentWeightsSchema,
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type KpiDefinitionDto = z.infer<typeof kpiDefinitionSchema>;

/** Tạo định nghĩa KPI (trọng số 5 thành phần, tổng = 100 ép ở refine + service + DB). */
export const createKpiDefinitionSchema = z.object({
  name: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  weights: kpiComponentWeightsSchema,
});
export type CreateKpiDefinitionRequest = z.infer<typeof createKpiDefinitionSchema>;

// ─── Compute request (snapshot append-only) ──────────────────────────────────

/**
 * Yêu cầu tính KPI cho 1 chủ thể (user HOẶC team) trong 1 kỳ [periodStart, periodEnd].
 * subjectUserId XOR subjectTeamId (đúng 1 trong 2) — chốt ở refine + service.
 */
export const computeKpiRequestSchema = z
  .object({
    definitionId: z.string().uuid(),
    subjectUserId: z.string().uuid().optional(),
    subjectTeamId: z.string().uuid().optional(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
  })
  .refine((d) => Boolean(d.subjectUserId) !== Boolean(d.subjectTeamId), {
    message: "Phải có đúng 1 chủ thể: subjectUserId HOẶC subjectTeamId",
    path: ["subjectUserId"],
  })
  .refine((d) => new Date(d.periodEnd) > new Date(d.periodStart), {
    message: "periodEnd phải sau periodStart",
    path: ["periodEnd"],
  });
export type ComputeKpiRequest = z.infer<typeof computeKpiRequestSchema>;

/** Xác nhận 1 kết quả KPI (BR-007: chỉ confirm:kpi). Tạo snapshot MỚI có cờ confirmed (append-only). */
export const confirmKpiResultSchema = z.object({
  kpiResultId: z.string().uuid(),
});
export type ConfirmKpiResultRequest = z.infer<typeof confirmKpiResultSchema>;

// ─── Result (snapshot append-only) ───────────────────────────────────────────

/** Các chỉ số thành phần ĐÃ TÍNH (thang 0..100) của 1 snapshot KPI. */
export const kpiComponentScoresSchema = z.object({
  tasksDone: z.number(),
  onTimeRate: z.number(),
  evaluationScore: z.number(),
  defectScore: z.number(),
  firstPassApprovalRate: z.number(),
});
export type KpiComponentScores = z.infer<typeof kpiComponentScoresSchema>;

export const kpiResultSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  definitionId: z.string().uuid(),
  subjectUserId: z.string().uuid().nullable().optional(),
  subjectTeamId: z.string().uuid().nullable().optional(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  /** Điểm thành phần đã tính (0..100). */
  components: kpiComponentScoresSchema,
  /** Điểm KPI tổng có trọng số, clamp [0,100]. */
  totalScore: z.number(),
  /** BR-007: NULL = chưa xác nhận = THAM KHẢO. Set qua confirm:kpi (snapshot mới). readonly snapshot. */
  confirmedBy: z.string().uuid().nullable(),
  confirmedAt: z.string().datetime().nullable(),
  computedBy: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type KpiResultDto = z.infer<typeof kpiResultSchema>;

export const listKpiDefinitionQuerySchema = z.object({
  includeInactive: z.coerce.boolean().optional(),
});
export type ListKpiDefinitionQuery = z.infer<typeof listKpiDefinitionQuerySchema>;

// ─── List results query (lịch sử KPI — read:kpi, server lọc scope) ───────────

/** Trần số bản ghi lịch sử KPI trả về 1 lần (chống quét toàn bảng). */
export const KPI_RESULT_LIST_LIMIT_DEFAULT = 50;
export const KPI_RESULT_LIST_LIMIT_MAX = 200;

/**
 * Filter cho GET /kpi/results (lịch sử kết quả KPI, mới nhất trước). MỌI filter tuỳ chọn; quyền
 * xem do SERVER quyết (employee chỉ của-mình — KHÔNG dựa subjectUserId client). `subjectUserId`/
 * `subjectTeamId` chỉ có hiệu lực cho người có quyền rộng (confirm:kpi / manage:kpi-definition);
 * với employee thường, server BỎ QUA và ép scope của-mình (fail-closed, không lộ KPI người khác).
 *
 * LƯU Ý coerce.boolean: chuỗi không rỗng đều → true (kể cả "false"). FE CHỈ gắn `confirmedOnly=true`
 * khi bật filter (mirror includeInactive); confirmedOnly chỉ THU HẸP kết quả → không rò dữ liệu.
 */
export const listKpiResultQuerySchema = z.object({
  definitionId: z.string().uuid().optional(),
  subjectUserId: z.string().uuid().optional(),
  subjectTeamId: z.string().uuid().optional(),
  periodFrom: z.string().datetime().optional(),
  periodTo: z.string().datetime().optional(),
  confirmedOnly: z.coerce.boolean().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(KPI_RESULT_LIST_LIMIT_MAX)
    .default(KPI_RESULT_LIST_LIMIT_DEFAULT),
});
export type ListKpiResultQuery = z.infer<typeof listKpiResultQuerySchema>;

/** Response GET /kpi/results — mảng snapshot KPI (mới nhất trước). Tái dùng kpiResultSchema. */
export const listKpiResultResponseSchema = z.array(kpiResultSchema);
