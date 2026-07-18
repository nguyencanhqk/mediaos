import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { taskCoreApi, taskKeys, useCan } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button } from "@mediaos/ui";
import type { ListTaskCoreQueryRequest, TaskCoreResponseDto } from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { useTaskReadColumns } from "./task-columns";

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
 */
const OVERDUE_FETCH_LIMIT = 200;
const PAGE_SIZE = 20;

/** So sánh due_at TĂNG DẦN; null (không nên xảy ra với task quá hạn) xuống cuối. */
function byDueAtAsc(a: TaskCoreResponseDto, b: TaskCoreResponseDto): number {
  if (!a.dueAt) return b.dueAt ? 1 : 0;
  if (!b.dueAt) return -1;
  return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0;
}

export function OverdueTasksPage() {
  const { t } = useTranslation("tasks");
  const columns = useTaskReadColumns();
  const canView = useCan(
    TASK_CORE_ENGINE_PAIRS.READ.action,
    TASK_CORE_ENGINE_PAIRS.READ.resourceType,
  );

  const queryParams: Partial<ListTaskCoreQueryRequest> = {
    overdue: true,
    limit: OVERDUE_FETCH_LIMIT,
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: taskKeys.list(queryParams),
    queryFn: () => taskCoreApi.listTasks(queryParams),
    enabled: canView,
    staleTime: 30_000,
  });

  const items = useMemo(() => [...(data ?? [])].sort(byDueAtAsc), [data]);
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

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("tasks.overdue.empty.title")}
            description={t("tasks.overdue.empty.description")}
          />
        }
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
