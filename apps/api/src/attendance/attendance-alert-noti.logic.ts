/**
 * S10-ATT-NOTIPROD-1 — logic THUẦN (không DB, không DI) cho detector 3 sự kiện NOTI ATT đã seed trong
 * catalog nhưng KHÔNG AI PHÁT (RELEASE-02 §KI-021): `ATT_MISSING_CHECKOUT` · `ATT_LATE_DETECTED` ·
 * `ATT_ABSENT_DETECTED`. Hạ tầng NOTI đã sẵn — catalog (migration 0481:59-61), template vi-VN
 * (0481:153-163, placeholder `{work_date}` cả 3 mã + `{employee_name}` cho MISSING_CHECKOUT/ABSENT),
 * deep-link `/attendance/today` (migration 0497:59-61). KHÔNG migration mới ở WO này.
 *
 * Tách khỏi repository/job-handler để mọi biên (tz, ca đêm cross_day, ổn định dedupe key, clamp
 * interval) test được KHÔNG cần Postgres — mirror pattern attendance.logic.ts (G11-1).
 */

import { addDaysToLocalDate, weekdayOfLocalDate, wallTimeToInstant } from "../common/tz.util";
import type { ShiftCalc } from "./attendance.logic";

// ─── identifiers ────────────────────────────────────────────────────────────

/** jobCode DUY NHẤT toàn hệ — khoá `system_job_locks` + `system_job_runs.job_code`. */
export const ATT_ALERT_DETECT_JOB_CODE = "ATT_ALERT_DETECT";

export const ATT_MISSING_CHECKOUT_EVENT = "ATT_MISSING_CHECKOUT";
export const ATT_LATE_DETECTED_EVENT = "ATT_LATE_DETECTED";
export const ATT_ABSENT_DETECTED_EVENT = "ATT_ABSENT_DETECTED";

// ─── trần bán kính (chốt #21/#22/#25 — TRẦN AN TOÀN, KHÔNG phải backfill) ───

/** Trần bản ghi ứng viên THÔ lấy về mỗi mã/lượt (trước khi loại tập "đã từng phát" + áp trần phát). */
export const ATT_ALERT_RAW_FETCH_CAP = 600;
/** Trần SỐ NOTIFICATION thật sự phát mỗi mã/lượt chạy (chốt #22 — áp SAU khi loại "đã từng phát"). */
export const ATT_ALERT_BATCH_CAP = 200;
/** Trần số nhân viên active quét khi dò vắng mặt (anti-join set-based, chống quét vô hạn công ty lớn). */
export const ATT_ALERT_EMPLOYEE_SCAN_CAP = 1000;
/**
 * Cửa sổ NGÀY-CANDIDATE quét vắng mặt — TRẦN AN TOÀN phủ ca đêm (chốt #25: "[today-1, today]"),
 * TUYỆT ĐỐI KHÔNG phải backfill lịch sử (vắng mặt 30 ngày trước ⇒ 0 thông báo, done_when).
 */
export const ATT_ALERT_LOOKBACK_DAYS = 1;

// ─── throttle (chốt #16/#23 — khoá THEO companyId, clamp mức NGÀY) ──────────

/** Nhịp mặc định 1 lần/ngày — detector theo lô cuối-ngày (chốt #23), KHÔNG cần quét dày như dashboard MV. */
export const DEFAULT_ATT_ALERT_DETECT_INTERVAL_MS = 24 * 60 * 60_000;
const MIN_ATT_ALERT_DETECT_INTERVAL_MS = 5 * 60_000;
/** Trần NGÀY (chốt #23 — khác biên [30s,1h] của dashboard-mv-refresh: quét NGÀY chạy 24 lượt/ngày vô nghĩa). */
const MAX_ATT_ALERT_DETECT_INTERVAL_MS = 24 * 60 * 60_000;

/**
 * Parse-an-toàn + clamp [5 phút, 24h] — mirror NGUYÊN KHUÔN `resolveDashboardMvRefreshIntervalMs`
 * (dashboard-mv-refresh.job-handler.ts:14-42). Rác/NaN/ngoài biên → mặc định, KHÔNG ném. Biến
 * `ATT_ALERT_DETECT_INTERVAL_MS` CỐ Ý NGOÀI `config/env.schema.ts` (ngoài paths lane này — ghi nợ RELEASE-02).
 */
export function resolveAttAlertDetectIntervalMs(
  raw: string | undefined = process.env.ATT_ALERT_DETECT_INTERVAL_MS,
): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_ATT_ALERT_DETECT_INTERVAL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return DEFAULT_ATT_ALERT_DETECT_INTERVAL_MS;
  }
  if (parsed < MIN_ATT_ALERT_DETECT_INTERVAL_MS || parsed > MAX_ATT_ALERT_DETECT_INTERVAL_MS) {
    return DEFAULT_ATT_ALERT_DETECT_INTERVAL_MS;
  }
  return parsed;
}

// ─── biên "ngày ĐÃ ĐÓNG" theo ca CỦA CHÍNH NHÂN VIÊN (chốt #17/#18) ─────────

/**
 * Instant kết thúc ca của `workDate` — đọc CỘT `shift.crossDay` (KHÔNG suy bằng so sánh giờ, chốt #17:
 * `isOvernight()` legacy trong attendance.logic.ts KHÔNG phải nguồn sự thật của ca mới). `null` khi ca
 * thiếu `end_time` (chốt #18 — FAIL-CLOSED, KHÔNG suy đoán biên).
 */
export function shiftEndInstant(workDate: string, shift: ShiftCalc): Date | null {
  if (!shift.endTime) return null;
  const endDate = shift.crossDay ? addDaysToLocalDate(workDate, 1) : workDate;
  return wallTimeToInstant(endDate, shift.endTime, shift.timezone);
}

/** `true` nếu `now` đã qua mốc kết thúc ca của `workDate` — "ngày ĐÃ ĐÓNG" theo ca của CHÍNH nhân viên. */
export function isWorkDateClosed(now: Date, workDate: string, shift: ShiftCalc): boolean {
  const end = shiftEndInstant(workDate, shift);
  return end !== null && now.getTime() >= end.getTime();
}

/** Ca có làm việc vào `workDate` không, theo `shift.work_days` (mảng ISO 1..7). `null` = KHUYẾT (chốt #18). */
export function isShiftWorkingDay(workDate: string, workDays: number[] | null): boolean {
  if (workDays === null) return false;
  return workDays.includes(weekdayOfLocalDate(workDate));
}

// ─── dedupe key (chốt #1b/#19 — nguồn ĐÓNG BĂNG, KHÔNG new Date()/Date.now() tại điểm phát) ─────────

/**
 * Khoá THÔ (trước khi engine gắn `${eventCode}:`) cho missing-checkout/late — `${recordId}:${workDate}`.
 * `workDate` LUÔN là cột DB đã ghi (nguồn đóng băng) — hàm này KHÔNG nhận `now`/đọc đồng hồ.
 */
export function buildRecordDedupeKey(recordId: string, workDate: string): string {
  return `${recordId}:${workDate}`;
}

/** Khoá THÔ cho vắng mặt — `${employeeId}:${closedWorkDate}` (closedWorkDate suy từ biên đóng, KHÔNG từ `now`). */
export function buildAbsentDedupeKey(employeeId: string, closedWorkDate: string): string {
  return `${employeeId}:${closedWorkDate}`;
}

/**
 * Khoá LƯU TRONG DB thật sự (dedupe_key cột `notifications`) — PHẢI khớp
 * `NotificationDedupeService.computeKey` strategy `'DedupeKey'` (notification-dedupe.service.ts:78):
 * `${eventCode}:${dto.dedupeKey}`. Repository/job-handler PHẢI dùng ĐÚNG hàm này để dò tập "đã từng phát"
 * — tự nối chuỗi lần 2 ở nơi khác là nguồn trôi khỏi nhau (chốt #19: thiếu khớp ⇒ tập "đã phát" luôn rỗng,
 * chống-hồi-sinh chết IM LẶNG).
 */
export function storedDedupeKey(eventCode: string, rawDedupeKey: string): string {
  return `${eventCode}:${rawDedupeKey}`;
}

// ─── payload (khớp ĐÚNG placeholder template migration 0481:153-163) ───────

// `extends Record<string, unknown>` (KHÔNG chỉ literal shape) — khớp
// `InternalEventIntakeDto.payload` (`z.record(z.unknown())`, packages/contracts/src/notification.ts:137).
export interface AttAlertPayload extends Record<string, unknown> {
  work_date: string;
  employee_name?: string;
}

export function buildMissingCheckoutPayload(
  workDate: string,
  employeeName: string,
): AttAlertPayload {
  return { work_date: workDate, employee_name: employeeName };
}

/** LATE template CHỈ có `{work_date}` (0481:157-160) — KHÔNG `employee_name`. */
export function buildLatePayload(workDate: string): AttAlertPayload {
  return { work_date: workDate };
}

export function buildAbsentPayload(workDate: string, employeeName: string): AttAlertPayload {
  return { work_date: workDate, employee_name: employeeName };
}
