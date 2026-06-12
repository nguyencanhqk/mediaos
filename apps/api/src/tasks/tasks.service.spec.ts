/**
 * G9-2 — Deny-path + audit RED suite cho TasksService (giao việc tay / office task).
 *
 * Bám đúng nền G9-1 đã land (mig 0040: `tasks` + project_id/workflow_instance_id nullable, CHECK 8 loại;
 * KHÔNG có created_by/priority/task_attachments → KHÔNG test các cột đó).
 *
 * Hành vi MONG MUỐN (G9-2):
 *   - SEC-1 (tenant-FK guard, in-tx): createTask với assignee KHÔNG cùng tenant / đã ngưng hoạt động
 *     → reject TRƯỚC khi insert (KHÔNG ghi row, KHÔNG audit). project_id chéo tenant → NotFound.
 *     Lý do: DB FK (assignee_user_id/project_id) tham chiếu PK toàn cục → cross-tenant value vẫn thoả
 *     ràng buộc DB; RLS chỉ chặn ĐỌC lại, KHÔNG chặn ghi giá trị FK của tenant khác. Guard app-side bắt buộc.
 *   - createTask office hợp lệ (mọi FK NULL) → THÀNH CÔNG + audit TaskCreated (CT1 ở tầng service).
 *   - FSM office rút gọn: updateStatus chỉ áp task KHÔNG thuộc workflow; task workflow-driven → reject.
 *   - soft-delete: deleteTask office → softDelete + audit TaskDeleted; task workflow → reject (engine quản).
 */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TasksService } from "./tasks.service";
import type { CreateTaskRequest } from "@mediaos/contracts";

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const ACTOR_ID = "22222222-2222-2222-2222-222222222222";
const TASK_ID = "33333333-3333-3333-3333-333333333333";
const ASSIGNEE_ID = "44444444-4444-4444-4444-444444444444";
const PROJECT_ID = "55555555-5555-5555-5555-555555555555";

const USER = { id: ACTOR_ID, companyId: COMPANY_ID };

function makeRepo() {
  return {
    // reads
    findByAssignee: vi.fn(),
    listAll: vi.fn(),
    listByProject: vi.fn(),
    listByTeam: vi.fn(),
    findByIdFull: vi.fn().mockResolvedValue([{ id: TASK_ID, taskType: "office", title: "Soạn báo cáo" }]),
    findRawByIdTx: vi
      .fn()
      .mockResolvedValue([{ id: TASK_ID, taskType: "office", workflowStepId: null, status: "not_started" }]),
    // tenant-FK guards (SEC-1) — mặc định hợp lệ
    assigneeActiveTx: vi.fn().mockResolvedValue(true),
    projectExistsTx: vi.fn().mockResolvedValue(true),
    // writes
    createTask: vi.fn().mockResolvedValue([{ id: TASK_ID }]),
    updateStatus: vi.fn().mockResolvedValue([{ id: TASK_ID }]),
    softDelete: vi.fn().mockResolvedValue([{ id: TASK_ID }]),
    // comments
    findCommentsByTaskId: vi.fn().mockResolvedValue([]),
    createComment: vi.fn(),
  };
}

/** withTenant chạy callback với fake tx — đồng bộ positions.service.spec.ts. */
function makeDb() {
  return {
    withTenant: vi
      .fn()
      .mockImplementation((_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({ __tx: true }),
      ),
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makeService(opts: {
  repo?: ReturnType<typeof makeRepo>;
  db?: ReturnType<typeof makeDb>;
  audit?: ReturnType<typeof makeAudit>;
} = {}) {
  const repo = opts.repo ?? makeRepo();
  const db = opts.db ?? makeDb();
  const audit = opts.audit ?? makeAudit();
  const service = new TasksService(db as never, repo as never, audit as never);
  return { service, repo, db, audit };
}

const OFFICE_TASK: CreateTaskRequest = { title: "Soạn báo cáo", taskType: "office" };

describe("TasksService.createTask — SEC-1 tenant-FK guard + audit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("CT1: office task mọi FK NULL → tạo được + audit TaskCreated (không cần video/step/project)", async () => {
    const { service, repo, audit } = makeService();

    const result = await service.createTask(USER, OFFICE_TASK);

    expect(result).toMatchObject({ id: TASK_ID });
    expect(repo.assigneeActiveTx).not.toHaveBeenCalled(); // không có assignee → không gọi guard
    expect(repo.projectExistsTx).not.toHaveBeenCalled();
    expect(repo.createTask).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "TaskCreated", objectType: "task", objectId: TASK_ID, actorUserId: ACTOR_ID }),
    );
  });

  it("CT5: assignee KHÔNG cùng tenant/đã ngưng → BadRequest, KHÔNG insert, KHÔNG audit", async () => {
    const repo = makeRepo();
    repo.assigneeActiveTx.mockResolvedValueOnce(false);
    const { service, audit } = makeService({ repo });

    await expect(
      service.createTask(USER, { ...OFFICE_TASK, assigneeUserId: ASSIGNEE_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repo.assigneeActiveTx).toHaveBeenCalledWith(expect.anything(), COMPANY_ID, ASSIGNEE_ID);
    expect(repo.createTask).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("CT6: project_id chéo tenant → NotFound, KHÔNG insert, KHÔNG audit", async () => {
    const repo = makeRepo();
    repo.projectExistsTx.mockResolvedValueOnce(false);
    const { service, audit } = makeService({ repo });

    await expect(
      service.createTask(USER, { ...OFFICE_TASK, projectId: PROJECT_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(repo.projectExistsTx).toHaveBeenCalledWith(expect.anything(), COMPANY_ID, PROJECT_ID);
    expect(repo.createTask).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("assignee + project hợp lệ cùng tenant → guard pass, insert + audit", async () => {
    const { service, repo } = makeService();

    await service.createTask(USER, { ...OFFICE_TASK, assigneeUserId: ASSIGNEE_ID, projectId: PROJECT_ID });

    expect(repo.assigneeActiveTx).toHaveBeenCalledOnce();
    expect(repo.projectExistsTx).toHaveBeenCalledOnce();
    expect(repo.createTask).toHaveBeenCalledOnce();
  });
});

describe("TasksService.updateStatus — FSM office rút gọn (D3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("CT8: office not_started → in_progress OK + audit TaskStatusChanged before/after", async () => {
    const { service, repo, audit } = makeService();

    await service.updateStatus(USER, TASK_ID, "in_progress");

    expect(repo.updateStatus).toHaveBeenCalledWith(COMPANY_ID, TASK_ID, "in_progress", expect.anything());
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "TaskStatusChanged",
        objectType: "task",
        objectId: TASK_ID,
        before: { status: "not_started" },
        after: { status: "in_progress" },
      }),
    );
  });

  it("task workflow-driven (workflowStepId set) → reject, KHÔNG update, KHÔNG audit", async () => {
    const repo = makeRepo();
    repo.findRawByIdTx.mockResolvedValueOnce([
      { id: TASK_ID, taskType: "workflow_step", workflowStepId: "step-1", status: "in_progress" },
    ]);
    const { service, audit } = makeService({ repo });

    await expect(service.updateStatus(USER, TASK_ID, "completed")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.updateStatus).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("task type production (workflow-driven) → reject dù step NULL", async () => {
    const repo = makeRepo();
    repo.findRawByIdTx.mockResolvedValueOnce([
      { id: TASK_ID, taskType: "production", workflowStepId: null, status: "in_progress" },
    ]);
    const { service } = makeService({ repo });

    await expect(service.updateStatus(USER, TASK_ID, "completed")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("task không tồn tại → NotFound", async () => {
    const repo = makeRepo();
    repo.findRawByIdTx.mockResolvedValueOnce([]);
    const { service } = makeService({ repo });

    await expect(service.updateStatus(USER, TASK_ID, "in_progress")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("TasksService.deleteTask — soft-delete (CT11) + reject workflow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("office task → softDelete + audit TaskDeleted (KHÔNG hard-delete)", async () => {
    const { service, repo, audit } = makeService();

    await service.deleteTask(USER, TASK_ID);

    expect(repo.softDelete).toHaveBeenCalledWith(COMPANY_ID, TASK_ID, expect.anything());
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "TaskDeleted", objectType: "task", objectId: TASK_ID }),
    );
  });

  it("task workflow-driven → reject, KHÔNG softDelete", async () => {
    const repo = makeRepo();
    repo.findRawByIdTx.mockResolvedValueOnce([
      { id: TASK_ID, taskType: "review", workflowStepId: "step-1", status: "waiting_review" },
    ]);
    const { service, audit } = makeService({ repo });

    await expect(service.deleteTask(USER, TASK_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.softDelete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("task không tồn tại → NotFound", async () => {
    const repo = makeRepo();
    repo.findRawByIdTx.mockResolvedValueOnce([]);
    const { service } = makeService({ repo });

    await expect(service.deleteTask(USER, TASK_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
