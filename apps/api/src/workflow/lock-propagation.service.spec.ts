/**
 * G7-4a — LockPropagationService unit suite (mocked repo, pure orchestration).
 *
 * RED-first: fails until LockPropagationService + the three repo lock-methods exist.
 *   - propagateRevisionLock inserts ONE lock per transitive descendant (and none for independent
 *     branches — LK2 at service level), tagged caused_by = the revised step.
 *   - releaseLocksForReapproved delegates a per-cause soft-release to the repo.
 *   - isStepLocked reflects whether any ACTIVE lock row exists for the step.
 */

import { describe, expect, it, vi } from "vitest";
import { LockPropagationService } from "./lock-propagation.service";
import type { DagContext } from "./workflow-dag";

const tx = {} as never; // service never touches tx internals — it just forwards it to the repo.

function def(nodeKey: string, isRequired = true) {
  return { id: `def-${nodeKey}`, nodeKey, isRequired };
}
function inst(nodeKey: string, status: string) {
  return { id: `inst-${nodeKey}`, nodeKey, stepCode: nodeKey, status };
}
function edge(from: string, to: string) {
  return { fromStepId: `def-${from}`, toStepId: `def-${to}` };
}

function makeRepo() {
  return {
    insertStepLockInTx: vi.fn(
      async (
        _companyId: string,
        _data: { lockedStepId: string; causedByStepId: string },
        _tx: unknown,
      ) => [{ id: "lock-1" }],
    ),
    releaseStepLocksByCauseInTx: vi.fn(
      async (_companyId: string, _causedByStepId: string, _tx: unknown) => undefined,
    ),
    findActiveLocksByStepIdInTx: vi.fn(
      async (_companyId: string, _stepId: string, _tx: unknown) => [] as Array<{ id: string }>,
    ),
    findActiveLockedStepIdsInTx: vi.fn(
      async (_companyId: string, _stepIds: string[], _tx: unknown) =>
        [] as Array<{ lockedStepId: string }>,
    ),
  };
}

const COMPANY = "cccccccc-cccc-cccc-cccc-cccccccccccc";

describe("LockPropagationService", () => {
  describe("propagateRevisionLock", () => {
    it("inserts one lock per transitive descendant (chain A→B→C, revise A → B & C)", async () => {
      const repo = makeRepo();
      const svc = new LockPropagationService(repo as never);
      const ctx: DagContext = {
        defSteps: [def("A"), def("B"), def("C")],
        deps: [edge("A", "B"), edge("B", "C")],
        instanceSteps: [inst("A", "revision"), inst("B", "not_started"), inst("C", "not_started")],
      };

      const locked = await svc.propagateRevisionLock(
        COMPANY,
        { id: "inst-A", nodeKey: "A", stepCode: "A" },
        ctx,
        tx,
      );

      expect([...locked].sort()).toEqual(["inst-B", "inst-C"]);
      expect(repo.insertStepLockInTx).toHaveBeenCalledTimes(2);
      const calls = repo.insertStepLockInTx.mock.calls.map((c) => c[1]);
      expect(calls).toContainEqual({ lockedStepId: "inst-B", causedByStepId: "inst-A" });
      expect(calls).toContainEqual({ lockedStepId: "inst-C", causedByStepId: "inst-A" });
    });

    it("does NOT lock an independent branch (diamond, revise B → only D)", async () => {
      const repo = makeRepo();
      const svc = new LockPropagationService(repo as never);
      const ctx: DagContext = {
        defSteps: [def("A"), def("B"), def("C"), def("D")],
        deps: [edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "D")],
        instanceSteps: [
          inst("A", "approved"),
          inst("B", "revision"),
          inst("C", "not_started"),
          inst("D", "not_started"),
        ],
      };

      const locked = await svc.propagateRevisionLock(
        COMPANY,
        { id: "inst-B", nodeKey: "B", stepCode: "B" },
        ctx,
        tx,
      );

      expect(locked).toEqual(["inst-D"]);
      expect(repo.insertStepLockInTx).toHaveBeenCalledTimes(1);
      expect(repo.insertStepLockInTx.mock.calls[0][1]).toEqual({
        lockedStepId: "inst-D",
        causedByStepId: "inst-B",
      });
    });

    it("locks nothing when the revised step resolves to no descendants (leaf / unknown)", async () => {
      const repo = makeRepo();
      const svc = new LockPropagationService(repo as never);
      const ctx: DagContext = {
        defSteps: [def("A"), def("B")],
        deps: [edge("A", "B")],
        instanceSteps: [inst("A", "approved"), inst("B", "revision")],
      };
      const locked = await svc.propagateRevisionLock(
        COMPANY,
        { id: "inst-B", nodeKey: "B", stepCode: "B" },
        ctx,
        tx,
      );
      expect(locked).toEqual([]);
      expect(repo.insertStepLockInTx).not.toHaveBeenCalled();
    });
  });

  describe("releaseLocksForReapproved", () => {
    it("delegates a per-cause release to the repo", async () => {
      const repo = makeRepo();
      const svc = new LockPropagationService(repo as never);
      await svc.releaseLocksForReapproved(COMPANY, "inst-A", tx);
      expect(repo.releaseStepLocksByCauseInTx).toHaveBeenCalledWith(COMPANY, "inst-A", tx);
    });
  });

  describe("isStepLocked", () => {
    it("returns true when an active lock row exists", async () => {
      const repo = makeRepo();
      repo.findActiveLocksByStepIdInTx.mockResolvedValueOnce([{ id: "lock-1" }]);
      const svc = new LockPropagationService(repo as never);
      expect(await svc.isStepLocked(COMPANY, "inst-B", tx)).toBe(true);
    });

    it("returns false when no active lock rows exist", async () => {
      const repo = makeRepo();
      const svc = new LockPropagationService(repo as never);
      expect(await svc.isStepLocked(COMPANY, "inst-B", tx)).toBe(false);
    });
  });

  describe("findLockedStepIds", () => {
    it("returns the subset of step ids that still carry an active lock (as a Set)", async () => {
      const repo = makeRepo();
      repo.findActiveLockedStepIdsInTx.mockResolvedValueOnce([{ lockedStepId: "inst-D" }]);
      const svc = new LockPropagationService(repo as never);
      const locked = await svc.findLockedStepIds(COMPANY, ["inst-C", "inst-D"], tx);
      expect(locked).toBeInstanceOf(Set);
      expect(locked.has("inst-D")).toBe(true);
      expect(locked.has("inst-C")).toBe(false);
    });
  });
});
