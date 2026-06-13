import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
        <h1 className="text-2xl font-semibold">Đơn bổ sung công</h1>
        <PermissionGate action="adjust" resourceType="attendance">
          <CreateAdjustmentDialog />
        </PermissionGate>
      </div>

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
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Đang tải đơn bổ sung công…</p>
      )}
      {isError && (
        <p className="text-sm text-destructive">Không tải được danh sách đơn.</p>
      )}
      {!isLoading && !isError && (
        <AdjustmentTable requests={requests} canApprove={canApprove} />
      )}
    </div>
  );
}
