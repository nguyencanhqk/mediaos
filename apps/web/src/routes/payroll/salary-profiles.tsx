import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SalaryProfileStatus } from "@mediaos/contracts";
import { salaryProfileApi } from "@/lib/salary-profile-api";
import { PermissionGate } from "@mediaos/web-core";
import { SalaryProfileTable } from "@/components/payroll/salary-profile-table";
import { CreateSalaryProfileDialog } from "@/components/payroll/create-salary-profile-dialog";
import { PageHeader } from "@mediaos/ui";
import { EmptyState } from "@mediaos/ui";
import { Select } from "@mediaos/ui";
import { Skeleton } from "@mediaos/ui";
import { SALARY_STATUS_LABELS } from "@/components/payroll/salary-constants";

/**
 * G12-1 — Salary Profile list. Lương NHẠY CẢM (BẤT BIẾN #3):
 *  - Mask-by-default: rows arrive already masked from the server; the table renders ••• for
 *    callers without view-salary-profile. The client NEVER unmasks.
 *  - The create form is wrapped in <PermissionGate manage-salary-profile> (defense in depth);
 *    the server's @RequirePermission(manage, isSensitive) is the real authority.
 *
 * Redesign (Phase 2): chuẩn hoá chrome (PageHeader + toolbar + loading/empty/error) theo house
 * style MISA/Funtime. KHÔNG đổi data/permission/masking — giữ nguyên hook query, PermissionGate,
 * và component bảng (mask do server, client không render được số đã bị tước).
 */
export function SalaryProfilesPage() {
  const { t } = useTranslation("payroll");
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
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      <PageHeader
        title={t("salaryProfiles.pageTitle")}
        description={t("salaryProfiles.pageDescription")}
        icon={Wallet}
        actions={
          <PermissionGate action="manage-salary-profile" resourceType="salary_profile">
            <CreateSalaryProfileDialog />
          </PermissionGate>
        }
      >
        <div className="space-y-1">
          <label
            htmlFor="salary-status-filter"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            {t("salaryProfiles.filterStatus")}
          </label>
          <Select
            id="salary-status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value as SalaryProfileStatus | "")}
            className="w-44"
          >
            <option value="">{t("salaryProfiles.all")}</option>
            {(Object.keys(SALARY_STATUS_LABELS) as SalaryProfileStatus[]).map((s) => (
              <option key={s} value={s}>
                {SALARY_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </PageHeader>

      {isLoading && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {!isLoading && isError && (
        <EmptyState
          icon={Wallet}
          title={t("salaryProfiles.loadFailed")}
          description={t("salaryProfiles.loadHint")}
        />
      )}

      {/* Bảng tự render empty-state riêng (đã có test) → giữ là nguồn duy nhất cho trạng thái rỗng. */}
      {!isLoading && !isError && <SalaryProfileTable rows={rows} />}
    </div>
  );
}
