/**
 * UI-SYSTEM-SCREEN-002 (S2-FE-AUTH-3) — /system/users/:id.
 *
 * GET /auth/users/:id — thông tin + trạng thái tài khoản. Nút khoá/mở khoá →
 * POST /auth/users/:id/lock|unlock (PermissionGate AUTH.USER.LOCK/UNLOCK — cặp canonical
 * S2-AUTH-BE-3). Server tự chặn tự-khoá chính mình (self-guard) — FE hiển thị lỗi rõ nếu 400.
 * Masking do server — client chỉ render field nhận được (KHÔNG passwordHash/lockedReason ẩn).
 *
 * States covered: loading · error · empty(404) · forbidden.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, RefreshCw, ArrowLeft, Pencil, Lock, Unlock, KeyRound } from "lucide-react";
import {
  authUsersApi,
  authUsersKeys,
  useCan,
  formatDate,
  PermissionGate,
  ApiError,
} from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, CardContent, Badge } from "@mediaos/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SYSTEM_ENGINE_PAIRS } from "../constants";

type TF = ReturnType<typeof useTranslation<"system">>["t"];

// ---------------------------------------------------------------------------
// Field row
// ---------------------------------------------------------------------------
function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 py-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? "—"}</span>
    </div>
  );
}

function statusBadgeVariant(status: string): "default" | "secondary" | "danger" {
  if (status === "active") return "default";
  if (status === "locked" || status === "suspended") return "danger";
  return "secondary";
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
interface UserDetailPageProps {
  userId: string;
  onBack?: () => void;
  onEdit?: () => void;
  onManageRoles?: () => void;
}

export function UserDetailPage({ userId, onBack, onEdit, onManageRoles }: UserDetailPageProps) {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const queryClient = useQueryClient();
  const [confirmAction, setConfirmAction] = useState<"lock" | "unlock" | null>(null);

  const canView = useCan(
    SYSTEM_ENGINE_PAIRS.READ_USER.action,
    SYSTEM_ENGINE_PAIRS.READ_USER.resourceType,
  );
  const canLock = useCan(
    SYSTEM_ENGINE_PAIRS.LOCK_USER.action,
    SYSTEM_ENGINE_PAIRS.LOCK_USER.resourceType,
  );
  const canUnlock = useCan(
    SYSTEM_ENGINE_PAIRS.UNLOCK_USER.action,
    SYSTEM_ENGINE_PAIRS.UNLOCK_USER.resourceType,
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: authUsersKeys.detail(userId),
    queryFn: () => authUsersApi.getUser(userId),
    enabled: canView && !!userId,
    staleTime: 30_000,
  });

  const lockMutation = useMutation({
    mutationFn: () => authUsersApi.lockUser(userId, {}),
    onSuccess: async () => {
      setConfirmAction(null);
      await queryClient.invalidateQueries({ queryKey: authUsersKeys.detail(userId) });
      await queryClient.invalidateQueries({ queryKey: authUsersKeys.all });
    },
  });
  const unlockMutation = useMutation({
    mutationFn: () => authUsersApi.unlockUser(userId),
    onSuccess: async () => {
      setConfirmAction(null);
      await queryClient.invalidateQueries({ queryKey: authUsersKeys.detail(userId) });
      await queryClient.invalidateQueries({ queryKey: authUsersKeys.all });
    },
  });

  const activeMutation = confirmAction === "lock" ? lockMutation : unlockMutation;
  const mutationError = lockMutation.error ?? unlockMutation.error;

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

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={tc("loading")} icon={Users} />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // ── Error / not found ──────────────────────────────────────────────────────
  if (isError || !data) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("users.detail.error.title")}
          description={t("users.detail.error.description")}
          action={
            <div className="flex gap-2">
              {onBack && (
                <Button variant="outline" size="sm" onClick={onBack}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t("users.detail.backToList")}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {tc("actions.retry")}
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const isLocked = data.status === "locked";

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={data.fullName ?? data.email}
        description={data.email}
        icon={Users}
        actions={
          <div className="flex items-center gap-2">
            {onBack && (
              <Button variant="outline" size="sm" onClick={onBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("users.detail.backToList")}
              </Button>
            )}
            {onManageRoles && (
              <PermissionGate
                action={SYSTEM_ENGINE_PAIRS.ASSIGN_ROLE.action}
                resourceType={SYSTEM_ENGINE_PAIRS.ASSIGN_ROLE.resourceType}
              >
                <Button variant="outline" size="sm" onClick={onManageRoles}>
                  <KeyRound className="mr-2 h-4 w-4" />
                  {t("users.detail.actions.manageRoles")}
                </Button>
              </PermissionGate>
            )}
            {onEdit && (
              <PermissionGate
                action={SYSTEM_ENGINE_PAIRS.UPDATE_USER.action}
                resourceType={SYSTEM_ENGINE_PAIRS.UPDATE_USER.resourceType}
              >
                <Button size="sm" onClick={onEdit}>
                  <Pencil className="mr-2 h-4 w-4" />
                  {t("users.detail.actions.edit")}
                </Button>
              </PermissionGate>
            )}
            {isLocked && canUnlock && (
              <Button variant="outline" size="sm" onClick={() => setConfirmAction("unlock")}>
                <Unlock className="mr-2 h-4 w-4" />
                {t("users.detail.actions.unlock")}
              </Button>
            )}
            {!isLocked && canLock && (
              <Button variant="destructive" size="sm" onClick={() => setConfirmAction("lock")}>
                <Lock className="mr-2 h-4 w-4" />
                {t("users.detail.actions.lock")}
              </Button>
            )}
          </div>
        }
      />

      {mutationError && (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {lockUnlockErrorMessage(mutationError, t)}
        </p>
      )}

      <Card>
        <CardContent className="divide-y divide-border pt-4">
          <FieldRow label={t("users.detail.fields.email")} value={data.email} />
          <FieldRow label={t("users.detail.fields.fullName")} value={data.fullName} />
          <FieldRow
            label={t("users.detail.fields.status")}
            value={
              <Badge variant={statusBadgeVariant(data.status)}>
                {t(`users.status.${data.status}`, { defaultValue: data.status })}
              </Badge>
            }
          />
          <FieldRow
            label={t("users.detail.fields.lastLogin")}
            value={data.lastLoginAt ? formatDate(new Date(data.lastLoginAt)) : "—"}
          />
          {isLocked && (
            <FieldRow
              label={t("users.detail.fields.lockedReason")}
              value={data.lockedReason ?? "—"}
            />
          )}
          <FieldRow
            label={t("users.detail.fields.createdAt")}
            value={formatDate(new Date(data.createdAt))}
          />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmAction !== null}
        title={
          confirmAction === "lock"
            ? t("users.detail.confirm.lockTitle")
            : t("users.detail.confirm.unlockTitle")
        }
        description={
          confirmAction === "lock"
            ? t("users.detail.confirm.lockDescription")
            : t("users.detail.confirm.unlockDescription")
        }
        confirmLabel={
          confirmAction === "lock"
            ? t("users.detail.actions.lock")
            : t("users.detail.actions.unlock")
        }
        cancelLabel={t("users.form.cancel")}
        destructive={confirmAction === "lock"}
        busy={activeMutation.isPending}
        busyLabel={t("users.form.submitting")}
        onConfirm={() => activeMutation.mutate()}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}

function lockUnlockErrorMessage(err: unknown, t: TF): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return t("users.detail.errors.badRequest");
    if (err.status === 403) return t("users.form.errors.forbidden");
    if (err.status >= 500) return t("users.form.errors.server");
  }
  return t("users.form.errors.generic");
}
