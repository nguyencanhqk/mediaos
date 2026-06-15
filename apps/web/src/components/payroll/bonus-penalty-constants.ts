import type {
  BonusKind,
  BonusPenaltyStatus,
  BonusReferenceType,
  BonusSource,
} from "@mediaos/contracts";

export const BONUS_KIND_LABELS: Record<BonusKind, string> = {
  bonus: "Thưởng",
  penalty: "Phạt",
};

export const BONUS_PENALTY_STATUS_LABELS: Record<BonusPenaltyStatus, string> = {
  draft: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
};

export const BONUS_SOURCE_LABELS: Record<BonusSource, string> = {
  manual: "Thủ công",
  kpi: "Từ KPI",
  defect: "Từ lỗi",
};

export const BONUS_REFERENCE_TYPE_LABELS: Record<BonusReferenceType, string> = {
  task: "Công việc",
  defect: "Lỗi",
  kpi_result: "Kết quả KPI",
};

/**
 * Định dạng số tiền thưởng/phạt cho hiển thị (DRY). amount LUÔN là số (server gate cả
 * row bằng 403, KHÔNG mask field) → không có nhánh null/unmask ở đây.
 */
export function formatAmount(amount: number, currency = "VND"): string {
  return `${amount.toLocaleString("vi-VN")} ${currency}`;
}
