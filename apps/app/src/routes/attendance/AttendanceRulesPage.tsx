/**
 * AttendanceRulesPage — danh sách rule chấm công (UI-02 §9.6 `/attendance/rules`, S3-FE-ATT-5).
 *
 * Gate: useCanExact('view','attendance-rule') — cặp is_sensitive (attendance-permissions.const.ts) →
 * fail-closed, KHÔNG wildcard fallback. Read-only minimum — CRUD (config rule) carry-over CO-S4-007.
 */
import { useTranslation } from "react-i18next";
import { type ColumnDef } from "@tanstack/react-table";
import { ShieldCheck, RefreshCw } from "lucide-react";
import { useCanExact, type AttRuleListItem } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button } from "@mediaos/ui";
import { useAttendanceRules } from "./hooks/useAttendanceAdmin";
import { ATT_ENGINE_PAIRS } from "./constants";

function useColumns(
  t: ReturnType<typeof useTranslation<"attendance">>["t"],
): ColumnDef<AttRuleListItem>[] {
  return [
    {
      accessorKey: "ruleCode",
      header: t("rules.columns.code"),
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.ruleCode}</span>,
    },
    {
      accessorKey: "name",
      header: t("rules.columns.name"),
      cell: ({ row }) => <span className="text-sm">{row.original.name}</span>,
    },
    {
      accessorKey: "ruleScope",
      header: t("rules.columns.scope"),
      cell: ({ row }) => <span className="text-sm">{row.original.ruleScope}</span>,
    },
    {
      accessorKey: "effectiveFrom",
      header: t("rules.columns.effectiveFrom"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{row.original.effectiveFrom ?? "—"}</span>
      ),
    },
    {
      accessorKey: "effectiveTo",
      header: t("rules.columns.effectiveTo"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{row.original.effectiveTo ?? "—"}</span>
      ),
    },
    {
      accessorKey: "priority",
      header: t("rules.columns.priority"),
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.priority}</span>,
    },
    {
      accessorKey: "status",
      header: t("rules.columns.status"),
      cell: ({ row }) => <span className="text-sm">{row.original.status}</span>,
    },
  ];
}

export function AttendanceRulesPage() {
  const { t } = useTranslation("attendance");

  // NHẠY CẢM: useCanExact — KHÔNG wildcard fallback (view:attendance-rule is_sensitive).
  const canView = useCanExact(
    ATT_ENGINE_PAIRS.RULE_VIEW.action,
    ATT_ENGINE_PAIRS.RULE_VIEW.resourceType,
  );

  const { data, isLoading, isError, refetch } = useAttendanceRules(canView);
  const columns = useColumns(t);

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("rules.forbidden.title")}
          description={t("rules.forbidden.description")}
          data-testid="rules-forbidden"
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("rules.error.title")}
          description={t("rules.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          }
        />
      </div>
    );
  }

  const items = data ?? [];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("rules.title")}
        description={t("rules.description")}
        icon={ShieldCheck}
      />

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState title={t("rules.empty.title")} description={t("rules.empty.description")} />
        }
      />
    </div>
  );
}
