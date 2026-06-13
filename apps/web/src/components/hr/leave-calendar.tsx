import { useQuery } from "@tanstack/react-query";
import type { LeaveCalendarEntryDto } from "@mediaos/contracts";
import { leaveApi } from "@/lib/leave-api";
import { formatDateFull } from "./constants";

interface Props {
  month: string; // YYYY-MM
}

function CalendarEntry({ entry }: { entry: LeaveCalendarEntryDto }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
      <div className="space-y-0.5">
        <p className="font-medium">{entry.userFullName ?? "—"}</p>
        <p className="text-muted-foreground text-xs">
          {entry.leaveTypeName} · {entry.totalDays} ngày
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
  const { data: entries = [], isLoading, isError } = useQuery({
    queryKey: ["leave", "calendar", month],
    queryFn: () => leaveApi.listCalendar(month),
  });

  const [y, m] = month.split("-");
  const displayMonth = `Tháng ${m}/${y}`;

  if (isLoading) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Lịch nghỉ team — {displayMonth}</h3>
        <p className="text-sm text-muted-foreground">Đang tải lịch nghỉ…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Lịch nghỉ team — {displayMonth}</h3>
        <p className="text-sm text-destructive">Không tải được lịch nghỉ.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Lịch nghỉ team — {displayMonth}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Không có ai nghỉ trong {displayMonth}.
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, idx) => (
            <CalendarEntry key={`${entry.userId}-${entry.startDate}-${idx}`} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
