/**
 * S16-SOCIAL-FE-3B (L5) — dải lỗi của lượt ĐỌC `SOCIAL-API-052` + ĐÚNG MỘT lối thoát theo `recovery` mà
 * `describeStatsError` đã quyết (component không tự suy từ status / mã):
 *  · `clearOrgUnit` — đơn vị đang lọc ngoài phạm vi ⇒ nút «Bỏ lọc đơn vị»;
 *  · `resetRange`   — khoảng ngày đang gửi bị từ chối ⇒ nút «Về mặc định»;
 *  · `retry`        — gửi lại nguyên yêu cầu có thể thành công ⇒ «Thử lại» (nút của `AdminErrorNotice`);
 *  · `none`         — 403 tầng quyền… ⇒ không nút nào: thử lại là vô ích.
 *
 * Hai lối thoát đầu ĐỔI bộ lọc (trang ghi URL mới ⇒ một lượt đọc khác), nên chúng là nút riêng đứng dưới dải,
 * không mượn chữ «Thử lại». `message` của server không có đường nào tới đây.
 */
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@mediaos/ui";
import { AdminErrorNotice } from "../../admin/components/AdminErrorNotice";
import type { StatsErrorOutcome } from "../lib/stats-errors";

export interface StatsLoadErrorProps {
  outcome: StatsErrorOutcome;
  /** Lượt «Thử lại» đang chạy mà dải vẫn còn trên màn ⇒ khoá nút. */
  isRetrying: boolean;
  onRetry: () => void;
  onClearOrgUnit: () => void;
  onResetRange: () => void;
}

export function StatsLoadError({
  outcome,
  isRetrying,
  onRetry,
  onClearOrgUnit,
  onResetRange,
}: StatsLoadErrorProps): React.ReactElement {
  const { t } = useTranslation("social");
  const { reason, recovery } = outcome;

  return (
    <div className="flex flex-col items-start gap-2">
      <AdminErrorNotice
        reason={reason}
        onRetry={recovery === "retry" ? onRetry : undefined}
        isRetrying={isRetrying}
        className="w-full"
      />
      {recovery === "clearOrgUnit" && (
        <Button type="button" variant="outline" size="sm" onClick={onClearOrgUnit}>
          {t("admin.stats.page.clearOrgUnit")}
        </Button>
      )}
      {recovery === "resetRange" && (
        <Button type="button" variant="outline" size="sm" onClick={onResetRange}>
          {t("admin.stats.page.resetRange")}
        </Button>
      )}
    </div>
  );
}
