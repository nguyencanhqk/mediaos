/**
 * AdjustmentStatusBadge — badge trạng thái đơn điều chỉnh (FSM DB-04 §7.6).
 * Không hard-code label — dùng t("adjustment.status.*"). Namespace "attendance" (tái dùng, KHÔNG tách ns mới).
 */
import { useTranslation } from "react-i18next";
import { Badge } from "@mediaos/ui";

export const ADJUSTMENT_STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  Draft: "secondary",
  Pending: "default",
  Approved: "default",
  Rejected: "destructive",
  Cancelled: "outline",
};

interface AdjustmentStatusBadgeProps {
  status: string | null | undefined;
}

export function AdjustmentStatusBadge({ status }: AdjustmentStatusBadgeProps) {
  const { t } = useTranslation("attendance");
  if (!status) return <span className="text-muted-foreground">—</span>;
  const label = t(`adjustment.status.${status}`, { defaultValue: status });
  const variant = ADJUSTMENT_STATUS_VARIANT[status] ?? "secondary";
  return <Badge variant={variant}>{label}</Badge>;
}
