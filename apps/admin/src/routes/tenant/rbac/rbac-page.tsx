import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmployeeDto } from "@mediaos/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { useCan } from "@/hooks/use-can";
import { rbacApi, type RoleSummary } from "@/lib/rbac-api";
import { AssignRoleDialog } from "./assign-role-dialog";
import { ObjectPermissionDialog } from "./object-permission-dialog";
import { RevokeRoleDialog } from "./revoke-role-dialog";

type DialogKind = "assign" | "revoke" | "object";

interface ActiveDialog {
  kind: DialogKind;
  user: EmployeeDto;
}

/**
 * RBAC self-service (AC-3 nhánh (a)). company-admin quản role/quyền của công ty MÌNH.
 *
 * Quyền gate (KHỚP permission-admin.controller.ts):
 *   - gán/thu role            → `assign-role:user`            (canAssignRole)
 *   - object-permission set/xoá → `grant-object-permission:permission` (canGrantObject)
 * Cả 2 isSensitive ở BE; UI chỉ ẩn/hiện affordance, BE là nguồn ép thật (fail-closed).
 */
export function RbacPage() {
  const { t } = useTranslation("rbac");
  const canAssignRole = useCan("assign-role", "user");
  const canGrantObject = useCan("grant-object-permission", "permission");
  const [active, setActive] = React.useState<ActiveDialog | null>(null);
  const [flash, setFlash] = React.useState<string | null>(null);

  const rolesQuery = useQuery({ queryKey: ["rbac", "roles"], queryFn: rbacApi.listRoles });
  const usersQuery = useQuery({ queryKey: ["rbac", "users"], queryFn: rbacApi.listUsers });

  const roles = rolesQuery.data ?? [];

  // Nếu thiếu CẢ hai quyền → không có gì để làm; chặn ở UI (BE vẫn là gác cuối).
  if (!canAssignRole && !canGrantObject) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <EmptyState
          icon={ShieldCheck}
          title={t("noPermission.title")}
          description={t("noPermission.description")}
        />
      </div>
    );
  }

  const showFlash = (message: string) => setFlash(message);

  const roleColumns: ColumnDef<RoleSummary>[] = [
    { accessorKey: "name", header: t("roles.columns.name") },
    {
      accessorKey: "id",
      header: t("roles.columns.id"),
      cell: ({ row }) => <code className="text-xs text-muted-foreground">{row.original.id}</code>,
    },
  ];

  const userColumns: ColumnDef<EmployeeDto>[] = [
    {
      accessorKey: "fullName",
      header: t("users.columns.name"),
      cell: ({ row }) => row.original.fullName ?? t("users.noName"),
    },
    { accessorKey: "email", header: t("users.columns.email") },
    {
      accessorKey: "status",
      header: t("users.columns.status"),
      cell: ({ row }) => <Badge variant="secondary">{row.original.status}</Badge>,
    },
    {
      id: "actions",
      header: t("users.columns.actions"),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          {canAssignRole && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActive({ kind: "assign", user: row.original })}
              >
                {t("actions.assignRole")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActive({ kind: "revoke", user: row.original })}
              >
                {t("actions.revokeRole")}
              </Button>
            </>
          )}
          {canGrantObject && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActive({ kind: "object", user: row.original })}
            >
              {t("actions.objectPermission")}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const loadFailed = rolesQuery.isError || usersQuery.isError;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {flash && (
        <p
          role="status"
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
        >
          {flash}
        </p>
      )}

      {loadFailed && (
        <p
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t("feedback.loadFailed")}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void rolesQuery.refetch();
              void usersQuery.refetch();
            }}
          >
            {t("common:actions.retry")}
          </Button>
        </p>
      )}

      {canAssignRole && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("roles.title")}</CardTitle>
            <CardDescription>{t("roles.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={roleColumns}
              data={roles}
              loading={rolesQuery.isLoading}
              emptyMessage={t("roles.empty")}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("users.title")}</CardTitle>
          <CardDescription>{t("users.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={userColumns}
            data={usersQuery.data ?? []}
            loading={usersQuery.isLoading}
            emptyMessage={t("users.empty")}
          />
        </CardContent>
      </Card>

      {active?.kind === "assign" && (
        <AssignRoleDialog
          open
          onClose={() => setActive(null)}
          user={active.user}
          roles={roles}
          onSuccess={showFlash}
        />
      )}
      {active?.kind === "revoke" && (
        <RevokeRoleDialog
          open
          onClose={() => setActive(null)}
          user={active.user}
          roles={roles}
          onSuccess={showFlash}
        />
      )}
      {active?.kind === "object" && (
        <ObjectPermissionDialog
          open
          onClose={() => setActive(null)}
          user={active.user}
          onSuccess={showFlash}
        />
      )}
    </div>
  );
}
