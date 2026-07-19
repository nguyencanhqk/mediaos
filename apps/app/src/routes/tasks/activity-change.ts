import type { TaskActivityLogResponseDto } from "@mediaos/contracts";

/**
 * S5-TASK-DETAIL-1 (GAP 1, SPEC-06 §13.12 cột "Dữ liệu cũ/mới") — trích cặp cũ→mới từ
 * oldValues/newValues của log để ActivityFeedList render dòng thay đổi dưới mỗi mục.
 *
 * Nguyên tắc "tên TẠI THỜI ĐIỂM đó": state dùng `stateName` ĐÃ LƯU lúc ghi log (cột rename sau
 * KHÔNG đổi lịch sử — applyStateChangeTx lưu cả id+name); assignee dùng `assigneeName` server enrich
 * lúc ĐỌC (log chỉ lưu employeeId — người là thực thể ổn định, hiện tên hiện tại là đúng), fallback
 * id rút gọn khi server chưa enrich. Giá trị thiếu (vd giao việc lần đầu oldValues=null) → null,
 * component render "—".
 *
 * `kind` quyết định cách ĐỊA PHƯƠNG HÓA giá trị ở component (status/priority qua i18n enum,
 * dueAt format ngày, state/assignee là text trần) — helper này THUẦN trích xuất, không dịch.
 */
export interface ActivityChange {
  kind: "status" | "state" | "assignee" | "priority" | "dueAt";
  oldValue: string | null;
  newValue: string | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function readString(obj: Record<string, unknown> | null, key: string): string | null {
  const v = obj?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Tên assignee (server enrich) → fallback id rút gọn 8 ký tự (log lịch sử trước khi có enrich). */
function readAssignee(obj: Record<string, unknown> | null): string | null {
  const name = readString(obj, "assigneeName");
  if (name) return name;
  const id = readString(obj, "assigneeEmployeeId");
  return id ? `${id.slice(0, 8)}…` : null;
}

export function extractActivityChange(log: TaskActivityLogResponseDto): ActivityChange | null {
  const oldV = asRecord(log.oldValues);
  const newV = asRecord(log.newValues);
  if (!oldV && !newV) return null;
  const change = extractByAction(log.action, oldV, newV);
  // Cả hai vế đều rỗng (values rác/shape lạ) → không dựng dòng "— → —" vô nghĩa.
  if (!change || (change.oldValue === null && change.newValue === null)) return null;
  return change;
}

function extractByAction(
  action: string,
  oldV: Record<string, unknown> | null,
  newV: Record<string, unknown> | null,
): ActivityChange | null {
  switch (action) {
    case "TASK_STATUS_CHANGED":
      return {
        kind: "status",
        oldValue: readString(oldV, "status"),
        newValue: readString(newV, "status"),
      };
    case "TASK_STATE_CHANGED":
      return {
        kind: "state",
        oldValue: readString(oldV, "stateName"),
        newValue: readString(newV, "stateName"),
      };
    case "TASK_ASSIGNED":
    case "TASK_ASSIGNEE_CHANGED":
      return { kind: "assignee", oldValue: readAssignee(oldV), newValue: readAssignee(newV) };
    case "TASK_PRIORITY_CHANGED":
      return {
        kind: "priority",
        oldValue: readString(oldV, "priority"),
        newValue: readString(newV, "priority"),
      };
    case "TASK_DUE_DATE_CHANGED":
      return {
        kind: "dueAt",
        oldValue: readString(oldV, "dueAt"),
        newValue: readString(newV, "dueAt"),
      };
    default:
      return null;
  }
}
