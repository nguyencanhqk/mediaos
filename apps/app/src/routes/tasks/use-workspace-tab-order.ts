import { useState } from "react";
import {
  moveWorkspaceTab,
  nextProjectLastTabMap,
  pickProjectLastTab,
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

/**
 * S20-TASK-PROJECTENTRY-1 — tab dùng lần trước THEO DỰ ÁN (US-TASK-QL-13). Cũng là tuỳ chọn hiển thị
 * cá nhân trong localStorage như thứ tự tab ở trên: mọi đọc/ghi bọc try/catch, storage hỏng/bị chặn
 * ⇒ như chưa có tính năng (vào Tổng quan). Không phải dữ liệu nghiệp vụ, không gọi server.
 *
 * `entryTab` = tab nhớ, ĐỌC MỘT LẦN khi vào dự án; trang chỉ dùng nó cho URL trống
 * (`/tasks/projects/:id`, không `?tab`). Nút Tổng quan đẩy URL trống (không `?tab=overview`) ⇒ bấm
 * Tổng quan thì `entryTab` về `null`, nếu không URL trống sẽ lại hiện tab nhớ.
 */
const LAST_TAB_STORAGE_KEY = "mediaos.tasks.projectLastTab";

function readStoredLastTabMap(): unknown {
  try {
    const raw = window.localStorage.getItem(LAST_TAB_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredLastTab(projectId: string, tab: ProjectWorkspaceTab): void {
  try {
    const next = nextProjectLastTabMap(readStoredLastTabMap(), projectId, tab);
    window.localStorage.setItem(LAST_TAB_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage bị chặn/đầy → lần sau không nhớ được, tab vẫn đổi bình thường.
  }
}

interface ProjectEntryTabState {
  projectId: string;
  entryTab: ProjectWorkspaceTab | null;
}

export function useProjectLastTab(projectId: string): {
  entryTab: ProjectWorkspaceTab | null;
  /** Gọi khi người dùng BẤM tab — ghi tab cuối của dự án này. */
  rememberTab: (tab: ProjectWorkspaceTab) => void;
} {
  const [state, setState] = useState<ProjectEntryTabState>(() => ({
    projectId,
    entryTab: pickProjectLastTab(readStoredLastTabMap(), projectId),
  }));
  // Cùng instance nhưng đổi dự án (cây sidebar P1 → P2) ⇒ đọc lại tab nhớ của dự án mới (mẫu React
  // "điều chỉnh state khi prop đổi" — setState có điều kiện trong lúc render).
  let current = state;
  if (state.projectId !== projectId) {
    current = { projectId, entryTab: pickProjectLastTab(readStoredLastTabMap(), projectId) };
    setState(current);
  }

  const rememberTab = (tab: ProjectWorkspaceTab) => {
    writeStoredLastTab(projectId, tab);
    if (tab === "overview" && current.entryTab !== null) setState({ projectId, entryTab: null });
  };

  return { entryTab: current.entryTab, rememberTab };
}
