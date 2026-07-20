import { describe, expect, it } from "vitest";
import { toTaskCoreDto, toTaskKanbanCardDto } from "./task-core.mapper";
import type { TaskCoreRow } from "./task-core.repository";

/**
 * S5-TASK-BE-6 — unit thuần (KHÔNG DB) cho projection Kanban card (SPEC-06 §13.8). Khoá 2 điều:
 *   1. `toTaskKanbanCardDto` = `toTaskCoreDto` (mọi field base giữ nguyên) + 4 field counts truyền vào —
 *      KHÔNG tự suy luận/query gì thêm (thuần merge, đúng "additive" — done_when).
 *   2. Counts truyền vào phản ánh ĐÚNG những gì service/repo tính (0 khi Map.get() miss — card trống),
 *      test riêng ở int-spec cho phần DB thật; ở đây chỉ khoá hợp đồng của mapper.
 */

const baseRow: TaskCoreRow = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "22222222-2222-2222-2222-222222222222",
  title: "Task mẫu",
  description: null,
  taskType: "office",
  taskStatus: "Todo",
  taskPriority: "Medium",
  projectId: "33333333-3333-3333-3333-333333333333",
  projectName: "Dự án X",
  mainAssigneeEmployeeId: null,
  assigneeName: null,
  creatorUserId: null,
  creatorName: null,
  reporterEmployeeId: null,
  departmentId: null,
  dueAt: null,
  startAt: null,
  completedAt: null,
  isOverdue: false,
  createdBy: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("task-core.mapper — toTaskKanbanCardDto (SPEC-06 §13.8, S5-TASK-BE-6)", () => {
  it("merge ĐÚNG toàn bộ field base của toTaskCoreDto + 4 field counts truyền vào", () => {
    const base = toTaskCoreDto(baseRow);
    const card = toTaskKanbanCardDto(baseRow, {
      commentCount: 2,
      attachmentCount: 1,
      checklistDone: 1,
      checklistTotal: 3,
      subtaskDone: 0,
      subtaskTotal: 0,
    });

    expect(card).toMatchObject(base);
    expect(card.commentCount).toBe(2);
    expect(card.attachmentCount).toBe(1);
    expect(card.checklistDone).toBe(1);
    expect(card.checklistTotal).toBe(3);
  });

  it("card KHÔNG có comment/file/checklist nào (project trống) → cả 4 field counts = 0", () => {
    const card = toTaskKanbanCardDto(baseRow, {
      commentCount: 0,
      attachmentCount: 0,
      checklistDone: 0,
      checklistTotal: 0,
      subtaskDone: 0,
      subtaskTotal: 0,
    });

    expect(card.commentCount).toBe(0);
    expect(card.attachmentCount).toBe(0);
    expect(card.checklistDone).toBe(0);
    expect(card.checklistTotal).toBe(0);
  });

  it("checklistDone KHÔNG BAO GIỜ vượt checklistTotal cho dữ liệu hợp lệ (guard hợp đồng, không phải DB CHECK)", () => {
    const card = toTaskKanbanCardDto(baseRow, {
      commentCount: 0,
      attachmentCount: 0,
      checklistDone: 2,
      checklistTotal: 2,
      subtaskDone: 0,
      subtaskTotal: 0,
    });
    expect(card.checklistDone).toBeLessThanOrEqual(card.checklistTotal ?? 0);
  });

  // ── S5-TASK-SUBTASK-1 (DECISIONS-05 D-34/D-35) ────────────────────────────────────────────────
  it("tiến độ việc con là badge ĐỘC LẬP với checklist — hai khái niệm khác nhau, KHÔNG gộp (D-35)", () => {
    const card = toTaskKanbanCardDto(baseRow, {
      commentCount: 0,
      attachmentCount: 0,
      checklistDone: 3,
      checklistTotal: 4,
      subtaskDone: 1,
      subtaskTotal: 2,
    });
    expect(card.checklistDone).toBe(3);
    expect(card.checklistTotal).toBe(4);
    expect(card.subtaskDone).toBe(1);
    expect(card.subtaskTotal).toBe(2);
  });

  it("task KHÔNG có việc con ⇒ subtaskTotal = 0 (FE dùng làm cờ 'không hiện %' — D-34)", () => {
    const card = toTaskKanbanCardDto(baseRow, {
      commentCount: 0,
      attachmentCount: 0,
      checklistDone: 0,
      checklistTotal: 0,
      subtaskDone: 0,
      subtaskTotal: 0,
    });
    expect(card.subtaskTotal).toBe(0);
  });

  it("parentTaskId map ra DTO: NULL = task gốc (D-31)", () => {
    expect(toTaskCoreDto(baseRow).parentTaskId).toBeNull();
    expect(
      toTaskCoreDto({ ...baseRow, parentTaskId: "11111111-1111-4111-8111-111111111111" })
        .parentTaskId,
    ).toBe("11111111-1111-4111-8111-111111111111");
  });
});
