/**
 * ACCOUNT-SCREEN-SESSIONS (S2-FE-AUTH-5 · lane FE batch C) — /account/sessions.
 *
 * API: GET /auth/sessions · POST /auth/sessions/:id/revoke · POST /auth/sessions/revoke-others
 * (S2-AUTH-BE-7, auth.controller.ts). Own scope, CHỈ Authenticated — owner-check ở service, giống
 * pattern /auth/me → KHÔNG có permission pair riêng, KHÔNG PermissionGate/useCan ở màn này (route đã
 * yêu cầu đăng nhập qua authGuard/ProtectedShell — không phải hard-code quyền, mà là KHÔNG CÓ cổng
 * permission cho self-service). `is_current` do SERVER đánh dấu (jti access-token của request).
 *
 * BẤT BIẾN #3: KHÔNG bao giờ hiển thị refresh token/hash — DTO server đã strip tận gốc.
 *
 * States: loading · error · empty · list (revoke từng phiên + revoke-all-others, có ConfirmDialog).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { KeyRound, RefreshCw, LogOut } from "lucide-react";
import type { SessionListItem } from "@mediaos/contracts";
import { authApi, authKeys, formatDateTime, ApiError } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Badge } from "@mediaos/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type TF = ReturnType<typeof useTranslation<"account">>["t"];

function submitErrorMessage(err: unknown, t: TF): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return t("sessions.errors.forbidden");
    if (err.status === 404) return t("sessions.errors.notFound");
    if (err.status >= 500) return t("sessions.errors.server");
  }
  return t("sessions.errors.generic");
}

function deviceLabel(session: SessionListItem, t: TF): string {
  const parts = [session.device_name, session.platform].filter((v): v is string => !!v);
  return parts.length > 0 ? parts.join(" · ") : t("sessions.unknownDevice");
}

export function AccountSessionsPage() {
  const { t } = useTranslation("account");
  const { t: tc } = useTranslation("common");
  const queryClient = useQueryClient();
  const [revokeTarget, setRevokeTarget] = useState<SessionListItem | null>(null);
  const [revokeOthersOpen, setRevokeOthersOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(
    null,
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: authKeys.sessions.list(),
    queryFn: () => authApi.listSessions(),
    staleTime: 15_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: authKeys.sessions.list() });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => authApi.revokeSession(id),
    onSuccess: async () => {
      await invalidate();
      setRevokeTarget(null);
      setFeedback({ kind: "success", message: t("sessions.revokeSuccess") });
    },
    onError: (err) => setFeedback({ kind: "error", message: submitErrorMessage(err, t) }),
  });

  const revokeOthersMutation = useMutation({
    mutationFn: () => authApi.revokeOtherSessions(),
    onSuccess: async (result) => {
      await invalidate();
      setRevokeOthersOpen(false);
      setFeedback({
        kind: "success",
        message: t("sessions.revokeOthersSuccess", { count: result.revoked_count }),
      });
    },
    onError: (err) => setFeedback({ kind: "error", message: submitErrorMessage(err, t) }),
  });

  const columns: ColumnDef<SessionListItem>[] = [
    {
      accessorKey: "device_name",
      header: t("sessions.columns.device"),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {deviceLabel(row.original, t)}
          </span>
          {row.original.is_current && <Badge variant="brand">{t("sessions.currentBadge")}</Badge>}
        </div>
      ),
    },
    {
      accessorKey: "ip_address",
      header: t("sessions.columns.ipAddress"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.ip_address ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "last_used_at",
      header: t("sessions.columns.lastUsedAt"),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.last_used_at ? formatDateTime(row.original.last_used_at) : "—"}
        </span>
      ),
    },
    {
      accessorKey: "created_at",
      header: t("sessions.columns.createdAt"),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDateTime(row.original.created_at)}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("sessions.columns.actions")}</span>,
      cell: ({ row }) =>
        row.original.is_current ? null : (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setRevokeTarget(row.original)}>
              {t("sessions.revoke")}
            </Button>
          </div>
        ),
    },
  ];

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
          title={t("sessions.title")}
          description={t("sessions.description")}
          icon={KeyRound}
        />
        <div className="mt-8">
          <EmptyState
            title={t("sessions.error.title")}
            description={t("sessions.error.description")}
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
  const hasOtherSessions = items.some((s) => !s.is_current);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("sessions.title")}
        description={t("sessions.description")}
        icon={KeyRound}
        actions={
          hasOtherSessions && (
            <Button variant="outline" size="sm" onClick={() => setRevokeOthersOpen(true)}>
              <LogOut className="mr-2 h-4 w-4" />
              {t("sessions.revokeOthers")}
            </Button>
          )
        }
      />

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

      <DataTable
        columns={columns}
        data={items}
        emptyState={
          <EmptyState
            title={t("sessions.empty.title")}
            description={t("sessions.empty.description")}
          />
        }
        pageSize={20}
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        title={t("sessions.confirm.revokeTitle")}
        description={t("sessions.confirm.revokeDescription")}
        confirmLabel={t("sessions.confirm.confirmLabel")}
        cancelLabel={t("sessions.confirm.cancelLabel")}
        destructive
        busy={revokeMutation.isPending}
        busyLabel={t("sessions.revoking")}
        onConfirm={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
        onCancel={() => setRevokeTarget(null)}
      />

      <ConfirmDialog
        open={revokeOthersOpen}
        title={t("sessions.confirm.revokeOthersTitle")}
        description={t("sessions.confirm.revokeOthersDescription")}
        confirmLabel={t("sessions.confirm.confirmLabel")}
        cancelLabel={t("sessions.confirm.cancelLabel")}
        destructive
        busy={revokeOthersMutation.isPending}
        busyLabel={t("sessions.revokingOthers")}
        onConfirm={() => revokeOthersMutation.mutate()}
        onCancel={() => setRevokeOthersOpen(false)}
      />
    </div>
  );
}
