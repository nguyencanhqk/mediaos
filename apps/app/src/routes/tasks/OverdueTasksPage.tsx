import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { companyTimeZone, taskCoreApi, taskKeys, useAuthStore, useCan } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button } from "@mediaos/ui";
import type { ListTaskCoreQueryRequest, TaskCoreResponseDto } from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import {
  byDueAtAsc,
  EMPTY_OVERDUE_FILTERS,
  filterOverdueRows,
  hasOverdueFilters,
  type OverdueDeskFilters,
} from "./overdue-desk";
import { useOverdueDeskColumns } from "./OverdueTasksPage.columns";
import { OverdueDeskToolbar } from "./OverdueTasksPage.filters";

/**
 * OverdueTasksPage — TASK-SCREEN-010 (SPEC-06 §13.10, S5-FE-TASK-6). Danh sách công việc QUÁ HẠN.
 *
 * FE-only trên BE sẵn có: `GET /tasks?overdue=true` (query param idempotent ĐÃ CÓ — task.ts). BE list
 * KHÔNG có sort param (mặc định created_at desc) và KHÔNG trả `total` ⇒ tải tối đa OVERDUE_FETCH_LIMIT
 * dòng rồi sort `due_at` TĂNG DẦN ở client (gấp nhất lên đầu) + đưa vào DataTable (phân trang client).
 * Header hiện tổng số quá hạn đã tải ("200+" khi chạm trần — hiếm ở single-company MVP; xem plan GAP).
 *
 * Gate = TASK.TASK.VIEW (read:task) — CÙNG cột đọc của TaskListPage (useTaskReadColumns). Cổng route ở
 * ProtectedRoute; useCan lặp lại ở component (deny-path khi mount trực tiếp ngoài route guard).
 *
 * S20-TASK-OVERDUEDESK-1 (US-TASK-QL-07) — «bàn xử lý»: cột «Trễ» (ngày lịch theo giờ công ty), dời hạn
 * và đổi người ngay trên dòng qua route chuyên trách (`OverdueTasksPage.columns.tsx`), lọc Dự án /
 * Người / «Tôi giao» trên các dòng đã tải (`OverdueTasksPage.filters.tsx`). Dời hạn xong: dòng chỉ rời
 * danh sách khi SERVER trả việc đã hết quá hạn — server từ chối ⇒ dòng ở lại (rollback trong control).
 */
const OVERDUE_FETCH_LIMIT = 200;
const PAGE_SIZE = 20;
const OVERDUE_QUERY: Partial<ListTaskCoreQueryRequest> = {
  overdue: true,
  limit: OVERDUE_FETCH_LIMIT,
};

function OverdueEmpty({ filters, total }: { filters: OverdueDeskFilters; total: number }) {
  const { t } = useTranslation("tasks");
  if (total === 0 || !hasOverdueFilters(filters)) {
    return (
      <EmptyState
        title={t("tasks.overdue.empty.title")}
        description={t("tasks.overdue.empty.description")}
      />
    );
  }
  const onlyMine = filters.mine && filters.project === null && filters.assignee === null;
  const key = onlyMine ? "overdueDesk.emptyMine" : "overdueDesk.emptyFiltered";
  return <EmptyState title={t(`${key}.title`)} description={t(`${key}.description`)} />;
}

export function OverdueTasksPage() {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const canView = useCan(
    TASK_CORE_ENGINE_PAIRS.READ.action,
    TASK_CORE_ENGINE_PAIRS.READ.resourceType,
  );
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const [filters, setFilters] = useState<OverdueDeskFilters>(EMPTY_OVERDUE_FILTERS);
  const timeZone = companyTimeZone();

  const { data, dataUpdatedAt, isLoading, isError, refetch } = useQuery({
    queryKey: taskKeys.list(OVERDUE_QUERY),
    queryFn: () => taskCoreApi.listTasks(OVERDUE_QUERY),
    enabled: canView,
    staleTime: 30_000,
  });

  // Server đã xác nhận hạn mới và việc HẾT quá hạn ⇒ bỏ dòng ngay (không đợi refetch của onSettled).
  // `?.`: response là dữ liệu ngoài — thiếu `task` thì giữ dòng, để refetch quyết.
  const onDeadlineSaved = useCallback(
    (saved: TaskCoreResponseDto) => {
      if (saved?.isOverdue !== false) return;
      queryClient.setQueryData<TaskCoreResponseDto[]>(taskKeys.list(OVERDUE_QUERY), (rows) =>
        rows?.filter((row) => row.id !== saved.id),
      );
    },
    [queryClient],
  );
  // «Trễ» tính theo lúc dữ liệu được tải/ghi vào cache — một mốc chung cho mọi dòng, giữ nguyên giữa
  // các lần render (đổi bộ lọc, mở picker…) thay vì một `Date` mới mỗi lần.
  const now = useMemo(() => new Date(dataUpdatedAt || Date.now()), [dataUpdatedAt]);
  const columns = useOverdueDeskColumns({ now, timeZone, onDeadlineSaved });

  const items = useMemo(() => [...(data ?? [])].sort(byDueAtAsc), [data]);
  const visible = useMemo(
    () => filterOverdueRows(items, filters, myUserId),
    [items, filters, myUserId],
  );
  const atLimit = (data?.length ?? 0) >= OVERDUE_FETCH_LIMIT;
  const countLabel = atLimit ? `${OVERDUE_FETCH_LIMIT}+` : String(items.length);

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("tasks.list.forbidden.title")}
          description={t("tasks.list.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("tasks.overdue.error.title")}
          description={t("tasks.overdue.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("tasks.overdue.title")}
        description={
          isLoading
            ? t("tasks.overdue.description")
            : t("tasks.overdue.count", { display: countLabel })
        }
        icon={AlertTriangle}
      />

      {items.length > 0 && (
        <OverdueDeskToolbar
          rows={items}
          filters={filters}
          onChange={setFilters}
          canFilterMine={myUserId !== null}
        />
      )}

      <DataTable
        columns={columns}
        data={visible}
        isLoading={isLoading}
        emptyState={<OverdueEmpty filters={filters} total={items.length} />}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
