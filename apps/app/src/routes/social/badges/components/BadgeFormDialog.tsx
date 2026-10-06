/**
 * S16-SOCIAL-FE-3B (L4) — KHUNG (lượt RED): hộp thoại tạo (049) / sửa (050) huy hiệu. Thân thật ở commit GREEN.
 */
import type * as React from "react";
import type { KudosBadgeAdminDto } from "@mediaos/contracts";
import type { AdminErrorReason } from "../../admin/lib/admin-errors";

export type BadgeFormMode = "create" | "edit";

export type BadgeFormOutcome =
  | { kind: "done"; mode: BadgeFormMode; badge: KudosBadgeAdminDto }
  | { kind: "failed"; mode: BadgeFormMode; reason: AdminErrorReason; invalidate: boolean };

export interface BadgeFormDialogProps {
  badge: KudosBadgeAdminDto | null;
  onClose: () => void;
  onOutcome: (outcome: BadgeFormOutcome) => void;
  onStale: () => void;
}

export function BadgeFormDialog(_props: BadgeFormDialogProps): React.ReactElement | null {
  return null;
}
