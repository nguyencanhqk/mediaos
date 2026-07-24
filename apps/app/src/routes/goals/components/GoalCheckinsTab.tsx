import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { goalApi, goalKeys } from "@mediaos/web-core";
import type { GoalUpdateResponseDto } from "@mediaos/contracts";
import { Badge, Button, EmptyState } from "@mediaos/ui";
import { GOAL_UPDATES_PAGE_SIZE } from "../constants";
import { formatProgress } from "../goal-format";
import { SimpleTable, TabError, TabSkeleton } from "./GoalTabPrimitives";

/**
 * S5-GOAL-FE-2 — tab "Lịch sử check-in" (GOAL-API-008), tách khỏi GoalDetailPage.tsx + THÊM phân trang.
 *
 * `goal_updates` là sổ APPEND-ONLY (DB-11 §6.2): tab này CHỈ ĐỌC — không có nút sửa/xoá dòng lịch sử,
 * và cũng không được thêm (mất dấu vết là mất luôn lý do vì sao con số đổi).
 *
 * PHÂN TRANG PREV/NEXT THUẦN: `GET /goals/:id/updates` trả MẢNG TRẦN, KHÔNG có `total` ⇒ không suy được
 * số trang. Quy ước duy nhất đúng với dữ liệu đang có: trả về đủ `limit` dòng ⇒ CÓ THỂ còn trang sau
 * (mirror TaskActivityTimeline). Bịa tổng số trang từ dữ liệu không có là hiển thị số sai.
 */
export function GoalCheckinsTab({ goalId, active }: { goalId: string; active: boolean }) {
  const { t } = useTranslation("goals");
  const [page, setPage] = useState(0);
  const offset = page * GOAL_UPDATES_PAGE_SIZE;

  const query = useQuery({
    queryKey: goalKeys.updates(goalId, { limit: GOAL_UPDATES_PAGE_SIZE, offset }),
    queryFn: () => goalApi.listUpdates(goalId, { limit: GOAL_UPDATES_PAGE_SIZE, offset }),
    enabled: active,
    staleTime: 30_000,
  });

  if (query.isLoading) return <TabSkeleton />;
  if (query.isError) return <TabError message={t("detail.checkins.error")} />;

  const updates = query.data ?? [];
  if (updates.length === 0 && page === 0) {
    return (
      <EmptyState
        title={t("detail.checkins.empty.title")}
        description={t("detail.checkins.empty.description")}
      />
    );
  }

  const hasNext = updates.length === GOAL_UPDATES_PAGE_SIZE;

  return (
    <div className="space-y-3">
      <SimpleTable
        head={[
          t("detail.checkins.columns.type"),
          t("detail.checkins.columns.progress"),
          t("detail.checkins.columns.confidence"),
          t("detail.checkins.columns.note"),
          t("detail.checkins.columns.at"),
        ]}
      >
        {updates.map((u: GoalUpdateResponseDto) => (
          <tr key={u.id} className="border-t border-border align-top">
            <td className="px-3 py-2">
              <Badge variant={u.updateType === "reopen" ? "warning" : "muted"}>
                {t(`detail.checkins.type.${u.updateType}`)}
              </Badge>
            </td>
            {/* formatProgress: NULL = "—" (chưa đo), KHÔNG in "0%" (SPEC-10 §13.2). */}
            <td className="px-3 py-2 text-sm tabular-nums">
              {formatProgress(u.oldProgressPercent)} → {formatProgress(u.newProgressPercent)}
            </td>
            <td className="px-3 py-2 text-sm text-muted-foreground">
              {u.confidence === null ? "—" : `${u.confidence}%`}
            </td>
            <td className="px-3 py-2 text-sm text-foreground">{u.note ?? "—"}</td>
            <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
              {new Date(u.createdAt).toLocaleString("vi-VN")}
            </td>
          </tr>
        ))}
      </SimpleTable>

      <div
        data-testid="goal-checkins-pager"
        className="flex items-center justify-end gap-2 text-xs text-muted-foreground"
      >
        <span>{t("pagination.page", { page: page + 1 })}</span>
        <Button
          variant="outline"
          size="sm"
          data-testid="goal-checkins-prev"
          disabled={page === 0 || query.isFetching}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          {t("pagination.prev")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="goal-checkins-next"
          disabled={!hasNext || query.isFetching}
          onClick={() => setPage((p) => p + 1)}
        >
          {t("pagination.next")}
        </Button>
      </div>
    </div>
  );
}
