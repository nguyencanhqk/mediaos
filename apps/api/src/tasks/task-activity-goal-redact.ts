/**
 * S20-SEC-GOALNAMEDTO-1 — tham chiếu mục tiêu trong NHẬT KÝ hoạt động của việc/dự án theo CÙNG quyết
 * định đọc mục tiêu với bản ghi việc (`TaskGoalRefPolicy`).
 *
 * `TASK_GOAL_DECOMPOSED` là action DUY NHẤT mang dữ liệu mục tiêu (`newValues.goalId/goalCode` + tên
 * mục tiêu trong `message`, ghi ở `goal-decompose.service.ts`). Che LÚC ĐỌC, trả object MỚI — sổ
 * `task_activity_logs` là append-only, KHÔNG UPDATE. `goalId` vắng/không hợp lệ ⇒ che (fail-closed).
 */

export const GOAL_DECOMPOSED_ACTION = "TASK_GOAL_DECOMPOSED";

/** Câu trung tính thay `message` khi người xem không đọc được mục tiêu (không tên, không mã). */
export const GOAL_DECOMPOSED_NEUTRAL_MESSAGE = "Tạo từ phân rã mục tiêu";

/**
 * UUID hợp lệ — giá trị rác/cũ trong JSONB lọt vào IN-list sẽ làm Postgres ném «invalid input syntax
 * for type uuid» ⇒ 500 cả trang nhật ký. Dùng chung cho mọi id đọc từ `oldValues`/`newValues`.
 */
export const ACTIVITY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface GoalRefLogRow {
  action: string;
  newValues: unknown;
  message: string | null;
}

function asRecord(values: unknown): Record<string, unknown> | null {
  if (values === null || typeof values !== "object" || Array.isArray(values)) return null;
  return values as Record<string, unknown>;
}

function readGoalId(values: unknown): string | null {
  const id = asRecord(values)?.goalId;
  return typeof id === "string" && ACTIVITY_UUID_RE.test(id) ? id : null;
}

/** Ứng viên quyết định của một trang nhật ký (khử trùng). Không có dòng phân rã ⇒ rỗng ⇒ 0 truy vấn. */
export function decomposedGoalIds(rows: readonly GoalRefLogRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.action !== GOAL_DECOMPOSED_ACTION) continue;
    const id = readGoalId(row.newValues);
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Dòng phân rã mà người xem KHÔNG đọc được mục tiêu ⇒ object MỚI: `message` trung tính, `newValues` bỏ
 * `goalId`/`goalCode` (giữ các khoá khác). Dòng khác hoặc mục tiêu đọc được ⇒ trả NGUYÊN dòng.
 */
export function redactGoalRef<T extends GoalRefLogRow>(row: T, visible: ReadonlySet<string>): T {
  if (row.action !== GOAL_DECOMPOSED_ACTION) return row;
  const goalId = readGoalId(row.newValues);
  if (goalId !== null && visible.has(goalId)) return row;
  const values = asRecord(row.newValues);
  let newValues: unknown = row.newValues;
  if (values) {
    const { goalId: _goalId, goalCode: _goalCode, ...rest } = values;
    newValues = rest;
  }
  return { ...row, newValues, message: GOAL_DECOMPOSED_NEUTRAL_MESSAGE };
}
