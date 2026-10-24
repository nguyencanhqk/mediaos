import { useMemo, useState } from "react";
import type { GoalTreeNodeDto } from "@mediaos/contracts";

/**
 * S20-GOAL-QUICKCHECKIN-1 (US-GOAL-QL-92) — trạng thái thu gọn/mở của cây mục tiêu.
 *
 * Nhớ tập nút ĐANG THU GỌN (không phải tập đang mở): mặc định của cây là bung hết, nên nút mới xuất
 * hiện (kỳ khác, mục tiêu vừa tạo) tự hiện ra như trước — chỉ những nhánh người dùng chủ động gập mới
 * bị giấu. Lưu ở `localStorage` của trình duyệt (tiện ích từng người, KHÔNG phải dữ liệu nghiệp vụ):
 * mọi lần đọc/ghi bọc try/catch — bị chặn (chế độ riêng tư, chính sách trình duyệt) ⇒ cây bung hết
 * như trước và thao tác thu gọn vẫn chạy trong phiên, chỉ không nhớ qua lần tải lại.
 */
export const GOAL_TREE_COLLAPSED_KEY = "mediaos.goals.tree.collapsed";
/** Trần số id nhớ — cắt phần cũ nhất để giá trị không phình mãi theo các kỳ đã qua. */
export const GOAL_TREE_COLLAPSED_MAX = 500;

export function readCollapsedGoalIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(GOAL_TREE_COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed
        .filter((id): id is string => typeof id === "string" && id.length > 0)
        .slice(-GOAL_TREE_COLLAPSED_MAX),
    );
  } catch {
    return new Set();
  }
}

export function writeCollapsedGoalIds(ids: ReadonlySet<string>): void {
  try {
    const list = [...ids].slice(-GOAL_TREE_COLLAPSED_MAX);
    window.localStorage.setItem(GOAL_TREE_COLLAPSED_KEY, JSON.stringify(list));
  } catch {
    // Bị chặn ⇒ chỉ mất phần «nhớ qua lần tải lại»; trạng thái trong phiên vẫn đúng.
  }
}

/** Id mọi nút CÓ CON (đích của «Thu gọn tất cả»). */
export function collectParentGoalIds(nodes: readonly GoalTreeNodeDto[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly GoalTreeNodeDto[]) => {
    for (const n of list) {
      if (n.children.length > 0) {
        out.push(n.id);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return out;
}

/** Id mọi nút có HẬU DUỆ nằm trong `targets` — các nhánh phải tự mở để lộ kết quả lọc. */
export function ancestorGoalIdsOf(
  nodes: readonly GoalTreeNodeDto[],
  targets: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  if (targets.size === 0) return out;
  const walk = (node: GoalTreeNodeDto): boolean => {
    let found = false;
    for (const child of node.children) {
      if (walk(child) || targets.has(child.id)) found = true;
    }
    if (found) out.add(node.id);
    return found;
  };
  nodes.forEach(walk);
  return out;
}

export interface GoalTreeExpansion {
  isExpanded: (id: string) => boolean;
  setExpanded: (id: string, expanded: boolean) => void;
  collapseAll: () => void;
  expandAll: () => void;
}

/**
 * Hook trạng thái mở/gập: nhớ qua localStorage + mở nhánh chứa `revealIds`. Người dùng CHỦ ĐỘNG gập một
 * nhánh đang bị ép mở (trong phiên này) thì lời gập thắng — không thì nút gập trông như hỏng.
 */
export function useGoalTreeExpansion(
  nodes: readonly GoalTreeNodeDto[],
  revealIds?: ReadonlySet<string>,
): GoalTreeExpansion {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(readCollapsedGoalIds);
  const [userCollapsed, setUserCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const forcedOpen = useMemo(
    () => ancestorGoalIdsOf(nodes, revealIds ?? new Set()),
    [nodes, revealIds],
  );

  const commit = (nextCollapsed: Set<string>, nextUserCollapsed: Set<string>) => {
    writeCollapsedGoalIds(nextCollapsed);
    setCollapsed(nextCollapsed);
    setUserCollapsed(nextUserCollapsed);
  };

  const without = (set: ReadonlySet<string>, drop: Iterable<string>) => {
    const next = new Set(set);
    for (const id of drop) next.delete(id);
    return next;
  };

  return {
    isExpanded: (id) => !collapsed.has(id) || (forcedOpen.has(id) && !userCollapsed.has(id)),
    setExpanded: (id, expanded) =>
      expanded
        ? commit(without(collapsed, [id]), without(userCollapsed, [id]))
        : commit(new Set([...collapsed, id]), new Set([...userCollapsed, id])),
    collapseAll: () => {
      const parents = collectParentGoalIds(nodes);
      commit(new Set([...collapsed, ...parents]), new Set(parents));
    },
    expandAll: () => {
      const parents = collectParentGoalIds(nodes);
      commit(without(collapsed, parents), new Set());
    },
  };
}
