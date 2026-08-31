import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";
import { recruitApi, recruitKeys, useCan } from "@mediaos/web-core";
import type { JobOpeningResponseDto, JobOpeningStatusDto } from "@mediaos/contracts";
import { Button, DataTable, EmptyState, Input, PageHeader, Select } from "@mediaos/ui";
import { RECRUIT_ENGINE_PAIRS, RECRUIT_PAGE_SIZE } from "./constants";
import { JobOpeningStatusBadge } from "./components/StatusBadges";
import { JobOpeningFormDialog } from "./components/JobOpeningFormDialog";

const JOB_STATUS_OPTIONS: readonly JobOpeningStatusDto[] = ["Draft", "Open", "Paused", "Closed"];

interface Filters {
  q: string;
  status: JobOpeningStatusDto | "";
}
const EMPTY_FILTERS: Filters = { q: "", status: "" };

/**
 * REC-SCREEN-001 (S12-RECRUIT-FE-1) — danh sách vị trí tuyển. Chi tiết/form sống ở DIALOG trong màn này
 * (SPEC-12 §9, không có route riêng) — `JobOpeningFormDialog` gộp tạo/sửa/đổi trạng thái.
 *
 * ⚠️ BE KHÔNG trả số ứng viên per-job trong response danh sách — cột hiển thị `headcount` (chỉ tiêu) +
 * `status`, KHÔNG chế thêm cột "số ứng viên" (memory `ui-promises-backend-never-reads`).
 */
export function JobOpeningListPage() {
  const { t } = useTranslation("recruit");

  const canView = useCan(
    RECRUIT_ENGINE_PAIRS.jobOpeningList.action,
    RECRUIT_ENGINE_PAIRS.jobOpeningList.resourceType,
  );
  const canCreate = useCan(
    RECRUIT_ENGINE_PAIRS.jobOpeningCreate.action,
    RECRUIT_ENGINE_PAIRS.jobOpeningCreate.resourceType,
  );
  const canUpdate = useCan(
    RECRUIT_ENGINE_PAIRS.jobOpeningUpdate.action,
    RECRUIT_ENGINE_PAIRS.jobOpeningUpdate.resourceType,
  );

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [dialogTarget, setDialogTarget] = useState<
    { kind: "none" } | { kind: "create" } | { kind: "edit"; job: JobOpeningResponseDto }
  >({ kind: "none" });

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };
  const hasFilters = filters.q !== "" || filters.status !== "";

  const listParams = useMemo(
    () => ({
      ...(filters.q ? { q: filters.q } : {}),
      ...(filters.status ? { status: [filters.status] } : {}),
      page,
      per_page: RECRUIT_PAGE_SIZE,
    }),
    [filters, page],
  );

  const listQuery = useQuery({
    queryKey: recruitKeys.jobs.list(listParams),
    queryFn: () => recruitApi.listJobOpenings(listParams),
    enabled: canView,
  });

  const rows = listQuery.data?.data ?? [];
  const pagination = listQuery.data?.pagination;
  const total = pagination?.total ?? rows.length;
  const lastPage = Math.max(1, Math.ceil(total / RECRUIT_PAGE_SIZE));

  const columns = useMemo<ColumnDef<JobOpeningResponseDto>[]>(
    () => [
      { accessorKey: "title", header: t("list.columns.title") },
      {
        accessorKey: "recruiterName",
        header: t("list.columns.recruiter"),
        cell: ({ row }) => row.original.recruiterName ?? "—",
      },
      { accessorKey: "headcount", header: t("list.columns.headcount") },
      {
        accessorKey: "status",
        header: t("list.columns.status"),
        cell: ({ row }) => <JobOpeningStatusBadge status={row.original.status} />,
      },
    ],
    [t],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("list.title")}
        description={t("description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void listQuery.refetch()}
              disabled={listQuery.isFetching}
            >
              <RefreshCw className="mr-2 size-4" />
              {t("states.retry")}
            </Button>
            {canCreate && (
              <Button size="sm" onClick={() => setDialogTarget({ kind: "create" })}>
                <Plus className="mr-2 size-4" />
                {t("list.create")}
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Input
            placeholder={t("list.searchPlaceholder")}
            value={filters.q}
            onChange={(e) => setFilter("q", e.target.value)}
          />
        </div>
        <Select
          className="w-48"
          value={filters.status}
          onChange={(e) => setFilter("status", e.target.value as JobOpeningStatusDto | "")}
          aria-label={t("list.filterStatus")}
        >
          <option value="">{t("list.filterAll")}</option>
          {JOB_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`jobStatus.${s}`)}
            </option>
          ))}
        </Select>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setPage(1);
            }}
          >
            {t("list.clearFilters")}
          </Button>
        )}
      </div>

      {listQuery.isError ? (
        <EmptyState
          title={t("states.error")}
          action={
            <Button variant="outline" onClick={() => void listQuery.refetch()}>
              {t("states.retry")}
            </Button>
          }
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={rows}
            isLoading={listQuery.isLoading}
            pageSize={RECRUIT_PAGE_SIZE}
            onRowClick={
              canUpdate ? (row) => setDialogTarget({ kind: "edit", job: row }) : undefined
            }
            emptyState={
              <EmptyState
                title={hasFilters ? t("list.emptyFiltered") : t("list.empty")}
                action={
                  canCreate && !hasFilters ? (
                    <Button onClick={() => setDialogTarget({ kind: "create" })}>
                      <Plus className="mr-2 size-4" />
                      {t("list.create")}
                    </Button>
                  ) : undefined
                }
              />
            }
          />

          {lastPage > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <span className="text-muted-foreground">
                {page} / {lastPage}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || listQuery.isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ‹
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= lastPage || listQuery.isFetching}
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
              >
                ›
              </Button>
            </div>
          )}
        </>
      )}

      <JobOpeningFormDialog
        open={dialogTarget.kind !== "none"}
        onClose={() => setDialogTarget({ kind: "none" })}
        jobOpening={dialogTarget.kind === "edit" ? dialogTarget.job : undefined}
        onDone={() => {}}
      />
    </div>
  );
}
