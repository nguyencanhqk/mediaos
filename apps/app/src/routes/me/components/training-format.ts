/**
 * training-format — helper THUẦN (không JSX) cho card/trang Đào tạo (S5-LMS-FE-1).
 *
 * Contract `me-training.ts` cố ý "PIN SHAPE, KHÔNG PIN GIÁ TRỊ": số học chỉ `nonnegative()`, KHÔNG chặn
 * trên (dòng dị thường `completed > total` KHÔNG làm 502). CHUẨN HOÁ ĐỂ HIỂN THỊ là việc của FE (ghi chú
 * trong me-training.ts §KỶ LUẬT SCHEMA) — nên clamp % về 0–100 Ở ĐÂY trước khi vẽ thanh tiến độ.
 */
import type { MeTrainingCourse } from "@mediaos/contracts";

/** Kẹp % về [0,100] + làm tròn — dùng cho thanh tiến độ (contract không chặn trên, xem ghi chú đầu file). */
export function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

/** Số giờ/phút từ tổng giây (làm tròn phút). Component ghép chuỗi i18n từ 2 số này. */
export function learningTimeParts(totalSeconds: number): { hours: number; minutes: number } {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const totalMinutes = Math.floor(safe / 60);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

/**
 * Khoá "gần đây nhất" cho card Tổng quan (% gần nhất) — chọn theo `lastActivityAt` mới nhất; khoá chưa có
 * hoạt động (null) xếp sau. Rỗng ⇒ null. So sánh chuỗi ISO-8601 an toàn theo thứ tự từ điển (cùng offset).
 */
export function pickRecentCourse(courses: readonly MeTrainingCourse[]): MeTrainingCourse | null {
  if (courses.length === 0) return null;
  return courses.reduce<MeTrainingCourse>((best, c) => {
    if (!c.lastActivityAt) return best;
    if (!best.lastActivityAt) return c;
    return c.lastActivityAt > best.lastActivityAt ? c : best;
  }, courses[0]);
}
