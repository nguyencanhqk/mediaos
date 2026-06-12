import type { Edge, Node } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import type { DependencyDto, InstanceStepDto } from "@/lib/workflow-builder/contract";

export interface InstanceStepNodeData extends Record<string, unknown> {
  step: InstanceStepDto;
}

export type InstanceStepNode = Node<InstanceStepNodeData, "instanceStep">;

const COL_GAP = 220;
const ROW_GAP = 130;
const ORIGIN_X = 40;
const ORIGIN_Y = 40;

function position(step: InstanceStepDto, index: number): { x: number; y: number } {
  if (step.positionX != null && step.positionY != null) {
    return { x: step.positionX, y: step.positionY };
  }
  return { x: ORIGIN_X + (index % 2) * COL_GAP, y: ORIGIN_Y + index * ROW_GAP };
}

export function buildInstanceNodes(steps: readonly InstanceStepDto[]): InstanceStepNode[] {
  return steps.map((step, index) => ({
    id: step.id,
    type: "instanceStep",
    position: position(step, index),
    data: { step },
    draggable: false,
    connectable: false,
  }));
}

export function buildInstanceEdges(deps: readonly DependencyDto[]): Edge[] {
  return deps.map((dep) => ({
    id: dep.id,
    source: dep.fromStepId,
    target: dep.toStepId,
    markerEnd: { type: MarkerType.ArrowClosed },
    deletable: false,
    selectable: false,
    // a11y: inert read-only edges must not take keyboard focus (no purpose without selection/delete).
    focusable: false,
  }));
}
