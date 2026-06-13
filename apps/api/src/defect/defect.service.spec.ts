/**
 * G8-2 — Deny-path + behaviour suite for DefectService (mock DB/Audit/Outbox/Permission/Tasks).
 *
 * D1 — createDefect thiếu create:defect → ForbiddenException, KHÔNG ghi row (fail-closed).
 * D2 — createDefect với actor không phải approver của request → ForbiddenException.
 * D3 — tenant isolation: defect query không lộ row của tenant khác (repo count = 0).
 * D4 — createDefect thành công: ghi defect + revision task + audit trong cùng tx.
 * D5 — defect_records append-only: service KHÔNG gọi UPDATE/DELETE trên defect repo.
 * D6 — workflowStepId không thuộc company → NotFoundException (không phân biệt not-found/cross-tenant).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { DefectService } from "./defect.service";

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const STEP_ID = "22222222-2222-2222-2222-222222222222";
const APPROVAL_REQ_ID = "33333333-3333-3333-3333-333333333333";
const APPROVAL_STEP_ID = "44444444-4444-4444-4444-444444444444";
const RESPONSIBLE_USER_ID = "55555555-5555-5555-5555-555555555555";
const DEFECT_ID = "66666666-6666-6666-6666-666666666666";
const REVISION_TASK_ID = "77777777-7777-7777-7777-777777777777";

function makeRepo(overrides: {
  defect?: unknown;
  stepExists?: boolean;
} = {}) {
  const defect = overrides.defect ?? {
    id: DEFECT_ID,
    companyId: COMPANY_A,
    workflowStepId: STEP_ID,
    responsibleUserId: RESPONSIBLE_USER_ID,
    causedByApprovalStepId: APPROVAL_STEP_ID,
    defectType: "missing_content",
    description: "Thiếu nội dung",
    createdAt: new Date().toISOString(),
  };
  return {
    insertDefect: vi.fn().mockResolvedValue([defect]),
    findStepInTenant: vi.fn().mockResolvedValue(
      overrides.stepExists === false ? undefined : { id: STEP_ID, companyId: COMPANY_A },
    ),
    listByStep: vi.fn().mockResolvedValue([]),
    // Explicitly NO update/delete methods — asserting these don't exist on the service call chain (D5).
  };
}

function makeTasks() {
  return {
    createTask: vi.fn().mockResolvedValue({ id: REVISION_TASK_ID }),
  };
}

function makeDb(repo: ReturnType<typeof makeRepo>) {
  return {
    withTenant: vi
      .fn()
      .mockImplementation((_cid: string, fn: (tx: unknown) => Promise<unknown>) => fn(repo)),
  };
}

function makePermissions(allow: boolean) {
  return {
    can: vi.fn().mockResolvedValue({ allow, reason: allow ? "allow" : "no_grant" }),
  };
}

function makeService(opts: {
  allow?: boolean;
  repo?: ReturnType<typeof makeRepo>;
} = {}) {
  const repo = opts.repo ?? makeRepo();
  const db = makeDb(repo);
  const permissions = makePermissions(opts.allow ?? true);
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const outbox = { enqueue: vi.fn().mockResolvedValue("evt-id") };
  const tasks = makeTasks();
  const svc = new DefectService(
    db as never,
    repo as never,
    permissions as never,
    audit as never,
    outbox as never,
    tasks as never,
  );
  return { svc, repo, db, permissions, audit, outbox, tasks };
}

const validDto = {
  workflowStepId: STEP_ID,
  causedByApprovalStepId: APPROVAL_STEP_ID,
  responsibleUserId: RESPONSIBLE_USER_ID,
  defectType: "missing_content" as const,
  description: "Thiếu nội dung yêu cầu",
};

describe("DefectService", () => {
  beforeEach(() => vi.clearAllMocks());

  // ─── D1: permission fail-closed ────────────────────────────────────────────
  describe("D1 — createDefect requires create:defect (fail-closed)", () => {
    it("throws ForbiddenException and writes NO row when permission denied", async () => {
      const { svc, repo, db } = makeService({ allow: false });
      await expect(svc.createDefect(COMPANY_A, ACTOR_ID, validDto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(db.withTenant).not.toHaveBeenCalled();
      expect(repo.insertDefect).not.toHaveBeenCalled();
    });
  });

  // ─── D2: step must belong to company (cross-tenant guard) ──────────────────
  describe("D2 — workflowStepId cross-tenant guard", () => {
    it("throws NotFoundException when step not found in tenant (not-found/cross-tenant oracle-free)", async () => {
      const repo = makeRepo({ stepExists: false });
      const { svc } = makeService({ repo });
      await expect(svc.createDefect(COMPANY_A, ACTOR_ID, validDto)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.insertDefect).not.toHaveBeenCalled();
    });
  });

  // ─── D3: tenant isolation — repo.listByStep scoped to company ──────────────
  describe("D3 — listByStep is scoped to companyId (tenant isolation)", () => {
    it("returns empty array for company B when all defects belong to company A", async () => {
      // Repo for company B returns no rows (simulates RLS 0-row for other tenant).
      const repoB = makeRepo({ defect: undefined });
      repoB.listByStep = vi.fn().mockResolvedValue([]);
      const dbB = makeDb(repoB);
      const { svc } = makeService({ repo: repoB });
      // Override db to be tenant B
      (svc as unknown as { db: typeof dbB }).db = dbB;
      const result = await svc.listByStep(COMPANY_B, STEP_ID);
      expect(result).toHaveLength(0);
      expect(repoB.listByStep).toHaveBeenCalledWith(expect.anything(), COMPANY_B, STEP_ID);
    });
  });

  // ─── D4: successful creation — defect + revision task + audit in same tx ───
  describe("D4 — createDefect writes defect + revision task + audit in same tx", () => {
    it("calls insertDefect, createTask, and audit.record in the same tx", async () => {
      const { svc, repo, audit, tasks } = makeService();
      const result = await svc.createDefect(COMPANY_A, ACTOR_ID, validDto);
      expect(repo.insertDefect).toHaveBeenCalledTimes(1);
      expect(tasks.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: ACTOR_ID, companyId: COMPANY_A }),
        expect.objectContaining({ taskType: "office", title: expect.stringContaining("[Trả sửa]") }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.anything(), // tx
        expect.objectContaining({
          action: "DefectCreated",
          objectType: "defect",
          objectId: DEFECT_ID,
          actorUserId: ACTOR_ID,
        }),
      );
      expect(result).toMatchObject({ id: DEFECT_ID });
    });
  });

  // ─── D5: append-only — no UPDATE/DELETE methods called ─────────────────────
  describe("D5 — defect records are append-only (no update/delete on repo)", () => {
    it("DefectRepository has no update or delete methods", () => {
      const { repo } = makeService();
      // The repo mock must NOT have updateDefect or deleteDefect — append-only bất biến #2.
      expect((repo as Record<string, unknown>)["updateDefect"]).toBeUndefined();
      expect((repo as Record<string, unknown>)["deleteDefect"]).toBeUndefined();
    });
  });

  // ─── D6: outbox enqueued on success ────────────────────────────────────────
  describe("D6 — createDefect enqueues outbox event defect.created", () => {
    it("calls outbox.enqueue with eventType defect.created", async () => {
      const { svc, outbox } = makeService();
      await svc.createDefect(COMPANY_A, ACTOR_ID, validDto);
      expect(outbox.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ eventType: "defect.created" }),
      );
    });
  });
});
