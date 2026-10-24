import { useId, useRef } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import type { GoalCoreResponseDto, GoalTreeNodeDto } from "@mediaos/contracts";
import { Button, cn } from "@mediaos/ui";
import { useGoalTreeExpansion, type GoalTreeExpansion } from "../goal-tree-state";
import { GoalFinalizedBadge, GoalLevelBadge, GoalStatusBadge } from "./GoalBadges";
import { GoalCheckinDialogTrigger } from "./GoalCheckinDialogTrigger";
import { GoalProgressBar } from "./GoalProgressBar";

interface GoalTreeViewProps {
  nodes: GoalTreeNodeDto[];
  onSelect: (goalId: string) => void;
  /** Có cặp `('checkin','goal')` — phía gọi đo bằng `useCan`, cây không tự hỏi quyền. */
  canCheckin?: boolean;
  onCheckin?: (goal: GoalCoreResponseDto) => void;
  /** Id kết quả lọc cần lộ ra — nhánh chứa chúng luôn mở (US-GOAL-QL-92). */
  revealIds?: ReadonlySet<string>;
}

/** Thuộc tính đánh dấu nút-dòng của cây — điều hướng ↑/↓/←/→ đi theo thứ tự DOM của các nút đang hiện. */
const ROW_ATTR = "data-goal-tree-row";

interface TreeContext {
  expansion: GoalTreeExpansion;
  onSelect: (goalId: string) => void;
  onCheckin?: (goal: GoalCoreResponseDto) => void;
  onRowKeyDown: (
    event: KeyboardEvent<HTMLButtonElement>,
    node: GoalTreeNodeDto,
    parentId: string | null,
    expanded: boolean,
  ) => void;
}

function visibleRows(treeRef: RefObject<HTMLUListElement | null>): HTMLElement[] {
  return Array.from(treeRef.current?.querySelectorAll<HTMLElement>(`[${ROW_ATTR}]`) ?? []);
}

function focusRow(treeRef: RefObject<HTMLUListElement | null>, goalId: string) {
  visibleRows(treeRef)
    .find((el) => el.getAttribute(ROW_ATTR) === goalId)
    ?.focus();
}

/**
 * S5-GOAL-FE-1 — cây mục tiêu (GOAL-SCREEN-001, GET /goals/tree). Đệ quy ≤3 tầng (cấu trúc dữ liệu BE
 * đã chặn độ sâu + cắt vòng lặp — buildGoalTree). Mỗi nút: tên + cấp + tiến độ (NULL → "—") + trạng thái
 * + badge khóa nếu đã chốt kỳ. Click nút → mở chi tiết.
 *
 * S20-GOAL-QUICKCHECKIN-1 — thu gọn/mở theo mẫu WAI-ARIA tree (US-GOAL-QL-92): `aria-expanded` phản ánh
 * đúng trạng thái; → mở / xuống con đầu, ← gập / về cha, ↑/↓ đi qua các nút đang hiện, Home/End; nút
 * gập ở đầu dòng cho chuột (`tabIndex=-1` — bàn phím dùng phím mũi tên, không thêm một điểm dừng Tab mỗi
 * nút). Nhớ nhánh gập qua `localStorage` (`goal-tree-state.ts`). Biểu tượng Check-in (US-GOAL-NV-91)
 * đứng CẠNH nút-dòng, không lồng trong nó (không lồng button trong button).
 */
export function GoalTreeView({
  nodes,
  onSelect,
  canCheckin = false,
  onCheckin,
  revealIds,
}: GoalTreeViewProps) {
  const { t } = useTranslation("goals");
  const treeRef = useRef<HTMLUListElement>(null);
  const expansion = useGoalTreeExpansion(nodes, revealIds);
  const hasBranches = nodes.some((n) => n.children.length > 0);

  const onRowKeyDown: TreeContext["onRowKeyDown"] = (event, node, parentId, expanded) => {
    const hasChildren = node.children.length > 0;
    const rows = visibleRows(treeRef);
    const index = rows.indexOf(event.currentTarget);
    const moves: Record<string, (() => void) | undefined> = {
      ArrowRight: () => {
        if (!hasChildren) return;
        if (!expanded) expansion.setExpanded(node.id, true);
        else focusRow(treeRef, node.children[0].id);
      },
      ArrowLeft: () => {
        if (hasChildren && expanded) expansion.setExpanded(node.id, false);
        else if (parentId) focusRow(treeRef, parentId);
      },
      ArrowDown: () => rows[index + 1]?.focus(),
      ArrowUp: () => rows[index - 1]?.focus(),
      Home: () => rows[0]?.focus(),
      End: () => rows[rows.length - 1]?.focus(),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  };

  const ctx: TreeContext = {
    expansion,
    onSelect,
    onCheckin: canCheckin ? onCheckin : undefined,
    onRowKeyDown,
  };

  return (
    <div className="space-y-2">
      {hasBranches && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={expansion.collapseAll}>
            {t("tree.collapseAll")}
          </Button>
          <Button variant="ghost" size="sm" onClick={expansion.expandAll}>
            {t("tree.expandAll")}
          </Button>
        </div>
      )}
      <ul ref={treeRef} className="space-y-1" role="tree" aria-label={t("tree.label")}>
        {nodes.map((node) => (
          <GoalTreeNode key={node.id} node={node} depth={0} parentId={null} ctx={ctx} />
        ))}
      </ul>
    </div>
  );
}

function GoalTreeNode({
  node,
  depth,
  parentId,
  ctx,
}: {
  node: GoalTreeNodeDto;
  depth: number;
  parentId: string | null;
  ctx: TreeContext;
}) {
  const { t } = useTranslation("goals");
  const nameId = useId();
  const hasChildren = node.children.length > 0;
  const expanded = hasChildren && ctx.expansion.isExpanded(node.id);

  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-labelledby={nameId}
    >
      <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 20}px` }}>
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={t(expanded ? "tree.collapse" : "tree.expand", { name: node.name })}
            onClick={() => ctx.expansion.setExpanded(node.id, !expanded)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <ChevronRight
              className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")}
              aria-hidden
            />
          </button>
        ) : (
          <span className="w-8 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          data-goal-tree-row={node.id}
          onClick={() => ctx.onSelect(node.id)}
          onKeyDown={(event) => ctx.onRowKeyDown(event, node, parentId, expanded)}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-transparent px-2 py-2 text-left hover:border-border hover:bg-muted"
        >
          <span
            id={nameId}
            className="min-w-40 flex-1 truncate text-sm font-medium text-foreground"
          >
            {node.name}
          </span>
          <GoalLevelBadge level={node.level} />
          <div className="w-40">
            <GoalProgressBar progressPercent={node.progressPercent} compact />
          </div>
          <GoalStatusBadge status={node.status} />
          {node.finalizedAt && <GoalFinalizedBadge />}
        </button>
        {ctx.onCheckin && <GoalCheckinDialogTrigger goal={node} onCheckin={ctx.onCheckin} />}
      </div>
      {expanded && (
        <ul className="space-y-1" role="group">
          {node.children.map((child) => (
            <GoalTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              parentId={node.id}
              ctx={ctx}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
