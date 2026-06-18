import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, Badge, Button, DataTable, EmptyState } from "@mediaos/ui";
import { useCan } from "@mediaos/web-core";
import { recycleBinApi, type DeletedEmployee } from "@/lib/recycle-bin-api";

/**
 * CS-6 — Thùng rác (/recycle-bin).
 *
 * 2 tab: "Người dùng" (placeholder) + "Nhân viên" (soft-deleted hồ sơ nhân viên).
 * Nút "Khôi phục" trên mỗi dòng gọi POST /recycle-bin/employees/:id/restore rồi refetch.
 * Gate: read:employee (hiển thị) + restore:employee (nút khôi phục).
 */

type Tab = "employees" | "users";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  inactive: "secondary",
  resigned: "outline",
  terminated: "destructive",
};

export function RecycleBinPage() {
  const { t } = useTranslation("recycle-bin");
  const qc = useQueryClient();

  const canRead = useCan("read", "employee");
  const canRestore = useCan("restore", "employee");

  const [activeTab, setActiveTab] = useState<Tab>("employees");

  // ── Data fetching ──────────────────────────────────────────────────────────

  const { data: deleted = [], isLoading, isError } = useQuery({
    queryKey: ["console:recycle-bin:employees"],
    queryFn: () => recycleBinApi.listDeleted(),
    enabled: canRead,
  });

  // ── Restore mutation ───────────────────────────────────────────────────────

  const [restoreError, setRestoreError] = useState<string | null>(null);

  const restoreMutation = useMutation({
    mutationFn: (id: string) => recycleBinApi.restore(id),
    onSuccess: () => {
      setRestoreError(null);
      void qc.invalidateQueries({ queryKey: ["console:recycle-bin:employees"] });
      // Also invalidate the active employees list in case ObjectsPage is open.
      void qc.invalidateQueries({ queryKey: ["console:employees"] });
    },
    onError: (err: unknown) => {
      setRestoreError(err instanceof Error ? err.message : t("error.restoreFailed"));
    },
  });

  // ── Table columns ──────────────────────────────────────────────────────────

  const columns = useMemo<ColumnDef<DeletedEmployee>[]>(
    () => [
      {
        id: "name",
        header: t("table.name"),
        accessorFn: (row) => `${row.userFullName ?? ""} ${row.userEmail ?? ""}`,
        cell: ({ row }) => {
          const e = row.original;
          const name = e.userFullName ?? e.userEmail ?? e.userId;
          return (
            <div className="flex items-center gap-3">
              <Avatar name={name} size="md" />
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{name}</p>
                {e.employeeCode && (
                  <p className="text-xs text-muted-foreground">{e.employeeCode}</p>
                )}
              </div>
            </div>
          );
        },
      },
      {
        id: "email",
        header: t("table.email"),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.userEmail ?? "—"}
          </span>
        ),
      },
      {
        id: "orgUnit",
        header: t("table.orgUnit"),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.orgUnitName ?? "—"}
          </span>
        ),
      },
      {
        id: "status",
        header: t("table.status"),
        cell: ({ row }) => {
          const s = row.original.status;
          return (
            <Badge variant={STATUS_VARIANT[s] ?? "secondary"}>
              {t(`statusLabels.${s}`, { defaultValue: s })}
            </Badge>
          );
        },
      },
      {
        id: "deletedAt",
        header: t("table.deletedAt"),
        cell: ({ row }) => {
          const raw = row.original.deletedAt;
          if (!raw) return <span className="text-sm text-muted-foreground">—</span>;
          return (
            <span className="text-sm text-muted-foreground">
              {new Date(raw).toLocaleDateString("vi-VN")}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          canRestore ? (
            <div className="flex items-center justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => restoreMutation.mutate(row.original.id)}
                disabled={restoreMutation.isPending}
                aria-label={`${t("actions.restore")} ${row.original.userFullName ?? row.original.id}`}
              >
                {restoreMutation.isPending ? t("restoring") : t("actions.restore")}
              </Button>
            </div>
          ) : null,
      },
    ],
    [t, canRestore, restoreMutation],
  );

  // ── Permission gate ────────────────────────────────────────────────────────

  if (!canRead) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <EmptyState
          icon={Trash2}
          title={t("noPermission.title")}
          description={t("noPermission.description")}
        />
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      {/* Header */}
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1 w-fit">
        {(["employees", "users"] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={[
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              activeTab === tab
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
            aria-selected={activeTab === tab}
            role="tab"
          >
            {t(`tabs.${tab}`)}
          </button>
        ))}
      </div>

      {/* Restore error banner */}
      {restoreError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {restoreError}
        </div>
      )}

      {/* Table (employees tab only — users tab is placeholder) */}
      {activeTab === "employees" ? (
        isError ? (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center text-sm text-destructive"
          >
            {t("error.loadFailed")}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={deleted}
            isLoading={isLoading}
            emptyState={
              <EmptyState
                icon={Trash2}
                title={t("empty.title")}
                description={t("empty.description")}
              />
            }
          />
        )
      ) : (
        /* Users tab — placeholder */
        <EmptyState
          icon={Trash2}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      )}
    </div>
  );
}
