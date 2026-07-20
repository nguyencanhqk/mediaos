import { useState } from "react";
import {
  PROJECT_WORKSPACE_TABS,
  sanitizeWorkspaceTabOrder,
  type ProjectWorkspaceTab,
} from "./workspace-constants";

/**
 * Thứ tự tab của trang dự án — TUỲ CHỌN HIỂN THỊ CÁ NHÂN, lưu localStorage (chung mọi dự án,
 * theo trình duyệt; đổi qua thẻ "Thứ tự tab" trong tab Cài đặt). KHÔNG phải dữ liệu nghiệp vụ —
 * không gọi server, không cần permission; storage hỏng/bị chặn (private mode) → im lặng dùng
 * mặc định, không crash.
 */
const STORAGE_KEY = "mediaos.tasks.workspaceTabOrder";

function readStoredOrder(): ProjectWorkspaceTab[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return sanitizeWorkspaceTabOrder(raw ? JSON.parse(raw) : null);
  } catch {
    return [...PROJECT_WORKSPACE_TABS];
  }
}

export function useWorkspaceTabOrder(): {
  tabOrder: ProjectWorkspaceTab[];
  isCustomized: boolean;
  moveTab: (tab: ProjectWorkspaceTab, dir: -1 | 1) => void;
  resetTabOrder: () => void;
} {
  const [tabOrder, setTabOrder] = useState<ProjectWorkspaceTab[]>(readStoredOrder);

  const moveTab = (tab: ProjectWorkspaceTab, dir: -1 | 1) => {
    const index = tabOrder.indexOf(tab);
    const target = index + dir;
    if (index < 0 || target < 0 || target >= tabOrder.length) return;
    const next = [...tabOrder];
    next.splice(index, 1);
    next.splice(target, 0, tab);
    setTabOrder(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage bị chặn → thứ tự vẫn đổi trong phiên này, chỉ không nhớ qua lần sau.
    }
  };

  const resetTabOrder = () => {
    setTabOrder([...PROJECT_WORKSPACE_TABS]);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Như trên — best-effort.
    }
  };

  return {
    tabOrder,
    isCustomized: tabOrder.join(",") !== PROJECT_WORKSPACE_TABS.join(","),
    moveTab,
    resetTabOrder,
  };
}
