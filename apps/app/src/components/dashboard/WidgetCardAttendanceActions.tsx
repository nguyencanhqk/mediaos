/**
 * WidgetCardAttendanceActions — S20-DASH-QUICKACTION-1 (US-X-04): Check-in/Check-out NGAY trên widget.
 *
 * Quick action `API_CALL` của DASH chỉ là metadata (API-08 §8.4 — DASH không tự thực thi nghiệp vụ gốc), nên
 * WidgetCard KHÔNG gọi `api_endpoint` server gửi một cách tổng quát. Với đúng hai mã CHECK_IN/CHECK_OUT nó
 * render lại luồng chấm công sẵn có của ATT: `useAttendanceToday` (allowedActions/kỳ khoá do server quyết) +
 * `CheckInOutActions` (`useCheckIn`/`useCheckOut` — invalidate ATT today khi server xác nhận). Widget chỉ
 * tải lại SAU khi server xác nhận (`onConfirmed`); server từ chối ⇒ lý do hiện tại chỗ, widget giữ nguyên.
 */
import type { QuickActionDto } from "@mediaos/contracts";
import { CheckInOutActions } from "@/routes/attendance/CheckInOutActions";
import { useAttendanceToday } from "@/routes/attendance/hooks/useAttendanceToday";

/** Mã quick action ATT mà widget tự render bằng luồng chấm công (không gọi `api_endpoint` tổng quát). */
export const ATTENDANCE_QUICK_ACTION_CODES: ReadonlySet<string> = new Set([
  "CHECK_IN",
  "CHECK_OUT",
]);

export function hasAttendanceQuickAction(actions: readonly QuickActionDto[] | undefined): boolean {
  return (actions ?? []).some(
    (a) => a.enabled && a.method === "API_CALL" && ATTENDANCE_QUICK_ACTION_CODES.has(a.action_code),
  );
}

export function WidgetCardAttendanceActions({ onConfirmed }: { onConfirmed: () => void }) {
  const today = useAttendanceToday(true);
  // Đang tải / lỗi tải trạng thái hôm nay ⇒ không có nút nào (không đoán allowedActions phía client).
  if (!today.data) return null;
  return <CheckInOutActions data={today.data} variant="inline" onConfirmed={onConfirmed} />;
}
