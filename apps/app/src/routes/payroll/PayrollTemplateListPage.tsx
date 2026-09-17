import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import type { PayrollTemplateDto } from "@mediaos/contracts";
import {
  Button,
  DataTable,
  DataToolbar,
  EmptyState,
  PageHeader,
  Select,
  StatusPill,
  TableFooter,
} from "@mediaos/ui";
import { PAYROLL_ENGINE_PAIRS, PAYROLL_PAGE_SIZE } from "./constants";
import { TemplateFormDialog } from "./components/TemplateFormDialog";

type ActiveFilter = "" | "true" | "false";

/**
 * PAY-SCREEN-010 «Mẫu bảng lương» — danh sách (049) + tạo (050). Bấm một hàng ⇒ chi tiết
 * `/payroll/templates/:id` (thành phần · nhãn cột · công thức ghi đè · ẩn/hiện · thứ tự · xem trước).
 * Cặp `view`/`manage:payroll-template` đều SENSITIVE ⇒ `useCanExact`.
 */
export function PayrollTemplateListPage({
  onOpenTemplate,
}: {
  onOpenTemplate: (id: string) => void;
}) {
  const { t } = useTranslation("payroll");

  const canView = useCanExact(
    PAYROLL_ENGINE_PAIRS.templateList.action,
    PAYROLL_ENGINE_PAIRS.templateList.resourceType,
  );
  const canCreate = useCanExact(
    PAYROLL_ENGINE_PAIRS.templateCreate.action,
    PAYROLL_ENGINE_PAIRS.templateCreate.resourceType,
  );

  const [page, setPage] = useState(1);
  const [isActive, setIsActive] = useState<ActiveFilter>("");
  const [createOpen, setCreateOpen] = useState(false);

  const params = useMemo(
    () => ({
      page,
      per_page: PAYROLL_PAGE_SIZE,
      ...(isActive ? { isActive: isActive === "true" } : {}),
    }),
    [page, isActive],
  );
  const listQuery = useQuery({
    queryKey: payrollKeys.catalog.templates(params),
    queryFn: () => payrollApi.listPayrollTemplates(params),
    enabled: canView,
  });

  const columns = useMemo<ColumnDef<PayrollTemplateDto>[]>(
    () => [
      {
        id: "code",
        header: t("templates.columns.code"),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
      },
      { id: "name", header: t("templates.columns.name"), cell: ({ row }) => row.original.name },
      {
        id: "scope",
        header: t("templates.columns.scope"),
        cell: ({ row }) => t(`templateScope.${row.original.scope}`),
      },
      {
        id: "status",
        header: t("templates.columns.status"),
        cell: ({ row }) => (
          <StatusPill
            tone={row.original.isActive ? "success" : "muted"}
            label={t(row.original.isActive ? "components.active" : "components.inactive")}
          />
        ),
      },
    ],
    [t],
  );

  if (!canView) return <EmptyState title={t("templates.noPermission")} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("templates.title")}
        description={t("templates.description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void listQuery.refetch()}
              disabled={listQuery.isFetching}
            >
              <RefreshCw className="mr-2 size-4" />
              {t("states.retry")}
            </Button>
            {canCreate && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 size-4" />
                {t("templates.create")}
              </Button>
            )}
          </div>
        }
      />

      <DataToolbar>
        <Select
          value={isActive}
          onChange={(e) => {
            setIsActive(e.target.value as ActiveFilter);
            setPage(1);
          }}
          className="w-44"
          aria-label={t("components.filterActive")}
        >
          <option value="">{t("components.activeFilter.all")}</option>
          <option value="true">{t("components.activeFilter.yes")}</option>
          <option value="false">{t("components.activeFilter.no")}</option>
        </Select>
      </DataToolbar>

      {listQuery.isError ? (
        <EmptyState
          title={t("states.error")}
          action={
            <Button variant="outline" onClick={() => void listQuery.refetch()}>
              {t("states.retry")}
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={listQuery.data?.data ?? []}
          isLoading={listQuery.isLoading}
          pageSize={PAYROLL_PAGE_SIZE}
          pinFirstColumn
          onRowClick={(row) => onOpenTemplate(row.id)}
          emptyState={<EmptyState title={t("templates.empty")} />}
          footer={
            <TableFooter
              page={page}
              pageSize={PAYROLL_PAGE_SIZE}
              total={listQuery.data?.pagination?.total}
              disabled={listQuery.isFetching}
              onPageChange={setPage}
            />
          }
        />
      )}

      {canCreate && (
        <TemplateFormDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          template={null}
          onCreated={onOpenTemplate}
        />
      )}
    </div>
  );
}
