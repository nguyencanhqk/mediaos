import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { LeaveCalendarEntryDto } from "@mediaos/contracts";
import { leaveApi } from "@/lib/leave-api";
import { formatDateFull } from "./constants";

interface Props {
  month: string; // YYYY-MM
}

function CalendarEntry({ entry, t }: { entry: LeaveCalendarEntryDto; t: TFunction<"hr"> }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
      <div className="space-y-0.5">
        <p className="font-medium">{entry.userFullName ?? "—"}</p>
        <p className="text-muted-foreground text-xs">
          {entry.leaveTypeName} · {t("leaveCalendar.days", { count: entry.totalDays })}
        </p>
      </div>
      <div className="text-right text-xs text-muted-foreground">
        <p>{formatDateFull(entry.startDate)}</p>
        {entry.startDate !== entry.endDate && (
          <p>→ {formatDateFull(entry.endDate)}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Lịch nghỉ team trong tháng — KHÔNG hiển thị lý do (bảo mật; server không trả về).
 */
export function LeaveCalendar({ month }: Props) {
  const { t } = useTranslation("hr");

  const { data: entries = [], isLoading, isError } = useQuery({
    queryKey: ["leave", "calendar", month],
    queryFn: () => leaveApi.listCalendar(month),
  });

  const [y, m] = month.split("-");
  const displayMonth = `Tháng ${m}/${y}`;

  if (isLoading) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("leaveCalendar.heading", { month: displayMonth })}</h3>
        <p className="text-sm text-muted-foreground">{t("leaveCalendar.loading")}</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("leaveCalendar.heading", { month: displayMonth })}</h3>
        <p className="text-sm text-destructive">{t("leaveCalendar.loadError")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t("leaveCalendar.heading", { month: displayMonth })}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("leaveCalendar.empty", { month: displayMonth })}
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, idx) => (
            <CalendarEntry key={`${entry.userId}-${entry.startDate}-${idx}`} entry={entry} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}
