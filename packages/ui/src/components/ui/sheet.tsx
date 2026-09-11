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
  /**
   * S17-CHAT-UX2-FE-5 — chỗ đứng TRƯỚC khối tiêu đề (nút ‹ quay lại của drawer chat).
   *
   * Tách khỏi `actions` (nằm bên PHẢI, cạnh ✕) vì "quay lại" là điều hướng NGƯỢC: đặt nó cạnh nút đóng
   * là mời người dùng bấm nhầm cái xoá cả panel khi họ chỉ muốn lùi một bước.
   */
  leading?: React.ReactNode;
  /** Bề rộng panel — mặc định `max-w-2xl`. */
  className?: string;
  /**
   * S17-CHAT-UX2-FE-5 — đè lớp của THÂN panel (mặc định `px-5 py-4` + tự cuộn).
   *
   * Cần cho nội dung tự quản lý cuộn và cần sát mép: drawer chat đặt cả danh sách phòng lẫn
   * `ConversationPanel` vào đây, cả hai đã có vùng cuộn riêng — để thêm một vùng cuộn bọc ngoài là hai
   * thanh cuộn lồng nhau và ô soạn tin trôi khỏi đáy.
   *
   * `cn` dùng `tailwind-merge` nên `p-0` đè được `px-5 py-4` và `overflow-hidden` đè được
   * `overflow-y-auto` (nhóm xung đột `overflow`). Có ca test riêng cho vế overflow — nếu không, một lần
   * nâng `tailwind-merge` đổi bảng nhóm xung đột là hỏng im lặng.
   */
  bodyClassName?: string;
  /**
   * S17-CHAT-UX2-FE-5 — bấm ra NỀN có đóng panel không. Mặc định `true` (hành vi cũ).
   *
   * `false` cho panel chứa nội dung người dùng đang GÕ DỞ mà không được lưu ở đâu: một cú click trượt
   * tay ra ngoài không được phép xoá nháp. (Drawer chat: `MessageComposer` giữ nháp bằng state cục bộ.)
   */
  closeOnBackdrop?: boolean;
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
  leading,
  className,
  bodyClassName,
  closeOnBackdrop = true,
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

  /**
   * S17-CHAT-UX2-FE-5 — có ai ĐANG GIỮ phím Esc cho một việc nhỏ hơn "đóng cả panel" không?
   *
   * Khác `hasNestedModal` ở chỗ thứ giữ Esc **không phải một lớp nổi**: nó là một trạng thái đang dở
   * ngay trong nội dung (đang trả lời một tin, chẳng hạn). Người dùng bấm Esc lúc đó có đúng MỘT ý
   * định — huỷ cái đang dở — và đóng luôn cả panel là làm hai việc cho một ý định, mất nháp.
   *
   * Truy vấn DOM chứ KHÔNG dựa vào thứ tự đăng ký listener: `document` không đảm bảo thứ tự nào giữa
   * hai listener bubble, và chỉ cần component con render lại vì một lý do bất kỳ là nó đăng ký lại và
   * nhảy xuống CUỐI hàng — hành vi sẽ đảo chiều mà không ai đụng vào code Esc.
   *
   * ⚠️ HAI TẦNG, không phải một `document.querySelector` trần. Một truy vấn toàn tài liệu sẽ để trạng
   * thái đang-dở của MỘT tính năng nuốt Esc của một `Sheet` thuộc tính năng KHÁC — primitive này dùng
   * chung cho chi tiết công việc, đặt phòng, chat… và cái giá là một phím Esc im lặng không làm gì.
   * Hai tầng dưới đây phân biệt đúng ba tình huống có thật:
   *
   *   1. Dấu nằm TRONG panel của chính mình — drawer chat chứa ô soạn đang trả lời ⇒ nhường.
   *   2. Dấu nằm NGOÀI mọi lớp modal, tức nó thuộc chính trang nền mà panel này đang phủ lên — ở
   *      `/chat` mốc 2 cột, dải "đang trả lời" ở cột hội thoại còn Sheet là bảng thông tin phòng
   *      ⇒ vẫn nhường ("lớp trong cùng ăn Esc trước, Esc lần hai mới tới lớp ngoài").
   *   3. Dấu nằm trong một lớp modal KHÁC ⇒ **KHÔNG** nhường. Đó là việc của lớp đó, không phải việc
   *      của panel này.
   */
  const hasEscapeClaim = React.useCallback((): boolean => {
    const panel = panelRef.current;
    if (panel?.querySelector('[data-escape-claim="open"]') != null) return true;
    for (const claim of document.querySelectorAll('[data-escape-claim="open"]')) {
      if (claim.closest('[role="dialog"][aria-modal="true"]') === null) return true;
    }
    return false;
  }, []);

  // Esc để đóng — nhường cho dialog con, cho lớp nổi, và cho việc đang dở đang giữ Esc.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Dây an toàn thứ hai: con đã xử lý xong và đánh dấu bằng `preventDefault()`. Một mình vế này
      // KHÔNG đủ (nó phụ thuộc thứ tự listener — xem `hasEscapeClaim`), nhưng nó bắt được những con
      // xử Esc mà không có dấu DOM nào.
      if (e.defaultPrevented) return;
      if (hasNestedModal()) return;
      if (hasEscapeClaim()) return;
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hasNestedModal, hasEscapeClaim]);

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
      onClick={closeOnBackdrop ? onClose : undefined}
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
          {leading}
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
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4",
            bodyClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
