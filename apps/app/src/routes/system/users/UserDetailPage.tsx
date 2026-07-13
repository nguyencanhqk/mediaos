/**
 * UI-SYSTEM-SCREEN-002 (S2-FE-AUTH-3 · S2-FE-SYS-SEC-1) — /system/users/:id.
 *
 * GET /auth/users/:id (authUserDetailSchema) — thông tin + trạng thái tài khoản + khối `twoFactor`.
 * Nút khoá/mở khoá → POST /auth/users/:id/lock|unlock (PermissionGate AUTH.USER.LOCK/UNLOCK).
 * Server tự chặn tự-khoá chính mình (self-guard) — FE hiển thị lỗi rõ nếu 400.
 *
 * S2-FE-SYS-SEC-1 — card 2FA:
 *  - Hiển thị enabled + NGUỒN ép (requiredByRole 'theo vai trò' vs requiredByUser 'theo tài khoản').
 *  - Toggle 'Ép 2FA tài khoản này' → PATCH /auth/users/:id {requireTwoFactor} — gate useCan(update:user).
 *  - Nút 'Reset 2FA' → POST /auth/users/:id/2fa/reset — gate useCanExact('reset-2fa','user') (SENSITIVE,
 *    fail-closed: wildcard '*:*' KHÔNG mở cổng) + ConfirmDialog. Kết quả CHỈ revokedSessionCount.
 *
 * Masking do server — client chỉ render field nhận được. TUYỆT ĐỐI KHÔNG render/log secret TOTP/
 * recovery-code (BẤT BIẾN #3): DTO không mang secret; reset chỉ phơi revokedSessionCount.
 *
 * States covered: loading · error · empty(404) · forbidden.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  RefreshCw,
  ArrowLeft,
  Pencil,
  Lock,
  Unlock,
  KeyRound,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import {
  authUsersApi,
  authUsersKeys,
  useCan,
  useCanExact,
  formatDate,
  PermissionGate,
  ApiError,
} from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, CardContent, Badge } from "@mediaos/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SYSTEM_ENGINE_PAIRS } from "../constants";

type TF = ReturnType<typeof useTranslation<"system">>["t"];
type ConfirmAction = "lock" | "unlock" | "reset";

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

function mutationErrorMessage(err: unknown, t: TF): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return t("users.detail.errors.badRequest");
    if (err.status === 403) return t("users.form.errors.forbidden");
    if (err.status === 404) return t("users.detail.errors.notFound");
    if (err.status === 409) return t("users.detail.errors.conflict");
    if (err.status >= 500) return t("users.form.errors.server");
  }
  return t("users.form.errors.generic");
}

// ---------------------------------------------------------------------------
// 2FA card — hiển thị trạng thái + toggle ép + reset (S2-FE-SYS-SEC-1)
// ---------------------------------------------------------------------------
interface TwoFactorCardProps {
  twoFactor: { enabled: boolean; requiredByRole: boolean; requiredByUser: boolean };
  canUpdate: boolean;
  canReset: boolean;
  t: TF;
  toggleBusy: boolean;
  resetBusy: boolean;
  resetError: unknown;
  toggleError: unknown;
  resetRevokedCount: number | null;
  onToggleForce: (next: boolean) => void;
  onRequestReset: () => void;
}

function TwoFactorCard({
  twoFactor,
  canUpdate,
  canReset,
  t,
  toggleBusy,
  resetBusy,
  resetError,
  toggleError,
  resetRevokedCount,
  onToggleForce,
  onRequestReset,
}: TwoFactorCardProps) {
  const { enabled, requiredByRole, requiredByUser } = twoFactor;
  const notRequired = !requiredByRole && !requiredByUser;
  const opError = toggleError ?? resetError;

  return (
    <Card>
      <CardContent className="space-y-4 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">
              {t("users.detail.twoFactor.title")}
            </h3>
          </div>
          <Badge variant={enabled ? "default" : "secondary"}>
            {enabled ? t("users.detail.twoFactor.enabled") : t("users.detail.twoFactor.disabled")}
          </Badge>
        </div>

        {/* Nguồn ép — phân biệt requiredByRole vs requiredByUser (KHÔNG lẫn) */}
        <div className="text-sm">
          <span className="font-medium text-muted-foreground">
            {t("users.detail.twoFactor.enforcement")}
          </span>{" "}
          {notRequired ? (
            <span className="text-foreground">{t("users.detail.twoFactor.notRequired")}</span>
          ) : (
            <span className="inline-flex flex-wrap gap-1.5 align-middle">
              {requiredByRole && (
                <Badge variant="secondary">{t("users.detail.twoFactor.byRole")}</Badge>
              )}
              {requiredByUser && (
                <Badge variant="secondary">{t("users.detail.twoFactor.byUser")}</Badge>
              )}
            </span>
          )}
        </div>

        {/* Toggle ép 2FA per-user — gate update:user (ẩn khi thiếu) */}
        {canUpdate && (
          <label
            htmlFor="requireTwoFactor"
            className="flex items-start gap-3 rounded-md border border-border p-3"
          >
            <input
              id="requireTwoFactor"
              type="checkbox"
              checked={requiredByUser}
              disabled={toggleBusy}
              onChange={(e) => onToggleForce(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium text-foreground">
                {t("users.detail.twoFactor.forceLabel")}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t("users.detail.twoFactor.forceHint")}
              </span>
            </span>
          </label>
        )}

        {/* Reset 2FA — gate useCanExact reset-2fa:user (SENSITIVE, fail-closed) */}
        {canReset && (
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">{t("users.detail.twoFactor.resetHint")}</p>
            <Button variant="outline" size="sm" onClick={onRequestReset} disabled={resetBusy}>
              <ShieldOff className="mr-2 h-4 w-4" />
              {t("users.detail.twoFactor.reset")}
            </Button>
          </div>
        )}

        {/* Success (toast) — CHỈ revokedSessionCount, KHÔNG secret (BẤT BIẾN #3) */}
        {resetRevokedCount !== null && !opError && (
          <p
            role="status"
            aria-live="polite"
            className="rounded-md border border-success/40 bg-success-muted px-3 py-2 text-sm text-success"
          >
            {t("users.detail.twoFactor.resetSuccess", { count: resetRevokedCount })}
          </p>
        )}

        {/* Lỗi thao tác 2FA (403/409/4xx) */}
        {opError != null && (
          <p
            role="alert"
            aria-live="assertive"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {mutationErrorMessage(opError, t)}
          </p>
        )}
      </CardContent>
    </Card>
  );
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
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

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
  const canUpdate = useCan(
    SYSTEM_ENGINE_PAIRS.UPDATE_USER.action,
    SYSTEM_ENGINE_PAIRS.UPDATE_USER.resourceType,
  );
  // SENSITIVE (reset-2fa:user is_sensitive=true, mig 0466) → useCanExact fail-closed: wildcard '*:*'
  // KHÔNG mở cổng (mirror BE SENSITIVE_CAPABILITY_ALLOWLIST). KHÔNG PermissionGate/useCan ở đây.
  const canResetTwoFactor = useCanExact(
    SYSTEM_ENGINE_PAIRS.RESET_2FA_USER.action,
    SYSTEM_ENGINE_PAIRS.RESET_2FA_USER.resourceType,
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

  // PATCH {requireTwoFactor} — ép 2FA per-user. Server phát hiện no-op → KHÔNG audit.
  const toggleForceMutation = useMutation({
    mutationFn: (requireTwoFactor: boolean) =>
      authUsersApi.updateUser(userId, { requireTwoFactor }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authUsersKeys.detail(userId) });
    },
  });

  // POST /2fa/reset — kết quả CHỈ revokedSessionCount (forensic, KHÔNG secret).
  const resetMutation = useMutation({
    mutationFn: () => authUsersApi.resetTwoFactor(userId),
    onSuccess: async () => {
      setConfirmAction(null);
      await queryClient.invalidateQueries({ queryKey: authUsersKeys.detail(userId) });
    },
  });

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
  const activeMutation =
    confirmAction === "lock"
      ? lockMutation
      : confirmAction === "unlock"
        ? unlockMutation
        : resetMutation;
  const confirmDestructive = confirmAction === "lock" || confirmAction === "reset";
  const resetRevokedCount = resetMutation.isSuccess ? resetMutation.data.revokedSessionCount : null;

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
          {mutationErrorMessage(mutationError, t)}
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

      <TwoFactorCard
        twoFactor={data.twoFactor}
        canUpdate={canUpdate}
        canReset={canResetTwoFactor}
        t={t}
        toggleBusy={toggleForceMutation.isPending}
        resetBusy={resetMutation.isPending}
        toggleError={toggleForceMutation.error}
        resetError={resetMutation.error}
        resetRevokedCount={resetRevokedCount}
        onToggleForce={(next) => toggleForceMutation.mutate(next)}
        onRequestReset={() => setConfirmAction("reset")}
      />

      <ConfirmDialog
        open={confirmAction !== null}
        title={
          confirmAction === "lock"
            ? t("users.detail.confirm.lockTitle")
            : confirmAction === "unlock"
              ? t("users.detail.confirm.unlockTitle")
              : t("users.detail.twoFactor.confirm.resetTitle")
        }
        description={
          confirmAction === "lock"
            ? t("users.detail.confirm.lockDescription")
            : confirmAction === "unlock"
              ? t("users.detail.confirm.unlockDescription")
              : t("users.detail.twoFactor.confirm.resetDescription")
        }
        confirmLabel={
          confirmAction === "lock"
            ? t("users.detail.actions.lock")
            : confirmAction === "unlock"
              ? t("users.detail.actions.unlock")
              : t("users.detail.twoFactor.reset")
        }
        cancelLabel={t("users.form.cancel")}
        destructive={confirmDestructive}
        busy={activeMutation.isPending}
        busyLabel={t("users.form.submitting")}
        onConfirm={() => activeMutation.mutate()}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
