import { describe, expect, it } from "vitest";
import { validateDag } from "./dag";
import type { DependencyDto, TemplateStepDto } from "./contract";

const COMPANY = "00000000-0000-4000-8000-000000000001";
const DEF = "a0000000-0000-4000-8000-000000000001";

function step(id: string, nodeKey: string): TemplateStepDto {
  return {
    id,
    companyId: COMPANY,
    workflowDefinitionId: DEF,
    nodeKey,
    stepType: "task",
    stepOrder: 1,
    code: nodeKey,
    title: nodeKey,
    assigneeRoleCode: null,
    reviewerRoleCode: null,
    isRequired: true,
    positionX: null,
    positionY: null,
    defaultChecklistId: null,
  };
}

function dep(from: string, to: string): DependencyDto {
  return {
    id: `${from}-${to}`,
    companyId: COMPANY,
    workflowDefinitionId: DEF,
    fromStepId: from,
    toStepId: to,
    dependencyType: "finish_to_start",
  };
}

const A = step("a", "a");
const B = step("b", "b");
const C = step("c", "c");
const D = step("d", "d");

describe("validateDag", () => {
  it("EMPTY: rejects a template with no steps", () => {
    const result = validateDag([], []);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("EMPTY");
  });

  it("DV6: accepts a valid parallel DAG A→{B,C}→D (exercises reachability path)", () => {
    const result = validateDag(
      [A, B, C, D],
      [dep("a", "b"), dep("a", "c"), dep("b", "d"), dep("c", "d")],
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts a valid linear chain A→B→C→D", () => {
    const result = validateDag([A, B, C, D], [dep("a", "b"), dep("b", "c"), dep("c", "d")]);
    expect(result.valid).toBe(true);
  });

  it("DV1: rejects a cycle A→B→C→A", () => {
    const result = validateDag([A, B, C], [dep("a", "b"), dep("b", "c"), dep("c", "a")]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "CYCLE")).toBe(true);
  });

  it("DV2: rejects a self-dependency A→A", () => {
    const result = validateDag([A, B], [dep("a", "a"), dep("a", "b")]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "SELF_DEP")).toBe(true);
  });

  it("DV5: rejects a dependency targeting a missing step", () => {
    const result = validateDag([A, B], [dep("a", "b"), dep("b", "zzz")]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_DEP_TARGET")).toBe(true);
  });

  it("NO_ROOT/CYCLE: rejects a 2-cycle A↔B (no root + cycle)", () => {
    const result = validateDag([A, B], [dep("a", "b"), dep("b", "a")]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "NO_ROOT" || e.code === "CYCLE")).toBe(true);
  });

  it("is pure — does not mutate inputs", () => {
    const steps = [A, B];
    const deps = [dep("a", "b")];
    const stepsBefore = JSON.stringify(steps);
    const depsBefore = JSON.stringify(deps);
    validateDag(steps, deps);
    expect(JSON.stringify(steps)).toBe(stepsBefore);
    expect(JSON.stringify(deps)).toBe(depsBefore);
  });
});
