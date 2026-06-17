import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertCircle, CalendarOff } from "lucide-react";
import type { HrRequestStatusDto } from "@mediaos/contracts";
import { leaveApi, type LeaveRequestFilters } from "@/lib/leave-api";
import { useCan } from "@/hooks/use-can";
import { PermissionGate } from "@/components/permission-gate";
import { LeaveRequestTable } from "@/components/hr/leave-request-table";
import { LeaveBalancePanel } from "@/components/hr/leave-balance-panel";
import { LeaveCalendar } from "@/components/hr/leave-calendar";
import { CreateLeaveDialog } from "@/components/hr/create-leave-dialog";
import { FilterField } from "@/components/hr/filter-field";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
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
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      <PageHeader
        title={t("leavePage.heading")}
        description={t("leavePage.description")}
        icon={CalendarOff}
        actions={
          <PermissionGate action="create" resourceType="leave">
            <CreateLeaveDialog />
          </PermissionGate>
        }
      />

      <LeaveBalancePanel />

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {(["requests", "calendar"] as TabId[]).map((tabId) => (
          <button
            key={tabId}
            type="button"
            onClick={() => setTab(tabId)}
            className={[
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === tabId
                ? "border-brand text-brand"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {tabId === "requests" ? t("leavePage.tabRequests") : t("leavePage.tabCalendar")}
          </button>
        ))}
      </div>

      {tab === "requests" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <FilterField label={t("leavePage.filterScope")} className="w-36">
              <Select
                value={filters.scope ?? "me"}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    scope: e.target.value as "me" | "all",
                  }))
                }
              >
                <option value="me">{t("common:mine")}</option>
                {canApprove && <option value="all">{t("common:all")}</option>}
              </Select>
            </FilterField>

            <FilterField label={t("leavePage.filterStatus")} className="w-40">
              <Select
                value={filters.status ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    status: (e.target.value as HrRequestStatusDto) || undefined,
                  }))
                }
              >
                <option value="">{t("common:all")}</option>
                {HR_REQUEST_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {HR_REQUEST_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </FilterField>

            <FilterField label={t("leavePage.filterYear")} className="w-24">
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
              />
            </FilterField>
          </div>

          {isLoading && (
            <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )}
          {isError && (
            <div className="rounded-xl border border-border bg-card shadow-sm">
              <EmptyState
                icon={AlertCircle}
                title={t("leavePage.errorTitle")}
                description={t("leavePage.errorHint")}
              />
            </div>
          )}
          {!isLoading && !isError && (
            <LeaveRequestTable requests={requests} canApprove={canApprove} />
          )}
        </div>
      )}

      {tab === "calendar" && (
        <div className="space-y-4">
          <FilterField label={t("leavePage.filterMonth")} className="max-w-[12rem]">
            <Input
              type="month"
              value={calendarMonth}
              onChange={(e) => setCalendarMonth(e.target.value)}
            />
          </FilterField>
          <LeaveCalendar month={calendarMonth} />
        </div>
      )}
    </div>
  );
}
