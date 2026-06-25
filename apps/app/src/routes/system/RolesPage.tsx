/**
 * SYSTEM-SCREEN-ROLES (S2-FE-HR-3 P1) — Role list read-only placeholder.
 *
 * Scope: read-only list only; full role-permission management deferred to Sprint 3.
 * Permission gate: useCan("read", "role") — khớp engine pair AUTH.ROLE.VIEW → read:role.
 * Server enforces all data-scope; client only renders what server returns.
 *
 * States covered: loading · error · empty · forbidden.
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Shield, RefreshCw, Clock } from "lucide-react";
import { z } from "zod";
import { apiFetch, useCan } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button } from "@mediaos/ui";
import { SYSTEM_ENGINE_PAIRS } from "./constants";

// ---------------------------------------------------------------------------
// Schema + type (inline — no shared contract for role list yet)
// ---------------------------------------------------------------------------
const roleItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

const roleListSchema = z.array(roleItemSchema);

type RoleItem = z.infer<typeof roleItemSchema>;

// ---------------------------------------------------------------------------
// Query key
// ---------------------------------------------------------------------------
const ROLES_QUERY_KEY = ["system", "roles"] as const;

// ---------------------------------------------------------------------------
// Column definitions — moved outside component to avoid recreation on render
// ---------------------------------------------------------------------------
function useRoleColumns(
  t: ReturnType<typeof useTranslation<"system">>["t"],
): ColumnDef<RoleItem>[] {
  return [
    {
      accessorKey: "name",
      header: t("roles.columns.name"),
      cell: ({ row }) => <span className="font-medium text-foreground">{row.original.name}</span>,
    },
    {
      accessorKey: "id",
      header: t("roles.columns.id"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.id}</span>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function RolesPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const { action, resourceType } = SYSTEM_ENGINE_PAIRS.READ_ROLE;
  const canView = useCan(action, resourceType);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ROLES_QUERY_KEY,
    queryFn: () => apiFetch("/org/roles", roleListSchema),
    enabled: canView,
    staleTime: 60_000,
  });

  const columns = useRoleColumns(t);

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("roles.forbidden.title")}
          description={t("roles.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <PageHeader title={t("roles.title")} description={t("roles.description")} icon={Shield} />
        <div className="mt-8">
          <EmptyState
            title={t("roles.error.title")}
            description={t("roles.error.description")}
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

  const items: RoleItem[] = data ?? [];

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t("roles.title")} description={t("roles.description")} icon={Shield}>
        {/* Sprint-3 notice — placeholder badge so QA knows full management is pending */}
        <div className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>{t("roles.sprint3Notice")}</span>
        </div>
      </PageHeader>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState title={t("roles.empty.title")} description={t("roles.empty.description")} />
        }
        pageSize={50}
      />
    </div>
  );
}
