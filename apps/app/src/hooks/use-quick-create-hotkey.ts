import { useEffect } from "react";
import { isTypingTarget } from "@/routes/tasks/use-slash-focus";

/**
 * S20-X-QUICKCREATE-1 — phím tắt toàn cục mở «Tạo việc nhanh»: Alt+Shift+N.
 *
 * Vì sao chọn tổ hợp này (WCAG 2.1.4: không phím một ký tự):
 * - KHÔNG Ctrl+K (AppSwitcher) · KHÔNG Alt+↑/↓ (chuyển phòng chat) · KHÔNG Ctrl+Shift+F (chat).
 * - Alt+N đơn: trình duyệt/Windows hay dành Alt+chữ cho menu; Alt+Shift+N không chiếm chỗ của Chrome/
 *   Edge/Firefox (Ctrl+Shift+N mới là cửa sổ ẩn danh) và Unikey/EVKey chỉ dùng Ctrl+Shift / Alt+Z.
 * - Windows gõ AltGr = Ctrl+Alt ⇒ bỏ qua khi có Ctrl/Meta, để AltGr+N (ký tự) không bị nuốt.
 * - macOS: Option+N là phím chết (key = "Dead") ⇒ so `event.code` ("KeyN"), không so `key`.
 *
 * Không làm gì khi focus ở ô nhập/vùng soạn thảo (không nuốt ký tự) hoặc đang trong hộp thoại khác
 * (không chồng modal). `enabled=false` (thiếu `create:task`) ⇒ không gắn listener.
 */
export const QUICK_CREATE_HOTKEY_LABEL = "Alt+Shift+N";

function isQuickCreateChord(event: KeyboardEvent): boolean {
  return (
    event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyN"
  );
}

function isInsideDialog(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && target.closest('[role="dialog"], [aria-modal="true"]') !== null
  );
}

export function useQuickCreateHotkey(enabled: boolean, onTrigger: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || !isQuickCreateChord(event)) return;
      if (isTypingTarget(event.target) || isInsideDialog(event.target)) return;
      event.preventDefault();
      onTrigger();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, onTrigger]);
}
