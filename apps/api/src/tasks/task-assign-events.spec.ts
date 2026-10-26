/**
 * S20-TASK-ASSIGNNOTI-1 — unit cho bộ phát sự kiện giao việc dùng chung (`TaskAssignEvents`).
 * Đường DB thật + bridge NOTI = `test/integration/s20-task-assign-noti.int-spec.ts`.
 *
 * Khoá: (1) bảng loại sự kiện null→assigned / A→changed; (2) tạo việc tự giao / không người ⇒ 0 enqueue,
 * giao người khác ⇒ 1 enqueue trên CHÍNH `tx` của caller; (3) PATCH chỉ tiêu đề/mô tả ⇒ 0 enqueue, đổi đủ ba
 * trường ⇒ 3 enqueue, payload mang người phụ trách SAU patch; (4) payload không bao giờ có `description`/`reason`.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { TaskAssignEvents, assignKind, commonTaskPayload } from "./task-assign-events";

const COMPANY = randomUUID();
const ACTOR = { id: randomUUID(), companyId: COMPANY };
const OTHER = { employeeId: randomUUID(), userId: randomUUID() };
const NEXT = { employeeId: randomUUID(), userId: randomUUID() };
const TX = { __tx: randomUUID() };

function makeEvents(afterRow: Record<string, unknown> = {}) {
  const outbox = { enqueue: vi.fn().mockResolvedValue(randomUUID()) };
  const actionsRepo = {
    findActionRawTx: vi.fn().mockResolvedValue({
      id: "task-1",
      title: "Sau patch",
      taskCode: "TASK-0001",
      projectId: null,
      mainAssigneeEmployeeId: NEXT.employeeId,
      assigneeUserId: NEXT.userId,
      dueAt: "2026-12-05T09:30:00.000Z",
      taskPriority: "Urgent",
      ...afterRow,
    }),
    hasApprovedLeaveOnDateTx: vi.fn().mockResolvedValue(false),
    isEmployeeProjectMemberTx: vi.fn().mockResolvedValue(true),
  };
  const coreRepo = { findActiveEmployeeByUserTx: vi.fn().mockResolvedValue({ id: randomUUID() }) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const activity = { record: vi.fn().mockResolvedValue(undefined) };
  const events = new TaskAssignEvents(
    outbox as never,
    actionsRepo as never,
    coreRepo as never,
    audit as never,
    activity as never,
  );
  return { events, outbox, audit, activity, actionsRepo };
}

const TASK = { id: "task-1", title: "Viết báo cáo", taskCode: "TASK-0001", projectId: null };
const SNAPSHOT = { title: "Viết báo cáo", status: "Todo", stateId: null };

function payloadKeys(outbox: { enqueue: ReturnType<typeof vi.fn> }): string[] {
  return outbox.enqueue.mock.calls.flatMap(([, ev]) => Object.keys(ev.payload as object));
}

describe("assignKind — bảng loại sự kiện giao việc (một nguồn với /assign)", () => {
  it("chưa có người ⇒ task.assigned; đã có người ⇒ task.assignee_changed", () => {
    expect(assignKind(null)).toMatchObject({
      code: "TASK_ASSIGNED",
      auditAction: "TaskAssigned",
      eventType: "task.assigned",
    });
    expect(assignKind(randomUUID())).toMatchObject({
      code: "TASK_ASSIGNEE_CHANGED",
      auditAction: "TaskAssigneeChanged",
      eventType: "task.assignee_changed",
    });
  });

  it("commonTaskPayload chỉ mang ID/tiêu đề/mã/actor", () => {
    expect(Object.keys(commonTaskPayload("TASK_ASSIGNED", TASK, ACTOR.id, null)).sort()).toEqual([
      "actorEmployeeId",
      "actorUserId",
      "eventCode",
      "projectId",
      "taskCode",
      "taskId",
      "taskTitle",
    ]);
  });
});

describe("TaskAssignEvents.recordCreatedTx", () => {
  const base = { actor: ACTOR, actorEmployeeId: null, task: TASK, snapshot: SNAPSHOT };

  it("không người phụ trách ⇒ ghi activity + audit TASK_CREATED, 0 enqueue", async () => {
    const { events, outbox, audit, activity } = makeEvents();
    await events.recordCreatedTx(TX as never, { ...base, assignee: null });
    expect(activity.record).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: "TASK_CREATED" }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: "TaskCreated" }),
    );
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("tự giao cho chính mình ⇒ 0 enqueue", async () => {
    const { events, outbox } = makeEvents();
    const self = { employeeId: randomUUID(), userId: ACTOR.id };
    await events.recordCreatedTx(TX as never, { ...base, assignee: self });
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("giao người khác ⇒ đúng 1 task.assigned trên CHÍNH tx của caller, payload không description", async () => {
    const { events, outbox } = makeEvents();
    await events.recordCreatedTx(TX as never, { ...base, assignee: OTHER });
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    const [tx, ev] = outbox.enqueue.mock.calls[0];
    expect(tx).toBe(TX);
    expect(ev.eventType).toBe("task.assigned");
    expect(ev.payload).toMatchObject({
      eventCode: "TASK_ASSIGNED",
      oldAssigneeEmployeeId: null,
      assigneeEmployeeId: OTHER.employeeId,
      assigneeUserId: OTHER.userId,
    });
    expect(payloadKeys(outbox)).not.toContain("description");
  });
});

describe("TaskAssignEvents.recordPatchedTx", () => {
  const before = {
    projectId: null,
    parentTaskId: null,
    stateId: null,
    mainAssigneeEmployeeId: OTHER.employeeId,
    dueAt: "2026-11-20T03:00:00.000Z",
    taskPriority: "Medium",
  };
  const input = (fields: string[], audited: Record<string, unknown>) => ({
    actor: ACTOR,
    taskId: "task-1",
    before,
    auditedChanges: audited,
    parentChanged: false,
    newParentTaskId: null,
    fieldChanges: new Set(fields) as never,
  });

  it("chỉ tiêu đề/mô tả ⇒ activity + audit TASK_UPDATED, 0 enqueue", async () => {
    const { events, outbox, audit } = makeEvents();
    await events.recordPatchedTx(TX as never, input([], { title: "x", description: "y" }));
    expect(audit.record).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: "TaskUpdated" }),
    );
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("nhật ký rỗng ⇒ không ghi gì", async () => {
    const { events, outbox, audit, activity } = makeEvents();
    await events.recordPatchedTx(TX as never, input([], {}));
    expect([activity.record, audit.record, outbox.enqueue].map((f) => f.mock.calls.length)).toEqual(
      [0, 0, 0],
    );
  });

  it("đổi người mà hàng sau patch không gắn tài khoản ⇒ nổ TASK-ERR-ASSIGNEE-WITHOUT-USER, 0 enqueue", async () => {
    const { events, outbox } = makeEvents({ assigneeUserId: null });
    await expect(
      events.recordPatchedTx(
        TX as never,
        input(["assigneeEmployeeId"], { assigneeEmployeeId: NEXT.employeeId }),
      ),
    ).rejects.toThrow("TASK-ERR-ASSIGNEE-WITHOUT-USER");
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("gỡ người phụ trách ⇒ không phát, không nổ", async () => {
    const { events, outbox, audit } = makeEvents({
      mainAssigneeEmployeeId: null,
      assigneeUserId: null,
    });
    await events.recordPatchedTx(
      TX as never,
      input(["assigneeEmployeeId"], { assigneeEmployeeId: null }),
    );
    expect(audit.record).toHaveBeenCalledOnce();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("đổi người + hạn + ưu tiên ⇒ 3 enqueue, payload mang người phụ trách SAU patch, không description/reason", async () => {
    const { events, outbox } = makeEvents();
    await events.recordPatchedTx(
      TX as never,
      input(["assigneeEmployeeId", "dueAt", "priority"], {
        assigneeEmployeeId: NEXT.employeeId,
        dueAt: "2026-12-05T09:30:00.000Z",
        priority: "Urgent",
        description: "không được vào payload",
      }),
    );
    const evs = outbox.enqueue.mock.calls.map(([tx, ev]) => {
      expect(tx).toBe(TX);
      return ev as { eventType: string; payload: Record<string, unknown> };
    });
    expect(evs.map((e) => e.eventType).sort()).toEqual([
      "task.assignee_changed",
      "task.due_date_changed",
      "task.priority_changed",
    ]);
    for (const e of evs) expect(e.payload.assigneeUserId).toBe(NEXT.userId);
    const changed = evs.find((e) => e.eventType === "task.assignee_changed");
    expect(changed?.payload.oldAssigneeEmployeeId).toBe(OTHER.employeeId);
    expect(payloadKeys(outbox)).not.toContain("description");
    expect(payloadKeys(outbox)).not.toContain("reason");
  });
});
