import type { LeaveCalendarEntryDto } from "@mediaos/contracts";
import type { CalendarRow } from "./leave-calendar.repository";

/**
 * S3-LEAVE-BE-5 — row → DTO mapper for GET /leave/calendar. MASK (crown-adjacent, not a permission gate but
 * a privacy default): `reason` is returned ONLY for the caller's OWN rows (`row.userId === actorUserId`) —
 * every other row (teammate/company-wide) always gets `reason: null`, regardless of the requested scope.
 * This is a hard rule (no extra grant unmasks it) — the calendar is "who's off when", not the approval
 * detail view (that surface is GET /leave/requests, already gated on view:leave separately).
 * Loại nghỉ (id/code/name) chỉ trả khi `canSeeType` (xem leave-calendar-type-visibility.ts); ngược lại null +
 * `leaveTypeMasked=true`. Server quyết định — client chỉ hiển thị.
 */
export function toCalendarEntryView(
  row: CalendarRow,
  actorUserId: string,
  canSeeType: boolean,
): LeaveCalendarEntryDto {
  const isOwn = row.userId === actorUserId;
  return {
    id: row.id,
    userId: row.userId,
    userFullName: row.userFullName,
    employeeCode: row.employeeCode,
    leaveTypeId: canSeeType ? row.leaveTypeId : null,
    leaveTypeCode: canSeeType ? row.leaveTypeCode : null,
    leaveTypeName: canSeeType ? row.leaveTypeName : null,
    leaveTypeMasked: !canSeeType,
    startDate: row.startDate,
    endDate: row.endDate,
    totalDays: Number(row.totalDays),
    status: row.status,
    reason: isOwn ? row.reason : null,
  };
}
