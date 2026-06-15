import type { BonusPenaltyDto } from "@mediaos/contracts";
import {
  BONUS_KIND_LABELS,
  BONUS_PENALTY_STATUS_LABELS,
  BONUS_REFERENCE_TYPE_LABELS,
  BONUS_SOURCE_LABELS,
  formatAmount,
} from "./bonus-penalty-constants";
import { BonusPenaltyDecisionActions } from "./bonus-penalty-decision-actions";

interface BonusPenaltyTableProps {
  rows: BonusPenaltyDto[];
  /** Id user đang đăng nhập (auth store) — truyền xuống actions để chặn self-approve ở UI. */
  currentUserId: string | null;
}

/** Mã reference ngắn để hiển thị (chỉ id tương ứng referenceType, không lộ nhiều cột). */
function referenceLabel(row: BonusPenaltyDto): string {
  if (row.referenceType == null) return "—";
  const id = { task: row.taskId, defect: row.defectId, kpi_result: row.kpiResultId }[
    row.referenceType
  ];
  return `${BONUS_REFERENCE_TYPE_LABELS[row.referenceType]}: ${id ?? "—"}`;
}

/**
 * Bảng thưởng/phạt. KHÔNG hard-code quyền: chỉ render row server trả (server đã gate 403 nếu
 * thiếu view-bonus-penalty). amount LUÔN là số (không có nhánh client unmask). Nút Duyệt/Từ chối
 * uỷ cho <BonusPenaltyDecisionActions> (ẩn khi self-approve / không phải draft / thiếu quyền).
 */
export function BonusPenaltyTable({ rows, currentUserId }: BonusPenaltyTableProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Chưa có khoản thưởng/phạt.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          <th className="py-2 font-medium">Nhân sự</th>
          <th className="py-2 font-medium">Loại</th>
          <th className="py-2 font-medium">Số tiền</th>
          <th className="py-2 font-medium">Kỳ</th>
          <th className="py-2 font-medium">Nguồn</th>
          <th className="py-2 font-medium">Tham chiếu</th>
          <th className="py-2 font-medium">Trạng thái</th>
          <th className="py-2 font-medium">Thao tác</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-border/50">
            <td className="py-2 font-mono text-xs">{row.userId}</td>
            <td className="py-2">{BONUS_KIND_LABELS[row.kind]}</td>
            <td className="py-2 font-medium">{formatAmount(row.amount, row.currency)}</td>
            <td className="py-2">{row.periodMonth}</td>
            <td className="py-2">{BONUS_SOURCE_LABELS[row.source]}</td>
            <td className="py-2 text-xs">{referenceLabel(row)}</td>
            <td className="py-2">{BONUS_PENALTY_STATUS_LABELS[row.status]}</td>
            <td className="py-2">
              <BonusPenaltyDecisionActions row={row} currentUserId={currentUserId} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
