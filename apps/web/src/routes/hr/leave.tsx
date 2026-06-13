import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { HrRequestStatusDto } from "@mediaos/contracts";
import { leaveApi, type LeaveRequestFilters } from "@/lib/leave-api";
import { useCan } from "@/hooks/use-can";
import { PermissionGate } from "@/components/permission-gate";
import { LeaveRequestTable } from "@/components/hr/leave-request-table";
import { LeaveBalancePanel } from "@/components/hr/leave-balance-panel";
import { LeaveCalendar } from "@/components/hr/leave-calendar";
import { CreateLeaveDialog } from "@/components/hr/create-leave-dialog";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  HR_REQUEST_STATUS_LABELS,
  HR_REQUEST_STATUS_OPTIONS,
  currentMonth,
  currentYear,
} from "@/components/hr/constants";

type TabId = "requests" | "calendar";

/**
 * G11 — Màn hình Nghỉ phép: danh sách đơn + số phép + lịch nghỉ team.
 */
export function LeavePage() {
  const canApprove = useCan("approve", "leave");
  const [tab, setTab] = useState<TabId>("requests");
  const [calendarMonth, setCalendarMonth] = useState<string>(currentMonth());

  const [filters, setFilters] = useState<LeaveRequestFilters>({
    scope: "me",
    year: currentYear(),
  });

  const {
    data: requests = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["leave", "requests", filters],
    queryFn: () => leaveApi.listRequests(filters),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Nghỉ phép</h1>
        <PermissionGate action="create" resourceType="leave">
          <CreateLeaveDialog />
        </PermissionGate>
      </div>

      {/* Leave balance for current user */}
      <LeaveBalancePanel />

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {(["requests", "calendar"] as TabId[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t === "requests" ? "Danh sách đơn" : "Lịch nghỉ team"}
          </button>
        ))}
      </div>

      {tab === "requests" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">
                Phạm vi
              </label>
              <Select
                value={filters.scope ?? "me"}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    scope: e.target.value as "me" | "all",
                  }))
                }
                className="w-36"
              >
                <option value="me">Của tôi</option>
                {canApprove && <option value="all">Tất cả</option>}
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">
                Trạng thái
              </label>
              <Select
                value={filters.status ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    status: (e.target.value as HrRequestStatusDto) || undefined,
                  }))
                }
                className="w-40"
              >
                <option value="">Tất cả</option>
                {HR_REQUEST_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {HR_REQUEST_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">
                Năm
              </label>
              <Input
                type="number"
                value={filters.year ?? currentYear()}
                min={2000}
                max={2100}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    year: e.target.value ? Number(e.target.value) : undefined,
                  }))
                }
                className="w-24"
              />
            </div>
          </div>

          {isLoading && (
            <p className="text-sm text-muted-foreground">Đang tải đơn nghỉ phép…</p>
          )}
          {isError && (
            <p className="text-sm text-destructive">Không tải được danh sách đơn.</p>
          )}
          {!isLoading && !isError && (
            <LeaveRequestTable requests={requests} canApprove={canApprove} />
          )}
        </div>
      )}

      {tab === "calendar" && (
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground uppercase tracking-wide">
              Chọn tháng
            </label>
            <Input
              type="month"
              value={calendarMonth}
              onChange={(e) => setCalendarMonth(e.target.value)}
              className="w-40"
            />
          </div>
          <LeaveCalendar month={calendarMonth} />
        </div>
      )}
    </div>
  );
}
