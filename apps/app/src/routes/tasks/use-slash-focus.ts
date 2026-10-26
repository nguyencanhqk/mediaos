import { useEffect, type RefObject } from "react";

/**
 * Phím tắt focus ô nhập của trang: «/» ⇒ ô lọc/tìm (Danh sách công việc · Việc của tôi); «n» ⇒ ô tạo
 * nhanh của «Việc của tôi» (S20-TASK-QUICKADD-1).
 *
 * Không cướp phím khi người dùng đang gõ: ô nhập, vùng soạn thảo (contenteditable — kể cả phần tử con
 * bên trong), hay đang ở trong hộp thoại (drawer việc mở đè lên trang — focus không được nhảy ra sau).
 * Có phím bổ trợ (Ctrl/⌘/Alt) ⇒ bỏ qua, nhường phím tắt của trình duyệt. Ô đích đang vô hiệu (hoặc
 * chưa gắn) ⇒ để nguyên phím cho trang.
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

/** `key = null` ⇒ không gắn phím tắt nào (phía gọi tắt có điều kiện mà không vi phạm luật hook). */
export function useKeyFocus(
  key: string | null,
  inputRef: RefObject<HTMLInputElement | null>,
): void {
  useEffect(() => {
    if (key === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== key || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target) || isInsideDialog(event.target)) return;
      const input = inputRef.current;
      if (!input || input.disabled) return;
      event.preventDefault();
      input.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [key, inputRef]);
}

export function useSlashFocus(inputRef: RefObject<HTMLInputElement | null>): void {
  useKeyFocus("/", inputRef);
}
