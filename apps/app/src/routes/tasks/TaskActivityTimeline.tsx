import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { taskCollabApi, taskKeys, ApiError } from "@mediaos/web-core";
// Card không còn dùng trực tiếp — vỏ do PanelBody quyết (embedded hay không).
import { ActivityFeedList } from "./ActivityFeedList";
import { PanelBody } from "./PanelBody";

const PAGE_SIZE = 20;

/**
 * TaskActivityTimeline — nhật ký hoạt động task (S4-FE-TASK-3, SPEC-06 §13.12/§14.19, TASK-API-602).
 *
 * S5-TASK-DETAIL-1 (GAP 2, DECISIONS-04 D-29): BỎ gate client `useCanExact('view','task-audit-log')`
 * — route server đổi guard sang `read:task` + tự quyết theo NGƯỜI LIÊN QUAN (assignee/creator/
 * reporter/watcher) HOẶC pair audit đầy đủ. Ai mở được trang chi tiết (read:task) đều thử tải;
 * server 403 (không liên quan, không pair) → ẨN HẲN card (mirror hành vi ẩn cũ — không hiện khối
 * "không có quyền" gây nhiễu). Client KHÔNG tự suy involvement — server là người quyết (CLAUDE.md §5).
 * 403/404 KHÔNG retry (kết quả xác định); lỗi khác giữ retry mặc định.
 *
 * S5-TASK-WORKSPACE-1: thân render (loading/error/list/empty + phân trang) ở `ActivityFeedList`
 * dùng chung với ProjectActivityTimeline (feed dự án TASK-API-601 — GIỮ gate sensitive, xem D-29);
 * bảng nhãn action ở `activity-labels.ts`. Key i18n GIỮ NGUYÊN.
 */
export function TaskActivityTimeline({
  taskId,
  embedded = false,
}: {
  taskId: string;
  /** Trong tab ⇒ bỏ vỏ Card + tiêu đề (nhãn tab đã nói). Xem PanelBody. */
  embedded?: boolean;
}) {
  const { t } = useTranslation("tasks");
  const [page, setPage] = useState(1);
  const queryParams = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: taskKeys.activity(taskId, queryParams),
    queryFn: () => taskCollabApi.listActivity(taskId, queryParams),
    staleTime: 30_000,
    // KHÔNG retry ngầm: 403/404 là kết quả xác định (retry chỉ trì hoãn việc ẩn card), lỗi khác đã
    // có nút "Thử lại" tường minh trong ActivityFeedList — deterministic cho cả test lẫn runtime.
    retry: false,
  });

  // Server từ chối (không liên quan + không pair audit) → ẩn hẳn mục lịch sử.
  if (isError && error instanceof ApiError && error.status === 403) return null;

  return (
    <PanelBody embedded={embedded}>
      {!embedded && (
        <h3 className="text-sm font-semibold text-muted-foreground">
          {t("tasks.detail.activity.title")}
        </h3>
      )}
      <ActivityFeedList
        items={data ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        page={page}
        onPageChange={setPage}
        pageSize={PAGE_SIZE}
        errorText={t("tasks.detail.activity.errors.loadFailed")}
        emptyText={t("tasks.detail.activity.empty")}
      />
    </PanelBody>
  );
}
