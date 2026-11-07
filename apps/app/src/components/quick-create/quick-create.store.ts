import { create } from "zustand";

/**
 * S20-X-QUICKCREATE-1 — trạng thái mở/đóng của form tạo việc gọn toàn cục. Nút «+ Tạo việc» ở topbar và
 * phím tắt cùng gọi `open`; `QuickCreateHost` (mount ở ProtectedShell) là nơi duy nhất vẽ hộp.
 *
 * `returnFocusTo`: phần tử đang focus LÚC MỞ (trước khi ô nhập của hộp tự focus) — Dialog chung chụp quá
 * muộn (autoFocus đã chạy) nên đóng xong focus rơi về BODY; Host dùng giá trị này để trả focus.
 */
interface QuickCreateState {
  isOpen: boolean;
  returnFocusTo: HTMLElement | null;
  open: () => void;
  close: () => void;
}

function activeElementOrNull(): HTMLElement | null {
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}

export const useQuickCreateStore = create<QuickCreateState>((set) => ({
  isOpen: false,
  returnFocusTo: null,
  open: () => set({ isOpen: true, returnFocusTo: activeElementOrNull() }),
  close: () => set({ isOpen: false }),
}));
