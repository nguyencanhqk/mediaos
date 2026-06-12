import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { DependencyDto, TemplateStepDto } from "@/lib/workflow-builder/contract";
import { workflowTemplatesApi } from "@/lib/workflow-templates-api";
import { StepNodeCard } from "./step-node";
import { buildEdges, buildNodes, type StepNode } from "./layout";

interface TemplateCanvasProps {
  templateId: string;
  steps: TemplateStepDto[];
  dependencies: DependencyDto[];
  /** node_key của các bước lỗi DAG (tô đỏ). */
  errorNodeKeys: ReadonlySet<string>;
  /** Template published → read-only (cấm kéo edge / di chuyển — D4 + 2d). */
  disabled: boolean;
  /**
   * id của đoạn hướng dẫn bên ngoài canvas (SC 2.4.6) — truyền vào aria-describedby
   * của vùng group để AT thông báo gợi ý phím tắt khi focus vào canvas.
   */
  hintId?: string;
}

const nodeTypes: NodeTypes = { stepNode: StepNodeCard };

function CanvasInner({ templateId, steps, dependencies, errorNodeKeys, disabled, hintId }: TemplateCanvasProps) {
  const qc = useQueryClient();
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const invalidate = useCallback(
    () => void qc.invalidateQueries({ queryKey: ["workflow-template", templateId] }),
    [qc, templateId],
  );

  // Đồng bộ nodes/edges từ dữ liệu server (sau mỗi mutation refetch).
  useEffect(() => {
    setNodes(buildNodes(steps, errorNodeKeys, disabled));
  }, [steps, errorNodeKeys, disabled, setNodes]);
  useEffect(() => {
    setEdges(buildEdges(dependencies, disabled));
  }, [dependencies, disabled, setEdges]);

  const addDep = useMutation({
    mutationFn: (conn: Connection) =>
      workflowTemplatesApi.addDependency(templateId, {
        fromStepId: conn.source,
        toStepId: conn.target,
        dependencyType: "finish_to_start",
      }),
    onSuccess: invalidate,
  });

  const removeDep = useMutation({
    mutationFn: (depId: string) => workflowTemplatesApi.removeDependency(templateId, depId),
    onSuccess: invalidate,
  });

  const savePosition = useMutation({
    mutationFn: (node: StepNode) =>
      workflowTemplatesApi.updateStepPosition(templateId, node.id, {
        positionX: Math.round(node.position.x),
        positionY: Math.round(node.position.y),
      }),
  });

  const onConnect = useCallback(
    (conn: Connection) => {
      if (disabled || !conn.source || !conn.target || conn.source === conn.target) return;
      addDep.mutate(conn);
    },
    [disabled, addDep],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (disabled) return;
      for (const edge of deleted) removeDep.mutate(edge.id);
    },
    [disabled, removeDep],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: StepNode) => {
      if (disabled) return;
      savePosition.mutate(node);
    },
    [disabled, savePosition],
  );

  const errorBanner = useMemo(() => {
    if (addDep.error instanceof Error) return addDep.error.message;
    return null;
  }, [addDep.error]);

  return (
    <div
      className="relative h-[460px] w-full overflow-hidden rounded-xl border border-border"
      role="group"
      aria-label={
        disabled
          ? "Sơ đồ quy trình (chỉ xem — quy trình đã xuất bản). Dùng chế độ Danh sách để thao tác bằng bàn phím."
          : "Sơ đồ quy trình — node là bước, cạnh là phụ thuộc. Dùng chế độ Danh sách để thao tác bằng bàn phím."
      }
      aria-describedby={hintId}
    >
      {errorBanner && (
        <div className="absolute left-2 top-2 z-10 rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground">
          {errorBanner}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodeDragStop={onNodeDragStop}
        nodesConnectable={!disabled}
        nodesDraggable={!disabled}
        // Published → cấm mọi đường sửa cạnh ở tầng React Flow (không chỉ chặn ở callback):
        // edgesFocusable=false → bàn phím không Tab vào cạnh; edgesReconnectable=false → không kéo lại cạnh.
        edgesFocusable={!disabled}
        edgesReconnectable={!disabled}
        elementsSelectable
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}

export default function TemplateCanvas(props: TemplateCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
