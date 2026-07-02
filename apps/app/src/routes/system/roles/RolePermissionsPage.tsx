/**
 * SYSTEM-SCREEN-ROLE-PERMISSIONS (S2-FE-AUTH-4 · lane FE batch C) — gán/thu hồi quyền cho 1 role.
 *
 * API: POST/DELETE /auth/roles/:id/permissions (assign:permission, is_sensitive=true — ANTI-ESCALATION,
 * role-admin.controller.ts). Gate = useCanExact (KHÔNG useCan — sensitive pair KHÔNG kế thừa wildcard).
 *
 * ⚠️ BE GAP (đã biết): KHÔNG có GET liệt kê permission ĐÃ gán cho 1 role — bảng dưới đây là TOÀN BỘ danh
 * mục quyền hệ thống (GET /auth/permissions) dùng làm nguồn gán/thu hồi, KHÔNG phản ánh trạng thái hiện
 * tại (ghi rõ trong banner UI — KHÔNG bịa dữ liệu).
 *
 * States: forbidden · loading · error · matrix (search + pagination qua DataTable).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { KeyRound, RefreshCw, ArrowLeft } from "lucide-react";
import type { PermissionCatalogDto } from "@mediaos/contracts";
import { roleAdminApi, authKeys, useCanExact, ApiError } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Input, Select, Badge } from "@mediaos/ui";
import { SYSTEM_ENGINE_PAIRS } from "../constants";

const ASSIGNABLE_DATA_SCOPES = ["Own", "Team", "Department", "Company"] as const;
type AssignableDataScope = (typeof ASSIGNABLE_DATA_SCOPES)[number];

type TF = ReturnType<typeof useTranslation<"system">>["t"];

function permissionKey(p: { action: string; resourceType: string }): string {
  return `${p.action}:${p.resourceType}`;
}

function submitErrorMessage(err: unknown, t: TF): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return t("rolePermissions.errors.badPair");
    if (err.status === 403) return t("rolePermissions.errors.forbidden");
    if (err.status === 404) return t("rolePermissions.errors.notFound");
    if (err.status >= 500) return t("rolePermissions.errors.server");
  }
  return t("rolePermissions.errors.generic");
}

interface RolePermissionsPageProps {
  roleId: string;
  onBack?: () => void;
}

export function RolePermissionsPage({ roleId, onBack }: RolePermissionsPageProps) {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const canAssign = useCanExact(
    SYSTEM_ENGINE_PAIRS.ASSIGN_PERMISSION.action,
    SYSTEM_ENGINE_PAIRS.ASSIGN_PERMISSION.resourceType,
  );

  const [filter, setFilter] = useState("");
  const [scopeByKey, setScopeByKey] = useState<Record<string, AssignableDataScope>>({});
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(
    null,
  );

  const rolesQuery = useQuery({
    queryKey: authKeys.roles.list(),
    queryFn: () => roleAdminApi.listRoles(),
    enabled: canAssign,
    staleTime: 30_000,
  });
  const role = rolesQuery.data?.find((r) => r.id === roleId);

  const permissionsQuery = useQuery({
    queryKey: authKeys.permissionCatalog.list(),
    queryFn: () => roleAdminApi.listPermissions(),
    enabled: canAssign,
    staleTime: 60_000,
  });

  const assignMutation = useMutation({
    mutationFn: (input: { action: string; resourceType: string; dataScope: AssignableDataScope }) =>
      roleAdminApi.assignPermission(roleId, input),
    onSuccess: (grant) => {
      setFeedback({
        kind: "success",
        message: t("rolePermissions.assignSuccess", {
          pair: `${grant.action}:${grant.resourceType}`,
          scope: t(`rolePermissions.scope.${grant.dataScope}`, { defaultValue: grant.dataScope }),
        }),
      });
    },
    onError: (err) => setFeedback({ kind: "error", message: submitErrorMessage(err, t) }),
  });

  const revokeMutation = useMutation({
    mutationFn: (input: { action: string; resourceType: string }) =>
      roleAdminApi.revokePermission(roleId, input),
    onSuccess: (_result, vars) => {
      setFeedback({
        kind: "success",
        message: t("rolePermissions.revokeSuccess", {
          pair: `${vars.action}:${vars.resourceType}`,
        }),
      });
    },
    onError: (err) => setFeedback({ kind: "error", message: submitErrorMessage(err, t) }),
  });

  const busy = assignMutation.isPending || revokeMutation.isPending;

  const columns = useMemo<ColumnDef<PermissionCatalogDto>[]>(
    () => [
      {
        accessorKey: "resourceType",
        header: t("permissions.columns.resourceType"),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.resourceType}</span>,
      },
      {
        accessorKey: "action",
        header: t("permissions.columns.action"),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.action}</span>,
      },
      {
        accessorKey: "isSensitive",
        header: t("permissions.columns.sensitive"),
        cell: ({ row }) =>
          row.original.isSensitive ? (
            <Badge variant="warning">{t("permissions.sensitive")}</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("rolePermissions.columns.actions")}</span>,
        cell: ({ row }) => {
          const key = permissionKey(row.original);
          const scope = scopeByKey[key] ?? "Company";
          return (
            <div className="flex items-center justify-end gap-2">
              <Select
                aria-label={t("rolePermissions.dataScope")}
                className="w-36"
                value={scope}
                disabled={busy}
                onChange={(e) =>
                  setScopeByKey((prev) => ({
                    ...prev,
                    [key]: e.target.value as AssignableDataScope,
                  }))
                }
              >
                {ASSIGNABLE_DATA_SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {t(`rolePermissions.scope.${s}`)}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  assignMutation.mutate({
                    action: row.original.action,
                    resourceType: row.original.resourceType,
                    dataScope: scope,
                  })
                }
              >
                {t("rolePermissions.assign")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  revokeMutation.mutate({
                    action: row.original.action,
                    resourceType: row.original.resourceType,
                  })
                }
              >
                {t("rolePermissions.revoke")}
              </Button>
            </div>
          );
        },
      },
    ],
    [t, scopeByKey, busy, assignMutation, revokeMutation],
  );

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canAssign) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("rolePermissions.forbidden.title")}
          description={t("rolePermissions.forbidden.description")}
        />
      </div>
    );
  }

  const isLoading = rolesQuery.isLoading || permissionsQuery.isLoading;
  const isError = rolesQuery.isError || permissionsQuery.isError;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={tc("loading")} icon={KeyRound} />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // ── Error / role not found ────────────────────────────────────────────────
  if (isError || !role) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("rolePermissions.error.title")}
          description={t("rolePermissions.error.description")}
          action={
            <div className="flex gap-2">
              {onBack && (
                <Button variant="outline" size="sm" onClick={onBack}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t("roleDetail.backToList")}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void rolesQuery.refetch();
                  void permissionsQuery.refetch();
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {tc("actions.retry")}
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const items = permissionsQuery.data ?? [];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("rolePermissions.title", { role: role.name })}
        description={t("rolePermissions.description")}
        icon={KeyRound}
        actions={
          onBack && (
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("roleDetail.backToList")}
            </Button>
          )
        }
      />

      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {t("rolePermissions.assignedListNotice")}
      </p>

      {feedback && (
        <p
          role="alert"
          aria-live="assertive"
          className={
            feedback.kind === "success"
              ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
              : "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          }
        >
          {feedback.message}
        </p>
      )}

      <Input
        placeholder={t("rolePermissions.search")}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-72"
      />

      <DataTable
        columns={columns}
        data={items}
        globalFilter={filter}
        emptyState={
          <EmptyState
            title={t("permissions.empty.title")}
            description={t("permissions.empty.description")}
          />
        }
        pageSize={20}
      />
    </div>
  );
}
