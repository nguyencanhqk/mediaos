import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OrgTreeNode } from "@mediaos/contracts";
import { OrgChart, buildOrgChartFlow, flattenOrgTree, type OrgChartNode } from "./org-chart";

// React Flow needs a measured DOM (ResizeObserver + container size) that jsdom
// does not provide, so we stub the canvas with a light list that still exercises
// our node/edge data and the onNodeClick wiring.
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    nodes,
    onNodeClick,
  }: {
    nodes: { id: string; data: { label: string } }[];
    onNodeClick?: (e: unknown, node: { id: string }) => void;
  }) => (
    <div data-testid="react-flow">
      {nodes.map((n) => (
        <button key={n.id} type="button" onClick={(e) => onNodeClick?.(e, n)}>
          {n.data.label}
        </button>
      ))}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}));

// Cây 3 cấp ở dạng phẳng (mỗi node mang parentId).
const FLAT: OrgChartNode[] = [
  { id: "a", name: "Khối Nội dung", parentId: null, status: "active" },
  { id: "b", name: "Phòng Sản xuất", parentId: "a", status: "active" },
  { id: "c", name: "Tổ Dựng phim", parentId: "b", status: "inactive" },
];

describe("buildOrgChartFlow", () => {
  it("builds one node per unit", () => {
    const { nodes } = buildOrgChartFlow(FLAT);
    expect(nodes).toHaveLength(3);
    expect(nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("builds a parent→child edge for every non-root unit", () => {
    const { edges } = buildOrgChartFlow(FLAT);
    expect(edges).toHaveLength(2);
    const pairs = edges.map((e) => `${e.source}->${e.target}`).sort();
    expect(pairs).toEqual(["a->b", "b->c"]);
  });

  it("does not create an edge for a root node", () => {
    const { edges } = buildOrgChartFlow(FLAT);
    expect(edges.some((e) => e.target === "a")).toBe(false);
  });

  it("lays out deeper levels lower on the canvas (depth drives y)", () => {
    const { nodes } = buildOrgChartFlow(FLAT);
    const y = (id: string) => nodes.find((n) => n.id === id)!.position.y;
    expect(y("a")).toBeLessThan(y("b"));
    expect(y("b")).toBeLessThan(y("c"));
  });

  it("ignores a dangling parentId (treats the node as a root)", () => {
    const { nodes, edges } = buildOrgChartFlow([{ id: "x", name: "Mồ côi", parentId: "missing" }]);
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0);
  });
});

describe("flattenOrgTree", () => {
  it("flattens a nested 3-level tree into flat nodes carrying parentId", () => {
    const tree: OrgTreeNode[] = [
      {
        id: "a",
        name: "Khối Nội dung",
        type: "division",
        status: "active",
        children: [
          {
            id: "b",
            name: "Phòng Sản xuất",
            type: "department",
            status: "active",
            children: [
              { id: "c", name: "Tổ Dựng phim", type: "unit", status: "active", children: [] },
            ],
          },
        ],
      },
    ];
    const flat = flattenOrgTree(tree);
    expect(flat).toHaveLength(3);
    expect(flat.find((n) => n.id === "a")!.parentId).toBeNull();
    expect(flat.find((n) => n.id === "b")!.parentId).toBe("a");
    expect(flat.find((n) => n.id === "c")!.parentId).toBe("b");
  });
});

describe("<OrgChart />", () => {
  it("renders a node for each unit", () => {
    render(<OrgChart units={FLAT} />);
    expect(screen.getByText("Khối Nội dung")).toBeInTheDocument();
    expect(screen.getByText("Phòng Sản xuất")).toBeInTheDocument();
    expect(screen.getByText("Tổ Dựng phim")).toBeInTheDocument();
  });

  it("fires onSelectNode with the unit id when a node is clicked", () => {
    const onSelectNode = vi.fn();
    render(<OrgChart units={FLAT} onSelectNode={onSelectNode} />);
    fireEvent.click(screen.getByText("Phòng Sản xuất"));
    expect(onSelectNode).toHaveBeenCalledWith("b");
  });

  it("shows an empty state when there are no units", () => {
    render(<OrgChart units={[]} />);
    expect(screen.getByText(/chưa có/i)).toBeInTheDocument();
  });
});
