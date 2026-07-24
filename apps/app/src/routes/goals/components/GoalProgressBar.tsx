import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@mediaos/ui";
import { clampPercent, formatProgress, isUnmeasured } from "../goal-format";

interface GoalProgressBarProps {
  /** `null` = CHƯA ĐO (SPEC-10 §13.2) → hiển thị "—" + cảnh báo, KHÔNG vẽ 0%. */
  progressPercent: number | null;
  /** Thu gọn (dùng trong bảng/cây): ẩn dòng cảnh báo chữ, chỉ giữ icon. */
  compact?: boolean;
  className?: string;
}

/**
 * S5-GOAL-FE-1 — thanh tiến độ mục tiêu. LUẬT §13.2: progress NULL = "chưa đo" ⇒ "—" + cảnh báo
 * "chưa gắn việc/chưa có dữ liệu" (icon warning), TUYỆT ĐỐI KHÔNG vẽ thanh 0% (0% là thông tin sai).
 * progress 0 (đã đo, thực 0%) ⇒ vẫn vẽ thanh rỗng + "0%".
 */
export function GoalProgressBar({
  progressPercent,
  compact = false,
  className,
}: GoalProgressBarProps) {
  const { t } = useTranslation("goals");
  const unmeasured = isUnmeasured(progressPercent);

  if (unmeasured) {
    // a11y: aria-label mang NGHĨA (cảnh báo "chưa đo") — không phải "—" trơ. Ở compact mode phần chữ
    // cảnh báo chỉ nằm trong title (chuột) nên screen-reader phải nghe được nghĩa qua aria-label này.
    return (
      <div
        className={cn("flex items-center gap-2", className)}
        aria-label={t("progress.unmeasuredWarning")}
      >
        <span className="font-medium text-muted-foreground" aria-hidden>
          {t("progress.unmeasured")}
        </span>
        <span
          className="flex items-center gap-1 text-xs text-warning"
          title={t("progress.unmeasuredWarning")}
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {!compact && <span aria-hidden>{t("progress.unmeasuredWarning")}</span>}
        </span>
      </div>
    );
  }

  const width = clampPercent(progressPercent);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="h-2 w-full min-w-16 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(width)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">
        {formatProgress(progressPercent)}
      </span>
    </div>
  );
}
