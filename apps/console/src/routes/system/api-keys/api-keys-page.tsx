import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ApiKeyDto } from "@mediaos/contracts";
import { useCan } from "@mediaos/web-core";
import { Badge, Button, Card, CardContent, DataTable, EmptyState } from "@mediaos/ui";
import { apiKeysApi } from "@/lib/api-keys-api";
import { CreateApiKeyDialog } from "./create-api-key-dialog";
import { RevokeApiKeyDialog } from "./revoke-api-key-dialog";

/** Map trạng thái → variant Badge dùng chung (@mediaos/ui không có `destructive` → `danger`). */
const STATUS_VARIANT: Record<ApiKeyDto["status"], "secondary" | "outline" | "danger"> = {
  active: "secondary",
  expired: "outline",
  revoked: "danger",
};

/** Định dạng ngày theo locale vi (UTC-safe — chỉ hiển thị). */
function fmtDate(iso: string | null, fallback: string): string {
  if (!iso) return fallback;
  return new Date(iso).toLocaleString("vi-VN");
}

/**
 * AC-5 API key / PAT — tenant self-service (apps/console, aud=user). Gate `manage:api-key`
 * (is_sensitive) ở BE; UI chỉ ẩn/hiện affordance qua useCan (KHÔNG hard-code permission).
 * Token plaintext hiển thị MỘT LẦN ở CreateApiKeyDialog (state local). loading/error/empty đầy đủ.
 */
export function ApiKeysPage() {
  const { t } = useTranslation("api-keys");
  const queryClient = useQueryClient();
  const canManage = useCan("manage", "api-key");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [revokeTarget, setRevokeTarget] = React.useState<ApiKeyDto | null>(null);
  const [flash, setFlash] = React.useState<string | null>(null);

  const keysQuery = useQuery({
    queryKey: ["api-keys", "list"],
    queryFn: apiKeysApi.list,
    enabled: canManage,
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiKeysApi.revoke(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["api-keys", "list"] });
      setRevokeTarget(null);
      setFlash(t("feedback.revoked"));
    },
  });

  const columns: ColumnDef<ApiKeyDto>[] = [
    { accessorKey: "name", header: t("table.name") },
    {
      accessorKey: "tokenPrefix",
      header: t("table.prefix"),
      cell: ({ row }) => (
        <code className="text-xs text-muted-foreground">{row.original.tokenPrefix}…</code>
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
      accessorKey: "lastUsedAt",
      header: t("table.lastUsed"),
      cell: ({ row }) => fmtDate(row.original.lastUsedAt, t("table.neverUsed")),
    },
    {
      accessorKey: "expiresAt",
      header: t("table.expires"),
      cell: ({ row }) => fmtDate(row.original.expiresAt, t("table.noExpiry")),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) =>
        row.original.status === "active" ? (
          <Button variant="outline" size="sm" onClick={() => setRevokeTarget(row.original)}>
            {t("actions.revoke")}
          </Button>
        ) : null,
    },
  ];

  if (!canManage) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <EmptyState
          icon={KeyRound}
          title={t("noPermission.title")}
          description={t("noPermission.description")}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>{t("actions.create")}</Button>
      </header>

      {flash && (
        <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          {flash}
        </p>
      )}

      {keysQuery.isError && (
        <p
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t("feedback.loadFailed")}
          <Button variant="outline" size="sm" onClick={() => void keysQuery.refetch()}>
            {t("common:actions.retry")}
          </Button>
        </p>
      )}

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={keysQuery.data ?? []}
            isLoading={keysQuery.isLoading}
            emptyState={
              <EmptyState
                icon={KeyRound}
                title={t("table.empty")}
                description={t("subtitle")}
              />
            }
          />
        </CardContent>
      </Card>

      {createOpen && (
        <CreateApiKeyDialog
          open
          onClose={() => setCreateOpen(false)}
          onSuccess={() => setFlash(t("feedback.created"))}
        />
      )}
      {revokeTarget && (
        <RevokeApiKeyDialog
          open
          apiKey={revokeTarget}
          pending={revokeMutation.isPending}
          error={revokeMutation.isError ? t("feedback.revokeFailed") : null}
          onConfirm={() => revokeMutation.mutate(revokeTarget.id)}
          onClose={() => {
            revokeMutation.reset();
            setRevokeTarget(null);
          }}
        />
      )}
    </div>
  );
}
