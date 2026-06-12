import type { Edge, Node } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import type { DependencyDto, TemplateStepDto } from "@/lib/workflow-builder/contract";

export interface StepNodeData extends Record<string, unknown> {
  step: TemplateStepDto;
  hasError: boolean;
  disabled: boolean;
}

export type StepNode = Node<StepNodeData, "stepNode">;

const COL_GAP = 220;
const ROW_GAP = 130;
const ORIGIN_X = 40;
const ORIGIN_Y = 40;

/**
 * Vị trí node: dùng position_x/y đã lưu; nếu null → xếp lưới theo stepOrder
 * (cột zig-zag để các bước không chồng lên nhau khi chưa kéo-thả lần nào).
 */
function fallbackPosition(step: TemplateStepDto, index: number): { x: number; y: number } {
  if (step.positionX != null && step.positionY != null) {
    return { x: step.positionX, y: step.positionY };
  }
  return { x: ORIGIN_X + (index % 2) * COL_GAP, y: ORIGIN_Y + index * ROW_GAP };
}

export function buildNodes(
  steps: readonly TemplateStepDto[],
  errorNodeKeys: ReadonlySet<string>,
  disabled: boolean,
): StepNode[] {
  return steps.map((step, index) => ({
    id: step.id,
    type: "stepNode",
    position: fallbackPosition(step, index),
    data: { step, hasError: errorNodeKeys.has(step.nodeKey), disabled },
    draggable: !disabled,
    connectable: !disabled,
    // a11y: keyboard-focusable node wrappers otherwise announce the UUID id; surface the step name.
    ariaLabel: step.name,
  }));
}

export function buildEdges(deps: readonly DependencyDto[], disabled: boolean): Edge[] {
  return deps.map((dep) => ({
    id: dep.id,
    source: dep.fromStepId,
    target: dep.toStepId,
    markerEnd: { type: MarkerType.ArrowClosed },
    // Published → read-only: cạnh không xoá được VÀ không focus được (chặn đường bàn phím
    // focus-cạnh-rồi-Delete chạm callback). Draft → focus được để chọn + Delete.
    deletable: !disabled,
    focusable: !disabled,
  }));
}
