import { useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { DependencyDto, InstanceStepDto } from "@/lib/workflow-builder/contract";
import { InstanceStepNodeCard } from "./instance-step-node";
import { buildInstanceEdges, buildInstanceNodes } from "./instance-layout";

interface InstanceCanvasProps {
  steps: InstanceStepDto[];
  dependencies: DependencyDto[];
}

const nodeTypes: NodeTypes = { instanceStep: InstanceStepNodeCard };

/** Canvas read-only của một instance — DAG tô màu theo status (3d). Không sửa được. */
export default function InstanceCanvas({ steps, dependencies }: InstanceCanvasProps) {
  const nodes = useMemo(() => buildInstanceNodes(steps), [steps]);
  const edges = useMemo(() => buildInstanceEdges(dependencies), [dependencies]);

  return (
    <ReactFlowProvider>
      <div
        className="h-[460px] w-full overflow-hidden rounded-xl border border-border"
        role="group"
        aria-label="Sơ đồ tiến độ quy trình (chỉ xem). Trạng thái từng bước có ở danh sách bên dưới."
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          nodesDraggable={false}
          elementsSelectable={false}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}
