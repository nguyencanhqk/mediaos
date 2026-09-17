/**
 * S15-PAYROLL-FE-4 — hằng số dùng chung cho biểu đồ Recharts (DECISIONS-14 §3: Recharts là lớp VẼ, cổng quyền
 * nằm ở server).
 *
 * Màu là `var(--…)` của design system (`packages/ui/src/styles/theme.css`), KHÔNG mã hex rời: đổi theme
 * light/dark là đổi biến, biểu đồ không phải render lại. `--chart-1/2` đã qua bộ kiểm bảng màu (ghi chú ngay
 * cạnh token). Chuỗi thứ 3 trở đi KHÔNG tự sinh màu — gộp «Khác» hoặc tách biểu đồ.
 *
 * Quy ước vẽ (dataviz): cột ≤ 24 px, đầu dữ liệu bo 4 px (gốc vuông) · đường 2 px · điểm ≥ 8 px có viền nền
 * 2 px · vùng tô ~10 % · lưới/trục mảnh 1 px, liền, lùi về sau · chữ dùng token CHỮ, không mặc màu chuỗi.
 */
export const CHART_COLORS = {
  series1: "var(--chart-1)",
  series2: "var(--chart-2)",
  /** Hàng gộp «Khác» / mục phụ — xám lùi về sau, không phải một màu chuỗi. */
  muted: "var(--muted-foreground)",
  grid: "var(--border)",
  axisText: "var(--muted-foreground)",
  surface: "var(--card)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  /** Rãnh của meter = bậc nhạt của CÙNG họ màu với phần tô (dataviz: meter). */
  meterTrack: "var(--brand-muted)",
} as const;

export const CHART_BAR_MAX_SIZE = 24;
/** Bo 4 px ở đầu dữ liệu, vuông ở gốc — cột dọc: hai góc TRÊN; cột ngang: hai góc PHẢI. */
export const CHART_BAR_RADIUS_VERTICAL: [number, number, number, number] = [4, 4, 0, 0];
export const CHART_BAR_RADIUS_HORIZONTAL: [number, number, number, number] = [0, 4, 4, 0];
export const CHART_LINE_WIDTH = 2;
export const CHART_AREA_OPACITY = 0.1;
export const CHART_DOT = { r: 4, strokeWidth: 2, stroke: CHART_COLORS.surface } as const;
export const CHART_HEIGHT = 240;

export const CHART_AXIS_TICK = { fill: CHART_COLORS.axisText, fontSize: 12 } as const;

const compactVnd = new Intl.NumberFormat("vi-VN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Nhãn trục tiền gọn («12,5 Tr», «1,2 T»). Tooltip/bảng dùng số đầy đủ. */
export function formatCompactMoney(value: number): string {
  return compactVnd.format(value);
}
