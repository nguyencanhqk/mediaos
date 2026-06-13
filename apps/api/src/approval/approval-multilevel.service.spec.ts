/**
 * G8-1 — Deny-path + behaviour RED suite for ApprovalMultilevelService (APR-001/002).
 *
 * ADR-0016: approval_requests = SOURCE OF TRUTH (current_level / max_level). approval_steps = projection,
 * append-only (1 decision per (request_id, level), enforced by approval_steps_request_level_uq).
 *
 * Architectural decision (G8-1): the existing single-level G4-5 ApprovalService.approve() ALWAYS closes
 * the request + completes/fans-out the workflow. For multi-level we MUST NOT close early when
 * current_level < max_level. So ApprovalMultilevelService:
 *   - level < max_level  → append approval_steps(level=current_level, approved) + bump current_level
 *                          (UPDATE approval_requests — the source of truth). Request STAYS pending.
 *                          NO workflow_step approve, NO fan-out, NO complete.
 *   - level == max_level → delegate to the proven G4-5 finalApprove() path (close request + approve
 *                          workflow_step + DAG fan-out + complete-if-done), unchanged.
 *
 * Cases:
 *   G1 — approve when actor is NOT approver of current_level (approver of level 2 acts while
 *        current_level=1) → ConflictException 'not your level yet'; NO approval_steps row written.
 *   G2 — approve when actor IS approver of current_level but level < max_level → append step(level=1)
 *        + bump current_level→2; request stays pending; finalApprove() NEVER called.
 *   G3 — approve at the LAST level (current_level == max_level) → delegate to finalApprove() exactly once.
 *   G4 — append-only: a duplicate decision on the same (request, level) surfaces 23505 → 409.
 *   G5 — reject at any level → close request revision_requested (delegates to finalReject), never bumps.
 *   G6 — approve when request NOT pending → ConflictException (no step written).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { ApprovalMultilevelService } from "./approval-multilevel.service";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const REQUEST_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const STEP_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const L1_APPROVER = "11111111-1111-1111-1111-111111111111";
const L2_APPROVER = "22222222-2222-2222-2222-222222222222";

const PG_UNIQUE_VIOLATION = "23505";

function makeRequest(overrides: Partial<{ status: string; currentLevel: number; maxLevel: number }> = {}) {
  return {
    id: REQUEST_ID,
    companyId: COMPANY_ID,
    workflowStepId: STEP_ID,
    requestedBy: L1_APPROVER,
    assigneeId: null,
    status: overrides.status ?? "pending",
    currentLevel: overrides.currentLevel ?? 1,
    maxLevel: overrides.maxLevel ?? 3,
    decidedAt: null,
    comment: null,
    createdAt: new Date(),
  };
}

/** Rule rows: one approver mapping per level (level → approverUserId). */
function makeRules(map: Record<number, string>) {
  return Object.entries(map).map(([level, approverUserId]) => ({
    id: `rule-${level}`,
    companyId: COMPANY_ID,
    level: Number(level),
    approverUserId,
  }));
}

function makeRepo(overrides: {
  request?: ReturnType<typeof makeRequest>;
  rules?: ReturnType<typeof makeRules>;
  createApprovalStepImpl?: () => Promise<unknown>;
} = {}) {
  const request = overrides.request ?? makeRequest();
  const rules = overrides.rules ?? makeRules({ 1: L1_APPROVER, 2: L2_APPROVER, 3: L2_APPROVER });
  return {
    findApprovalRequestById: vi.fn().mockResolvedValue([request]),
    findRulesForStep: vi.fn().mockResolvedValue(rules),
    lockApprovalRequestForUpdateInTx: vi.fn().mockResolvedValue([request]),
    createApprovalStep:
      overrides.createApprovalStepImpl
        ? vi.fn().mockImplementation(overrides.createApprovalStepImpl)
        : vi.fn().mockResolvedValue([{ id: "new-approval-step" }]),
    bumpCurrentLevel: vi.fn().mockResolvedValue([{ ...request, currentLevel: request.currentLevel + 1 }]),
  };
}

function makeDb(repo: ReturnType<typeof makeRepo>) {
  return {
    withTenant: vi.fn().mockImplementation((_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn(repo),
    ),
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}
function makeOutbox() {
  return { enqueue: vi.fn().mockResolvedValue(undefined) };
}
/** The delegated G4-5 ApprovalService path. Spied so we can assert it is/isn't called. */
function makeFinal() {
  return {
    approve: vi.fn().mockResolvedValue({ isWorkflowComplete: true }),
    requestRevision: vi.fn().mockResolvedValue({ step: { id: STEP_ID } }),
  };
}

function makeService(repo: ReturnType<typeof makeRepo>, final = makeFinal()) {
  const audit = makeAudit();
  const outbox = makeOutbox();
  const svc = new ApprovalMultilevelService(
    makeDb(repo) as never,
    repo as never,
    final as never,
    audit as never,
    outbox as never,
  );
  return { svc, final, audit, outbox };
}

describe("ApprovalMultilevelService", () => {
  beforeEach(() => vi.clearAllMocks());

  // ─── G1: not your level yet ─────────────────────────────────────────────────
  describe("G1 — gating: approver of a later level acts before their turn", () => {
    it("throws ConflictException 'not your level yet' and writes NO approval_steps row", async () => {
      const repo = makeRepo({ request: makeRequest({ currentLevel: 1, maxLevel: 3 }) });
      const { svc } = makeService(repo);

      // L2_APPROVER is the approver for level 2 (and 3) but current_level is 1.
      await expect(svc.approveLevel(COMPANY_ID, REQUEST_ID, L2_APPROVER)).rejects.toThrow(
        ConflictException,
      );
      expect(repo.createApprovalStep).not.toHaveBeenCalled();
      expect(repo.bumpCurrentLevel).not.toHaveBeenCalled();
    });
  });

  // ─── G2: open next level ────────────────────────────────────────────────────
  describe("G2 — open next level when level < max_level", () => {
    it("appends step(level=1) + bumps current_level→2; request stays pending; finalApprove NOT called", async () => {
      const repo = makeRepo({ request: makeRequest({ currentLevel: 1, maxLevel: 3 }) });
      const { svc, final } = makeService(repo);

      const result = await svc.approveLevel(COMPANY_ID, REQUEST_ID, L1_APPROVER);

      expect(repo.createApprovalStep).toHaveBeenCalledWith(
        COMPANY_ID,
        expect.objectContaining({ approvalRequestId: REQUEST_ID, level: 1, decision: "approved" }),
        repo,
      );
      expect(repo.bumpCurrentLevel).toHaveBeenCalledWith(COMPANY_ID, REQUEST_ID, 2, repo);
      expect(final.approve).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: "pending", currentLevel: 2 });
    });

    it("audits ApprovalLevelApproved in the same tx for an intermediate level", async () => {
      const repo = makeRepo({ request: makeRequest({ currentLevel: 1, maxLevel: 2 }) });
      const { svc, audit } = makeService(repo);

      await svc.approveLevel(COMPANY_ID, REQUEST_ID, L1_APPROVER);

      expect(audit.record).toHaveBeenCalledWith(
        repo,
        expect.objectContaining({ action: "ApprovalLevelApproved", objectType: "approval_request" }),
      );
    });
  });

  // ─── G3: final level delegates ──────────────────────────────────────────────
  describe("G3 — last level delegates to finalApprove (G4-5 path)", () => {
    it("calls finalApprove exactly once and does NOT bump when current_level == max_level", async () => {
      const repo = makeRepo({
        request: makeRequest({ currentLevel: 3, maxLevel: 3 }),
        rules: makeRules({ 1: L1_APPROVER, 2: L2_APPROVER, 3: L2_APPROVER }),
      });
      const { svc, final } = makeService(repo);

      await svc.approveLevel(COMPANY_ID, REQUEST_ID, L2_APPROVER);

      expect(final.approve).toHaveBeenCalledTimes(1);
      expect(repo.bumpCurrentLevel).not.toHaveBeenCalled();
    });
  });

  // ─── G4: append-only double-decision ────────────────────────────────────────
  describe("G4 — append-only: duplicate decision on (request, level)", () => {
    it("maps 23505 → ConflictException 409", async () => {
      const repo = makeRepo({
        request: makeRequest({ currentLevel: 1, maxLevel: 3 }),
        createApprovalStepImpl: () => Promise.reject({ code: PG_UNIQUE_VIOLATION }),
      });
      const { svc } = makeService(repo);

      await expect(svc.approveLevel(COMPANY_ID, REQUEST_ID, L1_APPROVER)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── G5: reject delegates to final-reject, never bumps ──────────────────────
  describe("G5 — reject at any level closes request, never bumps", () => {
    it("delegates to finalReject and never bumps current_level", async () => {
      const repo = makeRepo({ request: makeRequest({ currentLevel: 1, maxLevel: 3 }) });
      const { svc, final } = makeService(repo);

      await svc.rejectLevel(COMPANY_ID, REQUEST_ID, L1_APPROVER, "needs work");

      expect(final.requestRevision).toHaveBeenCalledTimes(1);
      expect(repo.bumpCurrentLevel).not.toHaveBeenCalled();
    });
  });

  // ─── G6: non-pending request ────────────────────────────────────────────────
  describe("G6 — approve a non-pending request", () => {
    it("throws ConflictException when request already approved (no step written)", async () => {
      const repo = makeRepo({ request: makeRequest({ status: "approved", currentLevel: 3, maxLevel: 3 }) });
      const { svc } = makeService(repo);

      await expect(svc.approveLevel(COMPANY_ID, REQUEST_ID, L2_APPROVER)).rejects.toThrow(
        ConflictException,
      );
      expect(repo.createApprovalStep).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when request does not exist", async () => {
      const repo = makeRepo();
      repo.findApprovalRequestById = vi.fn().mockResolvedValue([]);
      const { svc } = makeService(repo);

      await expect(svc.approveLevel(COMPANY_ID, REQUEST_ID, L1_APPROVER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
