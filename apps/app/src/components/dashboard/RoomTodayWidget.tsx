/**
 * RoomTodayWidget — «Lịch họp hôm nay» (SPEC-14 §121 RM-08 · §157, S11-OFFICE-DASH-1). widget_code=
 * ROOM_TODAY, slug=room-today, module nguồn ROOM. Data: apps/api dashboard-widget-office.handlers.ts
 * fetchRoomToday() → { date, items: [{id, title, roomName, roomLocation, startsAt, endsAt, myRole, status,
 * isCompleted, attendeeCount}], summary: { total, upcoming } } — TÁI DÙNG RoomBookingsService.listMine
 * (đúng GET /me/room-bookings?date=…), KHÔNG tính lại biên ngày ở đây.
 *
 * "Hôm nay" là ngày theo múi giờ CÔNG TY do SERVER chốt (SPEC-14 §83) — FE KHÔNG tự suy từ đồng hồ máy.
 * Giờ hiển thị quy đổi qua `companyTimeZone()` của module ROOM (một điểm đọc duy nhất; hiện trả
 * DEFAULT_TIMEZONE tới khi session mang được `company.timezone`).
 *
 * Nội dung là lịch CỦA CHÍNH người xem (tổ chức HOẶC được mời) — server đã tự khoá, widget không có bộ lọc.
 *
 * Drill-down: bấm 1 dòng → điều hướng `/rooms` (lưới lịch phòng — ROOM không có route chi tiết lượt đặt,
 * xem doc-block router.tsx §S11-ROOM-FE-1).
 *
 * Gate: PermissionGate(view:room) — MIRROR đúng BE DASH_WIDGET_GATE_PAIR.ROOM_TODAY.
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";
import { PermissionGate } from "@mediaos/web-core";
import { Badge } from "@mediaos/ui";
import { companyTimeZone, localTimeOf } from "@/routes/rooms/room-time";
import { useDashboardWidgetData } from "./useDashboardWidget";
import { WidgetCard } from "./WidgetCard";
import { DASH_WIDGET_CODE, DASH_WIDGET_GATE_PAIR } from "@/routes/dashboard/constants";
import { roomTodayWidgetDataSchema, widgetMessageSchema } from "./widget-data-schemas";
import type { DashboardTypeValue } from "@mediaos/contracts";

/**
 * Đích drill-down. Cast `as "/"`: union path của TanStack Router suy từ mảng routeTree trong router.tsx và
 * KHÔNG chứa "/rooms" (cùng lý do router.tsx tự viết `to: "/assets" as "/"`); đây là cách cả repo đang làm
 * cho route module (mirror NOTI_PATHS.LIST / CHAT_PATH).
 */
const ROOM_CALENDAR_PATH = "/rooms" as "/";

interface RoomTodayWidgetProps {
  dashboardType?: DashboardTypeValue;
}

function RoomTodayWidgetInner({ dashboardType }: RoomTodayWidgetProps) {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const { data, isLoading, isError, refresh, isRefreshing } = useDashboardWidgetData(
    DASH_WIDGET_CODE.ROOM_TODAY,
    { dashboardType },
  );

  const status = data?.status;
  const serverErrored = status === "Error" || status === "Degraded";
  const parsed = data && data.data !== null ? roomTodayWidgetDataSchema.safeParse(data.data) : null;
  const parseFailed = parsed !== null && !parsed.success;
  const emptyMsg = widgetMessageSchema.safeParse(data?.empty_state);
  const tz = companyTimeZone();

  return (
    <WidgetCard
      title={t("roomToday.title")}
      icon={CalendarClock}
      isLoading={isLoading}
      isError={isError || serverErrored || parseFailed}
      isEmpty={status === "Empty"}
      emptyTitle={emptyMsg.success ? emptyMsg.data.message : t("roomToday.empty.title")}
      errorTitle={data?.error_state?.message ?? t("widget.error.title")}
      errorDescription={t("widget.error.description")}
      lastUpdatedAt={data?.last_updated_at}
      onRefresh={refresh}
      isRefreshing={isRefreshing}
      quickActions={data?.quick_actions}
    >
      {parsed?.success && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t("roomToday.summary", {
              total: parsed.data.summary.total,
              upcoming: parsed.data.summary.upcoming,
            })}
          </p>
          <ul className="space-y-2">
            {parsed.data.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void navigate({ to: ROOM_CALENDAR_PATH })}
                  className="w-full space-y-1 rounded-md p-1 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                      {localTimeOf(new Date(item.startsAt), tz)}–
                      {localTimeOf(new Date(item.endsAt), tz)}
                    </span>
                    <span className="truncate text-sm text-foreground">{item.title}</span>
                    {item.myRole === "organizer" && (
                      <Badge variant="secondary">{t("roomToday.role.organizer")}</Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {t("roomToday.roomLine", {
                      room: item.roomName,
                      count: item.attendeeCount,
                    })}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetCard>
  );
}

/** Gate ngoài (PermissionGate) — user thiếu view:room ⇒ KHÔNG render (KHÔNG fetch). */
export function RoomTodayWidget(props: RoomTodayWidgetProps) {
  const pair = DASH_WIDGET_GATE_PAIR.ROOM_TODAY;
  return (
    <PermissionGate action={pair.action} resourceType={pair.resourceType}>
      <RoomTodayWidgetInner {...props} />
    </PermissionGate>
  );
}
