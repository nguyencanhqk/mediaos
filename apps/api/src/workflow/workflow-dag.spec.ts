/**
 * G7-3c-i — RED suite for workflow DAG resolution (pure logic).
 *
 * These pin the crown-jewel invariant (§1.3): a step is startable iff ALL its upstream
 * dependencies are approved. They MUST FAIL until allDependenciesApproved is implemented.
 *
 * Maps to plan §5 FS1/FS2/FS3 at the pure-logic level:
 *   DG1 — root (no deps) → always startable
 *   DG2 — linear A→B → B startable only when A approved      (FS1 essence)
 *   DG3 — fork  A→{B,C} → both open when A approved           (FS2 essence)
 *   DG4 — join  {B,C}→D → D opens only when both approved     (FS3 essence)
 */

import { describe, expect, it } from "vitest";
import {
  allDependenciesApproved,
  computeTransitiveDescendants,
  type DagContext,
} from "./workflow-dag";

// ─── Fixtures ───────────────────────────────────────────────────────────────────
// node_key == step_code in these fixtures (mirrors video_standard_v0 backfill).

function def(nodeKey: string, isRequired = true) {
  return { id: `def-${nodeKey}`, nodeKey, isRequired };
}
function inst(nodeKey: string, status: string) {
  return { id: `inst-${nodeKey}`, nodeKey, stepCode: nodeKey, status };
}
function edge(from: string, to: string) {
  return { fromStepId: `def-${from}`, toStepId: `def-${to}` };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("allDependenciesApproved", () => {
  // ─── DG1: root step has no incoming dependency ─────────────────────────────
  describe("DG1 — root step (no upstream dependency)", () => {
    it("returns true when the step has no incoming edges", () => {
      const ctx: DagContext = {
        defSteps: [def("A")],
        deps: [],
        instanceSteps: [inst("A", "not_started")],
      };
      expect(allDependenciesApproved(inst("A", "not_started"), ctx)).toBe(true);
    });
  });

  // ─── DG2: linear A→B ───────────────────────────────────────────────────────
  describe("DG2 — linear A→B", () => {
    const defSteps = [def("A"), def("B")];
    const deps = [edge("A", "B")];

    it("returns false when upstream A is not yet approved", () => {
      const instanceSteps = [inst("A", "waiting_review"), inst("B", "not_started")];
      expect(allDependenciesApproved(inst("B", "not_started"), { defSteps, deps, instanceSteps })).toBe(false);
    });

    it("returns true when upstream A is approved", () => {
      const instanceSteps = [inst("A", "approved"), inst("B", "not_started")];
      expect(allDependenciesApproved(inst("B", "not_started"), { defSteps, deps, instanceSteps })).toBe(true);
    });
  });

  // ─── DG3: fork A→{B,C} ─────────────────────────────────────────────────────
  describe("DG3 — fork A→{B,C}", () => {
    const defSteps = [def("A"), def("B"), def("C")];
    const deps = [edge("A", "B"), edge("A", "C")];

    it("opens BOTH B and C once A is approved", () => {
      const instanceSteps = [inst("A", "approved"), inst("B", "not_started"), inst("C", "not_started")];
      expect(allDependenciesApproved(inst("B", "not_started"), { defSteps, deps, instanceSteps })).toBe(true);
      expect(allDependenciesApproved(inst("C", "not_started"), { defSteps, deps, instanceSteps })).toBe(true);
    });
  });

  // ─── DG4: join {B,C}→D ─────────────────────────────────────────────────────
  describe("DG4 — join {B,C}→D", () => {
    const defSteps = [def("B"), def("C"), def("D")];
    const deps = [edge("B", "D"), edge("C", "D")];

    it("keeps D blocked when only B is approved (C still pending)", () => {
      const instanceSteps = [inst("B", "approved"), inst("C", "waiting_review"), inst("D", "not_started")];
      expect(allDependenciesApproved(inst("D", "not_started"), { defSteps, deps, instanceSteps })).toBe(false);
    });

    it("opens D only when BOTH B and C are approved", () => {
      const instanceSteps = [inst("B", "approved"), inst("C", "approved"), inst("D", "not_started")];
      expect(allDependenciesApproved(inst("D", "not_started"), { defSteps, deps, instanceSteps })).toBe(true);
    });
  });

  // ─── Fail-closed defensive branches (crown-jewel safety) ───────────────────
  describe("fail-closed — never open a step we cannot reason about", () => {
    it("returns false when the target key matches no def-step", () => {
      const ctx: DagContext = {
        defSteps: [def("A")],
        deps: [],
        instanceSteps: [inst("A", "approved")],
      };
      // "ghost" has no matching def-step → cannot resolve → blocked (not silently opened).
      expect(allDependenciesApproved({ nodeKey: "ghost", stepCode: "ghost" }, ctx)).toBe(false);
    });

    it("returns false when an upstream edge is dangling (from references a missing def-step)", () => {
      const ctx: DagContext = {
        defSteps: [def("B")], // def-A intentionally missing
        deps: [{ fromStepId: "def-A", toStepId: "def-B" }],
        instanceSteps: [inst("B", "not_started")],
      };
      expect(allDependenciesApproved(inst("B", "not_started"), { ...ctx })).toBe(false);
    });
  });

  // ─── Legacy fallback: instance step with null node_key resolves by step_code ─
  describe("legacy rows — node_key null falls back to step_code", () => {
    it("resolves dependency state via step_code when node_key is null", () => {
      const defSteps = [def("script"), def("edit")];
      const deps = [edge("script", "edit")];
      // Instance steps created by the old startWorkflow path: node_key = null.
      const instanceSteps = [
        { id: "i1", nodeKey: null, stepCode: "script", status: "approved" },
        { id: "i2", nodeKey: null, stepCode: "edit", status: "not_started" },
      ];
      const target = { id: "i2", nodeKey: null, stepCode: "edit", status: "not_started" };
      expect(allDependenciesApproved(target, { defSteps, deps, instanceSteps })).toBe(true);
    });
  });
});

// ─── G7-4a: transitive descendants (revision-lock propagation, BR-006) ──────────
// computeTransitiveDescendants(source, ctx) → instance-step IDs of ALL downstream steps reachable
// from `source` along dep edges. Independent branches are excluded (LK2). Fail-closed on unresolvable.
describe("computeTransitiveDescendants", () => {
  const idsOf = (xs: string[]) => [...xs].sort();

  it("LKpure-1 linear A→B→C: descendants of A are {B, C} (transitive, excludes self)", () => {
    const ctx: DagContext = {
      defSteps: [def("A"), def("B"), def("C")],
      deps: [edge("A", "B"), edge("B", "C")],
      instanceSteps: [inst("A", "revision"), inst("B", "not_started"), inst("C", "not_started")],
    };
    expect(idsOf(computeTransitiveDescendants(inst("A", "revision"), ctx))).toEqual(
      idsOf(["inst-B", "inst-C"]),
    );
  });

  it("LKpure-2 diamond A→{B,C}→D: descendants of B are {D} only (NOT sibling C)", () => {
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
    expect(computeTransitiveDescendants(inst("B", "revision"), ctx)).toEqual(["inst-D"]);
  });

  it("LKpure-3 independent branch is NOT a descendant (anti over-lock, LK2 essence)", () => {
    // A→B; C is an independent root. Descendants of A = {B} only.
    const ctx: DagContext = {
      defSteps: [def("A"), def("B"), def("C")],
      deps: [edge("A", "B")],
      instanceSteps: [inst("A", "revision"), inst("B", "not_started"), inst("C", "not_started")],
    };
    expect(computeTransitiveDescendants(inst("A", "revision"), ctx)).toEqual(["inst-B"]);
  });

  it("LKpure-4 dedups a step reachable by two paths (diamond join counted once)", () => {
    const ctx: DagContext = {
      defSteps: [def("A"), def("B"), def("C"), def("D")],
      deps: [edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "D")],
      instanceSteps: [
        inst("A", "revision"),
        inst("B", "not_started"),
        inst("C", "not_started"),
        inst("D", "not_started"),
      ],
    };
    expect(idsOf(computeTransitiveDescendants(inst("A", "revision"), ctx))).toEqual(
      idsOf(["inst-B", "inst-C", "inst-D"]),
    );
  });

  it("LKpure-5 fail-closed: unresolvable source → [] (locks nothing)", () => {
    const ctx: DagContext = {
      defSteps: [def("A"), def("B")],
      deps: [edge("A", "B")],
      instanceSteps: [inst("A", "revision"), inst("B", "not_started")],
    };
    expect(computeTransitiveDescendants({ nodeKey: "ghost", stepCode: "ghost" }, ctx)).toEqual([]);
  });

  it("LKpure-6 leaf source (no downstream edges) → []", () => {
    const ctx: DagContext = {
      defSteps: [def("A"), def("B")],
      deps: [edge("A", "B")],
      instanceSteps: [inst("A", "approved"), inst("B", "revision")],
    };
    expect(computeTransitiveDescendants(inst("B", "revision"), ctx)).toEqual([]);
  });
});
