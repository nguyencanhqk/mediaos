import { useState } from "react";
import {
  moveWorkspaceTab,
  PROJECT_WORKSPACE_TABS,
  sanitizeWorkspaceTabOrder,
  type ProjectWorkspaceTab,
} from "./workspace-constants";

/**
 * Thứ tự tab của trang dự án — TUỲ CHỌN HIỂN THỊ CÁ NHÂN, lưu localStorage (chung mọi dự án,
 * theo trình duyệt; đổi qua nút "Thứ tự tab" ngay trên thanh tab — WorkspaceTabOrderMenu).
 * KHÔNG phải dữ liệu nghiệp vụ — không gọi server, không cần permission; storage hỏng/bị chặn
 * (private mode) → im lặng dùng mặc định, không crash.
 *
 * ⚠️ Control này CỐ Ý không nằm trong tab "Cài đặt": tab đó ẩn với người không quản trị được dự án
 * (Viewer/Member) ⇒ đặt ở đó là khoá tuỳ chọn cá nhân sau một cổng quyền không liên quan.
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
  /** `visible` = tập tab người dùng THẬT SỰ thấy (đã lọc quyền); bỏ trống = toàn bộ. */
  moveTab: (
    tab: ProjectWorkspaceTab,
    dir: -1 | 1,
    visible?: readonly ProjectWorkspaceTab[],
  ) => void;
  resetTabOrder: () => void;
} {
  const [tabOrder, setTabOrder] = useState<ProjectWorkspaceTab[]>(readStoredOrder);

  const moveTab = (
    tab: ProjectWorkspaceTab,
    dir: -1 | 1,
    visible?: readonly ProjectWorkspaceTab[],
  ) => {
    const next = moveWorkspaceTab(tabOrder, tab, dir, visible);
    if (next.join(",") === tabOrder.join(",")) return;
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
