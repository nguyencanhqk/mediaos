/**
 * AttendanceRulesPage — danh sách rule chấm công + CRUD tối thiểu (UI-02 §9.6 `/attendance/rules`, S3-FE-ATT-5).
 *
 * Nối S3-ATT-BE-3 (PR #69): GET/POST /attendance/rules + PATCH /attendance/rules/:id.
 * Gate xem: useCanExact('view','attendance-rule') — cặp is_sensitive → fail-closed, KHÔNG wildcard. Gate
 * tạo/sửa: useCanExact('config','attendance-rule'). Advanced admin (đủ cờ auto/gps) = carry-over CO-S4-007.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type ColumnDef } from "@tanstack/react-table";
import { ShieldCheck, RefreshCw, Plus, Pencil } from "lucide-react";
import type { AttendanceRuleDto } from "@mediaos/contracts";
import { useCanExact } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button } from "@mediaos/ui";
import { useAttendanceRules } from "./hooks/useAttendanceAdmin";
import { ATT_ENGINE_PAIRS } from "./constants";
import { RuleFormDialog } from "./admin/RuleFormDialog";

function useColumns(
  t: ReturnType<typeof useTranslation<"attendance">>["t"],
  onEdit: ((rule: AttendanceRuleDto) => void) | null,
): ColumnDef<AttendanceRuleDto>[] {
  const cols: ColumnDef<AttendanceRuleDto>[] = [
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
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.effectiveFrom}</span>,
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
  if (onEdit) {
    cols.push({
      id: "actions",
      header: t("rules.actions.columnHeader"),
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(row.original)}
          data-testid="rule-edit-btn"
        >
          <Pencil className="mr-1 h-3.5 w-3.5" />
          {t("rules.actions.edit")}
        </Button>
      ),
    });
  }
  return cols;
}

export function AttendanceRulesPage() {
  const { t } = useTranslation("attendance");

  // NHẠY CẢM: useCanExact — KHÔNG wildcard fallback (view/config:attendance-rule is_sensitive).
  const canView = useCanExact(
    ATT_ENGINE_PAIRS.RULE_VIEW.action,
    ATT_ENGINE_PAIRS.RULE_VIEW.resourceType,
  );
  const canConfig = useCanExact(
    ATT_ENGINE_PAIRS.RULE_CONFIG.action,
    ATT_ENGINE_PAIRS.RULE_CONFIG.resourceType,
  );

  const { data, isLoading, isError, refetch } = useAttendanceRules(canView);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AttendanceRuleDto | null>(null);
  const columns = useColumns(t, canConfig ? (r) => setEditing(r) : null);

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
        actions={
          canConfig ? (
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="rule-create-btn">
              <Plus className="mr-2 h-4 w-4" />
              {t("rules.actions.create")}
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState title={t("rules.empty.title")} description={t("rules.empty.description")} />
        }
      />

      {canConfig && <RuleFormDialog open={createOpen} onClose={() => setCreateOpen(false)} />}
      {canConfig && editing && (
        <RuleFormDialog open onClose={() => setEditing(null)} rule={editing} />
      )}
    </div>
  );
}
