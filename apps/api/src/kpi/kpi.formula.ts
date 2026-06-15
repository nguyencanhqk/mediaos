import { ConflictException } from "@nestjs/common";
import {
  KPI_SCORE_MAX,
  KPI_SCORE_MIN,
  KPI_WEIGHT_EPSILON,
  KPI_WEIGHT_SUM,
  type KpiComponentScores,
  type KpiComponentWeights,
} from "@mediaos/contracts";

export { KPI_SCORE_MAX, KPI_SCORE_MIN };

/**
 * G8-4 — Công thức KPI THUẦN (không I/O). Tách khỏi service để test biên dày (chia-cho-0, thiếu dữ
 * liệu, tổng trọng số, clamp). BR-007: kết quả = THAM KHẢO; service gắn quyền + append-only quanh đây.
 */

/** Số lỗi quy ra điểm trừ: mỗi lỗi loại-1 nặng hơn loại-2 (trọng số penalty). Hằng số nghiệp vụ. */
const DEFECT_TYPE1_PENALTY = 10;
const DEFECT_TYPE2_PENALTY = 5;

/** Số liệu THÔ tổng hợp từ DB cho 1 chủ thể/kỳ (repository điền). Mọi field đã là số hữu hạn / null. */
export interface KpiRawMetrics {
  /** Số task đến hạn trong kỳ (mẫu số tỷ lệ hoàn thành / đúng hạn). */
  tasksDue: number;
  /** Số task đã hoàn thành (completed/approved) trong kỳ. */
  tasksDone: number;
  /** Số task hoàn thành ĐÚNG hạn (completed_at <= due_date). */
  tasksOnTime: number;
  /** Điểm đánh giá trung bình (G8-3, thang 0..100) — null nếu KHÔNG có evaluation kỳ này. */
  evaluationAvg: number | null;
  /** Số lỗi loại 1 (nặng) trong kỳ (G8-2 defects). */
  defectsType1: number;
  /** Số lỗi loại 2 (nhẹ) trong kỳ. */
  defectsType2: number;
  /** Tổng số lần duyệt trong kỳ (mẫu số tỷ lệ duyệt đạt lần đầu). */
  approvalsTotal: number;
  /** Số lần duyệt ĐẠT NGAY lần đầu (không bị trả sửa). */
  approvalsFirstPass: number;
}

/** Tỷ lệ an toàn: mẫu số rỗng/không hợp lệ → 0 (KHÔNG NaN/Infinity); kết quả clamp [0,100]. */
function safeRatePercent(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  if (!Number.isFinite(numerator) || numerator <= 0) return 0;
  return clampScore((numerator / denominator) * 100);
}

/** Ép giá trị vào [0,100] (clamp điểm/tỷ lệ). Non-finite → 0 (fail-safe). */
export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return KPI_SCORE_MIN;
  if (value < KPI_SCORE_MIN) return KPI_SCORE_MIN;
  if (value > KPI_SCORE_MAX) return KPI_SCORE_MAX;
  return value;
}

/**
 * Quy số liệu thô → 5 điểm thành phần (thang 0..100), xác định kể cả khi thiếu dữ liệu:
 *  - tasksDone / onTimeRate: tỷ lệ trên task đến hạn (mẫu số 0 → 0, không chia-cho-0).
 *  - evaluationScore: evaluationAvg (clamp) hoặc 0 nếu null (thiếu evaluation → 0 xác định).
 *  - defectScore: 100 - penalty(lỗi), clamp ≥0 (0 lỗi → 100; nhiều lỗi → giảm, không âm).
 *  - firstPassApprovalRate: tỷ lệ duyệt đạt lần đầu (mẫu số 0 → 0).
 */
export function aggregateComponentScores(raw: KpiRawMetrics): KpiComponentScores {
  const defectPenalty =
    raw.defectsType1 * DEFECT_TYPE1_PENALTY + raw.defectsType2 * DEFECT_TYPE2_PENALTY;

  return {
    tasksDone: safeRatePercent(raw.tasksDone, raw.tasksDue),
    onTimeRate: safeRatePercent(raw.tasksOnTime, raw.tasksDue),
    evaluationScore: raw.evaluationAvg === null ? 0 : clampScore(raw.evaluationAvg),
    defectScore: clampScore(KPI_SCORE_MAX - defectPenalty),
    firstPassApprovalRate: safeRatePercent(raw.approvalsFirstPass, raw.approvalsTotal),
  };
}

/** Tổng trọng số 5 thành phần phải = 100 (song song refine Zod + CHECK ở DB). Lệch → ConflictException. */
export function assertWeightSum(weights: KpiComponentWeights): void {
  const sum =
    weights.tasksDone +
    weights.onTimeRate +
    weights.evaluationScore +
    weights.defectScore +
    weights.firstPassApprovalRate;
  if (Math.abs(sum - KPI_WEIGHT_SUM) > KPI_WEIGHT_EPSILON) {
    throw new ConflictException(`Tổng trọng số 5 thành phần phải bằng ${KPI_WEIGHT_SUM} (hiện ${sum}).`);
  }
}

/**
 * Điểm KPI tổng = Σ (componentScore * weight) / 100, clamp [0,100].
 * Trọng số tổng phải = 100 (assert → ConflictException). Mỗi component đã ∈ [0,100].
 */
export function computeKpiTotalScore(
  weights: KpiComponentWeights,
  components: KpiComponentScores,
): number {
  assertWeightSum(weights);
  const weighted =
    components.tasksDone * weights.tasksDone +
    components.onTimeRate * weights.onTimeRate +
    components.evaluationScore * weights.evaluationScore +
    components.defectScore * weights.defectScore +
    components.firstPassApprovalRate * weights.firstPassApprovalRate;
  return clampScore(weighted / KPI_WEIGHT_SUM);
}
