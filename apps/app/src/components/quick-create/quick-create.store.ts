import { create } from "zustand";

/**
 * S20-X-QUICKCREATE-1 — trạng thái mở/đóng của form tạo việc gọn toàn cục. Nút «+ Tạo việc» ở topbar và
 * phím tắt cùng gọi `open`; `QuickCreateHost` (mount ở ProtectedShell) là nơi duy nhất vẽ hộp.
 */
interface QuickCreateState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useQuickCreateStore = create<QuickCreateState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
