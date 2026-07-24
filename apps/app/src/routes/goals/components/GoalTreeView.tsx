import { ChevronRight } from "lucide-react";
import type { GoalTreeNodeDto } from "@mediaos/contracts";
import { cn } from "@mediaos/ui";
import { GoalFinalizedBadge, GoalLevelBadge, GoalStatusBadge } from "./GoalBadges";
import { GoalProgressBar } from "./GoalProgressBar";

interface GoalTreeViewProps {
  nodes: GoalTreeNodeDto[];
  onSelect: (goalId: string) => void;
}

/**
 * S5-GOAL-FE-1 — cây mục tiêu (GOAL-SCREEN-001, GET /goals/tree). Đệ quy ≤3 tầng (cấu trúc dữ liệu BE
 * đã chặn độ sâu + cắt vòng lặp — buildGoalTree). Mỗi nút: tên + cấp + tiến độ (NULL → "—") + trạng thái
 * + badge khóa nếu đã chốt kỳ. Click nút → mở chi tiết.
 */
export function GoalTreeView({ nodes, onSelect }: GoalTreeViewProps) {
  return (
    <ul className="space-y-1" role="tree">
      {nodes.map((node) => (
        <GoalTreeNode key={node.id} node={node} depth={0} onSelect={onSelect} />
      ))}
    </ul>
  );
}

function GoalTreeNode({
  node,
  depth,
  onSelect,
}: {
  node: GoalTreeNodeDto;
  depth: number;
  onSelect: (goalId: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  return (
    <li role="treeitem" aria-expanded={hasChildren ? true : undefined}>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className={cn(
          "flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-transparent px-2 py-2 text-left hover:border-border hover:bg-muted",
        )}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        <ChevronRight
          className={cn("h-4 w-4 shrink-0 text-muted-foreground", !hasChildren && "opacity-0")}
          aria-hidden
        />
        <span className="min-w-40 flex-1 truncate text-sm font-medium text-foreground">
          {node.name}
        </span>
        <GoalLevelBadge level={node.level} />
        <div className="w-40">
          <GoalProgressBar progressPercent={node.progressPercent} compact />
        </div>
        <GoalStatusBadge status={node.status} />
        {node.finalizedAt && <GoalFinalizedBadge />}
      </button>
      {hasChildren && (
        <ul className="space-y-1" role="group">
          {node.children.map((child) => (
            <GoalTreeNode key={child.id} node={child} depth={depth + 1} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}
