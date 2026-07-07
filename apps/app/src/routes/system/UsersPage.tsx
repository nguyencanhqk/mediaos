/**
 * SYSTEM-SCREEN-USERS (S2-FE-AUTH-3 · S2-AUTH-USEROPS-1) — User list, nối /auth/users.
 *
 * S2-AUTH-USEROPS-1 (owner-request 2026-07-07): thao tác hàng loạt (checkbox + thanh bulk) ·
 * khóa/mở khóa ngay trên danh sách · admin đặt lại mật khẩu (temp password hiện ĐÚNG 1 lần) ·
 * xóa mềm + tab "Đã xóa" + khôi phục.
 *
 * Permission gates (cặp CANONICAL seed §13 / mig 0444/0450/0476):
 *   - view:user           → useCan   (danh sách)
 *   - create:user         → PermissionGate (nút Tạo)
 *   - lock/unlock:user    → useCan   (non-sensitive)
 *   - delete:user · restore:user · reset-password:user → useCanExact (SENSITIVE mig 0476 — wildcard
 *     '*:*' KHÔNG mở cổng; cần SENSITIVE_CAPABILITY_ALLOWLIST phía BE surface qua /auth/me).
 * Server enforces all permission/self-guard/data-scope; client chỉ ẩn/hiện affordance (KHÔNG tin FE).
 *
 * BẤT BIẾN #3: tempPassword từ reset CHỈ đi vào TempPasswordDialog qua state cục bộ — KHÔNG log,
 * KHÔNG vào query-cache (mutation KHÔNG persist kết quả), đóng dialog là mất.
 *
 * States covered: loading · error · empty · forbidden · bulk-progress · bulk-result.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import {
  Users,
  RefreshCw,
  ChevronRight,
  Lock,
  Unlock,
  KeyRound,
  Trash2,
  RotateCcw,
} from "lucide-react";
import type { AuthUserDto } from "@mediaos/contracts";
import {
  authUsersApi,
  authUsersKeys,
  useAuthStore,
  useCan,
  useCanExact,
  PermissionGate,
} from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Badge } from "@mediaos/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SYSTEM_ENGINE_PAIRS } from "./constants";
import { TempPasswordDialog } from "./users/TempPasswordDialog";
import {
  eligibleTargets,
  runBulkSequential,
  type BulkRunResult,
  type BulkUserAction,
} from "./users/bulk-actions";

const PAGE_LIMIT = 50;

type ViewTab = "active" | "deleted";
type RowAction = "lock" | "unlock" | "delete" | "restore" | "resetPassword";

type ConfirmState =
  | { kind: "row"; action: RowAction; user: AuthUserDto }
  | { kind: "bulk"; action: BulkUserAction; targets: AuthUserDto[]; skipped: number }
  | null;

interface ResetResultState {
  email: string;
  tempPassword: string;
  revokedSessionCount: number;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function UserStatusBadge({ status }: { status: AuthUserDto["status"] }) {
  const { t } = useTranslation("system");
  const variant = status === "active" ? "default" : status === "invited" ? "secondary" : "danger";
  return <Badge variant={variant}>{t(`users.status.${status}`)}</Badge>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function UsersPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id);

  // ── Permissions ─────────────────────────────────────────────────────────────
  const { action, resourceType } = SYSTEM_ENGINE_PAIRS.READ_USER;
  const canView = useCan(action, resourceType);
  const canLock = useCan(
    SYSTEM_ENGINE_PAIRS.LOCK_USER.action,
    SYSTEM_ENGINE_PAIRS.LOCK_USER.resourceType,
  );
  const canUnlock = useCan(
    SYSTEM_ENGINE_PAIRS.UNLOCK_USER.action,
    SYSTEM_ENGINE_PAIRS.UNLOCK_USER.resourceType,
  );
  // SENSITIVE (mig 0476) → useCanExact fail-closed (mirror RESET_2FA_USER — wildcard KHÔNG mở cổng).
  const canDelete = useCanExact(
    SYSTEM_ENGINE_PAIRS.DELETE_USER.action,
    SYSTEM_ENGINE_PAIRS.DELETE_USER.resourceType,
  );
  const canRestore = useCanExact(
    SYSTEM_ENGINE_PAIRS.RESTORE_USER.action,
    SYSTEM_ENGINE_PAIRS.RESTORE_USER.resourceType,
  );
  const canResetPassword = useCanExact(
    SYSTEM_ENGINE_PAIRS.RESET_PASSWORD_USER.action,
    SYSTEM_ENGINE_PAIRS.RESET_PASSWORD_USER.resourceType,
  );
  const hasBulkActions = canLock || canUnlock || canDelete;

  // ── State ───────────────────────────────────────────────────────────────────
  const [tab, setTab] = React.useState<ViewTab>("active");
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = React.useState<ConfirmState>(null);
  const [flash, setFlash] = React.useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = React.useState<{ done: number; total: number } | null>(
    null,
  );
  const [bulkResult, setBulkResult] = React.useState<(BulkRunResult & { action: string }) | null>(
    null,
  );
  const [resetResult, setResetResult] = React.useState<ResetResultState | null>(null);

  const showFlash = React.useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 4000);
  }, []);

  // ── Query ───────────────────────────────────────────────────────────────────
  const listParams = {
    limit: PAGE_LIMIT,
    offset: 0,
    ...(tab === "deleted" ? { deleted: true } : {}),
  };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: authUsersKeys.list(listParams),
    queryFn: () => authUsersApi.listUsers(listParams),
    enabled: canView,
    staleTime: 30_000,
  });
  const items: AuthUserDto[] = React.useMemo(() => data?.users ?? [], [data]);

  const invalidateList = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: authUsersKeys.all });
  }, [queryClient]);

  function switchTab(next: ViewTab) {
    setTab(next);
    setSelected({});
    setBulkResult(null);
  }

  // ── Row mutations (mỗi hành động server tự audit + enforce) ─────────────────
  function rowMutationOptions(okMsg: string) {
    return {
      onSuccess: () => {
        setConfirm(null);
        invalidateList();
        showFlash(okMsg);
      },
    };
  }
  const lockMutation = useMutation({
    mutationFn: (id: string) => authUsersApi.lockUser(id, {}),
    ...rowMutationOptions(t("users.feedback.lockOk")),
  });
  const unlockMutation = useMutation({
    mutationFn: (id: string) => authUsersApi.unlockUser(id),
    ...rowMutationOptions(t("users.feedback.unlockOk")),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => authUsersApi.deleteUser(id),
    ...rowMutationOptions(t("users.feedback.deleteOk")),
  });
  const restoreMutation = useMutation({
    mutationFn: (id: string) => authUsersApi.restoreUser(id),
    ...rowMutationOptions(t("users.feedback.restoreOk")),
  });
  // resetPassword: kết quả chứa tempPassword → CHỈ đưa vào state dialog (KHÔNG cache/log — BẤT BIẾN #3).
  const resetPasswordMutation = useMutation({
    mutationFn: (user: AuthUserDto) => authUsersApi.resetPassword(user.id),
    onSuccess: (result, user) => {
      setConfirm(null);
      invalidateList();
      setResetResult({
        email: user.email,
        tempPassword: result.tempPassword,
        revokedSessionCount: result.revokedSessionCount,
      });
    },
  });
  const anyRowPending =
    lockMutation.isPending ||
    unlockMutation.isPending ||
    deleteMutation.isPending ||
    restoreMutation.isPending ||
    resetPasswordMutation.isPending;
  const rowError =
    lockMutation.error ??
    unlockMutation.error ??
    deleteMutation.error ??
    restoreMutation.error ??
    resetPasswordMutation.error;

  function resetRowMutations() {
    lockMutation.reset();
    unlockMutation.reset();
    deleteMutation.reset();
    restoreMutation.reset();
    resetPasswordMutation.reset();
  }

  // ── Bulk execution (tuần tự per-item — server enforce từng item) ─────────────
  const bulkBusy = bulkProgress !== null;
  async function executeBulk(action: BulkUserAction, targets: AuthUserDto[], skipped: number) {
    const run =
      action === "lock"
        ? (u: AuthUserDto) => authUsersApi.lockUser(u.id, {})
        : action === "unlock"
          ? (u: AuthUserDto) => authUsersApi.unlockUser(u.id)
          : action === "delete"
            ? (u: AuthUserDto) => authUsersApi.deleteUser(u.id)
            : (u: AuthUserDto) => authUsersApi.restoreUser(u.id);
    setBulkProgress({ done: 0, total: targets.length });
    setBulkResult(null);
    try {
      const res = await runBulkSequential(targets, run, (done, total) =>
        setBulkProgress({ done, total }),
      );
      setBulkResult({ ...res, skipped, action: t(`users.bulk.actions.${action}`) });
    } finally {
      setBulkProgress(null);
      setConfirm(null);
      setSelected({});
      invalidateList();
    }
  }

  function openBulkConfirm(action: BulkUserAction) {
    const chosen = items.filter((u) => selected[u.id]);
    const { targets, skipped } = eligibleTargets(chosen, action, currentUserId);
    if (targets.length === 0) {
      showFlash(t("users.bulk.nothingEligible"));
      return;
    }
    setConfirm({ kind: "bulk", action, targets, skipped });
  }

  // ── Selection helpers ────────────────────────────────────────────────────────
  const selectableIds = React.useMemo(
    () => items.filter((u) => tab === "deleted" || u.id !== currentUserId).map((u) => u.id),
    [items, tab, currentUserId],
  );
  const selectedCount = selectableIds.filter((id) => selected[id]).length;
  const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length;

  const toggleAll = React.useCallback(() => {
    if (allSelected) {
      setSelected({});
      return;
    }
    setSelected(Object.fromEntries(selectableIds.map((id) => [id, true])));
  }, [allSelected, selectableIds]);

  // ── Columns ──────────────────────────────────────────────────────────────────
  const openDetail = React.useCallback(
    (id: string) => void navigate({ to: "/system/users/$userId", params: { userId: id } }),
    [navigate],
  );

  const columns = React.useMemo<ColumnDef<AuthUserDto>[]>(() => {
    const cols: ColumnDef<AuthUserDto>[] = [];

    // Checkbox chọn nhiều — chỉ khi có ít nhất 1 hành động bulk khả dụng cho tab hiện tại.
    const showSelect = tab === "active" ? hasBulkActions : canRestore;
    if (showSelect) {
      cols.push({
        id: "select",
        header: () => (
          <input
            type="checkbox"
            aria-label={t("users.bulk.selectAll")}
            checked={allSelected}
            onChange={toggleAll}
            className="h-4 w-4 accent-primary"
          />
        ),
        cell: ({ row }) => {
          const user = row.original;
          const isSelf = tab === "active" && user.id === currentUserId;
          return (
            <input
              type="checkbox"
              aria-label={t("users.bulk.selectRow", { email: user.email })}
              checked={Boolean(selected[user.id])}
              disabled={isSelf}
              title={isSelf ? t("users.bulk.selfDisabled") : undefined}
              onChange={(e) => setSelected((prev) => ({ ...prev, [user.id]: e.target.checked }))}
              className="h-4 w-4 accent-primary disabled:cursor-not-allowed disabled:opacity-40"
            />
          );
        },
      });
    }

    cols.push(
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
    );

    if (tab === "deleted") {
      cols.push({
        accessorKey: "deletedAt",
        header: t("users.columns.deletedAt"),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.deletedAt
              ? new Date(row.original.deletedAt).toLocaleString("vi-VN")
              : "—"}
          </span>
        ),
      });
    } else {
      cols.push({
        accessorKey: "lastLoginAt",
        header: t("users.columns.lastLogin"),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.lastLoginAt
              ? new Date(row.original.lastLoginAt).toLocaleDateString("vi-VN")
              : "—"}
          </span>
        ),
      });
    }

    cols.push({
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const user = row.original;
        const isSelf = user.id === currentUserId;
        if (tab === "deleted") {
          return canRestore ? (
            <Button
              variant="outline"
              size="sm"
              disabled={anyRowPending || bulkBusy}
              onClick={() => setConfirm({ kind: "row", action: "restore", user })}
            >
              <RotateCcw className="mr-1 h-4 w-4" />
              {t("users.actions.restore")}
            </Button>
          ) : null;
        }
        return (
          <div className="flex items-center justify-end gap-1">
            {user.status !== "locked" && canLock && (
              <Button
                variant="ghost"
                size="sm"
                title={t("users.actions.lock")}
                aria-label={t("users.actions.lock")}
                disabled={isSelf || anyRowPending || bulkBusy}
                onClick={() => setConfirm({ kind: "row", action: "lock", user })}
              >
                <Lock className="h-4 w-4" />
              </Button>
            )}
            {user.status === "locked" && canUnlock && (
              <Button
                variant="ghost"
                size="sm"
                title={t("users.actions.unlock")}
                aria-label={t("users.actions.unlock")}
                disabled={anyRowPending || bulkBusy}
                onClick={() => setConfirm({ kind: "row", action: "unlock", user })}
              >
                <Unlock className="h-4 w-4" />
              </Button>
            )}
            {canResetPassword && (
              <Button
                variant="ghost"
                size="sm"
                title={t("users.actions.resetPassword")}
                aria-label={t("users.actions.resetPassword")}
                disabled={isSelf || anyRowPending || bulkBusy}
                onClick={() => setConfirm({ kind: "row", action: "resetPassword", user })}
              >
                <KeyRound className="h-4 w-4" />
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                title={t("users.actions.delete")}
                aria-label={t("users.actions.delete")}
                disabled={isSelf || anyRowPending || bulkBusy}
                onClick={() => setConfirm({ kind: "row", action: "delete", user })}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              title={t("users.actions.detail")}
              aria-label={t("users.actions.detail")}
              onClick={() => openDetail(user.id)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        );
      },
    });

    return cols;
  }, [
    t,
    tab,
    hasBulkActions,
    canRestore,
    canLock,
    canUnlock,
    canDelete,
    canResetPassword,
    currentUserId,
    selected,
    allSelected,
    toggleAll,
    anyRowPending,
    bulkBusy,
    openDetail,
  ]);

  // ── Forbidden ────────────────────────────────────────────────────────────────
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

  // ── Error ────────────────────────────────────────────────────────────────────
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

  // ── Confirm dialog labels ────────────────────────────────────────────────────
  const confirmLabels = (() => {
    if (!confirm) return null;
    if (confirm.kind === "row") {
      const email = confirm.user.email;
      return {
        title: t(`users.confirm.${confirm.action}Title`),
        description: t(`users.confirm.${confirm.action}Description`, { email }),
        confirmLabel: t(`users.actions.${confirm.action}`),
        destructive: confirm.action === "lock" || confirm.action === "delete",
      };
    }
    return {
      title: t(`users.bulk.confirmTitle`, {
        action: t(`users.bulk.actions.${confirm.action}`),
        count: confirm.targets.length,
      }),
      description:
        t(`users.bulk.confirmDescription`, {
          action: t(`users.bulk.actions.${confirm.action}`),
          count: confirm.targets.length,
        }) +
        (confirm.skipped > 0 ? ` ${t("users.bulk.skippedNote", { count: confirm.skipped })}` : ""),
      confirmLabel: t(`users.bulk.actions.${confirm.action}`),
      destructive: confirm.action === "lock" || confirm.action === "delete",
    };
  })();

  function onConfirmAction() {
    if (!confirm) return;
    if (confirm.kind === "bulk") {
      void executeBulk(confirm.action, confirm.targets, confirm.skipped);
      return;
    }
    const { action: rowAction, user } = confirm;
    if (rowAction === "lock") lockMutation.mutate(user.id);
    else if (rowAction === "unlock") unlockMutation.mutate(user.id);
    else if (rowAction === "delete") deleteMutation.mutate(user.id);
    else if (rowAction === "restore") restoreMutation.mutate(user.id);
    else resetPasswordMutation.mutate(user);
  }

  // ── Render ───────────────────────────────────────────────────────────────────
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

      {/* Tab Đang dùng | Đã xóa — tab deleted chỉ hiện khi có quyền khôi phục (useCanExact) */}
      {canRestore && (
        <div role="tablist" className="flex gap-1 rounded-lg border border-border p-1 w-fit">
          {(["active", "deleted"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={tab === v}
              onClick={() => switchTab(v)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                tab === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {t(`users.tabs.${v}`)}
            </button>
          ))}
        </div>
      )}

      {/* Flash feedback */}
      {flash && (
        <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          {flash}
        </p>
      )}

      {/* Lỗi thao tác đơn */}
      {rowError != null && (
        <p
          role="alert"
          aria-live="assertive"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t("users.feedback.actionFailed")}
          <Button variant="outline" size="sm" onClick={resetRowMutations}>
            {t("users.feedback.dismiss")}
          </Button>
        </p>
      )}

      {/* Thanh bulk — hiện khi có dòng được chọn */}
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
          <span className="text-sm font-medium">
            {t("users.bulk.selected", { count: selectedCount })}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {tab === "active" && canLock && (
              <Button
                size="sm"
                variant="outline"
                disabled={bulkBusy}
                onClick={() => openBulkConfirm("lock")}
              >
                <Lock className="mr-1 h-4 w-4" />
                {t("users.bulk.actions.lock")}
              </Button>
            )}
            {tab === "active" && canUnlock && (
              <Button
                size="sm"
                variant="outline"
                disabled={bulkBusy}
                onClick={() => openBulkConfirm("unlock")}
              >
                <Unlock className="mr-1 h-4 w-4" />
                {t("users.bulk.actions.unlock")}
              </Button>
            )}
            {tab === "active" && canDelete && (
              <Button
                size="sm"
                variant="destructive"
                disabled={bulkBusy}
                onClick={() => openBulkConfirm("delete")}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {t("users.bulk.actions.delete")}
              </Button>
            )}
            {tab === "deleted" && canRestore && (
              <Button
                size="sm"
                variant="outline"
                disabled={bulkBusy}
                onClick={() => openBulkConfirm("restore")}
              >
                <RotateCcw className="mr-1 h-4 w-4" />
                {t("users.bulk.actions.restore")}
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={() => setSelected({})}>
              {t("users.bulk.clear")}
            </Button>
          </div>
          {bulkProgress && (
            <span role="status" className="text-xs text-muted-foreground">
              {t("users.bulk.running", { done: bulkProgress.done, total: bulkProgress.total })}
            </span>
          )}
        </div>
      )}

      {/* Kết quả bulk — thành công/lỗi từng dòng (partial failure rõ ràng) */}
      {bulkResult && (
        <div
          role="status"
          className="space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
        >
          <p className="font-medium">
            {t("users.bulk.resultSummary", {
              action: bulkResult.action,
              ok: bulkResult.ok,
              failed: bulkResult.failed.length,
            })}
            {bulkResult.skipped > 0 &&
              ` ${t("users.bulk.skippedNote", { count: bulkResult.skipped })}`}
          </p>
          {bulkResult.failed.length > 0 && (
            <ul className="list-inside list-disc text-destructive">
              {bulkResult.failed.map((f) => (
                <li key={f.email}>
                  <span className="font-mono">{f.email}</span>: {f.message}
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" variant="ghost" onClick={() => setBulkResult(null)}>
            {t("users.feedback.dismiss")}
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={tab === "deleted" ? t("users.emptyDeleted.title") : t("users.empty.title")}
            description={
              tab === "deleted" ? t("users.emptyDeleted.description") : t("users.empty.description")
            }
          />
        }
        pageSize={PAGE_LIMIT}
      />

      {/* Confirm hành động (đơn + bulk) */}
      {confirm && confirmLabels && (
        <ConfirmDialog
          open
          title={confirmLabels.title}
          description={confirmLabels.description}
          confirmLabel={confirmLabels.confirmLabel}
          cancelLabel={t("users.form.cancel")}
          destructive={confirmLabels.destructive}
          busy={anyRowPending || bulkBusy}
          busyLabel={t("users.form.submitting")}
          onConfirm={onConfirmAction}
          onCancel={() => {
            if (anyRowPending || bulkBusy) return;
            resetRowMutations();
            setConfirm(null);
          }}
        />
      )}

      {/* Mật khẩu tạm — hiện ĐÚNG 1 lần, đóng là mất (BẤT BIẾN #3) */}
      {resetResult && (
        <TempPasswordDialog
          open
          email={resetResult.email}
          tempPassword={resetResult.tempPassword}
          revokedSessionCount={resetResult.revokedSessionCount}
          onClose={() => setResetResult(null)}
        />
      )}
    </div>
  );
}
