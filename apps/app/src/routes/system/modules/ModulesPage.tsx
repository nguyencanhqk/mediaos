/**
 * SYSTEM-SCREEN-MODULES (S2-FE-FND-3) — Module Catalog admin, chỉ đọc (read-only trước).
 *
 * Nguồn: API-09 FOUNDATION GET /foundation/modules (S2-FND-BE-1, ModuleAdminController) — TẤT CẢ module
 * (active + inactive), KHÁC /modules/my-apps (lọc theo quyền user). Cổng quyền:
 * useCan('view','foundation-module') — cặp ENGINE THỰC (seed mig 0435, is_sensitive=false, bulk-grant
 * company-admin). KHÔNG hard-code role.
 *
 * Toggle enable/disable module = follow-up BE (chưa có endpoint mutation) — trang này KHÔNG dựng nút
 * mutation chết, chỉ hiển thị cờ `enabled` đã resolve server-side.
 *
 * States: loading · error · empty · forbidden. Filter: search theo tên/mã module (client-side, danh mục
 * nhỏ — không cần phân trang server).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { LayoutGrid, RefreshCw } from "lucide-react";
import { z } from "zod";
import { type AdminModuleItem, adminModuleItemSchema } from "@mediaos/contracts";
import { apiFetch, useCan } from "@mediaos/web-core";
import { Badge, Button, DataTable, EmptyState, Input, PageHeader } from "@mediaos/ui";
import {
  FOUNDATION_MODULE_VIEW,
  MODULES_API,
  MODULES_QUERY_KEY,
  moduleDetailPath,
} from "./constants";

const modulesListSchema = z.array(adminModuleItemSchema);

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------
function useModuleColumns(
  t: ReturnType<typeof useTranslation<"system">>["t"],
  onView: (code: string) => void,
): ColumnDef<AdminModuleItem>[] {
  return [
    {
      accessorKey: "module_code",
      header: t("modules.columns.code"),
      cell: ({ row }) => (
        <span className="font-mono text-xs font-medium text-foreground">
          {row.original.module_code}
        </span>
      ),
    },
    {
      accessorKey: "name",
      header: t("modules.columns.name"),
      cell: ({ row }) => (
        <span className="text-sm font-medium text-foreground">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "group",
      header: t("modules.columns.group"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.group ?? "—"}</span>
      ),
    },
    {
      accessorKey: "is_active",
      header: t("modules.columns.active"),
      cell: ({ row }) => (
        <Badge variant={row.original.is_active ? "outline" : "muted"}>
          {row.original.is_active ? t("modules.active.yes") : t("modules.active.no")}
        </Badge>
      ),
    },
    {
      accessorKey: "enabled",
      header: t("modules.columns.enabled"),
      cell: ({ row }) => (
        <Badge variant={row.original.enabled ? "outline" : "muted"}>
          {row.original.enabled ? t("modules.enabled.yes") : t("modules.enabled.no")}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: t("modules.columns.actions"),
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => onView(row.original.module_code)}>
          {t("modules.columns.viewDetail")}
        </Button>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export function ModulesPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const canView = useCan(FOUNDATION_MODULE_VIEW.action, FOUNDATION_MODULE_VIEW.resourceType);

  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: MODULES_QUERY_KEY,
    queryFn: () => apiFetch(MODULES_API, modulesListSchema),
    enabled: canView,
    staleTime: 30_000,
  });

  const columns = useModuleColumns(
    t,
    (code) => void navigate({ to: moduleDetailPath(code) as "/" }),
  );

  const items: AdminModuleItem[] = data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (m) => m.module_code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    );
  }, [items, search]);

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("modules.forbidden.title")}
          description={t("modules.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("modules.title")}
          description={t("modules.description")}
          icon={LayoutGrid}
        />
        <div className="mt-8">
          <EmptyState
            title={t("modules.error.title")}
            description={t("modules.error.description")}
            action={
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {tc("actions.retry")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={t("modules.title")}
        description={t("modules.description")}
        icon={LayoutGrid}
      />

      <form
        className="rounded-xl border border-border bg-card p-4 shadow-sm"
        onSubmit={(e) => e.preventDefault()}
      >
        <label className="flex max-w-sm flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("modules.filters.search")}
          </span>
          <Input
            value={search}
            placeholder={t("modules.filters.searchPlaceholder")}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </form>

      <DataTable
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("modules.empty.title")}
            description={t("modules.empty.description")}
          />
        }
      />
    </div>
  );
}
