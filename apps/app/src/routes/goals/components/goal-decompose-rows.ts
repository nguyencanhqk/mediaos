/**
 * S20-GOAL-DECOMPOSE-1 (US-GOAL-QL-07) — mô hình dòng xem trước của wizard phân rã (hàm thuần).
 *
 * «Áp cho tất cả» (người + hạn): giá trị chung đổ vào MỌI dòng chưa sửa tay ô tương ứng; dòng đã sửa
 * tay giữ giá trị riêng (cờ `assigneeTouched` / `dueTouched` theo từng ô, không theo cả dòng — sửa
 * người của dòng 3 không khoá hạn của dòng 3). Dòng mới thêm khởi tạo bằng giá trị chung hiện tại.
 *
 * Hạn: ô `<input type="date">` cho ngày local `YYYY-MM-DD`; server cần instant ISO ⇒ `endOfLocalDay`
 * theo múi giờ CÔNG TY (`companyTimeZone()` — người gọi truyền vào). Chuỗi UTC cứng
 * `T23:59:59.000Z` là 06:59 hôm sau ở UTC+7 ⇒ việc «hạn 31/10» thành hạn 01/11.
 */
import { endOfLocalDay } from "@mediaos/web-core";
import type {
  DecomposeGoalItemRequest,
  DecomposeGoalRequest,
  TaskTemplateItemResponseDto,
  TaskTemplatePriorityDto,
} from "@mediaos/contracts";

/** Một dòng preview — `key` cục bộ để React theo dõi dòng do người dùng THÊM (chưa có id server). */
export interface PreviewRow {
  key: string;
  templateItemId?: string;
  title: string;
  priority: TaskTemplatePriorityDto;
  assigneeEmployeeId: string;
  stateId: string;
  /** Ngày local `YYYY-MM-DD` theo giờ công ty; rỗng = không đặt hạn. */
  dueAt: string;
  checklist: string[];
  assigneeTouched: boolean;
  dueTouched: boolean;
}

/** Giá trị hàng «Áp cho tất cả». */
export interface BulkValues {
  assigneeEmployeeId: string;
  dueAt: string;
}

export const EMPTY_BULK: BulkValues = { assigneeEmployeeId: "", dueAt: "" };

export function rowsFromTemplate(
  items: readonly TaskTemplateItemResponseDto[],
  bulk: BulkValues,
): PreviewRow[] {
  return items.map((item, index) => ({
    key: `tpl-${item.id}-${index}`,
    templateItemId: item.id,
    title: item.title,
    priority: item.defaultPriority ?? "none",
    assigneeEmployeeId: bulk.assigneeEmployeeId,
    stateId: "",
    dueAt: bulk.dueAt,
    checklist: item.checklist,
    assigneeTouched: false,
    dueTouched: false,
  }));
}

export function appendBlankRow(rows: readonly PreviewRow[], bulk: BulkValues): PreviewRow[] {
  const last = rows[rows.length - 1];
  return [
    ...rows,
    {
      key: `new-${rows.length}-${last ? last.key : "first"}`,
      title: "",
      priority: "none",
      assigneeEmployeeId: bulk.assigneeEmployeeId,
      stateId: "",
      dueAt: bulk.dueAt,
      checklist: [],
      assigneeTouched: false,
      dueTouched: false,
    },
  ];
}

/** Sửa tay một dòng; đổi người/hạn ⇒ đánh dấu ô đó đã sửa tay (áp chung về sau không đè). */
export function editRow(
  rows: readonly PreviewRow[],
  key: string,
  patch: Partial<Omit<PreviewRow, "key" | "assigneeTouched" | "dueTouched">>,
): PreviewRow[] {
  return rows.map((row) =>
    row.key === key
      ? {
          ...row,
          ...patch,
          ...("assigneeEmployeeId" in patch ? { assigneeTouched: true } : {}),
          ...("dueAt" in patch ? { dueTouched: true } : {}),
        }
      : row,
  );
}

/** Áp giá trị chung cho mọi dòng CHƯA sửa tay ô tương ứng. */
export function applyBulk(rows: readonly PreviewRow[], patch: Partial<BulkValues>): PreviewRow[] {
  return rows.map((row) => ({
    ...row,
    ...(patch.assigneeEmployeeId !== undefined && !row.assigneeTouched
      ? { assigneeEmployeeId: patch.assigneeEmployeeId }
      : {}),
    ...(patch.dueAt !== undefined && !row.dueTouched ? { dueAt: patch.dueAt } : {}),
  }));
}

/** Dòng hợp lệ = có tiêu đề. Nguồn DUY NHẤT cho cả số trên nút lẫn payload gửi lên. */
export function validRowsOf(rows: readonly PreviewRow[]): PreviewRow[] {
  return rows.filter((row) => row.title.trim().length > 0);
}

export interface PayloadOptions {
  templateId: string;
  showAssignee: boolean;
  showState: boolean;
  /** Múi IANA của công ty — `companyTimeZone()`. */
  timeZone: string;
}

/**
 * Dựng payload GOAL-API-011 từ các dòng hợp lệ. Gọi TẠI THỜI ĐIỂM BẤM (xem chú thích ở wizard về
 * closure cũ của `mutationFn`).
 */
export function buildDecomposePayload(
  validRows: readonly PreviewRow[],
  { templateId, showAssignee, showState, timeZone }: PayloadOptions,
): DecomposeGoalRequest {
  return {
    templateId,
    items: validRows.map(
      (row): DecomposeGoalItemRequest => ({
        ...(row.templateItemId ? { templateItemId: row.templateItemId } : {}),
        title: row.title.trim(),
        ...(row.priority !== "none" ? { priority: row.priority } : {}),
        ...(showAssignee && row.assigneeEmployeeId
          ? { assigneeEmployeeId: row.assigneeEmployeeId }
          : {}),
        ...(showState && row.stateId ? { stateId: row.stateId } : {}),
        ...(row.dueAt ? { dueAt: endOfLocalDay(row.dueAt, timeZone).toISOString() } : {}),
        ...(row.checklist.length > 0 ? { checklist: row.checklist } : {}),
      }),
    ),
  };
}
