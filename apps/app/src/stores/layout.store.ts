/**
 * Layout client-state store — trạng thái UI không nhạy cảm (sidebar, overlay, dirty-form guard).
 *
 * KHÔNG persist dữ liệu nhạy cảm (token, permission, profile).
 * Chỉ persist isSidebarCollapsed (UX preference, không nhạy cảm).
 */
import { create } from "zustand";

export interface DirtyFormState {
  /** Route key của form đang bẩn. */
  routeKey: string;
  /** Thông báo hiển thị khi user cố rời form. */
  message: string;
}

interface LayoutState {
  isSidebarCollapsed: boolean;
  isMobileSidebarOpen: boolean;
  isAppSwitcherOpen: boolean;
  topbarSearchOpen: boolean;
  dirtyFormState: DirtyFormState | null;

  setSidebarCollapsed: (value: boolean) => void;
  toggleSidebarCollapsed: () => void;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  openAppSwitcher: () => void;
  closeAppSwitcher: () => void;
  toggleAppSwitcher: () => void;
  setTopbarSearchOpen: (value: boolean) => void;
  setDirtyFormState: (state: DirtyFormState | null) => void;
  /** Reset trạng thái thoáng qua khi đổi route. */
  resetTransientLayoutState: () => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  isSidebarCollapsed: false,
  isMobileSidebarOpen: false,
  isAppSwitcherOpen: false,
  topbarSearchOpen: false,
  dirtyFormState: null,

  setSidebarCollapsed: (value) => set({ isSidebarCollapsed: value }),
  toggleSidebarCollapsed: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
  openMobileSidebar: () => set({ isMobileSidebarOpen: true }),
  closeMobileSidebar: () => set({ isMobileSidebarOpen: false }),
  openAppSwitcher: () => set({ isAppSwitcherOpen: true }),
  closeAppSwitcher: () => set({ isAppSwitcherOpen: false }),
  toggleAppSwitcher: () => set((state) => ({ isAppSwitcherOpen: !state.isAppSwitcherOpen })),
  setTopbarSearchOpen: (value) => set({ topbarSearchOpen: value }),
  setDirtyFormState: (dirtyFormState) => set({ dirtyFormState }),
  resetTransientLayoutState: () =>
    set({
      isMobileSidebarOpen: false,
      isAppSwitcherOpen: false,
      topbarSearchOpen: false,
    }),
}));
