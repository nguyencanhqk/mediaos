import { describe, expect, it } from "vitest";
import { taskKanbanBoardSchema, taskKanbanCardSchema } from "./task-collab";

/**
 * S5-TASK-BE-6 (SPEC-06 §13.8) — khoá hợp đồng ADDITIVE của counts per-card Kanban: field mới
 * (commentCount/attachmentCount/checklistDone/checklistTotal) PHẢI optional để response CŨ (trước khi BE
 * thêm counts) vẫn parse được — "FE cũ không gãy" (done_when). Dùng `.optional()` (KHÔNG `.default()`) —
 * tránh bẫy suy luận generic của `apiFetch<T>(path, schema: z.ZodType<T>)` (web-core) làm T lệch giữa
 * Input/Output khi field có `.default()` (xem comment task-collab.ts).
 */

const BASE_CARD_FIELDS = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "22222222-2222-2222-2222-222222222222",
  title: "Task mẫu",
  description: null,
  taskType: "office",
  status: "Todo",
  priority: null,
  projectId: null,
  projectName: null,
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
} as const;

describe("taskKanbanCardSchema (S5-TASK-BE-6, SPEC-06 §13.8)", () => {
  it("parse ĐƯỢC card KHÔNG có 4 field counts (payload CŨ trước khi BE thêm counts) — additive, không gãy", () => {
    const parsed = taskKanbanCardSchema.parse(BASE_CARD_FIELDS);
    expect(parsed.commentCount).toBeUndefined();
    expect(parsed.attachmentCount).toBeUndefined();
    expect(parsed.checklistDone).toBeUndefined();
    expect(parsed.checklistTotal).toBeUndefined();
  });

  it("parse ĐÚNG card CÓ đủ 4 field counts do service tính", () => {
    const parsed = taskKanbanCardSchema.parse({
      ...BASE_CARD_FIELDS,
      commentCount: 2,
      attachmentCount: 1,
      checklistDone: 1,
      checklistTotal: 3,
    });
    expect(parsed.commentCount).toBe(2);
    expect(parsed.attachmentCount).toBe(1);
    expect(parsed.checklistDone).toBe(1);
    expect(parsed.checklistTotal).toBe(3);
  });

  it("từ chối count ÂM (nonnegative) — dữ liệu server hỏng phải fail validate, không âm thầm nuốt", () => {
    expect(() => taskKanbanCardSchema.parse({ ...BASE_CARD_FIELDS, commentCount: -1 })).toThrow();
  });
});

describe("taskKanbanBoardSchema — board KHÔNG gãy khi 1 số card cũ thiếu counts, số khác có đủ", () => {
  it("parse board trộn: card có counts + card KHÔNG có counts trong CÙNG 1 cột", () => {
    const board = taskKanbanBoardSchema.parse({
      projectId: "33333333-3333-3333-3333-333333333333",
      columns: [
        {
          status: "Todo",
          tasks: [
            { ...BASE_CARD_FIELDS, id: "44444444-4444-4444-4444-444444444444" },
            {
              ...BASE_CARD_FIELDS,
              id: "55555555-5555-5555-5555-555555555555",
              commentCount: 5,
              attachmentCount: 0,
              checklistDone: 0,
              checklistTotal: 0,
            },
          ],
        },
      ],
    });
    expect(board.columns[0]?.tasks).toHaveLength(2);
  });
});
