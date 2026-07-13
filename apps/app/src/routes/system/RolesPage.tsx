/**
 * SYSTEM-SCREEN-ROLES (S2-FE-AUTH-4 · lane FE batch C) — danh sách role + tạo mới + gán quyền.
 *
 * Nguồn cũ (S2-FE-HR-3) là read-only placeholder gọi `/org/roles` (endpoint KHÔNG tồn tại ở BE) —
 * RECONCILE sang API thật: GET /auth/roles (view:role) — auth-roles-permissions.controller.ts.
 * Create role: POST /auth/roles (create:role) — role-admin.controller.ts. System role KHÔNG cho sửa
 * (badge "Hệ thống" — nút sửa ẩn qua PermissionGate + RoleFormPage disable field/submit).
 *
 * Permission gate: useCan("view","role") — canonical engine pair AUTH.ROLE.VIEW → view:role
 *   (DB-02 §9.1 + seed §13 migration 0444; chỉ company-admin được view:role/Company).
 * Server enforces all data-scope; client only renders what server returns.
 *
 * States covered: loading · error · empty · forbidden.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Shield, RefreshCw, Plus, KeyRound, Trash2 } from "lucide-react";
import type { RoleDto } from "@mediaos/contracts";
import { ApiError, roleAdminApi, authKeys, useCan, PermissionGate } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Input, Badge, Dialog } from "@mediaos/ui";
import { SYSTEM_ENGINE_PAIRS } from "./constants";

// ---------------------------------------------------------------------------
// Column definitions — moved outside component to avoid recreation on render
// ---------------------------------------------------------------------------
function useRoleColumns(
  t: ReturnType<typeof useTranslation<"system">>["t"],
  navigate: ReturnType<typeof useNavigate>,
  onDelete: (role: RoleDto) => void,
): ColumnDef<RoleDto>[] {
  return [
    {
      accessorKey: "name",
      header: t("roles.columns.name"),
      cell: ({ row }) => (
        <button
          type="button"
          className="font-medium text-brand hover:underline"
          onClick={() =>
            void navigate({ to: "/system/roles/$roleId", params: { roleId: row.original.id } })
          }
        >
          {row.original.name}
        </button>
      ),
    },
    {
      accessorKey: "description",
      header: t("roles.columns.description"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.description ?? "—"}</span>
      ),
    },
    {
      accessorKey: "isSystem",
      header: t("roles.columns.type"),
      cell: ({ row }) =>
        row.original.isSystem ? (
          <Badge variant="warning">{t("roleDetail.systemBadge")}</Badge>
        ) : (
          <Badge variant="secondary">{t("roleDetail.companyRole")}</Badge>
        ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("roles.columns.actions")}</span>,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <PermissionGate
            action={SYSTEM_ENGINE_PAIRS.ASSIGN_PERMISSION.action}
            resourceType={SYSTEM_ENGINE_PAIRS.ASSIGN_PERMISSION.resourceType}
          >
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("roleDetail.managePermissions")}
              onClick={() =>
                void navigate({
                  to: "/system/roles/$roleId/permissions",
                  params: { roleId: row.original.id },
                })
              }
            >
              <KeyRound className="h-4 w-4" />
            </Button>
          </PermissionGate>
          {/* Xoá vai trò — chỉ vai trò công ty (ẨN với is_system; server cũng REJECT 400). Gate delete:role. */}
          {!row.original.isSystem && (
            <PermissionGate
              action={SYSTEM_ENGINE_PAIRS.DELETE_ROLE.action}
              resourceType={SYSTEM_ENGINE_PAIRS.DELETE_ROLE.resourceType}
            >
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("roles.delete.action")}
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete(row.original)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </PermissionGate>
          )}
        </div>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Delete error mapping — map ApiError status → thông báo rõ nghĩa (KHÔNG lộ chi tiết server).
// ---------------------------------------------------------------------------
function deleteRoleErrorMessage(
  err: unknown,
  t: ReturnType<typeof useTranslation<"system">>["t"],
): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return t("roles.delete.error.system");
    if (err.status === 403) return t("roles.delete.error.forbidden");
    if (err.status === 404) return t("roles.delete.error.notFound");
  }
  return t("roles.delete.error.generic");
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function RolesPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { action, resourceType } = SYSTEM_ENGINE_PAIRS.READ_ROLE;
  const canView = useCan(action, resourceType);
  const [filter, setFilter] = useState("");
  const [roleToDelete, setRoleToDelete] = useState<RoleDto | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: authKeys.roles.list(),
    queryFn: () => roleAdminApi.listRoles(),
    enabled: canView,
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (roleId: string) => roleAdminApi.deleteRole(roleId),
    onSuccess: async (result) => {
      setRoleToDelete(null);
      setDeleteError(null);
      setFeedback(
        result.revokedMembers > 0
          ? t("roles.delete.successWithMembers", { members: result.revokedMembers })
          : t("roles.delete.success"),
      );
      await queryClient.invalidateQueries({ queryKey: authKeys.roles.list() });
    },
    onError: (err) => setDeleteError(deleteRoleErrorMessage(err, t)),
  });

  const openDeleteDialog = (role: RoleDto) => {
    setDeleteError(null);
    setFeedback(null);
    setRoleToDelete(role);
  };

  const closeDeleteDialog = () => {
    if (deleteMutation.isPending) return;
    setRoleToDelete(null);
    setDeleteError(null);
  };

  const columns = useRoleColumns(t, navigate, openDeleteDialog);

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

  const items = data ?? [];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("roles.title")}
        description={t("roles.description")}
        icon={Shield}
        actions={
          <PermissionGate
            action={SYSTEM_ENGINE_PAIRS.CREATE_ROLE.action}
            resourceType={SYSTEM_ENGINE_PAIRS.CREATE_ROLE.resourceType}
          >
            <Button size="sm" onClick={() => void navigate({ to: "/system/roles/new" })}>
              <Plus className="mr-2 h-4 w-4" />
              {t("roles.addRole")}
            </Button>
          </PermissionGate>
        }
      >
        <Input
          placeholder={t("roles.search")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-64"
        />
      </PageHeader>

      {feedback && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-md border border-success/40 bg-success-muted px-3 py-2 text-sm text-success"
        >
          {feedback}
        </p>
      )}

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        globalFilter={filter}
        emptyState={
          <EmptyState title={t("roles.empty.title")} description={t("roles.empty.description")} />
        }
        pageSize={50}
      />

      {/* Dialog xác nhận xoá — cascade gỡ khỏi mọi thành viên. Chỉ mở cho vai trò công ty (nút ẩn với system). */}
      <Dialog
        open={roleToDelete !== null}
        onClose={closeDeleteDialog}
        title={t("roles.delete.dialogTitle")}
        description={
          roleToDelete
            ? t("roles.delete.dialogDescription", { name: roleToDelete.name })
            : undefined
        }
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={closeDeleteDialog}
              disabled={deleteMutation.isPending}
            >
              {t("roles.delete.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => roleToDelete && deleteMutation.mutate(roleToDelete.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? tc("saving") : t("roles.delete.confirm")}
            </Button>
          </>
        }
      >
        {deleteError && (
          <p role="alert" className="text-sm text-destructive">
            {deleteError}
          </p>
        )}
      </Dialog>
    </div>
  );
}
