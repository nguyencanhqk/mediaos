import { useTranslation } from "react-i18next";
import { Button } from "@mediaos/ui";
import type { TaskActivityLogResponseDto } from "@mediaos/contracts";
import { ACTIVITY_ACTION_LABEL_KEYS } from "./activity-labels";
import { extractActivityChange, type ActivityChange } from "./activity-change";

/**
 * ActivityFeedList — THÂN trình bày dùng chung của timeline hoạt động (S5-TASK-WORKSPACE-1):
 * loading / error+retry / danh sách dòng (actor + message|nhãn action + thời gian) / empty +
 * phân trang prev/next. TaskActivityTimeline (cấp task, TASK-API-602) và ProjectActivityTimeline
 * (cấp dự án, TASK-API-601) chỉ giữ gate + query + Card/tiêu đề riêng — sửa UI feed 1 chỗ.
 *
 * Nhãn action tra ACTIVITY_ACTION_LABEL_KEYS; action lạ → in thẳng mã (không vỡ UI).
 * `message` từ server (đã qua DTO) ưu tiên hơn nhãn.
 *
 * S5-TASK-DETAIL-1 (GAP 1, SPEC-06 §13.12): dòng "cũ → mới" dưới mỗi mục đổi cột/trạng thái/
 * assignee/hạn/ưu tiên — trích qua extractActivityChange; status/priority dịch qua i18n enum,
 * dueAt format vi-VN, state/assignee là TÊN ĐÃ LƯU/ENRICH từ server. Thiếu vế → "—".
 */
export function ActivityFeedList({
  items,
  isLoading,
  isError,
  onRetry,
  page,
  onPageChange,
  pageSize,
  errorText,
  emptyText,
}: {
  items: TaskActivityLogResponseDto[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  page: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  errorText: string;
  emptyText: string;
}) {
  const { t } = useTranslation("tasks");
  const hasNext = items.length === pageSize;

  const formatChangeValue = (change: ActivityChange, value: string | null): string => {
    if (value === null) return "—";
    if (change.kind === "status") return t(`tasks.status.${value}`, { defaultValue: value });
    if (change.kind === "priority") return t(`tasks.priority.${value}`, { defaultValue: value });
    if (change.kind === "dueAt") {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? value : d.toLocaleString("vi-VN");
    }
    return value; // state/assignee: tên đã lưu/enrich từ server
  };

  if (isLoading) return <div className="h-16 animate-pulse rounded bg-muted" />;

  if (isError) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">{errorText}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("actions.retry", { ns: "common" })}
        </Button>
      </div>
    );
  }

  return (
    <>
      {items.length > 0 ? (
        <ul className="space-y-2 border-l border-border pl-3">
          {items.map((log) => {
            const labelKey = ACTIVITY_ACTION_LABEL_KEYS[log.action];
            const label = labelKey ? t(labelKey) : log.action;
            const change = extractActivityChange(log);
            return (
              <li key={log.id} className="text-sm">
                <p className="text-foreground">
                  <span className="font-medium">
                    {log.actorName ?? t("tasks.detail.activity.systemActor")}
                  </span>{" "}
                  {log.message ?? label}
                </p>
                {change && (
                  <p className="text-xs text-muted-foreground">
                    <span>{formatChangeValue(change, change.oldValue)}</span>
                    <span aria-hidden="true"> → </span>
                    <span className="font-medium text-foreground">
                      {formatChangeValue(change, change.newValue)}
                    </span>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {new Date(log.createdAt).toLocaleString("vi-VN")}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      )}

      {(page > 1 || hasNext) && (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>{page}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(Math.max(1, page - 1))}
            >
              {t("pagination.prev", { ns: "common" })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext}
              onClick={() => onPageChange(page + 1)}
            >
              {t("pagination.next", { ns: "common" })}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
