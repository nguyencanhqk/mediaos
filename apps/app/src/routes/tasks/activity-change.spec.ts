import { describe, it, expect } from "vitest";
import type { TaskActivityLogResponseDto } from "@mediaos/contracts";
import { extractActivityChange } from "./activity-change";

// S5-TASK-DETAIL-1 (GAP 1) — trích cặp cũ→mới từ old/new values cho SPEC-06 §13.12.
const BASE: TaskActivityLogResponseDto = {
  id: "log-1",
  taskId: "t-1",
  projectId: null,
  action: "TASK_STATUS_CHANGED",
  targetType: "Task",
  targetId: "t-1",
  actorUserId: "u-1",
  actorName: "A",
  oldValues: null,
  newValues: null,
  message: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};

describe("extractActivityChange", () => {
  it("status: đọc old/new .status", () => {
    const c = extractActivityChange({
      ...BASE,
      oldValues: { status: "Todo" },
      newValues: { status: "Done" },
    });
    expect(c).toEqual({ kind: "status", oldValue: "Todo", newValue: "Done" });
  });

  it("state: dùng stateName ĐÃ LƯU tại thời điểm ghi log (không tra lại theo id)", () => {
    const c = extractActivityChange({
      ...BASE,
      action: "TASK_STATE_CHANGED",
      oldValues: { stateId: "s1", stateName: "Kịch bản" },
      newValues: { stateId: "s2", stateName: "Duyệt Video" },
    });
    expect(c).toEqual({ kind: "state", oldValue: "Kịch bản", newValue: "Duyệt Video" });
  });

  it("assignee: ưu tiên assigneeName server enrich; giao lần đầu (old null) → oldValue null", () => {
    const c = extractActivityChange({
      ...BASE,
      action: "TASK_ASSIGNED",
      oldValues: { assigneeEmployeeId: null },
      newValues: { assigneeEmployeeId: "e-123", assigneeName: "Ngô Assignee" },
    });
    expect(c).toEqual({ kind: "assignee", oldValue: null, newValue: "Ngô Assignee" });
  });

  it("assignee: log lịch sử CHƯA enrich → fallback id rút gọn 8 ký tự", () => {
    const c = extractActivityChange({
      ...BASE,
      action: "TASK_ASSIGNEE_CHANGED",
      oldValues: { assigneeEmployeeId: "abcdefgh-1111-2222-3333-444444444444" },
      newValues: { assigneeEmployeeId: "ijklmnop-1111-2222-3333-444444444444" },
    });
    expect(c?.oldValue).toBe("abcdefgh…");
    expect(c?.newValue).toBe("ijklmnop…");
  });

  it("priority + dueAt (dueAt=null → gỡ hạn = null)", () => {
    expect(
      extractActivityChange({
        ...BASE,
        action: "TASK_PRIORITY_CHANGED",
        oldValues: { priority: "Low" },
        newValues: { priority: "Urgent" },
      }),
    ).toEqual({ kind: "priority", oldValue: "Low", newValue: "Urgent" });

    expect(
      extractActivityChange({
        ...BASE,
        action: "TASK_DUE_DATE_CHANGED",
        oldValues: { dueAt: "2026-07-01T00:00:00.000Z" },
        newValues: { dueAt: null },
      }),
    ).toEqual({ kind: "dueAt", oldValue: "2026-07-01T00:00:00.000Z", newValue: null });
  });

  it("action ngoài bảng đổi-giá-trị (comment/checklist/created) → null (không bịa dòng cũ→mới)", () => {
    expect(
      extractActivityChange({ ...BASE, action: "COMMENT_CREATED", newValues: { x: 1 } }),
    ).toBeNull();
    expect(extractActivityChange({ ...BASE, action: "TASK_CREATED" })).toBeNull();
  });

  // S5-TASK-SUBTASK-1 (D-36 "thẻ rời board không được biến mất câm") — TASK_UPDATED dùng CHUNG cho
  // MỌI sửa field; chỉ dựng dòng cũ→mới khi oldValues mang khoá parentTaskId (be-core CHỈ ghi khi
  // parentChanged).
  it("TASK_UPDATED + oldValues.parentTaskId hiện diện (gán cha) → kind parentLink", () => {
    const c = extractActivityChange({
      ...BASE,
      action: "TASK_UPDATED",
      oldValues: { parentTaskId: null, stateId: "s1" },
      newValues: { title: "x", parentTaskId: "p-1", stateId: null },
    });
    expect(c).toEqual({ kind: "parentLink", oldValue: null, newValue: "p-1" });
  });

  it("TASK_UPDATED + gỡ cha (parentTaskId cũ khác null, mới null) → kind parentLink", () => {
    const c = extractActivityChange({
      ...BASE,
      action: "TASK_UPDATED",
      oldValues: { parentTaskId: "p-1", stateId: null },
      newValues: { title: "x", parentTaskId: null, stateId: null },
    });
    expect(c).toEqual({ kind: "parentLink", oldValue: "p-1", newValue: null });
  });

  it("TASK_UPDATED sửa field thường (KHÔNG có oldValues) → null (không bịa dòng cũ→mới)", () => {
    expect(
      extractActivityChange({
        ...BASE,
        action: "TASK_UPDATED",
        oldValues: null,
        newValues: { title: "Tiêu đề mới" },
      }),
    ).toBeNull();
  });

  it("old/new đều null hoặc không phải object → null (không vỡ UI với dữ liệu lạ)", () => {
    expect(extractActivityChange(BASE)).toBeNull();
    expect(extractActivityChange({ ...BASE, oldValues: "junk", newValues: 42 })).toBeNull();
  });
});
