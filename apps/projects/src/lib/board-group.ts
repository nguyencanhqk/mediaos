import type { BoardTaskDto, ProjectStateDto } from "@mediaos/contracts";

/** Khóa cột "không trạng thái" — work item có stateId null hoặc trỏ tới state đã bị xoá. */
export const NO_STATE_COLUMN_ID = "__no_state__";

export interface BoardColumn {
  /** id state, hoặc NO_STATE_COLUMN_ID cho cột "Chưa có trạng thái". */
  id: string;
  name: string | null;
  color: string | null;
  /** state nguồn (null cho cột không trạng thái). */
  state: ProjectStateDto | null;
  items: BoardTaskDto[];
}

/**
 * Gom work item vào cột theo state, giữ thứ tự cột = sortOrder của project_states. Item có stateId
 * null (hoặc trỏ state không còn trong danh sách) rơi vào cột "Chưa có trạng thái" — CHỈ hiện cột này
 * khi thực sự có item như vậy (tránh cột ma). Cột state luôn hiện kể cả rỗng (layout ổn định).
 *
 * Thuần hàm → unit-test được không cần render.
 */
export function groupTasksByState(
  states: readonly ProjectStateDto[],
  tasks: readonly BoardTaskDto[],
): BoardColumn[] {
  const ordered = [...states].sort((a, b) => a.sortOrder - b.sortOrder);
  const stateIds = new Set(ordered.map((s) => s.id));

  const columns: BoardColumn[] = ordered.map((state) => ({
    id: state.id,
    name: state.name,
    color: state.color,
    state,
    items: [],
  }));
  const byId = new Map(columns.map((c) => [c.id, c]));

  const noState: BoardColumn = {
    id: NO_STATE_COLUMN_ID,
    name: null,
    color: null,
    state: null,
    items: [],
  };

  for (const task of tasks) {
    if (task.stateId && stateIds.has(task.stateId)) {
      byId.get(task.stateId)!.items.push(task);
    } else {
      noState.items.push(task);
    }
  }

  // Cột "Chưa có trạng thái" đặt đầu chỉ khi có item (giống Plane "No status").
  return noState.items.length > 0 ? [noState, ...columns] : columns;
}
