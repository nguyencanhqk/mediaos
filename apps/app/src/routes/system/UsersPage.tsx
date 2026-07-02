/**
 * SYSTEM-SCREEN-USERS (S2-FE-AUTH-3) — User list, nối /auth/users (thay read-only placeholder cũ
 * dùng /users/admin — S2-FE-HR-3 P1).
 *
 * Permission gate: useCan("view", "user") — canonical engine pair AUTH.USER.VIEW → view:user
 *   (DB-02 §9.1 + seed §13 migration 0444/0450; hr + company-admin được view:user/Company).
 * Server enforces all data-scope; client only renders what server returns.
 *
 * States covered: loading · error · empty · forbidden.
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Users, RefreshCw, ChevronRight } from "lucide-react";
import type { AuthUserDto } from "@mediaos/contracts";
import { authUsersApi, authUsersKeys, useCan, PermissionGate } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Badge } from "@mediaos/ui";
import { SYSTEM_ENGINE_PAIRS } from "./constants";

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function UserStatusBadge({ status }: { status: AuthUserDto["status"] }) {
  const { t } = useTranslation("system");
  const variant = status === "active" ? "default" : status === "invited" ? "secondary" : "danger";
  return <Badge variant={variant}>{t(`users.status.${status}`)}</Badge>;
}

// ---------------------------------------------------------------------------
// Column definitions — moved out of component to avoid recreation on render
// ---------------------------------------------------------------------------
function useUserColumns(
  t: ReturnType<typeof useTranslation<"system">>["t"],
  onOpenDetail: (id: string) => void,
): ColumnDef<AuthUserDto>[] {
  return [
    {
      accessorKey: "email",
      header: t("users.columns.email"),
      cell: ({ row }) => (
        <span className="text-sm font-medium text-foreground">{row.original.email}</span>
      ),
    },
    {
      accessorKey: "fullName",
      header: t("users.columns.fullName"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.fullName ?? "—"}</span>
      ),
    },
    {
      accessorKey: "status",
      header: t("users.columns.status"),
      cell: ({ row }) => <UserStatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "lastLoginAt",
      header: t("users.columns.lastLogin"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.lastLoginAt
            ? new Date(row.original.lastLoginAt).toLocaleDateString("vi-VN")
            : "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => onOpenDetail(row.original.id)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function UsersPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  // READ_USER = { action: "view", resourceType: "user" } → view:user (seed §13/§0450).
  const { action, resourceType } = SYSTEM_ENGINE_PAIRS.READ_USER;
  const canView = useCan(action, resourceType);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: authUsersKeys.list({ limit: 50, offset: 0 }),
    queryFn: () => authUsersApi.listUsers({ limit: 50, offset: 0 }),
    enabled: canView,
    staleTime: 30_000,
  });

  const openDetail = (id: string) =>
    void navigate({ to: "/system/users/$userId", params: { userId: id } });

  const columns = useUserColumns(t, openDetail);

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("users.forbidden.title")}
          description={t("users.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <PageHeader title={t("users.title")} description={t("users.description")} icon={Users} />
        <div className="mt-8">
          <EmptyState
            title={t("users.error.title")}
            description={t("users.error.description")}
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

  const items: AuthUserDto[] = data?.users ?? [];

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t("users.title")} description={t("users.description")} icon={Users}>
        <PermissionGate
          action={SYSTEM_ENGINE_PAIRS.CREATE_USER.action}
          resourceType={SYSTEM_ENGINE_PAIRS.CREATE_USER.resourceType}
        >
          <Button size="sm" onClick={() => void navigate({ to: "/system/users/new" })}>
            {t("users.actions.create")}
          </Button>
        </PermissionGate>
      </PageHeader>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState title={t("users.empty.title")} description={t("users.empty.description")} />
        }
        pageSize={50}
      />
    </div>
  );
}
