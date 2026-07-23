/**
 * TrainingProgressBar — thanh tiến độ % dùng chung cho card/trang Đào tạo (S5-LMS-FE-1).
 *
 * Không có primitive Progress trong @mediaos/ui — dựng bằng theme token (bg-muted nền + bg-brand thanh),
 * KHÔNG hard-code hex (memory: fe-theme-light-dark-system). `percent` đã được clamp 0–100 ở caller
 * (training-format.clampPercent). role=progressbar + aria-* để đọc màn hình + test.
 */
interface TrainingProgressBarProps {
  /** 0–100, đã clamp. */
  percent: number;
  className?: string;
}

export function TrainingProgressBar({ percent, className }: TrainingProgressBarProps) {
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`h-2 w-full overflow-hidden rounded-full bg-muted ${className ?? ""}`}
    >
      <div
        className="h-full rounded-full bg-brand transition-all"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
