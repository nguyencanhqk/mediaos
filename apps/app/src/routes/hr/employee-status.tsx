import { useTranslation } from "react-i18next";
import { Badge } from "@mediaos/ui";

/** Variant badge theo trạng thái nhân viên (chuỗi từ server — có thể là bất kỳ string). */
function statusVariant(status: string): "success" | "warning" | "muted" | "danger" | "secondary" {
  switch (status.toLowerCase()) {
    case "active":
    case "official":
      return "success";
    case "probation":
    case "onboarding":
      return "warning";
    case "inactive":
    case "temporarily suspended":
      return "warning";
    case "resigned":
      return "muted";
    case "terminated":
      return "danger";
    default:
      return "secondary";
  }
}

interface EmployeeStatusBadgeProps {
  status: string;
}

/**
 * Badge trạng thái nhân viên — dùng chung list + detail.
 * Label dịch qua namespace "hr"; variant do statusVariant().
 */
export function EmployeeStatusBadge({ status }: EmployeeStatusBadgeProps) {
  const { t } = useTranslation("hr");
  // Thử tra cứu i18n key trước; fallback về chính chuỗi status nếu chưa có.
  const label = t(`status.${status}`, { defaultValue: status });
  return <Badge variant={statusVariant(status)}>{label}</Badge>;
}
