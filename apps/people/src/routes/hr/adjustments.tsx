import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertCircle, CalendarPlus } from "lucide-react";
import type { HrRequestStatusDto } from "@mediaos/contracts";
import { attendanceApi, type AdjustmentFilters } from "@/lib/attendance-api";
import { useCan } from "@mediaos/web-core";
import { PermissionGate } from "@mediaos/web-core";
import { AdjustmentTable } from "@/components/hr/adjustment-table";
import { CreateAdjustmentDialog } from "@/components/hr/create-adjustment-dialog";
import { FilterField } from "@/components/hr/filter-field";
import { PageHeader } from "@mediaos/ui";
import { EmptyState } from "@mediaos/ui";
import { Skeleton } from "@mediaos/ui";
import { Select } from "@mediaos/ui";
import {
  HR_REQUEST_STATUS_LABELS,
  HR_REQUEST_STATUS_OPTIONS,
} from "@/components/hr/constants";

/**
 * G11 — Màn hình Đơn bổ sung công (attendance_adjustment).
 */
export function AdjustmentsPage() {
  const { t } = useTranslation("hr");
  const canApprove = useCan("approve", "attendance");

  const [filters, setFilters] = useState<AdjustmentFilters>({
    scope: "me",
  });

  const {
    data: requests = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["attendance", "adjustments", filters],
    queryFn: () => attendanceApi.listAdjustments(filters),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      <PageHeader
        title={t("adjustmentsPage.heading")}
        description={t("adjustmentsPage.description")}
        icon={CalendarPlus}
        actions={
          <PermissionGate action="adjust" resourceType="attendance">
            <CreateAdjustmentDialog />
          </PermissionGate>
        }
      >
        <div className="flex flex-wrap gap-3">
          <FilterField label={t("adjustmentsPage.filterScope")} className="w-36">
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

          <FilterField label={t("adjustmentsPage.filterStatus")} className="w-40">
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
        </div>
      </PageHeader>

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
            title={t("adjustmentsPage.errorTitle")}
            description={t("adjustmentsPage.errorHint")}
          />
        </div>
      )}
      {!isLoading && !isError && (
        <AdjustmentTable requests={requests} canApprove={canApprove} />
      )}
    </div>
  );
}
