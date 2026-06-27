/**
 * SYSTEM-SCREEN-LOGIN-LOGS (S2-AUTH-BE-5 · L3-FE-VIEWER) — viewer Nhật ký đăng nhập.
 *
 * Nguồn: AUTH-API-401 GET /auth/login-logs (login_logs — append-only, mig 0443, RLS+FORCE).
 * Cổng quyền: useCan('view','audit-log') — cặp ENGINE THỰC (seed mig 0340, grant company-admin).
 *   KHÔNG hard-code role. Server enforce data-scope Company (RLS) + masking; client CHỈ render cái
 *   server trả (metadata jsonb đã bị loại khỏi DTO ở contract — không thể lộ secret).
 *
 * States: loading · error · empty · forbidden. Bộ lọc: status / user_id / from_date / to_date.
 * Phân trang server-side (page/per_page) — prev/next.
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { FileClock, RefreshCw } from "lucide-react";
import { z } from "zod";
import {
  LOGIN_LOG_STATUSES,
  type LoginLogListItem,
  type LoginLogStatus,
  loginLogListItemSchema,
} from "@mediaos/contracts";
import { apiFetch, buildQueryString, useCan } from "@mediaos/web-core";
import { Badge, Button, DataTable, EmptyState, PageHeader, Select } from "@mediaos/ui";
import {
  AUDIT_LOG_VIEW,
  AUTH_LOG_PAGE_SIZE,
  LOGIN_LOGS_API,
  LOGIN_LOGS_QUERY_KEY,
} from "./constants";
import {
  AuthLogPagination,
  DateField,
  FilterShell,
  LabeledField,
  TextField,
} from "./AuthLogControls";
import { emptyToUndefined, useAuthLogFilters } from "./use-auth-log-filters";

// ---------------------------------------------------------------------------
// Filter shape
// ---------------------------------------------------------------------------
// type (KHÔNG interface) để thỏa ràng buộc Record<string, unknown> của useAuthLogFilters.
type LoginLogFilters = {
  status: string; // "" = mọi trạng thái
  userId: string;
  fromDate: string;
  toDate: string;
};

const INITIAL_FILTERS: LoginLogFilters = { status: "", userId: "", fromDate: "", toDate: "" };

// Response sau unwrapEnvelope = mảng item (pagination/meta bị tách ở apiFetch).
const loginLogListSchema = z.array(loginLogListItemSchema);

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
const STATUS_VARIANT: Record<LoginLogStatus, "success" | "danger" | "warning"> = {
  success: "success",
  failed: "danger",
  blocked: "warning",
};

function LoginStatusBadge({ status }: { status: LoginLogStatus }) {
  const { t } = useTranslation("system");
  return <Badge variant={STATUS_VARIANT[status]}>{t(`loginLogs.status.${status}`)}</Badge>;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------
function useLoginLogColumns(
  t: ReturnType<typeof useTranslation<"system">>["t"],
): ColumnDef<LoginLogListItem>[] {
  return [
    {
      accessorKey: "created_at",
      header: t("loginLogs.columns.createdAt"),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {new Date(row.original.created_at).toLocaleString("vi-VN")}
        </span>
      ),
    },
    {
      accessorKey: "user",
      header: t("loginLogs.columns.user"),
      cell: ({ row }) => {
        const u = row.original.user;
        return u ? (
          <span className="text-sm font-medium text-foreground">{u.display_name ?? u.email}</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        );
      },
    },
    {
      accessorKey: "status",
      header: t("loginLogs.columns.status"),
      cell: ({ row }) => <LoginStatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "ip_address",
      header: t("loginLogs.columns.ipAddress"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.ip_address ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "failure_reason",
      header: t("loginLogs.columns.failureReason"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.failure_reason ?? "—"}</span>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export function LoginLogsPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const canView = useCan(AUDIT_LOG_VIEW.action, AUDIT_LOG_VIEW.resourceType);

  const { page, draft, applied, setPage, setDraftField, applyFilters, resetFilters } =
    useAuthLogFilters<LoginLogFilters>(INITIAL_FILTERS);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...LOGIN_LOGS_QUERY_KEY, page, applied] as const,
    queryFn: () => {
      const qs = buildQueryString({
        page,
        per_page: AUTH_LOG_PAGE_SIZE,
        status: emptyToUndefined(applied.status),
        user_id: emptyToUndefined(applied.userId),
        from_date: emptyToUndefined(applied.fromDate),
        to_date: emptyToUndefined(applied.toDate),
      });
      return apiFetch(`${LOGIN_LOGS_API}${qs}`, loginLogListSchema);
    },
    enabled: canView,
    staleTime: 30_000,
  });

  const columns = useLoginLogColumns(t);

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("loginLogs.forbidden.title")}
          description={t("loginLogs.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("loginLogs.title")}
          description={t("loginLogs.description")}
          icon={FileClock}
        />
        <div className="mt-8">
          <EmptyState
            title={t("loginLogs.error.title")}
            description={t("loginLogs.error.description")}
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

  const items: LoginLogListItem[] = data ?? [];

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={t("loginLogs.title")}
        description={t("loginLogs.description")}
        icon={FileClock}
      />

      <FilterShell onApply={applyFilters} onReset={resetFilters}>
        <LabeledField label={tc("status")}>
          <Select value={draft.status} onChange={(e) => setDraftField("status", e.target.value)}>
            <option value="">{t("authLogFilters.allStatuses")}</option>
            {LOGIN_LOG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`loginLogs.status.${s}`)}
              </option>
            ))}
          </Select>
        </LabeledField>
        <TextField
          label={t("authLogFilters.userId")}
          value={draft.userId}
          placeholder={t("authLogFilters.userIdPlaceholder")}
          onChange={(v) => setDraftField("userId", v)}
        />
        <DateField
          label={t("authLogFilters.fromDate")}
          value={draft.fromDate}
          onChange={(v) => setDraftField("fromDate", v)}
        />
        <DateField
          label={t("authLogFilters.toDate")}
          value={draft.toDate}
          onChange={(v) => setDraftField("toDate", v)}
        />
      </FilterShell>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("loginLogs.empty.title")}
            description={t("loginLogs.empty.description")}
          />
        }
        pageSize={AUTH_LOG_PAGE_SIZE}
      />

      <AuthLogPagination
        page={page}
        currentCount={items.length}
        pageSize={AUTH_LOG_PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
}
