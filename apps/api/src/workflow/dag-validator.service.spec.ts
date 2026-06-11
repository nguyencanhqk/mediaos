/**
 * G7-2a — RED-first suite for DagValidatorService (PURE DAG validation).
 *
 * Source: docs/plans/G7-workflow-builder.md §4(2a) + §5 (DV1–DV6).
 * RED phase: the service stub returns always-valid, so every deny-path case
 * (DV1–DV5 + boundary rejects) MUST fail here "for the right reason" — the
 * validator is not yet validating. GREEN makes them pass without touching the
 * port types.
 *
 * Coverage target: ≥90% (crown-jewel logic — CLAUDE.md §6).
 *
 * ── Pure-layer note on DV3 vs DV5 ─────────────────────────────────────────────
 * The validator sees ONLY this template's live steps + edges. So "dep → step in a
 * DIFFERENT template" (DV3) and "dep → deleted/non-existent step" (DV5) are
 * INDISTINGUISHABLE here: both surface as UNKNOWN_NODE (endpoint absent from the
 * node set). Full DV3 enforcement (cross-template) is Track A's loader job — it
 * scopes deps by workflow_definition_id before calling validateDag, so a foreign
 * node_key can never enter `steps`. We assert the pure-layer contract (UNKNOWN_NODE)
 * and document the boundary rather than fake a separate algorithm.
 *
 * ── Pure-layer note on DV4 (orphan) ───────────────────────────────────────────
 * In a FINITE graph, a node unreachable from every root necessarily sits in (or
 * downstream of) a rootless cycle — walking backward along in-edges from any node
 * in an acyclic graph always terminates at an in-degree-0 root. So an orphan test
 * inherently contains a cycle; UNREACHABLE_NODE and CYCLE_DETECTED legitimately
 * co-occur. UNREACHABLE_NODE is still its own signal: it means "this step can
 * never open", which is the actionable failure for the builder.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DagValidatorService,
  DAG_ERROR_CODE,
  type DagDep,
  type DagStep,
  type DagValidationResult,
} from "./dag-validator.service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const steps = (...keys: string[]): DagStep[] => keys.map((nodeKey) => ({ nodeKey }));

const dep = (fromNodeKey: string, toNodeKey: string): DagDep => ({ fromNodeKey, toNodeKey });

const codes = (result: DagValidationResult): string[] => result.errors.map((e) => e.code);

/** All node_keys referenced across errors of a given code (flattened, for assertions). */
const nodeKeysFor = (result: DagValidationResult, code: string): string[] =>
  result.errors.filter((e) => e.code === code).flatMap((e) => [...(e.nodeKeys ?? [])]);

// ─── Suite ──────────────────────────────────────────────────────────────────────

describe("DagValidatorService", () => {
  let validator: DagValidatorService;

  beforeEach(() => {
    validator = new DagValidatorService();
  });

  // ── DV1 — cycle A→B→C→A → reject ────────────────────────────────────────────
  describe("DV1 — dependency cycle", () => {
    it("rejects a 3-node cycle A→B→C→A with CYCLE_DETECTED", () => {
      const result = validator.validateDag(steps("A", "B", "C"), [
        dep("A", "B"),
        dep("B", "C"),
        dep("C", "A"),
      ]);

      expect(result.valid).toBe(false);
      expect(codes(result)).toContain(DAG_ERROR_CODE.CYCLE_DETECTED);
    });

    it("names the cyclic steps in the CYCLE_DETECTED error", () => {
      const result = validator.validateDag(steps("A", "B", "C"), [
        dep("A", "B"),
        dep("B", "C"),
        dep("C", "A"),
      ]);

      expect(nodeKeysFor(result, DAG_ERROR_CODE.CYCLE_DETECTED).sort()).toEqual(["A", "B", "C"]);
    });

    it("detects a cycle even when it is reachable from a root (root→B, B→C, C→B)", () => {
      const result = validator.validateDag(steps("root", "B", "C"), [
        dep("root", "B"),
        dep("B", "C"),
        dep("C", "B"),
      ]);

      expect(result.valid).toBe(false);
      expect(codes(result)).toContain(DAG_ERROR_CODE.CYCLE_DETECTED);
    });
  });

  // ── DV2 — self-dependency A→A → reject ──────────────────────────────────────
  describe("DV2 — self dependency", () => {
    it("rejects A→A with SELF_DEPENDENCY", () => {
      const result = validator.validateDag(steps("A", "B"), [dep("A", "A")]);

      expect(result.valid).toBe(false);
      expect(codes(result)).toContain(DAG_ERROR_CODE.SELF_DEPENDENCY);
    });

    it("does NOT report a self-edge as a cycle (it is its own category)", () => {
      const result = validator.validateDag(steps("A"), [dep("A", "A")]);

      expect(codes(result)).toContain(DAG_ERROR_CODE.SELF_DEPENDENCY);
      expect(codes(result)).not.toContain(DAG_ERROR_CODE.CYCLE_DETECTED);
    });
  });

  // ── DV3 — dep → step in a different template → reject (UNKNOWN_NODE) ─────────
  describe("DV3 — dependency crosses template boundary (pure layer: UNKNOWN_NODE)", () => {
    it("rejects a dep whose target is not a step of this template", () => {
      // "X" simulates a step that belongs to another template — at the pure layer it
      // is simply absent from this template's node set (Track A's loader guarantees
      // deps are scoped by workflow_definition_id; see file header note).
      const result = validator.validateDag(steps("A", "B"), [dep("A", "X")]);

      expect(result.valid).toBe(false);
      expect(codes(result)).toContain(DAG_ERROR_CODE.UNKNOWN_NODE);
      expect(nodeKeysFor(result, DAG_ERROR_CODE.UNKNOWN_NODE)).toContain("X");
    });
  });

  // ── DV4 — orphan (unreachable from any root) → reject ───────────────────────
  describe("DV4 — orphan step unreachable from any root", () => {
    it("rejects a step island that no root can reach with UNREACHABLE_NODE", () => {
      // Rooted chain A→B; plus a disconnected cycle X↔Y that no root reaches.
      const result = validator.validateDag(steps("A", "B", "X", "Y"), [
        dep("A", "B"),
        dep("X", "Y"),
        dep("Y", "X"),
      ]);

      expect(result.valid).toBe(false);
      expect(codes(result)).toContain(DAG_ERROR_CODE.UNREACHABLE_NODE);
      expect(nodeKeysFor(result, DAG_ERROR_CODE.UNREACHABLE_NODE).sort()).toEqual(["X", "Y"]);
    });

    it("flags a non-cycle node stranded downstream of a disconnected cycle", () => {
      // A→B reachable; X↔Y disconnected cycle; Z depends on Y → Z can never open.
      const result = validator.validateDag(steps("A", "B", "X", "Y", "Z"), [
        dep("A", "B"),
        dep("X", "Y"),
        dep("Y", "X"),
        dep("Y", "Z"),
      ]);

      expect(result.valid).toBe(false);
      expect(nodeKeysFor(result, DAG_ERROR_CODE.UNREACHABLE_NODE)).toContain("Z");
    });
  });

  // ── DV5 — dep → non-existent / deleted step → reject (UNKNOWN_NODE) ──────────
  describe("DV5 — dependency targets a deleted / non-existent step", () => {
    it("rejects a dep to a node_key not present in steps (deleted step not passed in)", () => {
      // A deleted step is simply not included in `steps` → its node_key is unknown.
      const result = validator.validateDag(steps("A", "B"), [dep("A", "B"), dep("B", "GHOST")]);

      expect(result.valid).toBe(false);
      expect(codes(result)).toContain(DAG_ERROR_CODE.UNKNOWN_NODE);
      expect(nodeKeysFor(result, DAG_ERROR_CODE.UNKNOWN_NODE)).toContain("GHOST");
    });

    it("rejects when the dependency SOURCE node is unknown too", () => {
      const result = validator.validateDag(steps("A", "B"), [dep("GHOST", "B")]);

      expect(result.valid).toBe(false);
      expect(nodeKeysFor(result, DAG_ERROR_CODE.UNKNOWN_NODE)).toContain("GHOST");
    });
  });

  // ── DV6 — valid parallel DAG A→{B,C}→D → pass ───────────────────────────────
  describe("DV6 — valid fork/join DAG", () => {
    it("accepts A→{B,C}→D with no errors", () => {
      const result = validator.validateDag(steps("A", "B", "C", "D"), [
        dep("A", "B"),
        dep("A", "C"),
        dep("B", "D"),
        dep("C", "D"),
      ]);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  // ── Santa-method boundaries ─────────────────────────────────────────────────
  describe("boundaries — empty / single / multi-root / chains / leaves", () => {
    it("accepts an empty graph (no steps, no deps)", () => {
      const result = validator.validateDag([], []);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("accepts a single isolated step (it is its own root)", () => {
      const result = validator.validateDag(steps("A"), []);
      expect(result.valid).toBe(true);
    });

    it("accepts a linear chain A→B→C→D", () => {
      const result = validator.validateDag(steps("A", "B", "C", "D"), [
        dep("A", "B"),
        dep("B", "C"),
        dep("C", "D"),
      ]);
      expect(result.valid).toBe(true);
    });

    it("accepts multiple roots converging (A→C, B→C — two entry points)", () => {
      const result = validator.validateDag(steps("A", "B", "C"), [dep("A", "C"), dep("B", "C")]);
      expect(result.valid).toBe(true);
    });

    it("accepts a fan-out with leaf/dead-end branches (A→B, A→C; B,C are sinks)", () => {
      const result = validator.validateDag(steps("A", "B", "C"), [dep("A", "B"), dep("A", "C")]);
      expect(result.valid).toBe(true);
    });

    it("treats duplicate identical edges as one (A→B, A→B) — not a cycle", () => {
      const result = validator.validateDag(steps("A", "B"), [dep("A", "B"), dep("A", "B")]);
      expect(result.valid).toBe(true);
    });

    it("rejects a graph whose every node has an incoming edge (no root) — 2-cycle A↔B", () => {
      const result = validator.validateDag(steps("A", "B"), [dep("A", "B"), dep("B", "A")]);
      expect(result.valid).toBe(false);
      expect(codes(result)).toContain(DAG_ERROR_CODE.NO_ROOT);
      expect(codes(result)).toContain(DAG_ERROR_CODE.CYCLE_DETECTED);
    });

    it("rejects duplicate node_key with DUPLICATE_NODE_KEY", () => {
      const result = validator.validateDag(steps("A", "A", "B"), []);
      expect(result.valid).toBe(false);
      expect(codes(result)).toContain(DAG_ERROR_CODE.DUPLICATE_NODE_KEY);
      expect(nodeKeysFor(result, DAG_ERROR_CODE.DUPLICATE_NODE_KEY)).toContain("A");
    });
  });

  // ── Aggregation + error shape ───────────────────────────────────────────────
  describe("error aggregation & shape", () => {
    it("reports MULTIPLE independent violations at once (self-dep + unknown node)", () => {
      const result = validator.validateDag(steps("A", "B"), [dep("A", "A"), dep("B", "GHOST")]);
      expect(result.valid).toBe(false);
      expect(codes(result)).toContain(DAG_ERROR_CODE.SELF_DEPENDENCY);
      expect(codes(result)).toContain(DAG_ERROR_CODE.UNKNOWN_NODE);
    });

    it("every error carries a non-empty code and message", () => {
      const result = validator.validateDag(steps("A", "B", "C"), [
        dep("A", "B"),
        dep("B", "C"),
        dep("C", "A"),
      ]);
      for (const err of result.errors) {
        expect(err.code).toBeTruthy();
        expect(typeof err.message).toBe("string");
        expect(err.message.length).toBeGreaterThan(0);
      }
    });
  });

  // ── Purity / immutability ───────────────────────────────────────────────────
  describe("purity", () => {
    it("does not mutate the input steps or deps arrays", () => {
      const inputSteps = steps("A", "B", "C");
      const inputDeps = [dep("A", "B"), dep("B", "C"), dep("C", "A")];
      const stepsSnapshot = JSON.stringify(inputSteps);
      const depsSnapshot = JSON.stringify(inputDeps);

      validator.validateDag(inputSteps, inputDeps);

      expect(JSON.stringify(inputSteps)).toBe(stepsSnapshot);
      expect(JSON.stringify(inputDeps)).toBe(depsSnapshot);
      expect(inputSteps).toHaveLength(3);
      expect(inputDeps).toHaveLength(3);
    });

    it("accepts readonly (frozen) inputs without throwing", () => {
      const frozenSteps = Object.freeze(steps("A", "B"));
      const frozenDeps = Object.freeze([Object.freeze(dep("A", "B"))]);

      expect(() => validator.validateDag(frozenSteps, frozenDeps)).not.toThrow();
    });
  });
});
