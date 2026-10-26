/**
 * S20-TASK-DUEREMIND-1 (done_when 4) — người nhận `TASK_STATUS_CHANGED` của `TaskNotiBridgeRegistrar`.
 * CHẠY KHÔNG CẦN DB: reader giả, `withTenant` chạy thẳng callback.
 *
 * Ghim: sang «In Review» ⇒ audience cũ ∪ Owner/Manager dự án, mỗi người MỘT lần (người tạo kiêm Owner không
 * lặp); trạng thái khác ⇒ không đọc danh sách reviewer; mọi phần đọc nằm trong MỘT `withTenant`.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskAudience } from "./task-audience.reader";
import { TaskNotiBridgeRegistrar } from "./task-noti-bridge.registrar";

interface Registered {
  eventType: string;
  resolveRecipients: (ctx: unknown) => Promise<string[]>;
}

const COMPANY_ID = randomUUID();
const TASK_ID = randomUUID();
const CREATOR = randomUUID();
const ASSIGNEE = randomUUID();
const WATCHER = randomUUID();
const MANAGER = randomUUID();

function ctxOf(payload: Record<string, unknown>) {
  return { companyId: COMPANY_ID, eventId: randomUUID(), payload };
}

describe("TaskNotiBridgeRegistrar — TASK_STATUS_CHANGED", () => {
  let registered: Registered[];
  const audience: TaskAudience = {
    assigneeUserId: ASSIGNEE,
    creatorUserId: CREATOR,
    watcherUserIds: [WATCHER],
  };
  const reader = {
    resolve: vi.fn(async () => audience),
    // Người tạo cũng là Owner ⇒ xuất hiện ở cả hai nguồn.
    projectReviewerUserIds: vi.fn(async () => [CREATOR, MANAGER]),
  };
  const db = {
    withTenant: vi.fn((_c: string, fn: (tx: unknown) => unknown) => fn({ tx: "fake" })),
  };

  beforeEach(() => {
    registered = [];
    vi.clearAllMocks();
    const bridge = { registerSource: (s: Registered) => registered.push(s) };
    new TaskNotiBridgeRegistrar(db as never, reader as never, bridge as never).onModuleInit();
  });

  const statusChanged = () => {
    const found = registered.find((r) => r.eventType === "task.status_changed");
    expect(found).toBeDefined();
    return found as Registered;
  };

  it("sang In Review ⇒ thêm Owner/Manager dự án, mỗi người đúng một lần", async () => {
    const out = await statusChanged().resolveRecipients(
      ctxOf({ taskId: TASK_ID, toStatus: "In Review", fromStatus: "In Progress" }),
    );
    expect([...out].sort()).toEqual([ASSIGNEE, CREATOR, MANAGER, WATCHER].sort());
    expect(out.filter((id) => id === CREATOR)).toHaveLength(1);
    expect(reader.projectReviewerUserIds).toHaveBeenCalledWith({ tx: "fake" }, COMPANY_ID, TASK_ID);
    expect(db.withTenant).toHaveBeenCalledTimes(1);
  });

  it("trạng thái khác ⇒ người nhận như cũ, không đọc danh sách reviewer", async () => {
    const out = await statusChanged().resolveRecipients(
      ctxOf({ taskId: TASK_ID, toStatus: "In Progress", fromStatus: "Todo" }),
    );
    expect([...out].sort()).toEqual([ASSIGNEE, CREATOR, WATCHER].sort());
    expect(reader.projectReviewerUserIds).not.toHaveBeenCalled();
  });

  it("payload thiếu taskId ⇒ không đọc gì, không người nhận", async () => {
    const out = await statusChanged().resolveRecipients(ctxOf({ toStatus: "In Review" }));
    expect(out).toEqual([]);
    expect(db.withTenant).not.toHaveBeenCalled();
  });
});
