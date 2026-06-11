import { describe, expect, it } from "vitest";
import { buildEdges, buildNodes } from "./layout";
import type { DependencyDto, TemplateStepDto } from "@/lib/workflow-builder/contract";

const COMPANY = "00000000-0000-4000-8000-000000000001";
const DEF = "a0000000-0000-4000-8000-000000000001";

function step(id: string, nodeKey: string, x: number | null, y: number | null): TemplateStepDto {
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
    positionX: x,
    positionY: y,
    defaultChecklistId: null,
  };
}

describe("canvas layout", () => {
  it("uses stored positions when present", () => {
    const nodes = buildNodes([step("a", "a", 100, 250)], new Set(), false);
    expect(nodes[0]?.position).toEqual({ x: 100, y: 250 });
  });

  it("falls back to a grid for steps with null position", () => {
    const nodes = buildNodes([step("a", "a", null, null), step("b", "b", null, null)], new Set(), false);
    expect(nodes[0]?.position.x).not.toBeNaN();
    expect(nodes[1]?.position.y).toBeGreaterThan(nodes[0]!.position.y);
  });

  it("marks nodes whose nodeKey is in the error set", () => {
    const nodes = buildNodes([step("a", "a", 0, 0)], new Set(["a"]), false);
    expect(nodes[0]?.data.hasError).toBe(true);
  });

  it("disables drag/connect when the template is published", () => {
    const nodes = buildNodes([step("a", "a", 0, 0)], new Set(), true);
    expect(nodes[0]?.draggable).toBe(false);
    expect(nodes[0]?.connectable).toBe(false);
  });

  it("builds edges from dependency from→to and marks them non-deletable when published", () => {
    const dep: DependencyDto = {
      id: "e1",
      companyId: COMPANY,
      workflowDefinitionId: DEF,
      fromStepId: "a",
      toStepId: "b",
      dependencyType: "finish_to_start",
    };
    const editable = buildEdges([dep], false);
    expect(editable[0]).toMatchObject({ id: "e1", source: "a", target: "b", deletable: true });
    const locked = buildEdges([dep], true);
    expect(locked[0]?.deletable).toBe(false);
  });
});
