import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  type AdminUserDto,
  ADMIN_USER_RESOURCE_TYPE,
  DELETE_USER_ACTION,
  INVITE_USER_ACTION,
  MANAGE_USER_ACTION,
  SUSPEND_USER_ACTION,
  type UserStatus,
} from "@mediaos/contracts";
import { PermissionGate, useCan } from "@mediaos/web-core";
import { Badge, Button, Card, CardContent, DataTable, EmptyState } from "@mediaos/ui";
import { adminUsersApi } from "@/lib/admin-users-api";
import { consoleInvitesApi } from "@/lib/invites-api";
import { DeleteUserDialog } from "./delete-user-dialog";
import { InviteUserDialog } from "./invite-user-dialog";
import { SuspendUserDialog } from "./suspend-user-dialog";

/**
 * ACCT-2-FE — Quản lý người dùng (admin, /system/users).
 *
 * Gate hiển thị quyền `manage:user` (is_sensitive=false).
 * Thao tác nhạy cảm bọc PermissionGate:
 *   - suspend/reactivate: suspend:user (is_sensitive=true)
 *   - soft-delete:        delete-user:user (is_sensitive=true)
 *   - invite:             invite:user (is_sensitive=true, per CS-10)
 * Server ép quyền qua PermissionGuard — FE chỉ ẩn/hiện affordance, KHÔNG tin tưởng thay thế server.
 */

const PAGE_LIMIT = 25;

/** Badge variant theo trạng thái user. */
const STATUS_VARIANT: Record<UserStatus, "secondary" | "outline"> = {
  active: "secondary",
  suspended: "outline",
};

interface FilterState {
  q: string;
  status: UserStatus | "";
}

const EMPTY_FILTER: FilterState = { q: "", status: "" };

export function UsersPage() {
  const { t } = useTranslation("users");
  const queryClient = useQueryClient();

  const canManage = useCan(MANAGE_USER_ACTION, ADMIN_USER_RESOURCE_TYPE);
  const canInvite = useCan(INVITE_USER_ACTION, ADMIN_USER_RESOURCE_TYPE);

  // Filter state (draft = UI chưa apply; applied = đang dùng cho query)
  const [draft, setDraft] = React.useState<FilterState>(EMPTY_FILTER);
  const [applied, setApplied] = React.useState<FilterState>(EMPTY_FILTER);
  const [offset, setOffset] = React.useState(0);

  // Dialog state
  const [suspendTarget, setSuspendTarget] = React.useState<AdminUserDto | null>(null);
  const [reactivateTarget, setReactivateTarget] = React.useState<AdminUserDto | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<AdminUserDto | null>(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [flash, setFlash] = React.useState<string | null>(null);

  // ── Query ────────────────────────────────────────────────────────────────────
  const usersQuery = useQuery({
    queryKey: ["admin:users", applied, offset],
    queryFn: () =>
      adminUsersApi.list({
        limit: PAGE_LIMIT,
        offset,
        ...(applied.status ? { status: applied.status } : {}),
        ...(applied.q ? { q: applied.q } : {}),
      }),
    enabled: canManage,
  });

  function invalidateList() {
    void queryClient.invalidateQueries({ queryKey: ["admin:users"] });
  }

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 4000);
  }

  // ── Mutations ────────────────────────────────────────────────────────────────
  const suspendMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      adminUsersApi.suspend(id, reason ? { reason } : {}),
    onSuccess: () => {
      invalidateList();
      setSuspendTarget(null);
      showFlash(t("feedback.suspendOk"));
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => adminUsersApi.reactivate(id),
    onSuccess: () => {
      invalidateList();
      setReactivateTarget(null);
      showFlash(t("feedback.reactivateOk"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminUsersApi.softDelete(id),
    onSuccess: () => {
      invalidateList();
      setDeleteTarget(null);
      showFlash(t("feedback.deleteOk"));
    },
  });

  const inviteMutation = useMutation({
    mutationFn: consoleInvitesApi.invite,
    onSuccess: (result) => {
      invalidateList();
      setInviteOpen(false);
      showFlash(result.emailSent ? t("feedback.inviteOk") : t("feedback.inviteOkNoEmail"));
    },
  });

  // ── Table columns ─────────────────────────────────────────────────────────────
  const columns: ColumnDef<AdminUserDto>[] = React.useMemo(
    () => [
      {
        accessorKey: "email",
        header: t("table.email"),
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.email}</span>
        ),
      },
      {
        accessorKey: "fullName",
        header: t("table.fullName"),
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.fullName ?? (
              <span className="italic text-muted-foreground">{t("table.noName")}</span>
            )}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: t("table.status"),
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.original.status]}>
            {t(`status.${row.original.status}`)}
          </Badge>
        ),
      },
      {
        accessorKey: "lastLoginAt",
        header: t("table.lastLoginAt"),
        cell: ({ row }) =>
          row.original.lastLoginAt ? (
            <span className="whitespace-nowrap text-xs">
              {new Date(row.original.lastLoginAt).toLocaleString("vi-VN")}
            </span>
          ) : (
            <span className="text-xs italic text-muted-foreground">{t("table.neverLoggedIn")}</span>
          ),
      },
      {
        accessorKey: "createdAt",
        header: t("table.createdAt"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs">
            {new Date(row.original.createdAt).toLocaleString("vi-VN")}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const user = row.original;
          return (
            <div className="flex items-center gap-2">
              {/* suspend / reactivate — gated by suspend:user */}
              <PermissionGate action={SUSPEND_USER_ACTION} resourceType={ADMIN_USER_RESOURCE_TYPE}>
                {user.status === "active" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSuspendTarget(user)}
                    disabled={suspendMutation.isPending}
                  >
                    {t("actions.suspend")}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setReactivateTarget(user)}
                    disabled={reactivateMutation.isPending}
                  >
                    {t("actions.reactivate")}
                  </Button>
                )}
              </PermissionGate>

              {/* soft-delete — gated by delete-user:user */}
              <PermissionGate action={DELETE_USER_ACTION} resourceType={ADMIN_USER_RESOURCE_TYPE}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteTarget(user)}
                  disabled={deleteMutation.isPending}
                >
                  {t("actions.delete")}
                </Button>
              </PermissionGate>
            </div>
          );
        },
      },
    ],
    [t, suspendMutation.isPending, reactivateMutation.isPending, deleteMutation.isPending],
  );

  // ── No permission ─────────────────────────────────────────────────────────────
  if (!canManage) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <EmptyState
          icon={Users}
          title={t("noPermission.title")}
          description={t("noPermission.description")}
        />
      </div>
    );
  }

  // ── Data ──────────────────────────────────────────────────────────────────────
  const data = usersQuery.data?.users ?? [];
  const total = usersQuery.data?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = offset + data.length;

  function applyFilter() {
    setOffset(0);
    setApplied(draft);
  }

  function clearFilter() {
    setOffset(0);
    setDraft(EMPTY_FILTER);
    setApplied(EMPTY_FILTER);
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>

        {/* Invite button — gated by invite:user */}
        {canInvite && (
          <Button onClick={() => setInviteOpen(true)}>{t("actions.invite")}</Button>
        )}
      </header>

      {/* Flash feedback */}
      {flash && (
        <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          {flash}
        </p>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
        <label className="flex flex-col gap-1 text-xs">
          <span>{t("filter.search")}</span>
          <input
            className="rounded border border-border px-2 py-1 text-sm"
            value={draft.q}
            placeholder={t("filter.searchPlaceholder")}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span>{t("filter.status")}</span>
          <select
            className="rounded border border-border px-2 py-1 text-sm"
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as UserStatus | "" })}
          >
            <option value="">{t("filter.all")}</option>
            <option value="active">{t("filter.active")}</option>
            <option value="suspended">{t("filter.suspended")}</option>
          </select>
        </label>

        <div className="flex gap-2">
          <Button size="sm" onClick={applyFilter}>
            {t("filter.apply")}
          </Button>
          <Button size="sm" variant="outline" onClick={clearFilter}>
            {t("filter.clear")}
          </Button>
        </div>
      </div>

      {/* Error state */}
      {usersQuery.isError && (
        <p
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t("feedback.loadFailed")}
          <Button variant="outline" size="sm" onClick={() => void usersQuery.refetch()}>
            {t("common:actions.retry")}
          </Button>
        </p>
      )}

      {/* Table */}
      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={data}
            isLoading={usersQuery.isLoading}
            emptyState={
              <EmptyState
                icon={Users}
                title={t("table.empty")}
                description={t("subtitle")}
              />
            }
          />
        </CardContent>
      </Card>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("pagination.summary", { from, to, total })}</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_LIMIT))}
            >
              {t("pagination.prev")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={to >= total}
              onClick={() => setOffset(offset + PAGE_LIMIT)}
            >
              {t("pagination.next")}
            </Button>
          </div>
        </div>
      )}

      {/* ── Dialogs ── */}

      {/* Suspend */}
      {suspendTarget && (
        <SuspendUserDialog
          open
          user={suspendTarget}
          pending={suspendMutation.isPending}
          error={suspendMutation.isError ? t("feedback.suspendFailed") : null}
          onConfirm={(reason) => suspendMutation.mutate({ id: suspendTarget.id, reason })}
          onClose={() => {
            suspendMutation.reset();
            setSuspendTarget(null);
          }}
        />
      )}

      {/* Reactivate — inline confirm (simpler than full dialog; no reason field) */}
      {reactivateTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        >
          <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-lg">
            <h2 className="mb-2 text-lg font-semibold">{t("reactivate.title")}</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {t("reactivate.description", { email: reactivateTarget.email })}
            </p>
            {reactivateMutation.isError && (
              <p role="alert" aria-live="assertive" className="mb-3 text-sm text-destructive">
                {t("feedback.reactivateFailed")}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  reactivateMutation.reset();
                  setReactivateTarget(null);
                }}
                disabled={reactivateMutation.isPending}
              >
                {t("reactivate.cancel")}
              </Button>
              <Button
                onClick={() => reactivateMutation.mutate(reactivateTarget.id)}
                disabled={reactivateMutation.isPending}
              >
                {reactivateMutation.isPending ? t("common:saving") : t("reactivate.confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete */}
      {deleteTarget && (
        <DeleteUserDialog
          open
          user={deleteTarget}
          pending={deleteMutation.isPending}
          error={deleteMutation.isError ? t("feedback.deleteFailed") : null}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          onClose={() => {
            deleteMutation.reset();
            setDeleteTarget(null);
          }}
        />
      )}

      {/* Invite */}
      {inviteOpen && (
        <InviteUserDialog
          open
          pending={inviteMutation.isPending}
          error={inviteMutation.isError ? t("feedback.inviteFailed") : null}
          onConfirm={(data) => inviteMutation.mutate(data)}
          onClose={() => {
            inviteMutation.reset();
            setInviteOpen(false);
          }}
        />
      )}
    </div>
  );
}
