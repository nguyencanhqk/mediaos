/**
 * SYSTEM-SCREEN-FILE-ACCESS-LOGS (S2-FE-FND-6) — /system/file-access-logs (viewer, chỉ đọc).
 *
 * GET /foundation/file-access-logs (filter fileId/actorUserId/action/from-to + phân trang page-based)
 * → gate view:foundation-file-access-log (KHÔNG sensitive). BẤT BIẾN #2 (APPEND-ONLY): KHÔNG có
 * nút sửa/xoá — server chỉ có route GET (UPDATE/DELETE bị REVOKE ở mig 0433). BẤT BIẾN #3: contract
 * fileAccessLogViewSchema WHITELIST — KHÔNG storage_path/signed-url/ip/user-agent/metadata; client chỉ
 * render field server đã cho phép.
 *
 * States: loading · error · empty · forbidden. Phân trang server-side (page/limit) tái dùng
 * AuthLogPagination (heuristic full-page ⇒ còn trang sau, cùng kỹ thuật LoginLogsPage).
 */
import { useTranslation } from "react-i18next";
import { type ColumnDef } from "@tanstack/react-table";
import { FileSearch } from "lucide-react";
import { FILE_ACCESS_ACTIONS, useCan, type FileAccessLogView } from "@mediaos/web-core";
import { Badge, Button, DataTable, EmptyState, PageHeader, Select } from "@mediaos/ui";
import {
  AuthLogPagination,
  DateField,
  FilterShell,
  LabeledField,
  TextField,
} from "@/routes/system/auth-logs/AuthLogControls";
import {
  emptyToUndefined,
  useAuthLogFilters,
} from "@/routes/system/auth-logs/use-auth-log-filters";
import { useFileAccessLogs } from "./useFileAccessLogs";
import { FOUNDATION_ENGINE_PAIRS } from "./constants";

// Khớp LIST_LIMIT_DEFAULT (packages/contracts/src/foundation/file-access-log.ts — KHÔNG export nên
// pin lại giá trị default ở đây; server vẫn tự clamp [1..100] dù client gửi gì).
const FILE_ACCESS_LOG_PAGE_SIZE = 50;

type LogFilters = {
  fileId: string;
  actorUserId: string;
  action: string; // "" = mọi action
  fromDate: string;
  toDate: string;
};

const INITIAL_FILTERS: LogFilters = {
  fileId: "",
  actorUserId: "",
  action: "",
  fromDate: "",
  toDate: "",
};

const ACCESS_GRANTED_VARIANT = { granted: "success", denied: "danger" } as const;

function useColumns(
  t: ReturnType<typeof useTranslation<"system">>["t"],
): ColumnDef<FileAccessLogView>[] {
  return [
    {
      accessorKey: "createdAt",
      header: t("fileAccessLogs.columns.createdAt"),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {new Date(row.original.createdAt).toLocaleString("vi-VN")}
        </span>
      ),
    },
    {
      accessorKey: "action",
      header: t("fileAccessLogs.columns.action"),
      cell: ({ row }) => <span className="text-sm">{row.original.action}</span>,
    },
    {
      accessorKey: "accessGranted",
      header: t("fileAccessLogs.columns.result"),
      cell: ({ row }) => (
        <Badge variant={ACCESS_GRANTED_VARIANT[row.original.accessGranted ? "granted" : "denied"]}>
          {row.original.accessGranted
            ? t("fileAccessLogs.result.granted")
            : t("fileAccessLogs.result.denied")}
        </Badge>
      ),
    },
    {
      accessorKey: "deniedReason",
      header: t("fileAccessLogs.columns.deniedReason"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.deniedReason ?? "—"}</span>
      ),
    },
    {
      accessorKey: "actorUserId",
      header: t("fileAccessLogs.columns.actor"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.actorUserId ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "moduleCode",
      header: t("fileAccessLogs.columns.module"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.moduleCode ?? "—"} {row.original.entityType ?? ""}
        </span>
      ),
    },
  ];
}

export function FileAccessLogsPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const canView = useCan(
    FOUNDATION_ENGINE_PAIRS.VIEW_FILE_ACCESS_LOG.action,
    FOUNDATION_ENGINE_PAIRS.VIEW_FILE_ACCESS_LOG.resourceType,
  );

  const { page, draft, applied, setPage, setDraftField, applyFilters, resetFilters } =
    useAuthLogFilters<LogFilters>(INITIAL_FILTERS);

  const { data, isLoading, isError, refetch } = useFileAccessLogs(
    {
      page,
      limit: FILE_ACCESS_LOG_PAGE_SIZE,
      fileId: emptyToUndefined(applied.fileId),
      actorUserId: emptyToUndefined(applied.actorUserId),
      action: emptyToUndefined(applied.action) as (typeof FILE_ACCESS_ACTIONS)[number] | undefined,
      from: emptyToUndefined(applied.fromDate),
      to: emptyToUndefined(applied.toDate),
    },
    canView,
  );

  const columns = useColumns(t);

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("fileAccessLogs.forbidden.title")}
          description={t("fileAccessLogs.forbidden.description")}
          data-testid="file-access-logs-forbidden"
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("fileAccessLogs.title")}
          description={t("fileAccessLogs.description")}
          icon={FileSearch}
        />
        <div className="mt-8">
          <EmptyState
            title={t("fileAccessLogs.error.title")}
            description={t("fileAccessLogs.error.description")}
            action={
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
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
    <div className="space-y-5 p-6">
      <PageHeader
        title={t("fileAccessLogs.title")}
        description={t("fileAccessLogs.description")}
        icon={FileSearch}
      />

      <FilterShell onApply={applyFilters} onReset={resetFilters}>
        <LabeledField label={t("fileAccessLogs.filters.action")}>
          <Select value={draft.action} onChange={(e) => setDraftField("action", e.target.value)}>
            <option value="">{t("authLogFilters.allStatuses")}</option>
            {FILE_ACCESS_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </LabeledField>
        <TextField
          label={t("fileAccessLogs.filters.fileId")}
          value={draft.fileId}
          placeholder={t("fileAccessLogs.filters.fileIdPlaceholder")}
          onChange={(v) => setDraftField("fileId", v)}
        />
        <TextField
          label={t("authLogFilters.userId")}
          value={draft.actorUserId}
          placeholder={t("authLogFilters.userIdPlaceholder")}
          onChange={(v) => setDraftField("actorUserId", v)}
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
            title={t("fileAccessLogs.empty.title")}
            description={t("fileAccessLogs.empty.description")}
          />
        }
        pageSize={FILE_ACCESS_LOG_PAGE_SIZE}
      />

      <AuthLogPagination
        page={page}
        currentCount={items.length}
        pageSize={FILE_ACCESS_LOG_PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
}
