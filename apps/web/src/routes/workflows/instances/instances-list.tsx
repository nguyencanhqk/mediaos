import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { Activity, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { InstanceDto, InstanceStatus } from "@/lib/workflow-builder/contract";
import { workflowInstancesApi } from "@/lib/workflow-instances-api";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  INSTANCE_STATUS_BADGE_VARIANT,
  INSTANCE_STATUS_LABELS,
} from "@/components/workflows/constants";

type StatusFilter = InstanceStatus | "all";

const INSTANCE_STATUS_OPTIONS: InstanceStatus[] = ["active", "completed", "cancelled"];

/** Khoá i18n cho cột "Áp cho" — nội dung / dự án / không có (dữ liệu thật chỉ có 2 FK nullable). */
function appliesToKey(inst: InstanceDto): string {
  if (inst.contentItemId) return "instances.appliesContent";
  if (inst.projectId) return "instances.appliesProject";
  return "instances.appliesNone";
}

export function WorkflowInstancesPage() {
  const { t } = useTranslation("workflows");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data: instances = [], isLoading, isError } = useQuery({
    queryKey: ["workflow-instances"],
    queryFn: () => workflowInstancesApi.list(),
  });

  const visible = useMemo(
    () =>
      statusFilter === "all"
        ? instances
        : instances.filter((inst) => inst.status === statusFilter),
    [instances, statusFilter],
  );

  const columns = useMemo<ColumnDef<InstanceDto>[]>(
    () => [
      {
        accessorKey: "templateName",
        header: t("instances.table.colName"),
        cell: ({ row }) => (
          <Link
            to="/workflows/instances/$instanceId"
            params={{ instanceId: row.original.id }}
            className="font-medium text-primary hover:underline"
          >
            {row.original.templateName}
          </Link>
        ),
      },
      {
        id: "appliesTo",
        accessorFn: (inst) => t(appliesToKey(inst)),
        header: t("instances.table.colAppliesTo"),
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "definitionVersion",
        header: t("instances.table.colVersion"),
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">v{getValue<number>()}</span>
        ),
      },
      {
        accessorKey: "status",
        header: t("instances.table.colStatus"),
        cell: ({ getValue }) => {
          const status = getValue<InstanceStatus>();
          return (
            <Badge variant={INSTANCE_STATUS_BADGE_VARIANT[status]}>
              {INSTANCE_STATUS_LABELS[status]}
            </Badge>
          );
        },
      },
      {
        accessorKey: "createdAt",
        header: t("instances.table.colStartedAt"),
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">
            {new Date(getValue<string>()).toLocaleDateString("vi-VN")}
          </span>
        ),
      },
    ],
    [t],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      <PageHeader
        title={t("instances.pageTitle")}
        description={t("instances.summary", { count: instances.length })}
        icon={Activity}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("instances.searchPlaceholder")}
              className="pl-9"
              aria-label={t("instances.searchPlaceholder")}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("instances.statusFilter")}</span>
            <Select
              className="h-10 w-40"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">{t("instances.statusAll")}</option>
              {INSTANCE_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {INSTANCE_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </PageHeader>

      {isError ? (
        <EmptyState
          icon={Activity}
          title={t("instances.loadError")}
          description={t("instances.loadHint")}
        />
      ) : (
        <DataTable
          columns={columns}
          data={visible}
          isLoading={isLoading}
          globalFilter={query}
          emptyState={
            <EmptyState
              icon={Activity}
              title={query || statusFilter !== "all" ? t("instances.searchEmpty") : t("instances.empty")}
              description={
                query || statusFilter !== "all" ? undefined : t("instances.emptyHint")
              }
            />
          }
        />
      )}
    </div>
  );
}
