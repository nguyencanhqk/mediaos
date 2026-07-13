import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { ShieldCheck, ShieldOff, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmployeeDto } from "@mediaos/contracts";
import { useCan } from "@mediaos/web-core";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@mediaos/ui";
import { rbacApi, type RoleSummary } from "@/lib/rbac-api";
import { AssignRoleDialog } from "./assign-role-dialog";
import { ObjectPermissionDialog } from "./object-permission-dialog";
import { RevokeRoleDialog } from "./revoke-role-dialog";

type DialogKind = "assign" | "revoke" | "object";

interface ActiveDialog {
  kind: DialogKind;
  user: EmployeeDto;
}

/** Badge variant theo trạng thái user. */
const STATUS_BADGE_VARIANT: Record<string, "secondary" | "outline" | "muted"> = {
  active: "secondary",
  suspended: "outline",
  inactive: "muted",
};

/** Skeleton hàng bảng cho loading state. */
function TableSkeleton({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, ri) => (
        <div key={ri} className="flex gap-4">
          {Array.from({ length: cols }).map((_, ci) => (
            <Skeleton key={ci} className="h-5 flex-1 rounded" />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * CS-2 — Phân quyền (console, tenant self, /system/permissions).
 *
 * Quyền gate (KHỚP permission-admin.controller.ts):
 *   - gán/thu role             → `assign-role:user`                 (canAssignRole)
 *   - object-permission set/xoá → `grant-object-permission:permission` (canGrantObject)
 * Cả 2 isSensitive ở BE; UI chỉ ẩn/hiện affordance, BE là nguồn ép thật (fail-closed).
 * Console = 1 công ty ⇒ KHÔNG cột companyId.
 */
export function PermissionsPage() {
  const { t } = useTranslation("rbac");
  const canAssignRole = useCan("assign-role", "user");
  const canGrantObject = useCan("grant-object-permission", "permission");
  const [active, setActive] = React.useState<ActiveDialog | null>(null);
  const [flash, setFlash] = React.useState<string | null>(null);
  const [userSearch, setUserSearch] = React.useState("");
  const flashTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const rolesQuery = useQuery({
    queryKey: ["console:rbac", "roles"],
    queryFn: rbacApi.listRoles,
    enabled: canAssignRole,
  });
  const usersQuery = useQuery({
    queryKey: ["console:rbac", "users"],
    queryFn: rbacApi.listUsers,
    enabled: canAssignRole || canGrantObject,
  });

  const roles = rolesQuery.data ?? [];

  const showFlash = React.useCallback((message: string) => {
    setFlash(message);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), 4000);
  }, []);

  React.useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  // Nếu thiếu CẢ hai quyền → không có gì để làm; chặn ở UI (BE vẫn là gác cuối).
  if (!canAssignRole && !canGrantObject) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <EmptyState
          icon={ShieldOff}
          title={t("noPermission.title")}
          description={t("noPermission.description")}
        />
      </div>
    );
  }

  const allUsers = usersQuery.data ?? [];
  const filteredUsers = userSearch.trim()
    ? allUsers.filter((u) => {
        const q = userSearch.toLowerCase();
        return u.email.toLowerCase().includes(q) || (u.fullName ?? "").toLowerCase().includes(q);
      })
    : allUsers;

  const loadFailed = rolesQuery.isError || usersQuery.isError;

  const roleColumns: ColumnDef<RoleSummary>[] = [
    {
      accessorKey: "name",
      header: t("roles.columns.name"),
      cell: ({ row }) => <span className="font-medium text-sm">{row.original.name}</span>,
    },
    {
      accessorKey: "id",
      header: t("roles.columns.id"),
      cell: ({ row }) => (
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {row.original.id}
        </code>
      ),
    },
  ];

  const userColumns: ColumnDef<EmployeeDto>[] = [
    {
      accessorKey: "fullName",
      header: t("users.columns.name"),
      cell: ({ row }) => (
        <span className="text-sm font-medium">
          {row.original.fullName ?? (
            <span className="italic text-muted-foreground">{t("users.noName")}</span>
          )}
        </span>
      ),
    },
    {
      accessorKey: "email",
      header: t("users.columns.email"),
      cell: ({ row }) => (
        <span className="font-mono text-sm text-muted-foreground">{row.original.email}</span>
      ),
    },
    {
      id: "teams",
      header: t("users.columns.teams"),
      cell: ({ row }) => {
        const names = row.original.teams.map((tm) => tm.teamName);
        return names.length > 0 ? (
          <span className="text-xs">{names.join(", ")}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      },
    },
    {
      accessorKey: "status",
      header: t("users.columns.status"),
      cell: ({ row }) => {
        const status = row.original.status;
        const variant = STATUS_BADGE_VARIANT[status] ?? "outline";
        return (
          <Badge variant={variant}>{t(`users.status.${status}`, { defaultValue: status })}</Badge>
        );
      },
    },
    {
      id: "actions",
      header: t("users.columns.actions"),
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1.5">
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

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <PageHeader icon={ShieldCheck} title={t("title")} description={t("subtitle")} />

      {/* Flash feedback (auto-dismiss 4s) */}
      {flash && (
        <p
          role="status"
          className="rounded-lg border border-success/30 bg-success-muted px-4 py-2.5 text-sm text-success"
        >
          {flash}
        </p>
      )}

      {/* Error state */}
      {loadFailed && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
        >
          <span>{t("feedback.loadFailed")}</span>
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
        </div>
      )}

      {/* Danh mục vai trò — chỉ hiện khi có quyền gán role */}
      {canAssignRole && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("roles.title")}</CardTitle>
            <CardDescription>{t("roles.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            {rolesQuery.isLoading ? (
              <TableSkeleton rows={3} cols={2} />
            ) : (
              <DataTable
                columns={roleColumns}
                data={roles}
                isLoading={false}
                emptyState={
                  <EmptyState title={t("roles.empty")} description={t("roles.emptyDescription")} />
                }
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Bảng người dùng */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-base">{t("users.title")}</CardTitle>
              <CardDescription>{t("users.description")}</CardDescription>
            </div>

            {/* Search filter */}
            <div className="shrink-0">
              <input
                type="search"
                className="h-8 w-52 rounded-md border border-border bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
                placeholder={t("users.searchPlaceholder")}
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                aria-label={t("users.searchLabel")}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {usersQuery.isLoading ? (
            <TableSkeleton rows={5} cols={5} />
          ) : (
            <DataTable
              columns={userColumns}
              data={filteredUsers}
              isLoading={false}
              emptyState={
                <EmptyState
                  icon={Users}
                  title={userSearch ? t("users.noSearchResults") : t("users.empty")}
                  description={userSearch ? t("users.noSearchResultsHint") : undefined}
                />
              }
            />
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
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
