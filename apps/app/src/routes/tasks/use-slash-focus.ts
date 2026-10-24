import { useEffect, type RefObject } from "react";

/**
 * Phím «/» ở bất kỳ đâu ⇒ focus ô lọc/tìm của trang (Danh sách công việc · Việc của tôi).
 *
 * Không cướp phím khi người dùng đang gõ: ô nhập, vùng soạn thảo (contenteditable — kể cả phần tử con
 * bên trong), hay đang ở trong hộp thoại (drawer việc mở đè lên trang — focus không được nhảy ra sau).
 * Có phím bổ trợ (Ctrl/⌘/Alt) ⇒ bỏ qua, nhường phím tắt của trình duyệt.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName.toUpperCase())) return true;
  // jsdom không tính `isContentEditable` ⇒ dò thuộc tính trên chính nó và tổ tiên.
  const editable = target.closest("[contenteditable]");
  return editable !== null && editable.getAttribute("contenteditable") !== "false";
}

function isInsideDialog(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && target.closest('[role="dialog"], [aria-modal="true"]') !== null
  );
}

export function useSlashFocus(inputRef: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target) || isInsideDialog(event.target)) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [inputRef]);
}
