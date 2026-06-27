/**
 * SYSTEM-SCREEN-SECURITY-EVENTS (S2-AUTH-BE-5 · L3-FE-VIEWER) — viewer Sự kiện bảo mật.
 *
 * Nguồn: AUTH-API-402 GET /auth/security-events (user_security_events — append-only, mig 0443,
 * RLS+FORCE). Cổng quyền: useCan('view','audit-log') — cặp ENGINE THỰC (seed mig 0340, grant
 * company-admin). KHÔNG hard-code role. Server enforce data-scope Company (RLS) + masking; client
 * CHỈ render cái server trả (payload jsonb đã bị loại khỏi DTO ở contract — không lộ secret).
 *
 * States: loading · error · empty · forbidden. Bộ lọc: event_type / severity / user_id / from / to.
 * Phân trang server-side (page/per_page) — prev/next.
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { ShieldAlert, RefreshCw } from "lucide-react";
import { z } from "zod";
import {
  SECURITY_EVENT_SEVERITIES,
  type SecurityEventListItem,
  type SecurityEventSeverity,
  securityEventListItemSchema,
} from "@mediaos/contracts";
import { apiFetch, buildQueryString, useCan } from "@mediaos/web-core";
import { Badge, Button, DataTable, EmptyState, PageHeader, Select } from "@mediaos/ui";
import {
  AUDIT_LOG_VIEW,
  AUTH_LOG_PAGE_SIZE,
  SECURITY_EVENTS_API,
  SECURITY_EVENTS_QUERY_KEY,
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
type SecurityEventFilters = {
  eventType: string;
  severity: string; // "" = mọi mức độ
  userId: string;
  fromDate: string;
  toDate: string;
};

const INITIAL_FILTERS: SecurityEventFilters = {
  eventType: "",
  severity: "",
  userId: "",
  fromDate: "",
  toDate: "",
};

// Response sau unwrapEnvelope = mảng item (pagination/meta bị tách ở apiFetch).
const securityEventListSchema = z.array(securityEventListItemSchema);

// ---------------------------------------------------------------------------
// Severity badge
// ---------------------------------------------------------------------------
const SEVERITY_VARIANT: Record<
  SecurityEventSeverity,
  "muted" | "secondary" | "warning" | "danger"
> = {
  info: "muted",
  low: "secondary",
  medium: "warning",
  high: "danger",
  critical: "danger",
};

function SeverityBadge({ severity }: { severity: SecurityEventSeverity }) {
  const { t } = useTranslation("system");
  return (
    <Badge variant={SEVERITY_VARIANT[severity]}>{t(`securityEvents.severity.${severity}`)}</Badge>
  );
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------
function useSecurityEventColumns(
  t: ReturnType<typeof useTranslation<"system">>["t"],
): ColumnDef<SecurityEventListItem>[] {
  return [
    {
      accessorKey: "created_at",
      header: t("securityEvents.columns.createdAt"),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {new Date(row.original.created_at).toLocaleString("vi-VN")}
        </span>
      ),
    },
    {
      accessorKey: "event_type",
      header: t("securityEvents.columns.eventType"),
      cell: ({ row }) => (
        <span className="text-sm font-medium text-foreground">{row.original.event_type}</span>
      ),
    },
    {
      accessorKey: "severity",
      header: t("securityEvents.columns.severity"),
      cell: ({ row }) => <SeverityBadge severity={row.original.severity} />,
    },
    {
      accessorKey: "user",
      header: t("securityEvents.columns.user"),
      cell: ({ row }) => {
        const u = row.original.user;
        return u ? (
          <span className="text-sm text-foreground">{u.display_name ?? u.email}</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        );
      },
    },
    {
      accessorKey: "actor",
      header: t("securityEvents.columns.actor"),
      cell: ({ row }) => {
        const a = row.original.actor;
        return a ? (
          <span className="text-sm text-muted-foreground">{a.display_name ?? a.email}</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        );
      },
    },
    {
      accessorKey: "ip_address",
      header: t("securityEvents.columns.ipAddress"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.ip_address ?? "—"}
        </span>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export function SecurityEventsPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const canView = useCan(AUDIT_LOG_VIEW.action, AUDIT_LOG_VIEW.resourceType);

  const { page, draft, applied, setPage, setDraftField, applyFilters, resetFilters } =
    useAuthLogFilters<SecurityEventFilters>(INITIAL_FILTERS);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...SECURITY_EVENTS_QUERY_KEY, page, applied] as const,
    queryFn: () => {
      const qs = buildQueryString({
        page,
        per_page: AUTH_LOG_PAGE_SIZE,
        event_type: emptyToUndefined(applied.eventType),
        severity: emptyToUndefined(applied.severity),
        user_id: emptyToUndefined(applied.userId),
        from_date: emptyToUndefined(applied.fromDate),
        to_date: emptyToUndefined(applied.toDate),
      });
      return apiFetch(`${SECURITY_EVENTS_API}${qs}`, securityEventListSchema);
    },
    enabled: canView,
    staleTime: 30_000,
  });

  const columns = useSecurityEventColumns(t);

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("securityEvents.forbidden.title")}
          description={t("securityEvents.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("securityEvents.title")}
          description={t("securityEvents.description")}
          icon={ShieldAlert}
        />
        <div className="mt-8">
          <EmptyState
            title={t("securityEvents.error.title")}
            description={t("securityEvents.error.description")}
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

  const items: SecurityEventListItem[] = data ?? [];

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={t("securityEvents.title")}
        description={t("securityEvents.description")}
        icon={ShieldAlert}
      />

      <FilterShell onApply={applyFilters} onReset={resetFilters}>
        <TextField
          label={t("authLogFilters.eventType")}
          value={draft.eventType}
          placeholder={t("authLogFilters.eventTypePlaceholder")}
          onChange={(v) => setDraftField("eventType", v)}
        />
        <LabeledField label={t("securityEvents.columns.severity")}>
          <Select
            value={draft.severity}
            onChange={(e) => setDraftField("severity", e.target.value)}
          >
            <option value="">{t("authLogFilters.allSeverities")}</option>
            {SECURITY_EVENT_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {t(`securityEvents.severity.${s}`)}
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
            title={t("securityEvents.empty.title")}
            description={t("securityEvents.empty.description")}
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
