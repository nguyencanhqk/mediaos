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
 * Không làm gì khi focus ở ô nhập/vùng soạn thảo (không nuốt ký tự) hoặc khi sẽ chồng modal lên modal
 * (xem `wouldStackOnModal`). `enabled=false` (thiếu `create:task`) ⇒ không gắn listener.
 */
export const QUICK_CREATE_HOTKEY_LABEL = "Alt+Shift+N";

function isQuickCreateChord(event: KeyboardEvent): boolean {
  return (
    event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyN"
  );
}

const MODAL_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';

/**
 * Chỉ nhường khi mở hộp sẽ CHỒNG modal lên modal: focus trong hộp cảnh báo (alertdialog), hoặc đang có từ
 * hai lớp modal trở lên (vd. drawer + hộp thoại con). MỘT modal duy nhất (drawer chat/việc — Sheet) thì
 * vẫn mở: hộp tạo nhanh vẽ ở vỏ, ngoài panel của Sheet nên focus-trap của Sheet không giành lại.
 */
function wouldStackOnModal(target: EventTarget | null): boolean {
  if (target instanceof HTMLElement && target.closest('[role="alertdialog"]') !== null) return true;
  return document.querySelectorAll(MODAL_SELECTOR).length > 1;
}

export function useQuickCreateHotkey(enabled: boolean, onTrigger: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || !isQuickCreateChord(event)) return;
      if (isTypingTarget(event.target) || wouldStackOnModal(event.target)) return;
      event.preventDefault();
      onTrigger();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, onTrigger]);
}
