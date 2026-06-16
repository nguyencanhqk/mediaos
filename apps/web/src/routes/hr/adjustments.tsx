import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { HrRequestStatusDto } from "@mediaos/contracts";
import { attendanceApi, type AdjustmentFilters } from "@/lib/attendance-api";
import { useCan } from "@/hooks/use-can";
import { PermissionGate } from "@/components/permission-gate";
import { AdjustmentTable } from "@/components/hr/adjustment-table";
import { CreateAdjustmentDialog } from "@/components/hr/create-adjustment-dialog";
import { Select } from "@/components/ui/select";
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
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("adjustmentsPage.heading")}</h1>
        <PermissionGate action="adjust" resourceType="attendance">
          <CreateAdjustmentDialog />
        </PermissionGate>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wide">
            {t("adjustmentsPage.filterScope")}
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
            {t("adjustmentsPage.filterStatus")}
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
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">{t("adjustmentsPage.loading")}</p>
      )}
      {isError && (
        <p className="text-sm text-destructive">{t("adjustmentsPage.loadError")}</p>
      )}
      {!isLoading && !isError && (
        <AdjustmentTable requests={requests} canApprove={canApprove} />
      )}
    </div>
  );
}
