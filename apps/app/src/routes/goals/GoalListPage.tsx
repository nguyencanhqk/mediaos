import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { List, ListTree, Plus, RefreshCw, Target } from "lucide-react";
import { goalApi, goalKeys, hrApi, hrKeys, useCan } from "@mediaos/web-core";
import {
  GOAL_PAGE_LIMIT_MAX,
  type GoalCoreResponseDto,
  type GoalStatusDto,
  type GoalLevelDto,
} from "@mediaos/contracts";
import { Button, DataTable, EmptyState, Input, PageHeader, Select } from "@mediaos/ui";
import { GOAL_ENGINE_PAIRS, GOAL_LEVEL_OPTIONS, GOAL_STATUS_OPTIONS } from "./constants";
import { formatPeriod } from "./goal-format";
import { GoalFinalizedBadge, GoalLevelBadge, GoalStatusBadge } from "./components/GoalBadges";
import { GoalProgressBar } from "./components/GoalProgressBar";
import { GoalTreeView } from "./components/GoalTreeView";

type ViewMode = "tree" | "list";

interface GoalFilters {
  periodFrom: string;
  periodTo: string;
  level: GoalLevelDto | "";
  departmentId: string;
  status: GoalStatusDto | "";
  ownerEmployeeId: string;
}

const EMPTY_FILTERS: GoalFilters = {
  periodFrom: "",
  periodTo: "",
  level: "",
  departmentId: "",
  status: "",
  ownerEmployeeId: "",
};

/**
 * GOAL-SCREEN-001 (S5-GOAL-FE-1) — trang Mục tiêu: cây/danh sách theo kỳ·cấp·phòng ban·trạng thái·owner.
 * Progress từng nút NULL → "—" + cảnh báo (KHÔNG 0%, §13.2). Gate route = access:goal (ProtectedRoute);
 * trang tự gate lại: view:goal cho nội dung, create:goal cho nút Tạo (PermissionGate KHÔNG hard-code role).
 *
 * Bộ lọc SERVER: kỳ/phòng/trạng thái (cả 2 view) + cấp (list). Bộ lọc CLIENT: owner (GET /goals không có
 * ownerEmployeeId — lọc trên tập đã tải, tập bị chặn ≤ GOAL_PAGE_LIMIT_MAX). Tree không có cấp/owner
 * (cấu trúc — GET /goals/tree chỉ nhận phòng/trạng thái/kỳ).
 */
export function GoalListPage() {
  const { t } = useTranslation("goals");
  const navigate = useNavigate();
  const canView = useCan(GOAL_ENGINE_PAIRS.VIEW.action, GOAL_ENGINE_PAIRS.VIEW.resourceType);
  const canCreate = useCan(GOAL_ENGINE_PAIRS.CREATE.action, GOAL_ENGINE_PAIRS.CREATE.resourceType);

  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [filters, setFilters] = useState<GoalFilters>(EMPTY_FILTERS);
  const setFilter = <K extends keyof GoalFilters>(key: K, value: GoalFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  // Danh mục phụ trợ filter — GET /hr/lookups/departments là reference-data non-sensitive (KHÔNG cần
  // read:department). fail-soft: lỗi → không có option, filter vẫn dùng "tất cả".
  const { data: departments } = useQuery({
    queryKey: hrKeys.departments.list(),
    queryFn: () => hrApi.listDepartments(),
    enabled: canView,
    staleTime: 300_000,
  });
  const canReadEmployees = useCan("read", "employee");
  const { data: employeesPage } = useQuery({
    queryKey: hrKeys.employees.list({ pageSize: 100, status: "active" }),
    queryFn: () => hrApi.listEmployees({ pageSize: 100, status: "active" }),
    enabled: canView && canReadEmployees && viewMode === "list",
    staleTime: 60_000,
  });

  // Bộ lọc gửi server. periodFrom/periodTo/departmentId/status áp cho CẢ 2 view; level chỉ list.
  const listParams = useMemo(
    () => ({
      ...(filters.level ? { level: filters.level } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.periodFrom ? { periodFrom: filters.periodFrom } : {}),
      ...(filters.periodTo ? { periodTo: filters.periodTo } : {}),
      limit: GOAL_PAGE_LIMIT_MAX,
    }),
    [filters.level, filters.departmentId, filters.status, filters.periodFrom, filters.periodTo],
  );
  const treeParams = useMemo(
    () => ({
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.periodFrom ? { periodFrom: filters.periodFrom } : {}),
      ...(filters.periodTo ? { periodTo: filters.periodTo } : {}),
    }),
    [filters.departmentId, filters.status, filters.periodFrom, filters.periodTo],
  );

  const listQuery = useQuery({
    queryKey: goalKeys.list(listParams),
    queryFn: () => goalApi.listGoals(listParams),
    enabled: canView && viewMode === "list",
    staleTime: 30_000,
  });
  const treeQuery = useQuery({
    queryKey: goalKeys.tree(treeParams),
    queryFn: () => goalApi.getTree(treeParams),
    enabled: canView && viewMode === "tree",
    staleTime: 30_000,
  });

  // Owner: lọc CLIENT (GET /goals không nhận ownerEmployeeId).
  const listRows = useMemo(() => {
    const rows = listQuery.data ?? [];
    return filters.ownerEmployeeId
      ? rows.filter((g) => g.ownerEmployeeId === filters.ownerEmployeeId)
      : rows;
  }, [listQuery.data, filters.ownerEmployeeId]);

  const openDetail = (goalId: string) =>
    void navigate({ to: "/goals/$goalId", params: { goalId } });

  const columns = useMemo<ColumnDef<GoalCoreResponseDto>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("list.columns.name"),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-foreground">{row.original.name}</span>
            <span className="text-xs text-muted-foreground">{row.original.goalCode}</span>
          </div>
        ),
      },
      {
        accessorKey: "level",
        header: t("list.columns.level"),
        cell: ({ row }) => <GoalLevelBadge level={row.original.level} />,
      },
      {
        id: "period",
        header: t("list.columns.period"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {formatPeriod(row.original.periodStart, row.original.periodEnd)}
          </span>
        ),
      },
      {
        id: "progress",
        header: t("list.columns.progress"),
        cell: ({ row }) => (
          <div className="w-44">
            <GoalProgressBar progressPercent={row.original.progressPercent} compact />
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: t("list.columns.status"),
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <GoalStatusBadge status={row.original.status} />
            {row.original.finalizedAt && <GoalFinalizedBadge />}
          </div>
        ),
      },
    ],
    [t],
  );

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Target}
          title={t("list.forbidden.title")}
          description={t("list.forbidden.description")}
        />
      </div>
    );
  }

  const activeQuery = viewMode === "list" ? listQuery : treeQuery;

  const createButton = canCreate ? (
    <Button size="sm" onClick={() => void navigate({ to: "/goals/new" })}>
      <Plus className="mr-2 h-4 w-4" />
      {t("list.create")}
    </Button>
  ) : null;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={Target}
        actions={createButton}
      >
        <div className="flex flex-wrap items-end gap-3">
          {/* Toggle cây / danh sách */}
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            <button
              type="button"
              onClick={() => setViewMode("tree")}
              className={
                viewMode === "tree"
                  ? "flex items-center gap-1.5 bg-primary px-3 py-2 text-sm text-primary-foreground"
                  : "flex items-center gap-1.5 px-3 py-2 text-sm hover:bg-muted"
              }
              aria-pressed={viewMode === "tree"}
            >
              <ListTree className="h-4 w-4" />
              {t("list.view.tree")}
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={
                viewMode === "list"
                  ? "flex items-center gap-1.5 bg-primary px-3 py-2 text-sm text-primary-foreground"
                  : "flex items-center gap-1.5 px-3 py-2 text-sm hover:bg-muted"
              }
              aria-pressed={viewMode === "list"}
            >
              <List className="h-4 w-4" />
              {t("list.view.list")}
            </button>
          </div>

          <FilterField label={t("list.filters.periodFrom")}>
            <Input
              type="date"
              value={filters.periodFrom}
              onChange={(e) => setFilter("periodFrom", e.target.value)}
            />
          </FilterField>
          <FilterField label={t("list.filters.periodTo")}>
            <Input
              type="date"
              value={filters.periodTo}
              onChange={(e) => setFilter("periodTo", e.target.value)}
            />
          </FilterField>

          <FilterField label={t("list.filters.department")}>
            <Select
              value={filters.departmentId}
              onChange={(e) => setFilter("departmentId", e.target.value)}
            >
              <option value="">{t("list.filters.allDepartments")}</option>
              {(departments ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </FilterField>

          <FilterField label={t("list.filters.status")}>
            <Select
              value={filters.status}
              onChange={(e) => setFilter("status", e.target.value as GoalStatusDto | "")}
            >
              <option value="">{t("list.filters.allStatuses")}</option>
              {GOAL_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          </FilterField>

          {viewMode === "list" && (
            <>
              <FilterField label={t("list.filters.level")}>
                <Select
                  value={filters.level}
                  onChange={(e) => setFilter("level", e.target.value as GoalLevelDto | "")}
                >
                  <option value="">{t("list.filters.allLevels")}</option>
                  {GOAL_LEVEL_OPTIONS.map((lv) => (
                    <option key={lv} value={lv}>
                      {t(`level.${lv}`)}
                    </option>
                  ))}
                </Select>
              </FilterField>
              <FilterField label={t("list.filters.owner")}>
                <Select
                  value={filters.ownerEmployeeId}
                  onChange={(e) => setFilter("ownerEmployeeId", e.target.value)}
                >
                  <option value="">{t("list.filters.ownerPlaceholder")}</option>
                  {(employeesPage?.items ?? []).map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.fullName}
                    </option>
                  ))}
                </Select>
              </FilterField>
            </>
          )}

          <Button variant="outline" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
            {t("list.filters.clear")}
          </Button>
        </div>
      </PageHeader>

      {activeQuery.isError ? (
        <EmptyState
          icon={Target}
          title={t("list.error.title")}
          description={t("list.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void activeQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          }
        />
      ) : viewMode === "list" ? (
        <DataTable
          columns={columns}
          data={listRows}
          isLoading={listQuery.isLoading}
          onRowClick={(row) => openDetail(row.id)}
          pageSize={20}
          emptyState={
            <EmptyState
              icon={Target}
              title={t("list.empty.title")}
              description={t("list.empty.description")}
              action={createButton}
            />
          }
        />
      ) : treeQuery.isLoading ? (
        <div className="space-y-2 p-2">
          <div className="h-10 w-full animate-pulse rounded bg-muted" />
          <div className="h-10 w-11/12 animate-pulse rounded bg-muted" />
          <div className="h-10 w-10/12 animate-pulse rounded bg-muted" />
        </div>
      ) : (treeQuery.data ?? []).length === 0 ? (
        <EmptyState
          icon={Target}
          title={t("list.empty.title")}
          description={t("list.empty.description")}
          action={createButton}
        />
      ) : (
        <div className="rounded-lg border border-border p-2">
          <GoalTreeView nodes={treeQuery.data ?? []} onSelect={openDetail} />
        </div>
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}
