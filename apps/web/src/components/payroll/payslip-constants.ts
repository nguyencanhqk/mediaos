import type { PayslipEntryKind } from "@mediaos/contracts";

/**
 * Payslip-specific display constants (G12-FE). Period-status labels + the masked-amount placeholder
 * already live in ./period-constants — reused there, NOT duplicated here (CLAUDE.md §5: status/text
 * dùng constants chung).
 */

/** Human-readable labels for the payslip snapshot entry kind (append-only lineage). */
export const ENTRY_KIND_LABELS: Record<PayslipEntryKind, string> = {
  original: "Gốc",
  adjustment: "Điều chỉnh",
  void: "Huỷ",
};
