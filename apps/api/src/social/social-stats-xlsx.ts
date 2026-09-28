import type { FeedEngagementResponseDto } from "@mediaos/contracts";
// Tiện ích thuần 1 hàm (không kéo module PAYROLL) — dời ra thư mục chung là nợ ngoài `paths` của BE-3B (plan D11).
import { xlsxSafe } from "../payroll/payroll-xlsx.util";

export const SOCIAL_STATS_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const NO_UNIT_LABEL = "Chưa gán đơn vị";
const DELETED_UNIT_SUFFIX = " (đã xoá)";
const COUNT_HEADERS = ["Bài", "Bình luận", "Cảm xúc", "Thành viên hoạt động"] as const;

/**
 * S16-SOCIAL-BE-3B (plan D10) — tệp XLSX của `053` từ CHÍNH kết quả `collectTx` của `052` (không đường SQL thứ hai).
 *
 * Tên đơn vị là dữ liệu người nhập ⇒ qua `xlsxSafe` (chống formula-injection). Tên tệp chỉ mang ngày — không id,
 * không tên. `exceljs` import ĐỘNG — giữ dependency nặng ngoài đường boot (khuôn 017/071/082).
 */
export async function buildEngagementWorkbook(
  data: FeedEngagementResponseDto,
): Promise<{ buffer: Buffer; filename: string }> {
  const unitNames = new Map(
    data.units.map((u) => [u.orgUnitId, u.isDeleted ? `${u.name}${DELETED_UNIT_SUFFIX}` : u.name]),
  );
  const unitLabel = (id: string | null): string =>
    // Id có hoạt động nhưng vắng metadata không tới được: `rows` và `units` dựng từ CÙNG bộ lọc phạm vi
    // (D5/D6) và metadata gồm cả đơn vị đã xoá. Vẫn trả id thay vì bịa tên nếu bất biến đó vỡ.
    id === null ? NO_UNIT_LABEL : xlsxSafe(unitNames.get(id) ?? id);

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();

  const byUnit = workbook.addWorksheet("Theo đơn vị");
  byUnit.columns = [
    { header: "Tuần bắt đầu", width: 14 },
    { header: "Đơn vị", width: 32 },
    ...COUNT_HEADERS.map((header) => ({ header, width: 14 })),
  ];
  byUnit.getRow(1).font = { bold: true };
  for (const r of data.rows) {
    byUnit.addRow([
      r.weekStart,
      unitLabel(r.orgUnitId),
      r.posts,
      r.comments,
      r.reactions,
      r.activeMembers,
    ]);
  }

  const byWeek = workbook.addWorksheet("Theo tuần");
  byWeek.columns = [
    { header: "Tuần bắt đầu", width: 14 },
    ...COUNT_HEADERS.map((header) => ({ header, width: 14 })),
  ];
  byWeek.getRow(1).font = { bold: true };
  for (const w of data.weekTotals) {
    byWeek.addRow([w.weekStart, w.posts, w.comments, w.reactions, w.activeMembers]);
  }

  const out = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(out as ArrayBuffer),
    filename: `social-tuong-tac-${data.range.from}_${data.range.to}.xlsx`,
  };
}
