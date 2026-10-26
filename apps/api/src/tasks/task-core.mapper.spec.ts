import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  goalRefCandidates,
  signedUrlsForRow,
  toTaskCoreDto,
  toTaskKanbanCardDto,
} from "./task-core.mapper";
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

/**
 * S20-SEC-GOALNAMEDTO-1 (plan §4 U1) — tham chiếu mục tiêu theo quyết định đọc mục tiêu. Mapper là điểm hợp
 * nhất DUY NHẤT: thiếu quyết định đi kèm ⇒ fail-closed (null×3); cờ `hasGoal` = join mục tiêu còn sống trúng.
 */
describe("task-core.mapper — tham chiếu mục tiêu: cùng dữ liệu, cùng quyết định quyền", () => {
  const GOAL_ID = "44444444-4444-4444-4444-444444444444";
  const linkedRow: TaskCoreRow = {
    ...baseRow,
    goalId: GOAL_ID,
    goalCode: "GOAL-0001",
    goalName: "Mục tiêu X",
  };
  /** Đọc trường theo tên — `hasGoal` chưa có trong kiểu DTO ở bước RED. */
  const field = (dto: object, key: string): unknown => (dto as Record<string, unknown>)[key];
  const visible = { assigneeAvatarUrl: null, coverUrl: null, goalRefVisible: true };

  it("U1a không có quyết định đọc mục tiêu đi kèm ⇒ ba trường null, chỉ cờ có mục tiêu", () => {
    const dto = toTaskCoreDto(linkedRow);
    expect(dto.goalName).toBeNull();
    expect(dto.goalCode).toBeNull();
    expect(dto.goalId).toBeNull();
    expect(field(dto, "hasGoal")).toBe(true);
  });

  it("U1b quyết định thấy được ⇒ đủ ba trường của đúng mục tiêu + cờ", () => {
    const dto = toTaskCoreDto(linkedRow, visible);
    expect(dto.goalName).toBe("Mục tiêu X");
    expect(dto.goalCode).toBe("GOAL-0001");
    expect(dto.goalId).toBe(GOAL_ID);
    expect(field(dto, "hasGoal")).toBe(true);
  });

  it("U1c thấy được nhưng join mục tiêu trượt (mục tiêu đã xoá mềm) ⇒ ba trường null, cờ false", () => {
    const dto = toTaskCoreDto({ ...linkedRow, goalCode: null, goalName: null }, visible);
    expect(dto.goalName).toBeNull();
    expect(dto.goalCode).toBeNull();
    expect(dto.goalId).toBeNull();
    expect(field(dto, "hasGoal")).toBe(false);
  });

  it("U1d việc không gắn mục tiêu ⇒ ba trường null, cờ false", () => {
    const dto = toTaskCoreDto(baseRow, visible);
    expect(dto.goalId).toBeNull();
    expect(field(dto, "hasGoal")).toBe(false);
  });
});

/**
 * S20-SEC-GOALNAMEDTO-1 (plan §4 U6) — MỘT điểm dựng object trang trí: quyết định đọc mục tiêu chỉ đi
 * vào DTO qua `signedUrlsForRow` (đường nào tự dựng `{ assigneeAvatarUrl, coverUrl }` là đường sẽ quên
 * trường trang trí mới ⇒ mất cờ quyết định ⇒ che, nhưng cũng lệch hành vi giữa các đường).
 */
describe("task-core.mapper — trang trí qua một helper duy nhất", () => {
  const GOAL_ID = "44444444-4444-4444-4444-444444444444";
  const linked: TaskCoreRow = { ...baseRow, goalId: GOAL_ID, goalCode: "GOAL-0001", goalName: "X" };
  const deco = (goals: string[]) => ({
    avatars: new Map<string, string>(),
    covers: new Map<string, string>(),
    goals: new Set(goals),
  });

  it("U6a signedUrlsForRow mang quyết định đọc mục tiêu của ĐÚNG mục tiêu đang gắn", () => {
    expect(signedUrlsForRow(linked, deco([GOAL_ID])).goalRefVisible).toBe(true);
    expect(
      signedUrlsForRow(linked, deco(["55555555-5555-4555-8555-555555555555"])).goalRefVisible,
    ).toBe(false);
    expect(signedUrlsForRow(baseRow, deco([GOAL_ID])).goalRefVisible).toBe(false);
  });

  it("U6b ứng viên quyết định = hàng join mục tiêu trúng, khử trùng", () => {
    const deleted: TaskCoreRow = { ...linked, id: "x", goalCode: null, goalName: null };
    expect(goalRefCandidates([linked, linked, deleted, baseRow])).toEqual([GOAL_ID]);
  });

  it("U6c không tệp nguồn nào ngoài mapper tự đặt cờ đọc mục tiêu hay tự dựng URL avatar", () => {
    const roots = [__dirname, join(__dirname, "..", "goals")];
    const offenders: string[] = [];
    for (const dir of roots) {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".ts") || f.endsWith(".spec.ts") || f === "task-core.mapper.ts") continue;
        const text = readFileSync(join(dir, f), "utf8");
        if (/goalRefVisible\s*:/.test(text) || /assigneeAvatarUrl:\s*avatarForRow\(/.test(text)) {
          offenders.push(f);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
