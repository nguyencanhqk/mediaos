/**
 * AttendanceStatusBadge — badge tái dùng cho trạng thái chấm công (TitleCase DB-04).
 * Trích từ AttendanceStatusCard (S3-FE-ATT-1) để dùng chung ở My/Team/Detail page.
 *
 * Không hard-code label — dùng t("attendance.status.*").
 * Variant theo STATUS_VARIANT (DB-04 TitleCase) hoặc 'secondary' khi không khớp.
 */
import { useTranslation } from "react-i18next";
import { Badge } from "@mediaos/ui";

// ── Status → variant map (DB-04 TitleCase) ────────────────────────────────────
// Nguồn sự thật: SPEC-04 §9 + ATT_STATUS constants.ts.
export const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  "Not Checked-in": "secondary",
  "Checked-in": "default",
  "Checked-out": "default",
  Present: "default",
  Late: "destructive",
  "Early Leave": "destructive",
  "Missing Hours": "destructive",
  "Missing Check-in": "destructive",
  "Missing Check-out": "destructive",
  Absent: "destructive",
  Leave: "outline",
  "Remote Work": "outline",
  "Auto Attendance": "outline",
  Adjusted: "secondary",
  "Pending Adjustment": "secondary",
  Invalid: "destructive",
};

interface AttendanceStatusBadgeProps {
  status: string | null | undefined;
}

export function AttendanceStatusBadge({ status }: AttendanceStatusBadgeProps) {
  const { t } = useTranslation("attendance");
  if (!status) return <span className="text-muted-foreground">—</span>;
  const label = t(`status.${status}`, { defaultValue: status });
  const variant = STATUS_VARIANT[status] ?? "secondary";
  return <Badge variant={variant}>{label}</Badge>;
}
