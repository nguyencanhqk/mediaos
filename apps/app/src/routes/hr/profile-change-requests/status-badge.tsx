/**
 * S2-FE-HR-4 — Badge trạng thái profile_change_request (PROFILE_CHANGE_STATUSES, @mediaos/contracts).
 * Trạng thái/text dùng constants chung — KHÔNG hard-code chuỗi rải rác (CLAUDE.md §5).
 */
import { useTranslation } from "react-i18next";
import type { ProfileChangeStatus } from "@mediaos/contracts";
import { Badge } from "@mediaos/ui";

const STATUS_VARIANT: Record<
  ProfileChangeStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  Draft: "secondary",
  Pending: "default",
  Approved: "default",
  Rejected: "destructive",
  Cancelled: "outline",
};

export function ProfileChangeStatusBadge({ status }: { status: ProfileChangeStatus | string }) {
  const { t } = useTranslation("hr");
  const variant = STATUS_VARIANT[status as ProfileChangeStatus] ?? "secondary";
  return (
    <Badge variant={variant}>{t(`changeRequest.status.${status}`, { defaultValue: status })}</Badge>
  );
}
