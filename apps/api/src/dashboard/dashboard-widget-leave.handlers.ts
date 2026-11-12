/**
 * Handler widget LEAVE_CALENDAR (slug `leave-calendar`) — tách khỏi `dashboard-widget-handlers.service.ts`
 * (đã sát trần 800 dòng của CLAUDE.md §5). Registry vẫn là MỘT: `buildRegistry` gọi sang đây.
 *
 * Nguồn = `LeaveCalendarService.listCalendar(scope=team)`: server đã áp data-scope VÀ che loại nghỉ theo
 * người xem; widget chỉ chép lại các trường đó (kể cả `leaveTypeMasked`), không tự suy loại nghỉ.
 */
import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { LeaveCalendarService } from "../leave/leave-calendar.service";
import { addDaysToLocalDate, localDateOf } from "../common/tz.util";
import { resolveCompanyTz } from "./dashboard-company-tz.util";
import { DASH_WIDGET_LIST_CAP } from "./dashboard-widget-data.const";
import type { WidgetFetchResult, WidgetHandlerContext } from "./dashboard-widget-data.types";

/** LEAVE_CALENDAR: cửa sổ lịch nghỉ team [hôm nay, +N ngày) theo TZ công ty. */
const LEAVE_CALENDAR_WINDOW_DAYS = 30;

@Injectable()
export class DashboardWidgetLeaveHandlers {
  constructor(
    private readonly db: DatabaseService,
    private readonly leaveCalendar: LeaveCalendarService,
  ) {}

  // ── LEAVE_CALENDAR (LeaveCalendarService.listCalendar scope=team; gate view-team:leave-calendar) ─────
  async fetchLeaveCalendar(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const tz = await resolveCompanyTz(this.db, ctx.user.companyId);
    const from = localDateOf(new Date(), tz); // 'YYYY-MM-DD' theo TZ công ty (REUSE tz.util).
    const to = addDaysToLocalDate(from, LEAVE_CALENDAR_WINDOW_DAYS);
    const res = await this.leaveCalendar.listCalendar(
      { id: ctx.user.id, companyId: ctx.user.companyId },
      { scope: "team", from, to },
    );
    // BỎ `reason` (riêng tư — đã mask null cho dòng người khác nhưng widget "ai nghỉ khi nào" không cần).
    const items = res.items.slice(0, DASH_WIDGET_LIST_CAP).map((e) => ({
      id: e.id,
      userFullName: e.userFullName,
      employeeCode: e.employeeCode,
      leaveTypeName: e.leaveTypeName,
      leaveTypeMasked: e.leaveTypeMasked ?? false,
      startDate: e.startDate,
      endDate: e.endDate,
      totalDays: e.totalDays,
      status: e.status,
    }));
    return {
      status: res.items.length === 0 ? "Empty" : "Active",
      data: { items, summary: { total: res.items.length } },
      emptyState: res.items.length === 0 ? { message: "Không có lịch nghỉ team" } : null,
    };
  }
}
