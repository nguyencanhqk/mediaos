import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList, List, ListTree, Plus, RefreshCw, Target, UserRound } from "lucide-react";
import {
  companyTimeZone,
  goalApi,
  goalKeys,
  hrApi,
  hrKeys,
  meApi,
  meKeys,
  PermissionGate,
  useCan,
} from "@mediaos/web-core";
import {
  GOAL_PAGE_LIMIT_MAX,
  type GoalCoreResponseDto,
  type GoalStatusDto,
} from "@mediaos/contracts";
import { Button, DataTable, EmptyState, Input, PageHeader, Select } from "@mediaos/ui";
import {
  GOAL_ENGINE_PAIRS,
  GOAL_LEVEL_OPTIONS,
  GOAL_STATUS_OPTIONS,
  TASK_TEMPLATE_MANAGE_PAIR,
} from "./constants";
import { formatPeriod } from "./goal-format";
import {
  GOAL_PERIOD_ALL,
  GOAL_PERIOD_CHIPS,
  formatGoalPeriod,
  goalPeriodChips,
  parseGoalPeriod,
  useGoalListDefaults,
  useGoalListSearch,
  type GoalListSearch,
  type GoalPeriodRange,
} from "./goal-list-search";
import { GoalFinalizedBadge, GoalLevelBadge, GoalStatusBadge } from "./components/GoalBadges";
import { GoalProgressBar } from "./components/GoalProgressBar";
import { GoalTreeView } from "./components/GoalTreeView";
import { GoalCheckinDialog } from "./components/GoalCheckinDialog";
import { GoalCheckinDialogTrigger } from "./components/GoalCheckinDialogTrigger";

const TOGGLE_ON = "flex items-center gap-1.5 bg-primary px-3 py-2 text-sm text-primary-foreground";
const TOGGLE_OFF = "flex items-center gap-1.5 px-3 py-2 text-sm hover:bg-muted";

/** Đổi một vế của khoảng kỳ; vế kia bị bỏ nếu thành ngược chiều (URL không bao giờ mang kỳ rác). */
function withPeriodEdge(range: GoalPeriodRange, edge: "from" | "to", value: string): string {
  const next: GoalPeriodRange = { ...range, [edge]: value || undefined };
  if (next.from && next.to && next.from > next.to) {
    return formatGoalPeriod(edge === "from" ? { from: next.from } : { to: next.to });
  }
  return formatGoalPeriod(next);
}

/**
 * GOAL-SCREEN-001 (S5-GOAL-FE-1) — trang Mục tiêu: cây/danh sách theo kỳ·cấp·phòng ban·trạng thái·owner.
 * Progress từng nút NULL → "—" + cảnh báo (KHÔNG 0%, §13.2). Gate route = access:goal (ProtectedRoute);
 * trang tự gate lại: view:goal cho nội dung, create:goal cho nút Tạo (PermissionGate KHÔNG hard-code role).
 *
 * S20-GOAL-LISTURL-1 (US-GOAL-QL-03): kỳ · phòng · trạng thái · cấp · chế độ xem · «Của tôi» sống trên
 * URL (`goal-list-search.ts`); URL trống ⇒ quý hiện tại theo giờ công ty + phòng của tôi (khi phạm vi
 * `view:goal` rộng hơn Own) hoặc lựa chọn gần nhất. «Của tôi» đọc `GET /me/goals` (phụ trách HOẶC chủ
 * thể) — KHÔNG `?employeeId=` (tham số đó chỉ lọc chủ thể neo).
 *
 * Bộ lọc CLIENT duy nhất còn lại: owner (GET /goals không có ownerEmployeeId — lọc trên tập đã tải, tập
 * bị chặn ≤ GOAL_PAGE_LIMIT_MAX). Tree không có cấp/owner (GET /goals/tree chỉ nhận phòng/trạng thái/kỳ).
 *
 * S20-GOAL-QUICKCHECKIN-1 (US-GOAL-NV-91): biểu tượng Check-in ở cột cuối + trên nút cây, gate cặp RIÊNG
 * `(checkin, goal)` như `MeGoalsCard`. Hộp thoại dựng ở CẤP TRANG, NGOÀI bảng — `Dialog` không portal,
 * dựng trong ô thì mọi click trong hộp nổi bọt lên `onRowClick` của dòng (mở chi tiết).
 */
export function GoalListPage() {
  const { t } = useTranslation("goals");
  const navigate = useNavigate();
  const canView = useCan(GOAL_ENGINE_PAIRS.VIEW.action, GOAL_ENGINE_PAIRS.VIEW.resourceType);
  const canCreate = useCan(GOAL_ENGINE_PAIRS.CREATE.action, GOAL_ENGINE_PAIRS.CREATE.resourceType);
  const canCheckin = useCan(
    GOAL_ENGINE_PAIRS.CHECKIN.action,
    GOAL_ENGINE_PAIRS.CHECKIN.resourceType,
  );
  const [checkinGoal, setCheckinGoal] = useState<GoalCoreResponseDto | null>(null);

  const { search, update, replaceFilters } = useGoalListSearch();
  const ready = useGoalListDefaults(search, replaceFilters, canView);
  const chips = useMemo(() => goalPeriodChips(new Date(), companyTimeZone()), []);
  const [ownerEmployeeId, setOwnerEmployeeId] = useState("");

  const mine = search.mine === 1;
  const viewMode = search.view ?? "tree";
  const showList = mine || viewMode === "list";
  const period = useMemo(() => parseGoalPeriod(search.period) ?? {}, [search.period]);

  // Danh mục phụ trợ filter — GET /hr/lookups/departments là reference-data non-sensitive (KHÔNG cần
  // read:department). fail-soft: lỗi → không có option, filter vẫn dùng "tất cả".
  const { data: departments } = useQuery({
    queryKey: hrKeys.departments.lookup(),
    queryFn: () => hrApi.listDepartments(),
    enabled: canView,
    staleTime: 300_000,
  });
  const canReadEmployees = useCan("read", "employee");
  const { data: employeesPage } = useQuery({
    queryKey: hrKeys.employees.list({ pageSize: 100, status: "active" }),
    queryFn: () => hrApi.listEmployees({ pageSize: 100, status: "active" }),
    enabled: canView && canReadEmployees && viewMode === "list" && !mine,
    staleTime: 60_000,
  });

  const { listParams, treeParams, mineParams } = useMemo(() => {
    const periodParams = {
      ...(period.from ? { periodFrom: period.from } : {}),
      ...(period.to ? { periodTo: period.to } : {}),
    };
    const statusParam = search.status ? { status: search.status } : {};
    const departmentParam = search.departmentId ? { departmentId: search.departmentId } : {};
    return {
      listParams: {
        ...(search.level ? { level: search.level } : {}),
        ...departmentParam,
        ...statusParam,
        ...periodParams,
        limit: GOAL_PAGE_LIMIT_MAX,
      },
      treeParams: { ...departmentParam, ...statusParam, ...periodParams },
      mineParams: { ...statusParam, ...periodParams, limit: GOAL_PAGE_LIMIT_MAX },
    };
  }, [period, search.status, search.departmentId, search.level]);

  const listQuery = useQuery({
    queryKey: goalKeys.list(listParams),
    queryFn: () => goalApi.listGoals(listParams),
    enabled: ready && !mine && viewMode === "list",
    staleTime: 30_000,
  });
  const treeQuery = useQuery({
    queryKey: goalKeys.tree(treeParams),
    queryFn: () => goalApi.getTree(treeParams),
    enabled: ready && !mine && viewMode === "tree",
    staleTime: 30_000,
  });
  const mineQuery = useQuery({
    queryKey: meKeys.goals(mineParams),
    queryFn: () => meApi.getGoals(mineParams),
    enabled: ready && mine,
    staleTime: 30_000,
  });

  const listRows = useMemo(() => {
    const rows = listQuery.data ?? [];
    return ownerEmployeeId ? rows.filter((g) => g.ownerEmployeeId === ownerEmployeeId) : rows;
  }, [listQuery.data, ownerEmployeeId]);

  const openDetail = (goalId: string) =>
    void navigate({ to: "/goals/$goalId", params: { goalId } });

  const columns = useGoalColumns(canCheckin ? setCheckinGoal : undefined);

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

  const activeQuery = mine ? mineQuery : viewMode === "list" ? listQuery : treeQuery;

  const createButton = canCreate ? (
    <Button size="sm" onClick={() => void navigate({ to: "/goals/new" })}>
      <Plus className="mr-2 h-4 w-4" />
      {t("list.create")}
    </Button>
  ) : null;

  const listEmpty = (
    <EmptyState
      icon={Target}
      title={t("list.empty.title")}
      description={t("list.empty.description")}
      action={createButton}
    />
  );
  const mineEmpty = (
    <EmptyState
      icon={Target}
      title={t("list.mine.empty.title")}
      description={t("list.mine.empty.description")}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          {createButton}
          {search.period !== chips.previous && (
            <Button variant="outline" size="sm" onClick={() => update({ period: chips.previous })}>
              {t("list.mine.empty.previousPeriod")}
            </Button>
          )}
        </div>
      }
    />
  );

  const clearFilters = () => {
    setOwnerEmployeeId("");
    update({
      period: GOAL_PERIOD_ALL,
      departmentId: undefined,
      status: undefined,
      level: undefined,
      mine: undefined,
      risk: undefined,
    });
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={Target}
        actions={
          <div className="flex flex-wrap gap-2">
            {/* S20-GOAL-DECOMPOSE-1 (US-GOAL-QL-08) — lối vào danh mục việc mẫu (route không có mục
                sidebar). Thiếu cặp ⇒ không có nút; gõ URL thì trang mẫu tự báo không đủ quyền. */}
            <PermissionGate
              action={TASK_TEMPLATE_MANAGE_PAIR.action}
              resourceType={TASK_TEMPLATE_MANAGE_PAIR.resourceType}
            >
              <Button
                variant="outline"
                size="sm"
                data-testid="goal-list-templates"
                onClick={() => void navigate({ to: "/goals/templates" })}
              >
                <ClipboardList className="mr-2 h-4 w-4" />
                {t("list.templates")}
              </Button>
            </PermissionGate>
            {createButton}
          </div>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <ViewToggle search={search} onChange={update} />
          <PeriodChips
            value={search.period}
            chips={chips}
            onSelect={(p) => update({ period: p })}
          />

          <FilterField label={t("list.filters.periodFrom")}>
            <Input
              type="date"
              value={period.from ?? ""}
              onChange={(e) => update({ period: withPeriodEdge(period, "from", e.target.value) })}
            />
          </FilterField>
          <FilterField label={t("list.filters.periodTo")}>
            <Input
              type="date"
              value={period.to ?? ""}
              onChange={(e) => update({ period: withPeriodEdge(period, "to", e.target.value) })}
            />
          </FilterField>

          {!mine && (
            <FilterField label={t("list.filters.department")}>
              <Select
                value={search.departmentId ?? ""}
                onChange={(e) => update({ departmentId: e.target.value || undefined })}
              >
                <option value="">{t("list.filters.allDepartments")}</option>
                {(departments ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </FilterField>
          )}

          <FilterField label={t("list.filters.status")}>
            <Select
              value={search.status ?? ""}
              onChange={(e) =>
                update({ status: (e.target.value || undefined) as GoalStatusDto | undefined })
              }
            >
              <option value="">{t("list.filters.allStatuses")}</option>
              {GOAL_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          </FilterField>

          {viewMode === "list" && !mine && (
            <>
              <FilterField label={t("list.filters.level")}>
                <Select
                  value={search.level ?? ""}
                  onChange={(e) =>
                    update({
                      level: (e.target.value || undefined) as GoalListSearch["level"],
                    })
                  }
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
                  value={ownerEmployeeId}
                  onChange={(e) => setOwnerEmployeeId(e.target.value)}
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

          <Button variant="outline" size="sm" onClick={clearFilters}>
            {t("list.filters.clear")}
          </Button>
        </div>
      </PageHeader>

      {!ready ? (
        <ListSkeleton />
      ) : activeQuery.isError ? (
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
      ) : showList ? (
        <DataTable
          columns={columns}
          data={mine ? (mineQuery.data ?? []) : listRows}
          isLoading={activeQuery.isLoading}
          onRowClick={(row) => openDetail(row.id)}
          pageSize={20}
          emptyState={mine ? mineEmpty : listEmpty}
        />
      ) : treeQuery.isLoading ? (
        <ListSkeleton />
      ) : (treeQuery.data ?? []).length === 0 ? (
        listEmpty
      ) : (
        <div className="rounded-lg border border-border p-2">
          <GoalTreeView
            nodes={treeQuery.data ?? []}
            onSelect={openDetail}
            canCheckin={canCheckin}
            onCheckin={setCheckinGoal}
          />
        </div>
      )}

      {checkinGoal && <GoalCheckinDialog goal={checkinGoal} onClose={() => setCheckinGoal(null)} />}
    </div>
  );
}

/** `onCheckin` có ⇔ người xem có cặp `(checkin, goal)` — không có thì KHÔNG có cột Check-in. */
function useGoalColumns(
  onCheckin?: (goal: GoalCoreResponseDto) => void,
): ColumnDef<GoalCoreResponseDto>[] {
  const { t } = useTranslation("goals");
  return useMemo<ColumnDef<GoalCoreResponseDto>[]>(
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
      ...(onCheckin
        ? [
            {
              id: "checkin",
              header: () => <span className="sr-only">{t("list.columns.checkin")}</span>,
              cell: ({ row }) => (
                <GoalCheckinDialogTrigger goal={row.original} onCheckin={onCheckin} />
              ),
            } satisfies ColumnDef<GoalCoreResponseDto>,
          ]
        : []),
    ],
    [t, onCheckin],
  );
}

/** Cây · Danh sách · «Của tôi» — «Của tôi» luôn hiện dạng danh sách (nguồn `/me/goals` là tập phẳng). */
function ViewToggle({
  search,
  onChange,
}: {
  search: GoalListSearch;
  onChange: (patch: Partial<GoalListSearch>) => void;
}) {
  const { t } = useTranslation("goals");
  const mine = search.mine === 1;
  const viewMode = search.view ?? "tree";
  const options = [
    {
      key: "tree",
      pressed: !mine && viewMode === "tree",
      icon: ListTree,
      label: t("list.view.tree"),
      patch: { view: undefined, mine: undefined },
    },
    {
      key: "list",
      pressed: !mine && viewMode === "list",
      icon: List,
      label: t("list.view.list"),
      patch: { view: "list" as const, mine: undefined },
    },
    {
      key: "mine",
      pressed: mine,
      icon: UserRound,
      label: t("list.view.mine"),
      patch: { mine: mine ? undefined : (1 as const) },
    },
  ];
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border">
      {options.map(({ key, pressed, icon: Icon, label, patch }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(patch)}
          className={pressed ? TOGGLE_ON : TOGGLE_OFF}
          aria-pressed={pressed}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

/** Chip «Kỳ trước / Quý này / Năm nay» — nhấn = khoảng tường minh trên URL. */
function PeriodChips({
  value,
  chips,
  onSelect,
}: {
  value: string | undefined;
  chips: ReturnType<typeof goalPeriodChips>;
  onSelect: (period: string) => void;
}) {
  const { t } = useTranslation("goals");
  return (
    <div role="group" aria-label={t("list.periodChips.label")} className="flex flex-wrap gap-1.5">
      {GOAL_PERIOD_CHIPS.map((chip) => (
        <button
          key={chip}
          type="button"
          aria-pressed={value === chips[chip]}
          onClick={() => onSelect(chips[chip])}
          className={
            value === chips[chip]
              ? "rounded-full border border-primary bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              : "rounded-full border border-border px-3 py-1.5 text-sm hover:bg-muted"
          }
        >
          {t(`list.periodChips.${chip}`)}
        </button>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2 p-2">
      <div className="h-10 w-full animate-pulse rounded bg-muted" />
      <div className="h-10 w-11/12 animate-pulse rounded bg-muted" />
      <div className="h-10 w-10/12 animate-pulse rounded bg-muted" />
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
