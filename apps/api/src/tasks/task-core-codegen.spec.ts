/**
 * S5-NOTI-FIX-2 (lane notifix2-taskcode-codegen) — QA2-CRIT-002 remediation (a): task_code CODE-GEN cut-over.
 *
 * Team-3 finding (vòng SỬA): task_code KHÔNG được set ở BẤT KỲ luồng tạo task thực nào ⇒ createTask sinh
 * task_code=NULL cho mọi task tạo qua API ⇒ TASK_COMMENT_CREATED/TASK_MENTIONED render '{task_code}' câm
 * (renderer giữ nguyên placeholder khi payload[key]=null). Fix = createTask cấp mã qua
 * `SequenceService.nextCode({sequenceKey:'task'})` trong tx RIÊNG TRƯỚC business tx (mirror
 * allocateEmployeeCode: FOR UPDATE 0-dup, gaps OK, KHÔNG giữ lock suốt tx dài) rồi thread taskCode vào
 * `insertTaskCoreTx` (cột `tasks.task_code`, seed counter 'task' ở migration 0498).
 *
 * Unit thuần (KHÔNG DB) — khoá HỢP ĐỒNG code-gen ở tầng service (đường DB thật + render '{' = int-spec).
 * RED trước wire: createTask KHÔNG gọi sequence.nextCode ⇒ insertTaskCoreTx nhận taskCode=undefined.
 */

import { describe, expect, it, vi } from "vitest";
import { TaskCoreService } from "./task-core.service";
import { SequenceNotFoundError } from "../foundation/sequences/sequence.types";

const COMPANY = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ACTOR = "11111111-1111-1111-1111-111111111111";
const NEW_TASK_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const FAKE_TX = { __tx: true };
const user = { id: ACTOR, companyId: COMPANY };

/** Hàng reload sau insert (toDto cần createdAt/updatedAt/isOverdue) — taskCode để chứng minh projection có mã. */
function reloadRow() {
  return {
    id: NEW_TASK_ID,
    companyId: COMPANY,
    title: "T",
    description: null,
    taskType: "office",
    taskCode: "TASK-0001",
    taskStatus: "Todo",
    taskPriority: null,
    projectId: null,
    projectName: null,
    mainAssigneeEmployeeId: null,
    assigneeName: null,
    creatorUserId: ACTOR,
    creatorName: null,
    reporterEmployeeId: null,
    departmentId: null,
    dueAt: null,
    startAt: null,
    completedAt: null,
    isOverdue: false,
    createdBy: ACTOR,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

function makeSequence(
  overrides: {
    nextCode?: ReturnType<typeof vi.fn>;
    ensureCounterTx?: ReturnType<typeof vi.fn>;
  } = {},
) {
  return {
    nextCode:
      overrides.nextCode ??
      vi.fn().mockResolvedValue({ sequenceKey: "task", value: 1, code: "TASK-0001" }),
    ensureCounterTx: overrides.ensureCounterTx ?? vi.fn().mockResolvedValue(undefined),
  };
}

function makeService(opts: { sequence?: ReturnType<typeof makeSequence> } = {}) {
  const repo = {
    findActiveEmployeeByUserTx: vi
      .fn()
      .mockResolvedValue({ id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" }),
    insertTaskCoreTx: vi.fn().mockResolvedValue({ id: NEW_TASK_ID }),
    findScopedByIdTx: vi.fn().mockResolvedValue(reloadRow()),
    // S5-TASK-PIPELINE-1 — createTask tra cột mặc định khi có projectId (undefined = project 0 state).
    findDefaultStateTx: vi.fn().mockResolvedValue(undefined),
    findStateForWriteTx: vi.fn().mockResolvedValue(undefined),
  };
  const db = {
    withTenant: vi.fn((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(FAKE_TX)),
  };
  const tasksRepo = {};
  // Company scope → createTask không lọc scope thêm; assignee null (dto không gửi).
  const dataScope = { resolveAndAssert: vi.fn().mockResolvedValue("Company") };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const activity = { record: vi.fn().mockResolvedValue(undefined) };
  const sequence = opts.sequence ?? makeSequence();
  // S5-TASK-PIPELINE-1 — 2 dependency mới của đường ghi state (dto test KHÔNG gửi stateId ⇒
  // createTask chỉ gọi findDefaultStateTx khi có projectId; mock trả undefined = project 0 state).
  const taskActions = { isChecklistGateEnabled: vi.fn().mockResolvedValue(false) };
  const permission = { resolveStrongestScope: vi.fn().mockResolvedValue("Company") };
  // S5-TASK-PROJROLE-1 — dependency mới (tầng project_role). Test này chạy scope Company ⇒ create-scope
  // bypass, KHÔNG gọi membership; mock trả null cho an toàn.
  const projectAccess = {
    getMembershipTx: vi.fn().mockResolvedValue(null),
    assertProjectRoleTx: vi.fn().mockResolvedValue({ role: "Owner", memberId: "m" }),
    assertTaskInScopeTx: vi.fn().mockResolvedValue(undefined),
  };
  const svc = new TaskCoreService(
    db as never,
    repo as never,
    tasksRepo as never,
    dataScope as never,
    audit as never,
    activity as never,
    sequence as never,
    taskActions as never,
    permission as never,
    projectAccess as never,
  );
  return { svc, repo, db, sequence };
}

describe("TaskCoreService.createTask — task_code code-gen (S5-NOTI-FIX-2, QA2-CRIT-002)", () => {
  it("cấp mã qua sequence.nextCode({sequenceKey:'task'}) cho company rồi thread vào insertTaskCoreTx", async () => {
    const { svc, repo, sequence } = makeService();
    await svc.createTask(user, { title: "Viết báo cáo" } as never);

    expect(sequence.nextCode).toHaveBeenCalledOnce();
    const [companyId, input] = sequence.nextCode.mock.calls[0];
    expect(companyId).toBe(COMPANY);
    expect(input).toMatchObject({ sequenceKey: "task" });

    expect(repo.insertTaskCoreTx).toHaveBeenCalledOnce();
    const insertVals = repo.insertTaskCoreTx.mock.calls[0][2] as { taskCode?: string };
    expect(insertVals.taskCode).toBe("TASK-0001");
  });

  it("cấp mã trong tx RIÊNG TRƯỚC insert (KHÔNG long tx): nextCode chạy TRƯỚC insertTaskCoreTx", async () => {
    const { svc, repo, sequence } = makeService();
    await svc.createTask(user, { title: "X" } as never);
    // invocationCallOrder tăng đơn điệu toàn suite ⇒ nextCode phải có số thứ tự nhỏ hơn insert.
    expect(sequence.nextCode.mock.invocationCallOrder[0]).toBeLessThan(
      repo.insertTaskCoreTx.mock.invocationCallOrder[0],
    );
  });

  it("ensure-on-miss: counter chưa seed (SequenceNotFoundError) → ensureCounterTx (config TASK canonical) → retry nextCode ĐÚNG 1 lần", async () => {
    const nextCode = vi
      .fn()
      .mockRejectedValueOnce(new SequenceNotFoundError("task"))
      .mockResolvedValueOnce({ sequenceKey: "task", value: 1, code: "TASK-0007" });
    const ensureCounterTx = vi.fn().mockResolvedValue(undefined);
    const { svc, repo } = makeService({ sequence: makeSequence({ nextCode, ensureCounterTx }) });

    await svc.createTask(user, { title: "X" } as never);

    expect(ensureCounterTx).toHaveBeenCalledOnce();
    const [, companyId, key, defaults] = ensureCounterTx.mock.calls[0];
    expect(companyId).toBe(COMPANY);
    expect(key).toMatchObject({ sequenceKey: "task" });
    // Canonical config PHẢI khớp migration 0498 (prefix/padding/module/reset) — CẤM drift.
    expect(defaults).toMatchObject({
      moduleCode: "TASK",
      prefix: "TASK-",
      paddingLength: 4,
      resetPolicy: "Never",
      status: "Active",
    });
    expect(nextCode).toHaveBeenCalledTimes(2);
    expect((repo.insertTaskCoreTx.mock.calls[0][2] as { taskCode?: string }).taskCode).toBe(
      "TASK-0007",
    );
  });

  it("KHÔNG lặp vô hạn: nextCode vẫn NotFound sau ensure → ném (retry ĐÚNG 1 lần), KHÔNG insert task", async () => {
    const nextCode = vi.fn().mockRejectedValue(new SequenceNotFoundError("task"));
    const ensureCounterTx = vi.fn().mockResolvedValue(undefined);
    const { svc, repo } = makeService({ sequence: makeSequence({ nextCode, ensureCounterTx }) });

    await expect(svc.createTask(user, { title: "X" } as never)).rejects.toThrow();

    expect(nextCode).toHaveBeenCalledTimes(2); // gốc + đúng 1 retry, KHÔNG loop
    expect(repo.insertTaskCoreTx).not.toHaveBeenCalled(); // fail-loud: mã lỗi ⇒ KHÔNG tạo task câm
  });
});
