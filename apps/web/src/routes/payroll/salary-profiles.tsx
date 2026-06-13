import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SalaryProfileStatus } from "@mediaos/contracts";
import { salaryProfileApi } from "@/lib/salary-profile-api";
import { PermissionGate } from "@/components/permission-gate";
import { SalaryProfileTable } from "@/components/payroll/salary-profile-table";
import { CreateSalaryProfileDialog } from "@/components/payroll/create-salary-profile-dialog";
import { Select } from "@/components/ui/select";
import { SALARY_STATUS_LABELS } from "@/components/payroll/salary-constants";

/**
 * G12-1 — Salary Profile list. Lương NHẠY CẢM (BẤT BIẾN #3):
 *  - Mask-by-default: rows arrive already masked from the server; the table renders ••• for
 *    callers without view-salary-profile. The client NEVER unmasks.
 *  - The create form is wrapped in <PermissionGate manage-salary-profile> (defense in depth);
 *    the server's @RequirePermission(manage, isSensitive) is the real authority.
 */
export function SalaryProfilesPage() {
  const [status, setStatus] = useState<SalaryProfileStatus | "">("");

  const {
    data: rows = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["salary-profiles", { status }],
    queryFn: () => salaryProfileApi.list(status ? { status } : undefined),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Hồ sơ lương</h1>
        <PermissionGate action="manage-salary-profile" resourceType="salary_profile">
          <CreateSalaryProfileDialog />
        </PermissionGate>
      </div>

      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">Trạng thái</label>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as SalaryProfileStatus | "")}
          className="w-44"
        >
          <option value="">Tất cả</option>
          {(Object.keys(SALARY_STATUS_LABELS) as SalaryProfileStatus[]).map((s) => (
            <option key={s} value={s}>
              {SALARY_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải hồ sơ lương…</p>}
      {isError && <p className="text-sm text-destructive">Không tải được danh sách hồ sơ lương.</p>}
      {!isLoading && !isError && <SalaryProfileTable rows={rows} />}
    </div>
  );
}
