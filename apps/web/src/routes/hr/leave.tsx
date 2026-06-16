import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("hr");
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
        <h1 className="text-2xl font-semibold">{t("leavePage.heading")}</h1>
        <PermissionGate action="create" resourceType="leave">
          <CreateLeaveDialog />
        </PermissionGate>
      </div>

      {/* Leave balance for current user */}
      <LeaveBalancePanel />

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {(["requests", "calendar"] as TabId[]).map((tabId) => (
          <button
            key={tabId}
            onClick={() => setTab(tabId)}
            className={[
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === tabId
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {tabId === "requests" ? t("leavePage.tabRequests") : t("leavePage.tabCalendar")}
          </button>
        ))}
      </div>

      {tab === "requests" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">
                {t("leavePage.filterScope")}
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
                <option value="me">{t("common:mine")}</option>
                {canApprove && <option value="all">{t("common:all")}</option>}
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">
                {t("leavePage.filterStatus")}
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
                <option value="">{t("common:all")}</option>
                {HR_REQUEST_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {HR_REQUEST_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide">
                {t("leavePage.filterYear")}
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
            <p className="text-sm text-muted-foreground">{t("leavePage.loading")}</p>
          )}
          {isError && (
            <p className="text-sm text-destructive">{t("leavePage.loadError")}</p>
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
              {t("leavePage.filterMonth")}
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
