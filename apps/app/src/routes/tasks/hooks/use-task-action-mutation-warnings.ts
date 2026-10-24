import type { TaskActionWarningCode, TaskCoreResponseDto } from "@mediaos/contracts";

/**
 * Chuẩn hoá `warnings[]` của route action task (S20-TASK-ASSIGNWARN-1 · US-TASK-QL-91).
 *
 * Server (task-actions.service) trả cảnh báo KHÔNG chặn: `assign` ⇒ ASSIGNEE-ON-LEAVE (người nhận có
 * đơn nghỉ đã duyệt trùng NGÀY HẠN của việc) + ASSIGNEE-NOT-MEMBER (việc thuộc dự án mà người nhận
 * không là thành viên); `change-deadline` ⇒ ASSIGNEE-ON-LEAVE. Việc vẫn được giao như server đã chấp
 * nhận — cảnh báo chỉ để người giao biết sớm.
 *
 * Parse PHÒNG THỦ, không ném: vắng trường / không phải mảng / phần tử rác / mã chưa biết ⇒ bỏ qua phần
 * tử đó. Một cảnh báo mới phía server KHÔNG được biến việc giao đã thành công thành lỗi trên UI.
 */
export type TaskAssigneeWarningKind = "onLeave" | "notMember";

export interface TaskAssigneeWarning {
  readonly kind: TaskAssigneeWarningKind;
  /**
   * Ngày cuối kỳ nghỉ dạng `YYYY-MM-DD` khi server trả (trường `until`); không có / sai dạng ⇒ `null`
   * (câu cảnh báo bỏ phần hạn). Chỉ nhận dạng NGÀY thuần — chuỗi có giờ + múi giờ cắt lấy ngày có thể
   * lệch một ngày so với giờ công ty, nên thà không hiện hạn còn hơn hiện sai.
   */
  readonly until: string | null;
}

/** Kết quả mutate của `useTaskActionMutation` — `warnings` đã chuẩn hoá, rỗng khi không có cảnh báo. */
export interface TaskActionMutationResult {
  readonly task: TaskCoreResponseDto;
  readonly warnings: readonly TaskAssigneeWarning[];
}

/** Ánh xạ mã contract → loại cảnh báo. `Record` theo enum contract ⇒ thêm mã mới là tsc bắt khai. */
const KIND_BY_CODE: Readonly<Record<TaskActionWarningCode, TaskAssigneeWarningKind>> = {
  "TASK-WARN-ASSIGNEE-ON-LEAVE": "onLeave",
  "TASK-WARN-ASSIGNEE-NOT-MEMBER": "notMember",
};
// Map, không tra thẳng object: mã rác kiểu "toString"/"constructor" không được khớp thuộc tính prototype.
const KIND_LOOKUP: ReadonlyMap<string, TaskAssigneeWarningKind> = new Map(
  Object.entries(KIND_BY_CODE),
);

const DATE_ONLY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function readUntil(item: Readonly<Record<string, unknown>>): string | null {
  const value = item.until;
  return typeof value === "string" && DATE_ONLY.test(value) ? value : null;
}

function toWarning(item: unknown): TaskAssigneeWarning | null {
  if (typeof item !== "object" || item === null) return null;
  const record = item as Readonly<Record<string, unknown>>;
  if (typeof record.code !== "string") return null;
  const kind = KIND_LOOKUP.get(record.code);
  return kind ? { kind, until: readUntil(record) } : null;
}

/** `unknown` vào, danh sách hợp lệ ra — mỗi loại tối đa MỘT lần (giữ lần xuất hiện đầu). */
export function normalizeTaskActionWarnings(raw: unknown): readonly TaskAssigneeWarning[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<TaskAssigneeWarningKind>();
  const warnings: TaskAssigneeWarning[] = [];
  for (const item of raw) {
    const warning = toWarning(item);
    if (!warning || seen.has(warning.kind)) continue;
    seen.add(warning.kind);
    warnings.push(warning);
  }
  return warnings;
}
