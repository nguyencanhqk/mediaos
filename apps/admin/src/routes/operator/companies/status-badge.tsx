import { useTranslation } from "react-i18next";
import { Badge, type BadgeProps } from "@/components/ui/badge";

interface CompanyStatusBadgeProps {
  status: string;
}

/** Map status công ty → variant badge + nhãn i18n (fallback hiển thị raw status nếu lạ). */
const VARIANT_BY_STATUS: Record<string, BadgeProps["variant"]> = {
  active: "default",
  suspended: "destructive",
  provisioning: "secondary",
};

export function CompanyStatusBadge({ status }: CompanyStatusBadgeProps) {
  const { t } = useTranslation("operator-companies");
  const variant = VARIANT_BY_STATUS[status] ?? "outline";
  // i18n key chỉ tồn tại cho enum đã biết; status lạ → hiển thị nguyên văn.
  const known = status in VARIANT_BY_STATUS;
  return <Badge variant={variant}>{known ? t(`status.${status}`) : status}</Badge>;
}
