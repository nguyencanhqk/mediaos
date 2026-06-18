import * as React from "react";
import { cn } from "@/lib/utils";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Optional footer (action buttons). Rendered below the body, right-aligned. */
  footer?: React.ReactNode;
  className?: string;
}

/** Phần tử có thể nhận focus bên trong dialog — phục vụ focus-trap (giữ Tab trong modal). */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Minimal controlled modal — overlay + centered panel. Esc và click ra ngoài để đóng.
 * Không phụ thuộc thư viện ngoài (house style nhẹ). Port của @mediaos/ui Dialog (nguồn sự thật).
 *
 * A11y: `role="dialog"` + `aria-modal` + `aria-labelledby`/`aria-describedby` trỏ tới title/description;
 * focus-trap giữ Tab quanh các phần tử trong panel khi mở; focus phần tử đầu khi mở và TRẢ focus về
 * phần tử kích hoạt khi đóng.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const previouslyFocused = React.useRef<HTMLElement | null>(null);
  const reactId = React.useId();
  const titleId = `dialog-title-${reactId}`;
  const descId = `dialog-desc-${reactId}`;

  // Giữ tham chiếu onClose mới nhất → listener Esc KHÔNG cần re-subscribe khi parent render lại
  // (consumer thường truyền arrow inline cho onClose → đổi ref mỗi render). Tránh cửa sổ rớt phím Esc.
  const onCloseRef = React.useRef(onClose);
  React.useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  // Esc để đóng.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Mở: nhớ phần tử đang focus → focus phần tử focusable đầu tiên trong panel.
  // Đóng (cleanup): trả focus về phần tử đã kích hoạt dialog (a11y — không "mất" vị trí bàn phím).
  React.useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel) {
      const focusable = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (focusable ?? panel).focus();
    }
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Focus-trap: vòng Tab/Shift+Tab trong panel.
  const onTrapKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || active === panel) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={cn(
          "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-lg",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onTrapKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        <div className="mb-4 space-y-1">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          {description && (
            <p id={descId} className="text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        <div className="space-y-4">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
