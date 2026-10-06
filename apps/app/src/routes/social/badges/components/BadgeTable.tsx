/**
 * S16-SOCIAL-FE-3B (L4) — KHUNG (lượt RED): bảng huy hiệu của màn `SOC-SCREEN-012`. Thân thật ở commit GREEN.
 */
import type * as React from "react";
import type { KudosBadgeAdminDto } from "@mediaos/contracts";

export interface BadgeTableProps {
  badges: readonly KudosBadgeAdminDto[];
  isBusy?: boolean;
  onEdit: (badge: KudosBadgeAdminDto) => void;
  onDeactivate: (badge: KudosBadgeAdminDto) => void;
  onReactivate: (badge: KudosBadgeAdminDto) => void;
}

export function BadgeTable(_props: BadgeTableProps): React.ReactElement | null {
  return null;
}
