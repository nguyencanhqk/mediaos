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
