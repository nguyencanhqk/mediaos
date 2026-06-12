import "reflect-metadata";
import { InternalServerErrorException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { buildDagInput, toDagValidationResultDto } from "./dag-result.adapter";
import { DAG_ERROR_CODE } from "./dag-validator.service";

/**
 * G7-2b — alignment test (the "thin adapter" the dag-validator header calls for):
 * the persisted step/dep rows map to the validator port, and the validator's own
 * error codes map 1-1 onto the FROZEN contract codes. Pure, no DB.
 */
describe("dag-result.adapter — buildDagInput", () => {
  it("maps each edge's step ids to node_keys and strips ids from steps", () => {
    const steps = [
      { id: "id-a", nodeKey: "A" },
      { id: "id-b", nodeKey: "B" },
    ];
    const deps = [{ fromStepId: "id-a", toStepId: "id-b" }];

    const out = buildDagInput(steps, deps);

    expect(out.steps).toEqual([{ nodeKey: "A" }, { nodeKey: "B" }]);
    expect(out.deps).toEqual([{ fromNodeKey: "A", toNodeKey: "B" }]);
  });

  it("throws when an edge's `to` step is outside the set (integrity breach)", () => {
    const steps = [{ id: "id-a", nodeKey: "A" }];
    const deps = [{ fromStepId: "id-a", toStepId: "ghost" }];
    expect(() => buildDagInput(steps, deps)).toThrow(InternalServerErrorException);
  });

  it("throws when an edge's `from` step is outside the set (integrity breach)", () => {
    const steps = [{ id: "id-a", nodeKey: "A" }];
    const deps = [{ fromStepId: "ghost", toStepId: "id-a" }];
    expect(() => buildDagInput(steps, deps)).toThrow(InternalServerErrorException);
  });

  it("does not mutate inputs (immutability)", () => {
    const steps = Object.freeze([Object.freeze({ id: "id-a", nodeKey: "A" })]);
    const deps = Object.freeze([] as { fromStepId: string; toStepId: string }[]);
    const out = buildDagInput(steps, deps);
    expect(out.steps).toEqual([{ nodeKey: "A" }]);
    expect(steps).toHaveLength(1); // untouched
  });
});

describe("dag-result.adapter — toDagValidationResultDto", () => {
  it("passes a valid result through unchanged", () => {
    expect(toDagValidationResultDto({ valid: true, errors: [] })).toEqual({
      valid: true,
      errors: [],
    });
  });

  it.each([
    [DAG_ERROR_CODE.CYCLE_DETECTED, "cycle"],
    [DAG_ERROR_CODE.SELF_DEPENDENCY, "self_dependency"],
    [DAG_ERROR_CODE.UNKNOWN_NODE, "missing_node"],
    [DAG_ERROR_CODE.UNREACHABLE_NODE, "unreachable"],
    [DAG_ERROR_CODE.NO_ROOT, "no_root"],
  ])("maps service code %s → frozen contract code %s", (serviceCode, contractCode) => {
    const out = toDagValidationResultDto({
      valid: false,
      errors: [{ code: serviceCode, message: "boom", nodeKeys: ["A", "B"] }],
    });
    expect(out.valid).toBe(false);
    expect(out.errors[0].code).toBe(contractCode);
    expect(out.errors[0].message).toBe("boom");
    expect(out.errors[0].nodeKeys).toEqual(["A", "B"]);
  });

  it("defaults nodeKeys to [] when the service omits it", () => {
    const out = toDagValidationResultDto({
      valid: false,
      errors: [{ code: DAG_ERROR_CODE.NO_ROOT, message: "no root" }],
    });
    expect(out.errors[0].nodeKeys).toEqual([]);
  });

  it("drops the service-only `edge` field (not in the frozen contract)", () => {
    const out = toDagValidationResultDto({
      valid: false,
      errors: [
        {
          code: DAG_ERROR_CODE.SELF_DEPENDENCY,
          message: "self",
          nodeKeys: ["A"],
          edge: { fromNodeKey: "A", toNodeKey: "A" },
        },
      ],
    });
    expect(out.errors[0]).not.toHaveProperty("edge");
  });

  it("throws on DUPLICATE_NODE_KEY — impossible on persisted steps (unique-index invariant)", () => {
    expect(() =>
      toDagValidationResultDto({
        valid: false,
        errors: [{ code: DAG_ERROR_CODE.DUPLICATE_NODE_KEY, message: "dup", nodeKeys: ["A"] }],
      }),
    ).toThrow(InternalServerErrorException);
  });
});
