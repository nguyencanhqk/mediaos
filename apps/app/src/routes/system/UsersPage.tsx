/**
 * HR-SCREEN-SYSTEM-USERS (S2-FE-HR-3 P1) — User list read-only placeholder.
 *
 * Scope: read-only view placeholder; full CRUD deferred to Sprint 3 (S3-FE-SYSTEM-USERS).
 * Permission gate: useCan("manage", "user") — khớp engine pair AUTH.USER.VIEW → manage:user.
 * Server enforces all data-scope; client only renders what server returns.
 *
 * States covered: loading · error · empty · forbidden.
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Users, RefreshCw, Clock } from "lucide-react";
import { usersApi, useCan } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Badge } from "@mediaos/ui";
import { SYSTEM_ENGINE_PAIRS } from "./constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type UserStatus = "active" | "suspended";

interface UserRow {
  id: string;
  email: string;
  fullName: string | null;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Query key factory (local — not global yet; extend query-keys.ts in Sprint 3)
// ---------------------------------------------------------------------------
const USER_QUERY_KEY = ["system", "users"] as const;

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function UserStatusBadge({ status }: { status: UserStatus }) {
  const { t } = useTranslation("system");
  const variant = status === "active" ? "default" : "secondary";
  return <Badge variant={variant}>{t(`users.status.${status}`)}</Badge>;
}

// ---------------------------------------------------------------------------
// Column definitions — moved out of component to avoid recreation on render
// ---------------------------------------------------------------------------
function useUserColumns(t: ReturnType<typeof useTranslation<"system">>["t"]): ColumnDef<UserRow>[] {
  return [
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
    {
      accessorKey: "lastLoginAt",
      header: t("users.columns.lastLogin"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.lastLoginAt
            ? new Date(row.original.lastLoginAt).toLocaleDateString("vi-VN")
            : "—"}
        </span>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function UsersPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const { action, resourceType } = SYSTEM_ENGINE_PAIRS.READ_USER;
  const canView = useCan(action, resourceType);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: USER_QUERY_KEY,
    queryFn: async () => {
      const result = await usersApi.listUsers({ limit: 50, offset: 0 });
      return result;
    },
    enabled: canView,
    staleTime: 30_000,
  });

  const columns = useUserColumns(t);

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

  // ── Error ──────────────────────────────────────────────────────────────────
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

  const items: UserRow[] = (data?.users ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    status: u.status,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  }));

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t("users.title")} description={t("users.description")} icon={Users}>
        {/* Sprint-3 notice — placeholder badge so QA knows this is read-only */}
        <div className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>{t("users.sprint3Notice")}</span>
        </div>
      </PageHeader>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState title={t("users.empty.title")} description={t("users.empty.description")} />
        }
        pageSize={50}
      />
    </div>
  );
}
