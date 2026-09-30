/**
 * S16-SOCIAL-FE-2C — tháng của vinh danh (plan D11), dạng `YYYY-MM` của `047?month=`.
 *
 * ┌─ 🔴 THÁNG THEO GIỜ CÔNG TY, KHÔNG THEO MÁY ─────────────────────────────────────────────────────┐
 * │ Server cắt biên tháng theo `companies.timezone` (`social-kudos.repository.ts#listKudosTx`). Tính │
 * │ «tháng này» bằng `new Date().getMonth()` là đọc múi giờ CỦA MÁY: 00:30 ngày 1/10 giờ VN vẫn là   │
 * │ tháng 9 trên máy UTC ⇒ widget hỏi nhầm tháng. Múi giờ đọc qua `companyTimeZone()` — điểm đọc     │
 * │ DUY NHẤT (`routes/rooms/room-time.ts`); helper `currentMonth()` của attendance/leave là tiền lệ  │
 * │ SAI cho việc này.                                                                                  │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ `047` VẮNG `month` = vinh danh GẦN ĐÂY, không phải tháng này ⇒ mọi nơi gọi phải gửi tháng tường minh.
 */
import { kudosMonthSchema } from "@mediaos/contracts";
import { companyTimeZone, partsIn } from "@/routes/rooms/room-time";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `YYYY-MM` hợp lệ với `kudosMonthSchema` (năm 1900–2099) — chỉ nhận CHUỖI. */
export function isKudosMonth(value: unknown): value is string {
  return typeof value === "string" && kudosMonthSchema.safeParse(value).success;
}

/** Tháng hiện tại theo giờ công ty. Tính lại mỗi lần gọi (không memo) — tab mở qua nửa đêm cuối tháng tự sang tháng mới. */
export function currentKudosMonth(now: Date = new Date()): string {
  const p = partsIn(now, companyTimeZone());
  return `${p.year}-${pad2(p.month)}`;
}

/** Dịch `delta` tháng bằng số học chuỗi (không cần múi giờ). Ra ngoài 1900-01..2099-12 ⇒ `null`. */
export function shiftKudosMonth(month: string, delta: number): string | null {
  if (!isKudosMonth(month)) return null;
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const next = `${Math.floor(total / 12)}-${pad2((total % 12) + 1)}`;
  return isKudosMonth(next) ? next : null;
}

/** `{year, month}` (month 1..12) để i18n dựng nhãn «Tháng 9/2026». */
export function kudosMonthParts(month: string): { year: number; month: number } {
  const [year, m] = month.split("-").map(Number);
  return { year, month: m };
}
