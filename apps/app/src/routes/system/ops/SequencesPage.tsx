/**
 * SYSTEM-SCREEN-SEQUENCES (S2-FE-FND-5 · lane FE batch C) — /system/sequences.
 *
 * API: GET /foundation/sequences (view:foundation-sequence) · GET /:id/preview (KHÔNG mutate) ·
 * PATCH /:id (update:foundation-sequence) — sequence.controller.ts (mig 0435).
 *
 * States: forbidden · loading · error · empty · list (search + pagination qua DataTable).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Hash, RefreshCw, Pencil, Eye } from "lucide-react";
import type { SequenceCounterView } from "@mediaos/contracts";
import { foundationOpsApi, foundationKeys, useCan, PermissionGate } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Input, Badge } from "@mediaos/ui";
import { SYSTEM_ENGINE_PAIRS } from "../constants";
import { SequenceEditDialog } from "./SequenceEditDialog";

function StatusBadge({ status }: { status: SequenceCounterView["status"] }) {
  const { t } = useTranslation("system");
  return (
    <Badge variant={status === "Active" ? "success" : "muted"}>
      {t(`sequences.status.${status}`)}
    </Badge>
  );
}

export function SequencesPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const canView = useCan(
    SYSTEM_ENGINE_PAIRS.READ_SEQUENCE.action,
    SYSTEM_ENGINE_PAIRS.READ_SEQUENCE.resourceType,
  );
  const [filter, setFilter] = useState("");
  const [previewById, setPreviewById] = useState<Record<string, string>>({});
  const [previewErrorId, setPreviewErrorId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SequenceCounterView | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: foundationKeys.sequences.list(),
    queryFn: () => foundationOpsApi.listSequences(),
    enabled: canView,
    staleTime: 30_000,
  });

  const previewMutation = useMutation({
    mutationFn: (id: string) => foundationOpsApi.previewSequence(id),
    onSuccess: (result, id) => {
      setPreviewErrorId(null);
      setPreviewById((prev) => ({ ...prev, [id]: result.code }));
    },
    onError: (_err, id) => setPreviewErrorId(id),
  });

  const columns = useMemo<ColumnDef<SequenceCounterView>[]>(
    () => [
      {
        accessorKey: "moduleCode",
        header: t("sequences.columns.moduleCode"),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.moduleCode}</span>,
      },
      {
        accessorKey: "sequenceKey",
        header: t("sequences.columns.sequenceKey"),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.sequenceKey}</span>,
      },
      {
        accessorKey: "scopeType",
        header: t("sequences.columns.scopeType"),
        cell: ({ row }) => <span className="text-sm">{row.original.scopeType}</span>,
      },
      {
        accessorKey: "lastGeneratedCode",
        header: t("sequences.columns.lastGeneratedCode"),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.lastGeneratedCode ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "resetPolicy",
        header: t("sequences.columns.resetPolicy"),
        cell: ({ row }) => <span className="text-sm">{row.original.resetPolicy}</span>,
      },
      {
        accessorKey: "status",
        header: t("sequences.columns.status"),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "preview",
        header: t("sequences.preview"),
        cell: ({ row }) => {
          const id = row.original.id;
          const previewed = previewById[id];
          return (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={previewMutation.isPending}
                onClick={() => previewMutation.mutate(id)}
              >
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                {t("sequences.preview")}
              </Button>
              {previewed && <span className="font-mono text-xs">{previewed}</span>}
              {previewErrorId === id && (
                <span className="text-xs text-destructive">{t("sequences.previewError")}</span>
              )}
            </div>
          );
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("sequences.edit")}</span>,
        cell: ({ row }) => (
          <PermissionGate
            action={SYSTEM_ENGINE_PAIRS.UPDATE_SEQUENCE.action}
            resourceType={SYSTEM_ENGINE_PAIRS.UPDATE_SEQUENCE.resourceType}
          >
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("sequences.edit")}
              onClick={() => setEditing(row.original)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </PermissionGate>
        ),
      },
    ],
    [t, previewById, previewErrorId, previewMutation],
  );

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("sequences.forbidden.title")}
          description={t("sequences.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("sequences.title")}
          description={t("sequences.description")}
          icon={Hash}
        />
        <div className="mt-8">
          <EmptyState
            title={t("sequences.error.title")}
            description={t("sequences.error.description")}
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
        title={t("sequences.title")}
        description={t("sequences.description")}
        icon={Hash}
      />

      <Input
        placeholder={t("sequences.search")}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-72"
      />

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        globalFilter={filter}
        emptyState={
          <EmptyState
            title={t("sequences.empty.title")}
            description={t("sequences.empty.description")}
          />
        }
        pageSize={20}
      />

      {editing && <SequenceEditDialog sequence={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
