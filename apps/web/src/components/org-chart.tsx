import { useCallback, useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { OrgTreeNode } from "@mediaos/contracts";

/** Một node org_unit ở dạng phẳng (mang parentId) — đầu vào của OrgChart. */
export interface OrgChartNode {
  id: string;
  name: string;
  parentId: string | null;
  type?: string;
  status?: "active" | "inactive";
  headUserName?: string | null;
}

const X_GAP = 220;
const Y_GAP = 120;

/** Làm phẳng cây org_unit lồng nhau (từ GET /org/units/tree) thành mảng phẳng có parentId. */
export function flattenOrgTree(
  tree: readonly OrgTreeNode[],
  parentId: string | null = null,
): OrgChartNode[] {
  return tree.flatMap((node) => [
    {
      id: node.id,
      name: node.name,
      parentId,
      type: node.type,
      status: node.status,
      headUserName: node.headUserName ?? null,
    },
    ...flattenOrgTree(node.children, node.id),
  ]);
}

/**
 * Tính độ sâu của node theo chuỗi cha. Cha mất tích (dangling parentId) → coi như gốc.
 * `cache` đặt 0 trước khi đệ quy để chặn vòng lặp vô hạn nếu dữ liệu có chu trình.
 */
function computeDepth(
  id: string,
  byId: Map<string, OrgChartNode>,
  cache: Map<string, number>,
): number {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  cache.set(id, 0);
  const parentId = byId.get(id)?.parentId ?? null;
  const depth = parentId && byId.has(parentId) ? computeDepth(parentId, byId, cache) + 1 : 0;
  cache.set(id, depth);
  return depth;
}

/** Dựng nodes + edges (parent→child) cho React Flow từ dữ liệu phẳng có parentId. */
export function buildOrgChartFlow(units: readonly OrgChartNode[]): {
  nodes: Node[];
  edges: Edge[];
} {
  const byId = new Map(units.map((u) => [u.id, u]));
  const depthCache = new Map<string, number>();
  const xCursorByDepth = new Map<number, number>();

  const nodes: Node[] = units.map((u) => {
    const depth = computeDepth(u.id, byId, depthCache);
    const column = xCursorByDepth.get(depth) ?? 0;
    xCursorByDepth.set(depth, column + 1);
    return {
      id: u.id,
      position: { x: column * X_GAP, y: depth * Y_GAP },
      data: { label: u.name, status: u.status ?? "active", unitType: u.type ?? "" },
      type: "default",
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      className: u.status === "inactive" ? "opacity-60" : undefined,
    };
  });

  const edges: Edge[] = units
    .filter((u): u is OrgChartNode & { parentId: string } => !!u.parentId && byId.has(u.parentId))
    .map((u) => ({
      id: `e:${u.parentId}->${u.id}`,
      source: u.parentId,
      target: u.id,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed },
    }));

  return { nodes, edges };
}

interface OrgChartProps {
  /** Dữ liệu phẳng (mỗi node có parentId) — dùng `flattenOrgTree` cho phản hồi cây lồng nhau. */
  units: OrgChartNode[];
  onSelectNode?: (id: string) => void;
  emptyLabel?: string;
}

/** Sơ đồ tổ chức tương tác (@xyflow/react) — node = org_unit, edge = parent→child. */
export function OrgChart({ units, onSelectNode, emptyLabel }: OrgChartProps) {
  const { nodes, edges } = useMemo(() => buildOrgChartFlow(units), [units]);

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => onSelectNode?.(node.id),
    [onSelectNode],
  );

  if (units.length === 0) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-xl border border-border text-sm text-muted-foreground">
        {emptyLabel ?? "Chưa có dữ liệu sơ đồ tổ chức."}
      </div>
    );
  }

  return (
    <div className="h-[420px] w-full rounded-xl border border-border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={handleNodeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
