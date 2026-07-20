import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

/**
 * Popover — panel nổi controlled, đóng khi click ra ngoài / nhấn Escape.
 * Hand-rolled (không Radix — đồng bộ convention primitives hiện có). Trigger do caller render,
 * truyền qua prop `trigger` để wrapper quản lý outside-click cho CẢ trigger lẫn panel.
 *
 * ⚠️ VÌ SAO PORTAL + `position: fixed` (đổi ở S5-TASK-INLINE-1) — bản cũ dùng `absolute` trong một
 * `relative` cha, và BỊ CẮT MẤT khi đặt trong vùng cuộn:
 *   - CSS: khi một trục overflow khác `visible` thì trục kia KHÔNG còn là `visible` nữa (tính ra
 *     `auto`). Nên mọi cha `overflow-y-auto` — thân Sheet, thân Card cuộn, sidebar — đều xén panel
 *     theo CHIỀU NGANG, dù panel không hề tràn theo chiều dọc.
 *   - Triệu chứng thật: picker chọn người trên dòng việc con trong drawer chi tiết task bị xén cụt
 *     ở mép trái, thò ra ngoài panel.
 * Portal ra `document.body` + toạ độ `fixed` tính từ rect của trigger thoát khỏi MỌI tổ tiên cắt.
 *
 * Panel tự KẸP vào trong khung nhìn và lật lên trên khi không đủ chỗ bên dưới — không còn cảnh panel
 * dài chạy khỏi đáy màn hình. Đo lại khi cuộn (capture: bắt cuộn của mọi cha, không riêng window),
 * khi resize, và khi CHÍNH panel đổi kích thước (lọc danh sách làm nó ngắn đi ⇒ vị trí lật phải tính lại).
 *
 * `data-floating-layer="open"`: hợp đồng với các lớp bao có thể đóng bằng Esc (xem `Sheet`). Cả hai
 * cùng nghe Esc trên `document`; không có dấu này thì một lần Esc đóng CẢ popover LẪN sheet chứa nó.
 */
interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nút mở/đóng — caller tự gắn onClick toggle. */
  trigger: React.ReactNode;
  /** Căn mép panel so với trigger. */
  align?: "start" | "end";
  className?: string;
  children: React.ReactNode;
}

/** Khoảng hở trigger→panel và lề tối thiểu với mép khung nhìn. */
const GAP = 8;
const VIEWPORT_MARGIN = 8;

export function Popover({
  open,
  onOpenChange,
  trigger,
  align = "end",
  className,
  children,
}: PopoverProps) {
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  // Outside-click: panel đã PORTAL ra ngoài cây trigger nên phải kiểm CẢ HAI ref (bản cũ chỉ cần
  // kiểm root vì panel nằm trong đó — giữ nguyên logic cũ ở đây là bấm trong panel sẽ tự đóng).
  React.useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      onOpenChange(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  // Đo + kẹp trong khung nhìn. useLayoutEffect: chạy TRƯỚC khi trình duyệt vẽ ⇒ người dùng không
  // thấy panel nhảy từ vị trí ước lượng sang vị trí đúng.
  React.useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const measure = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const panel = panelRef.current?.getBoundingClientRect();
      const width = panel?.width ?? 256;
      const height = panel?.height ?? 0;
      const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;

      // Căn theo mép trigger rồi KẸP — cận trên `VIEWPORT_MARGIN` đứng sau để panel rộng hơn khung
      // nhìn vẫn dính mép trái thay vì lệch ra ngoài bên trái.
      const preferredLeft = align === "end" ? trigger.right - width : trigger.left;
      const left = Math.max(VIEWPORT_MARGIN, Math.min(preferredLeft, maxLeft));

      // Dưới trigger nếu đủ chỗ; không thì lật lên trên; không đủ cả hai thì kẹp đáy.
      let top = trigger.bottom + GAP;
      if (height > 0 && top + height > window.innerHeight - VIEWPORT_MARGIN) {
        const above = trigger.top - GAP - height;
        top =
          above >= VIEWPORT_MARGIN
            ? above
            : Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
      }
      setPos({ top, left });
    };

    measure();
    window.addEventListener("resize", measure);
    // capture:true — cuộn KHÔNG nổi bọt lên window, phải bắt ở pha bắt để thấy cuộn của mọi cha
    // (thân Sheet, Card cuộn…). Thiếu vế này thì panel đứng yên còn trigger trôi đi.
    window.addEventListener("scroll", measure, true);

    // Nội dung panel đổi kích thước (lọc danh sách ngắn lại…) ⇒ tính lại chỗ lật.
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure()) : null;
    if (observer && panelRef.current) observer.observe(panelRef.current);

    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer?.disconnect();
    };
  }, [open, align]);

  const panel = open ? (
    <div
      ref={panelRef}
      role="dialog"
      data-floating-layer="open"
      style={{
        position: "fixed",
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        // Lượt render đầu chưa biết kích thước panel ⇒ giấu để không loé ở góc trên-trái.
        visibility: pos ? "visible" : "hidden",
      }}
      className={cn(
        // z cao hơn Sheet/Dialog (z-50) — popover mở TỪ TRONG chúng phải nằm trên.
        "z-[60] min-w-[16rem] rounded-lg border border-border bg-card p-3 shadow-lg",
        className,
      )}
    >
      {children}
    </div>
  ) : null;

  return (
    <div ref={triggerRef} className="relative inline-block">
      {trigger}
      {panel && createPortal(panel, document.body)}
    </div>
  );
}
