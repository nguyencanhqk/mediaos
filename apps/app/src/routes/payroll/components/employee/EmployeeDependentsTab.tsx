import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import type { PayrollDependentDto } from "@mediaos/contracts";
import { Button, DataTable, EmptyState, StatusPill } from "@mediaos/ui";
import { isDependentEffectiveOn, todayIsoDate } from "./employee-forms";
import { DependentFormDialog } from "./DependentFormDialog";

/** Trần dòng client-side của bảng NPT — một người hiếm khi > vài NPT; 040 trả mảng trần, không phân trang. */
const DEPENDENTS_TABLE_PAGE = 50;

/**
 * Tab «Gia đình» (PAY-SCREEN-007) — người phụ thuộc giảm trừ TNCN: đọc 040 (`view:payroll-employee`),
 * thêm/sửa/xoá mềm qua `DependentFormDialog` (`manage:payroll-employee`). Bấm dòng để sửa CHỈ khi có
 * `canManage` — không có thì bảng chỉ đọc, không cursor-pointer «mời bấm rồi 403».
 */
export function EmployeeDependentsTab({
  userId,
  canManage,
}: {
  userId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation("payroll");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PayrollDependentDto | null>(null);

  const query = useQuery({
    queryKey: payrollKeys.employees.dependents(userId),
    queryFn: () => payrollApi.listDependents(userId),
  });
  const rows = query.data ?? [];
  const today = todayIsoDate();

  const columns = useMemo<ColumnDef<PayrollDependentDto>[]>(
    () => [
      {
        id: "fullName",
        header: t("dependents.columns.fullName"),
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{row.original.fullName}</span>
            {isDependentEffectiveOn(row.original, today) && (
              <StatusPill hideDot tone="success" label={t("dependents.ongoing")} />
            )}
          </div>
        ),
      },
      {
        id: "relationship",
        header: t("dependents.columns.relationship"),
        cell: ({ row }) => t(`relationship.${row.original.relationship}`),
      },
      {
        id: "taxCode",
        header: t("dependents.columns.taxCode"),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.dependentTaxCode ?? "—"}</span>
        ),
      },
      {
        id: "dateOfBirth",
        header: t("dependents.columns.dateOfBirth"),
        cell: ({ row }) => <span className="tabular-nums">{row.original.dateOfBirth ?? "—"}</span>,
      },
      {
        id: "effectiveFrom",
        header: t("dependents.columns.effectiveFrom"),
        cell: ({ row }) => <span className="tabular-nums">{row.original.effectiveFrom}</span>,
      },
      {
        id: "effectiveTo",
        header: t("dependents.columns.effectiveTo"),
        cell: ({ row }) => <span className="tabular-nums">{row.original.effectiveTo ?? "—"}</span>,
      },
    ],
    [t, today],
  );

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (dep: PayrollDependentDto) => {
    setEditing(dep);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4" data-testid="employee-dependents-tab">
      {canManage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 size-4" />
            {t("dependents.add")}
          </Button>
        </div>
      )}

      {query.isError ? (
        <EmptyState
          title={t("states.error")}
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t("states.retry")}
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={query.isLoading}
          pageSize={DEPENDENTS_TABLE_PAGE}
          onRowClick={canManage ? openEdit : undefined}
          emptyState={<EmptyState title={t("dependents.empty")} />}
        />
      )}

      <DependentFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        userId={userId}
        dependent={editing}
      />
    </div>
  );
}
