import type { GoalStatusDto } from "@mediaos/contracts";

/**
 * S5-GOAL-FE-1 — helper THUẦN (không i18n, không React) để test được độc lập. Nhãn enum (level/mode/
 * status/period) render qua i18n namespace `goals` trong component; ở đây chỉ logic số + trạng thái.
 *
 * LUẬT LÕI (SPEC-10 §13.2): `progressPercent === null` = "CHƯA ĐO" → hiển thị "—", TUYỆT ĐỐI KHÔNG "0%"
 * (0% là thông tin SAI khi chưa có dữ liệu). `progressPercent === 0` (đã đo, thực sự 0%) → "0%".
 */

/** Định dạng % tiến độ. NULL ("chưa đo") → "—"; số → làm tròn kèm "%". 0 (đã đo) → "0%" (KHÁC "—"). */
export function formatProgress(progressPercent: number | null): string {
  if (progressPercent === null || progressPercent === undefined) return "—";
  return `${Math.round(progressPercent)}%`;
}

/** true khi mục tiêu CHƯA ĐO (progress NULL) — dùng để hiện cảnh báo "chưa gắn việc/chưa có dữ liệu". */
export function isUnmeasured(progressPercent: number | null): boolean {
  return progressPercent === null || progressPercent === undefined;
}

/** Bề rộng thanh tiến độ 0..100 (NULL/không hữu hạn → 0; KHÔNG dùng cho phần chữ — chỉ hình học thanh). */
export function clampPercent(progressPercent: number | null): number {
  if (
    progressPercent === null ||
    progressPercent === undefined ||
    !Number.isFinite(progressPercent)
  ) {
    return 0;
  }
  return Math.max(0, Math.min(100, progressPercent));
}

/** Variant Badge cho trạng thái goal (Badge @mediaos/ui: default|secondary|brand|outline|success|warning|danger|muted). */
export function goalStatusBadgeVariant(
  status: GoalStatusDto,
): "success" | "brand" | "danger" | "muted" {
  switch (status) {
    case "Active":
      return "success";
    case "Completed":
      return "brand";
    case "Cancelled":
      return "danger";
    case "Draft":
    default:
      return "muted";
  }
}

/**
 * Định dạng kỳ từ 2 chuỗi DATE-only `YYYY-MM-DD` (cột `date`, KHÔNG timestamp) → "DD/MM/YYYY – DD/MM/YYYY".
 * THUẦN chuỗi (KHÔNG `new Date()` — tránh lệch timezone khi parse date-only). Chuỗi lạ → giữ nguyên.
 */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/** Kỳ hiển thị "DD/MM/YYYY – DD/MM/YYYY". */
export function formatPeriod(
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined,
): string {
  return `${formatDateOnly(periodStart)} – ${formatDateOnly(periodEnd)}`;
}

// ── S20-GOAL-QUICKSTART-1 (APPEND) — trạng thái một chạm (US-GOAL-NV-02/04) ───────────────────────

/** Ngưỡng gợi ý «Đánh dấu Hoàn thành» (SPEC-10 §12: chỉ GỢI Ý, không tự đổi trạng thái). */
export const GOAL_COMPLETE_SUGGEST_PERCENT = 100;

/** Phần chung của mục tiêu mà các luật dưới đây cần (Core lẫn Detail DTO đều có). */
interface GoalStatusFacts {
  readonly status: GoalStatusDto;
  readonly finalizedAt: string | null;
  readonly progressPercent: number | null;
}

/**
 * Vì sao Check-in đang khoá — null = check-in được. Chốt kỳ xét TRƯỚC (GOAL-ERR-005 khoá mọi thao tác
 * ghi, kể cả khi đang Nháp); Nháp tách riêng vì có lối tắt «Kích hoạt»; Hoàn thành/Đã huỷ = «không còn
 * chạy» (GOAL-ERR-006 chỉ nhận Active).
 */
export type GoalCheckinLockReason = "finalized" | "draft" | "notActive";

export function goalCheckinLockReason(goal: GoalStatusFacts): GoalCheckinLockReason | null {
  if (goal.finalizedAt) return "finalized";
  if (goal.status === "Draft") return "draft";
  if (goal.status !== "Active") return "notActive";
  return null;
}

/**
 * Gợi ý «Đã đạt 100%. Đánh dấu Hoàn thành?»: Active · chưa chốt · đã đo và ≥ 100. NULL («chưa đo») và
 * 99,5 KHÔNG gợi ý; Completed mà % tụt xuống không bao giờ tự đổi (hàm chỉ trả cờ hiển thị).
 */
export function shouldSuggestCompletion(goal: GoalStatusFacts): boolean {
  return (
    goal.status === "Active" &&
    !goal.finalizedAt &&
    goal.progressPercent !== null &&
    goal.progressPercent !== undefined &&
    goal.progressPercent >= GOAL_COMPLETE_SUGGEST_PERCENT
  );
}

const MONTHS_PER_QUARTER = 3;

/**
 * Nhãn kỳ gọn: Quý ⇒ «Q4/2026», Năm ⇒ «2026», Tuỳ chỉnh ⇒ «DD/MM/YYYY – DD/MM/YYYY». THUẦN chuỗi (cột
 * `date`, không đổi múi); ngày lạ ⇒ rơi về dạng khoảng ngày.
 */
export function goalPeriodLabel(goal: {
  readonly periodType: "quarter" | "year" | "custom";
  readonly periodStart: string;
  readonly periodEnd: string;
}): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(goal.periodStart);
  if (match && goal.periodType === "quarter") {
    const quarter = Math.ceil(Number(match[2]) / MONTHS_PER_QUARTER);
    return `Q${quarter}/${match[1]}`;
  }
  if (match && goal.periodType === "year") return match[1] as string;
  return formatPeriod(goal.periodStart, goal.periodEnd);
}
