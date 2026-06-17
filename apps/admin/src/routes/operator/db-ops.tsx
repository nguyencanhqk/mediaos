import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DB_BROWSER_ALLOWLIST,
  type DbBrowserTable,
  type DbOpsGrantDto,
} from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { useCan } from "@/hooks/use-can";
import { dbOpsApi } from "@/lib/db-ops-api";

const TABLE_NAMES = Object.keys(DB_BROWSER_ALLOWLIST) as DbBrowserTable[];

/**
 * Trang Operator — DB ops CHỈ-ĐỌC (`/operator/db-ops`, AC-9). 4 panel:
 *   P1 Migration status (manage:db-ops) · P2 Data browser tenant-scoped (read:db-browser) ·
 *   P3 Break-glass grants (manage:db-ops) · P4 Export jobs scaffold (manage:db-ops).
 *
 * useCan gate UI; server ép permission (is_sensitive) + break-glass-active + step-up. KHÔNG hard-code perm.
 * loading→role=status, error→role=alert. Data browser yêu cầu 1 grant ACTIVE (server fail-closed 403).
 */
export function OperatorDbOpsPage() {
  const { t } = useTranslation("db-ops");
  const canManage = useCan("manage", "db-ops");
  const canBrowse = useCan("read", "db-browser");

  if (!canManage && !canBrowse) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <EmptyState
          icon={ShieldAlert}
          title={t("noPermission.title")}
          description={t("noPermission.description")}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {canManage && <MigrationStatusPanel />}
      {canManage && <GrantsPanel />}
      {canBrowse && <DataBrowserPanel />}
      {canManage && <ExportsPanel />}
    </div>
  );
}

function MigrationStatusPanel() {
  const { t } = useTranslation("db-ops");
  const q = useQuery({
    queryKey: ["db-ops:migration-status"],
    queryFn: () => dbOpsApi.getMigrationStatus(),
  });

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="font-medium">{t("migration.title")}</h2>
      {q.isLoading ? (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          …
        </p>
      ) : q.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("migration.error")}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("migration.applied")}: <strong>{q.data?.appliedCount ?? 0}</strong> ·{" "}
          {t("migration.pending")}: <strong>{q.data?.pendingCount ?? 0}</strong>
        </p>
      )}
    </section>
  );
}

function GrantsPanel() {
  const { t } = useTranslation("db-ops");
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [targetTenantId, setTargetTenantId] = useState("");

  const grants = useQuery({
    queryKey: ["db-ops:grants"],
    queryFn: () => dbOpsApi.listGrants(),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["db-ops:grants"] });
  const request = useMutation({
    mutationFn: () =>
      dbOpsApi.requestGrant({
        targetTenantId: targetTenantId.trim() || null,
        reason: reason.trim(),
        ttlSeconds: 3600,
      }),
    onSuccess: () => {
      setReason("");
      setTargetTenantId("");
      invalidate();
    },
  });
  const approve = useMutation({
    mutationFn: (id: string) => dbOpsApi.approveGrant(id),
    onSuccess: invalidate,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => dbOpsApi.revokeGrant(id),
    onSuccess: invalidate,
  });

  const columns = useMemo(
    () => [
      { accessorKey: "status", header: t("grants.table.status") },
      {
        accessorKey: "targetTenantId",
        header: t("grants.table.target"),
        cell: ({ row }: { row: { original: DbOpsGrantDto } }) =>
          row.original.targetTenantId ? row.original.targetTenantId.slice(0, 8) : t("grants.allTenant"),
      },
      {
        accessorKey: "approvalCount",
        header: t("grants.table.approvals"),
        cell: ({ row }: { row: { original: DbOpsGrantDto } }) =>
          `${row.original.approvalCount}/${row.original.requiredApprovals}`,
      },
      {
        id: "actions",
        header: t("grants.table.actions"),
        cell: ({ row }: { row: { original: DbOpsGrantDto } }) => (
          <div className="flex gap-2">
            {row.original.status === "pending" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => approve.mutate(row.original.id)}
                disabled={approve.isPending}
              >
                {t("grants.approve")}
              </Button>
            )}
            {row.original.status !== "revoked" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => revoke.mutate(row.original.id)}
                disabled={revoke.isPending}
              >
                {t("grants.revoke")}
              </Button>
            )}
          </div>
        ),
      },
    ],
    [t, approve, revoke],
  );

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="font-medium">{t("grants.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("grants.subtitle")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <input
          aria-label={t("grants.targetLabel")}
          placeholder={t("grants.targetPlaceholder")}
          className="rounded border border-border px-2 py-1 text-sm"
          value={targetTenantId}
          onChange={(e) => setTargetTenantId(e.target.value)}
        />
        <input
          aria-label={t("grants.reasonLabel")}
          placeholder={t("grants.reasonPlaceholder")}
          className="min-w-64 rounded border border-border px-2 py-1 text-sm"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          size="sm"
          onClick={() => request.mutate()}
          disabled={request.isPending || reason.trim().length === 0}
        >
          {t("grants.request")}
        </Button>
      </div>
      {grants.isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">
          …
        </p>
      ) : grants.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("grants.error")}
        </p>
      ) : (grants.data?.length ?? 0) === 0 ? (
        <EmptyState icon={Database} title={t("grants.empty.title")} description={t("grants.empty.description")} />
      ) : (
        <DataTable columns={columns} data={grants.data ?? []} pagination={false} />
      )}
    </section>
  );
}

function DataBrowserPanel() {
  const { t } = useTranslation("db-ops");
  const [target, setTarget] = useState("");
  const [table, setTable] = useState<DbBrowserTable>(TABLE_NAMES[0]);
  const [submitted, setSubmitted] = useState<{ target: string; table: DbBrowserTable } | null>(null);

  const q = useQuery({
    queryKey: ["db-ops:browse", submitted?.target, submitted?.table],
    queryFn: () =>
      dbOpsApi.browse({
        targetCompanyId: submitted!.target,
        table: submitted!.table,
        limit: 50,
        offset: 0,
      }),
    enabled: submitted != null,
  });

  const columns = useMemo(
    () =>
      (q.data?.columns ?? []).map((c) => ({
        accessorKey: c,
        header: c,
        cell: ({ row }: { row: { original: Record<string, unknown> } }) => {
          const v = row.original[c];
          return <span className="text-xs">{v == null ? "" : String(v)}</span>;
        },
      })),
    [q.data?.columns],
  );

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="font-medium">{t("browser.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("browser.subtitle")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <input
          aria-label={t("browser.targetLabel")}
          placeholder={t("browser.targetPlaceholder")}
          className="rounded border border-border px-2 py-1 text-sm"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <select
          aria-label={t("browser.tableLabel")}
          className="rounded border border-border px-2 py-1 text-sm"
          value={table}
          onChange={(e) => setTable(e.target.value as DbBrowserTable)}
        >
          {TABLE_NAMES.map((tn) => (
            <option key={tn} value={tn}>
              {tn}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={() => setSubmitted({ target: target.trim(), table })}
          disabled={target.trim().length === 0}
        >
          {t("browser.run")}
        </Button>
      </div>
      {submitted == null ? (
        <EmptyState icon={Database} title={t("browser.empty.title")} description={t("browser.empty.description")} />
      ) : q.isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">
          …
        </p>
      ) : q.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("browser.error")}
        </p>
      ) : (q.data?.rows.length ?? 0) === 0 ? (
        <EmptyState icon={Database} title={t("browser.noRows.title")} description={t("browser.noRows.description")} />
      ) : (
        <DataTable columns={columns} data={q.data?.rows ?? []} pagination={false} />
      )}
    </section>
  );
}

function ExportsPanel() {
  const { t } = useTranslation("db-ops");
  const q = useQuery({
    queryKey: ["db-ops:exports"],
    queryFn: () => dbOpsApi.listExports(),
  });

  const columns = useMemo(
    () => [
      { accessorKey: "tableName", header: t("exports.table.tableName") },
      { accessorKey: "status", header: t("exports.table.status") },
      {
        accessorKey: "createdAt",
        header: t("exports.table.createdAt"),
        cell: ({ row }: { row: { original: { createdAt: string } } }) =>
          new Date(row.original.createdAt).toLocaleString("vi-VN"),
      },
    ],
    [t],
  );

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="font-medium">{t("exports.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("exports.subtitle")}</p>
      {q.isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">
          …
        </p>
      ) : q.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("exports.error")}
        </p>
      ) : (q.data?.length ?? 0) === 0 ? (
        <EmptyState icon={Database} title={t("exports.empty.title")} description={t("exports.empty.description")} />
      ) : (
        <DataTable columns={columns} data={q.data ?? []} pagination={false} />
      )}
    </section>
  );
}
