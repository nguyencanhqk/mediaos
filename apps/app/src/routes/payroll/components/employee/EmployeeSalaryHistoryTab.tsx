import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import { Button, EmptyState } from "@mediaos/ui";
import { PAYROLL_ENGINE_PAIRS, SALARY_HISTORY_PAGE } from "../../constants";
import type { PayrollPeopleLookup } from "../../use-payroll-people";
import { todayIsoDate } from "./employee-forms";
import { SalaryProfileFormDialog } from "../SalaryProfileFormDialog";
import { SalaryProfileVersionCard } from "./SalaryProfileVersionCard";

/**
 * Tab «Lịch sử lương» (PAY-SCREEN-007, cặp `view:salary-profile` — SENSITIVE; page đã gate, ở đây gate
 * lại nút tạo bằng `manage:salary-profile`).
 *
 * Timeline PHIÊN BẢN theo `effectiveDate` giảm dần (PAY-DEC-003): bản «hiện hành» = bản mới nhất có
 * `effectiveDate <= hôm nay` — chỉ là chỉ dấu UI; bản nào áp cho một kỳ là do SQL chọn lúc `calculate`
 * theo ngày cuối kỳ, không phải hôm nay.
 *
 * Danh sách 019 tải một trang `SALARY_HISTORY_PAGE`; vượt trần thì nói ra («chỉ 100 gần nhất»), không
 * lật trang trong tab.
 */
export function EmployeeSalaryHistoryTab({
  userId,
  people,
  employeeLabel,
}: {
  userId: string;
  people: PayrollPeopleLookup;
  employeeLabel: string;
}) {
  const { t } = useTranslation("payroll");
  const canCreate = useCanExact(
    PAYROLL_ENGINE_PAIRS.salaryProfileCreate.action,
    PAYROLL_ENGINE_PAIRS.salaryProfileCreate.resourceType,
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);

  const params = { userId, page: 1, per_page: SALARY_HISTORY_PAGE };
  const listQuery = useQuery({
    queryKey: payrollKeys.salaryProfiles.list(params),
    queryFn: () => payrollApi.listSalaryProfiles(params),
  });

  const versions = useMemo(
    () =>
      [...(listQuery.data?.data ?? [])].sort((a, b) =>
        b.effectiveDate.localeCompare(a.effectiveDate),
      ),
    [listQuery.data],
  );
  const today = todayIsoDate();
  const currentId = versions.find((v) => v.effectiveDate <= today)?.id ?? null;
  const total = listQuery.data?.pagination?.total;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4" data-testid="employee-salary-history-tab">
      {canCreate && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 size-4" />
            {t("salaryHistory.addVersion")}
          </Button>
        </div>
      )}

      {listQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("states.loading")}</p>
      ) : listQuery.isError ? (
        <EmptyState
          title={t("states.error")}
          action={
            <Button variant="outline" onClick={() => void listQuery.refetch()}>
              {t("states.retry")}
            </Button>
          }
        />
      ) : versions.length === 0 ? (
        <EmptyState title={t("salaryHistory.empty")} />
      ) : (
        <>
          <ul className="space-y-2">
            {versions.map((v) => (
              <SalaryProfileVersionCard
                key={v.id}
                profile={v}
                isCurrent={v.id === currentId}
                expanded={expanded.has(v.id)}
                onToggle={() => toggle(v.id)}
              />
            ))}
          </ul>
          {total !== undefined && total > SALARY_HISTORY_PAGE && (
            <p className="text-xs text-muted-foreground">{t("salaryHistory.truncated")}</p>
          )}
        </>
      )}

      <SalaryProfileFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        people={people}
        fixedUserId={userId}
        fixedUserLabel={employeeLabel}
      />
    </div>
  );
}
