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
    });
    expect(card.checklistDone).toBeLessThanOrEqual(card.checklistTotal ?? 0);
  });
});
