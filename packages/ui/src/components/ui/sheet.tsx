import * as React from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Hành động ở đầu panel, cạnh nút đóng (Sửa/Xoá…). */
  actions?: React.ReactNode;
  /** Bề rộng panel — mặc định `max-w-2xl`. */
  className?: string;
  "data-testid"?: string;
}

/** Phần tử có thể nhận focus bên trong panel — phục vụ focus-trap (giữ Tab trong sheet). */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Sheet — panel TRƯỢT TỪ PHẢI (side drawer), full chiều cao, thân tự cuộn. Khác `Dialog` (modal
 * giữa màn) ở chỗ giữ NGỮ CẢNH nền: người dùng vẫn thấy board phía sau, đóng là về ngay chỗ cũ.
 *
 * Dùng cho màn chi tiết mở từ một danh sách/board (benchmark UX: MISA AMIS mở chi tiết task bên phải
 * board). Deep-link vẫn giữ được vì URL do consumer quản (search param), Sheet chỉ lo phần trình bày.
 *
 * A11y: `role="dialog"` + `aria-modal` + `aria-labelledby`/`aria-describedby`; focus-trap vòng Tab;
 * focus phần tử đầu khi mở và TRẢ focus về phần tử kích hoạt khi đóng; Esc để đóng.
 *
 * ⚠️ MODAL LỒNG NHAU: panel này có thể chứa `Dialog` (vd. form Sửa / hộp thoại Xoá mở TỪ trong sheet).
 * Cả hai cùng nghe Esc trên `document` và cùng bẫy Tab ⇒ nếu không chặn, một lần Esc sẽ đóng CẢ HAI
 * (mất luôn sheet dù người dùng chỉ muốn thoát dialog con). Vì `Dialog` render như DESCENDANT trong
 * cây React của sheet (không portal), ta nhận diện được bằng cách tìm `[role="dialog"]` khác panel:
 * có dialog con đang mở ⇒ sheet NHƯỜNG cả Esc lẫn focus-trap cho nó.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  className,
  "data-testid": dataTestId,
}: SheetProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const previouslyFocused = React.useRef<HTMLElement | null>(null);
  const reactId = React.useId();
  const titleId = `sheet-title-${reactId}`;
  const descId = `sheet-desc-${reactId}`;

  // Giữ tham chiếu onClose mới nhất → listener Esc KHÔNG cần re-subscribe khi parent render lại
  // (consumer thường truyền arrow inline). Tránh cửa sổ rớt phím Esc.
  const onCloseRef = React.useRef(onClose);
  React.useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  /**
   * Có lớp nổi con đang mở không? Xem ghi chú "MODAL LỒNG NHAU" ở trên.
   *
   * Hai loại, tìm ở hai chỗ khác nhau:
   *   - `Dialog` render như DESCENDANT trong cây sheet ⇒ tìm TRONG panel.
   *   - `Popover` PORTAL ra `document.body` (thoát tổ tiên cắt — xem popover.tsx) nên KHÔNG nằm
   *     trong panel nữa ⇒ phải tìm ở tài liệu qua dấu `data-floating-layer`. Thiếu vế này thì một
   *     lần Esc lúc đang mở picker chọn người sẽ đóng luôn cả sheet — người dùng mất chỗ đang làm.
   */
  const hasNestedModal = React.useCallback((): boolean => {
    if (document.querySelector('[data-floating-layer="open"]') !== null) return true;
    const panel = panelRef.current;
    if (!panel) return false;
    return panel.querySelector('[role="dialog"][aria-modal="true"]') !== null;
  }, []);

  // Esc để đóng — nhường cho dialog con nếu đang mở.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (hasNestedModal()) return;
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hasNestedModal]);

  // Mở: nhớ phần tử đang focus → focus phần tử focusable đầu tiên trong panel.
  // Đóng (cleanup): trả focus về phần tử đã kích hoạt (a11y — không "mất" vị trí bàn phím trên board).
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

  // Focus-trap: vòng Tab/Shift+Tab trong panel — nhường cho dialog con (nó có trap riêng).
  const onTrapKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    if (hasNestedModal()) return;
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
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={cn(
          "flex h-full w-full max-w-2xl flex-col border-l border-border bg-background shadow-xl",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onTrapKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        data-testid={dataTestId}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 space-y-1">
            <h2 id={titleId} className="truncate text-base font-semibold">
              {title}
            </h2>
            {description && (
              <p id={descId} className="truncate text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng"
              data-testid="sheet-close"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        {/* Thân tự cuộn — header đứng yên khi nội dung dài (timeline/bình luận). */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
