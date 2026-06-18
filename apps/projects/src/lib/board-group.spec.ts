import { describe, expect, test } from "vitest";
import { groupTasksByState, NO_STATE_COLUMN_ID } from "@/lib/board-group";
import { makeState, makeTask } from "@/test/fixtures";

describe("groupTasksByState", () => {
  test("groups tasks into columns by stateId, ordered by sortOrder", () => {
    // Arrange
    const todo = makeState({ name: "Cần làm", sortOrder: 1 });
    const doing = makeState({ name: "Đang làm", sortOrder: 0 });
    const tasks = [
      makeTask({ stateId: todo.id }),
      makeTask({ stateId: doing.id }),
      makeTask({ stateId: doing.id }),
    ];

    // Act — cố ý truyền state KHÔNG theo thứ tự để chứng minh hàm tự sort.
    const columns = groupTasksByState([todo, doing], tasks);

    // Assert — cột đầu = doing (sortOrder 0) với 2 item, cột sau = todo với 1 item.
    expect(columns).toHaveLength(2);
    expect(columns[0]!.id).toBe(doing.id);
    expect(columns[0]!.items).toHaveLength(2);
    expect(columns[1]!.id).toBe(todo.id);
    expect(columns[1]!.items).toHaveLength(1);
  });

  test("keeps empty state columns for stable layout", () => {
    // Arrange
    const empty = makeState({ name: "Trống", sortOrder: 0 });

    // Act
    const columns = groupTasksByState([empty], []);

    // Assert
    expect(columns).toHaveLength(1);
    expect(columns[0]!.items).toHaveLength(0);
  });

  test("puts tasks with null or unknown stateId into a leading 'No state' column", () => {
    // Arrange
    const state = makeState({ sortOrder: 0 });
    const tasks = [
      makeTask({ stateId: null }),
      makeTask({ stateId: "ffffffff-ffff-ffff-ffff-ffffffffffff" }), // state không còn tồn tại
      makeTask({ stateId: state.id }),
    ];

    // Act
    const columns = groupTasksByState([state], tasks);

    // Assert — cột "Chưa có trạng thái" đứng đầu với 2 item; cột state thật có 1 item.
    expect(columns[0]!.id).toBe(NO_STATE_COLUMN_ID);
    expect(columns[0]!.items).toHaveLength(2);
    expect(columns[1]!.id).toBe(state.id);
    expect(columns[1]!.items).toHaveLength(1);
  });

  test("omits the 'No state' column entirely when no orphan tasks exist", () => {
    // Arrange
    const state = makeState({ sortOrder: 0 });

    // Act
    const columns = groupTasksByState([state], [makeTask({ stateId: state.id })]);

    // Assert — không có cột ma.
    expect(columns.every((c) => c.id !== NO_STATE_COLUMN_ID)).toBe(true);
  });
});
