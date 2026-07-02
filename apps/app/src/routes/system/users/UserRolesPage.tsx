/**
 * UI-SYSTEM-SCREEN-007 (S2-FE-AUTH-3) — /system/users/:id/roles.
 *
 * Gán/gỡ role cho user từ catalog GET /auth/roles → POST/DELETE /permissions/users/:userId/roles
 * (G3-4 mutation-path, CROWN — assign-role:user isSensitive). PermissionGate AUTH.USER.ASSIGN_ROLE.
 *
 * GHI CHÚ GIỚI HẠN BACKEND (S2-AUTH-BE-3 KHÔNG có endpoint đọc "role hiện tại của user X"; API-02
 * §AUTH-API-102 định nghĩa UserDetailDto.roles[] nhưng AuthUserDto ĐÃ SHIP (packages/contracts/src/
 * auth/user-admin.ts) KHÔNG có field này). Vì vậy màn này KHÔNG hiển thị "role đang giữ" — chỉ hiển
 * thị catalog + hành động Gán/Gỡ, và nhật ký thao tác NGAY TRONG PHIÊN (không suy đoán trạng thái
 * server chưa biết). Gỡ role KHÔNG đang giữ → server trả 404 rõ ràng (KHÔNG no-op ngầm).
 * TODO theo dõi: bổ sung GET /auth/users/:id/roles hoặc field `roles` trong AuthUserDto (backend).
 *
 * States covered: loading (catalog) · error · empty (catalog rỗng) · forbidden.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, RefreshCw, ArrowLeft } from "lucide-react";
import { authUsersApi, authUsersKeys, useCan, ApiError } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, CardContent } from "@mediaos/ui";
import { SYSTEM_ENGINE_PAIRS } from "../constants";

type TF = ReturnType<typeof useTranslation<"system">>["t"];

interface SessionLogEntry {
  id: string;
  roleName: string;
  kind: "assigned" | "revoked" | "error";
  detail?: string;
}

function actionErrorMessage(err: unknown, t: TF): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return t("users.roles.errors.notAssigned");
    if (err.status === 409) return t("users.roles.errors.conflict");
    if (err.status === 400) return t("users.roles.errors.badRequest");
    if (err.status === 403) return t("users.form.errors.forbidden");
    if (err.status >= 500) return t("users.form.errors.server");
  }
  return t("users.form.errors.generic");
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
interface UserRolesPageProps {
  userId: string;
  onBack?: () => void;
}

export function UserRolesPage({ userId, onBack }: UserRolesPageProps) {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const queryClient = useQueryClient();
  const [log, setLog] = useState<SessionLogEntry[]>([]);
  const [pendingRoleId, setPendingRoleId] = useState<string | null>(null);

  const canAssign = useCan(
    SYSTEM_ENGINE_PAIRS.ASSIGN_ROLE.action,
    SYSTEM_ENGINE_PAIRS.ASSIGN_ROLE.resourceType,
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: authUsersKeys.roles(),
    queryFn: () => authUsersApi.listRoles(),
    enabled: canAssign,
    staleTime: 60_000,
  });

  const assignMutation = useMutation({
    mutationFn: (roleId: string) => authUsersApi.assignRole(userId, { roleId }),
    onMutate: (roleId) => setPendingRoleId(roleId),
    onSettled: () => setPendingRoleId(null),
    onSuccess: (_result, roleId) => {
      const role = data?.roles.find((r) => r.id === roleId);
      setLog((prev) => [
        { id: crypto.randomUUID(), roleName: role?.name ?? roleId, kind: "assigned" },
        ...prev,
      ]);
      void queryClient.invalidateQueries({ queryKey: authUsersKeys.detail(userId) });
    },
    onError: (err, roleId) => {
      const role = data?.roles.find((r) => r.id === roleId);
      setLog((prev) => [
        {
          id: crypto.randomUUID(),
          roleName: role?.name ?? roleId,
          kind: "error",
          detail: actionErrorMessage(err, t),
        },
        ...prev,
      ]);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (roleId: string) => authUsersApi.revokeRole(userId, roleId),
    onMutate: (roleId) => setPendingRoleId(roleId),
    onSettled: () => setPendingRoleId(null),
    onSuccess: (_result, roleId) => {
      const role = data?.roles.find((r) => r.id === roleId);
      setLog((prev) => [
        { id: crypto.randomUUID(), roleName: role?.name ?? roleId, kind: "revoked" },
        ...prev,
      ]);
      void queryClient.invalidateQueries({ queryKey: authUsersKeys.detail(userId) });
    },
    onError: (err, roleId) => {
      const role = data?.roles.find((r) => r.id === roleId);
      setLog((prev) => [
        {
          id: crypto.randomUUID(),
          roleName: role?.name ?? roleId,
          kind: "error",
          detail: actionErrorMessage(err, t),
        },
        ...prev,
      ]);
    },
  });

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canAssign) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("users.forbidden.title")}
          description={t("users.roles.forbidden.description")}
        />
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={tc("loading")} icon={KeyRound} />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("users.roles.title")}
          description={t("users.roles.description")}
          icon={KeyRound}
        />
        <div className="mt-8">
          <EmptyState
            title={t("users.roles.error.title")}
            description={t("users.roles.error.description")}
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

  const roles = data?.roles ?? [];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("users.roles.title")}
        description={t("users.roles.description")}
        icon={KeyRound}
        actions={
          onBack && (
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("users.detail.backToList")}
            </Button>
          )
        }
      />

      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
        {t("users.roles.limitationNotice")}
      </p>

      {roles.length === 0 ? (
        <EmptyState
          title={t("users.roles.empty.title")}
          description={t("users.roles.empty.description")}
        />
      ) : (
        <Card>
          <CardContent className="divide-y divide-border pt-4">
            {roles.map((role) => {
              const busy = pendingRoleId === role.id;
              return (
                <div key={role.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{role.name}</p>
                    {role.description && (
                      <p className="text-xs text-muted-foreground">{role.description}</p>
                    )}
                    {role.isSystem && (
                      <p className="text-xs text-muted-foreground">{t("users.roles.systemRole")}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => assignMutation.mutate(role.id)}
                    >
                      {t("users.roles.actions.assign")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => revokeMutation.mutate(role.id)}
                    >
                      {t("users.roles.actions.revoke")}
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {log.length > 0 && (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <h3 className="text-sm font-semibold text-foreground">
              {t("users.roles.sessionLog.title")}
            </h3>
            <ul className="space-y-1 text-sm">
              {log.map((entry) => (
                <li
                  key={entry.id}
                  className={entry.kind === "error" ? "text-destructive" : "text-muted-foreground"}
                >
                  {entry.kind === "assigned" &&
                    t("users.roles.sessionLog.assigned", { role: entry.roleName })}
                  {entry.kind === "revoked" &&
                    t("users.roles.sessionLog.revoked", { role: entry.roleName })}
                  {entry.kind === "error" &&
                    t("users.roles.sessionLog.error", {
                      role: entry.roleName,
                      detail: entry.detail,
                    })}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
