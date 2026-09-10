import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * Accordion — primitive nhẹ, CONTROLLED (không Radix, đồng bộ convention `tabs.tsx`/`sheet.tsx`).
 *
 * Compound API theo hình dạng shadcn để người đọc quen mắt:
 * `<Accordion value={[...]} onValueChange><AccordionItem value><AccordionTrigger/><AccordionContent/>`.
 *
 * ┌─ HAI luật của file này, cả hai đều là RÀNG BUỘC THẬT chứ không phải trang trí ────────────────────┐
 * │ 1. **Controlled, `value` là MẢNG.** Trạng thái mở nằm ở consumer vì có nơi cần biết "mục nào đang │
 * │    mở" để quyết định GỌI API hay không (bảng thông tin phòng chat: mỗi lần đọc đường tệp là một   │
 * │    hàng `file_access_logs`). Giấu trạng thái trong primitive là lấy mất đúng thông tin đó.        │
 * │ 2. **Đóng ⇒ UNMOUNT thân, không phải `hidden`.** Ẩn bằng CSS vẫn mount con ⇒ `useQuery`/`useEffect`│
 * │    trong đó vẫn chạy, tức vẫn gọi API cho thứ người dùng chưa mở. Đó là nguyên nhân gốc của luật  │
 * │    số 1; hai luật này đi cùng nhau.                                                              │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * A11y: trigger là `<button aria-expanded aria-controls>`, thân là `role="region" aria-labelledby` —
 * khuôn WAI-ARIA Accordion. Không tự bẫy phím: mỗi trigger là một nút thật trong luồng tab.
 */

interface AccordionContextValue {
  openValues: readonly string[];
  toggle: (value: string) => void;
}

const AccordionContext = React.createContext<AccordionContextValue | null>(null);

interface AccordionItemContextValue {
  isOpen: boolean;
  toggle: () => void;
  triggerId: string;
  contentId: string;
}

const AccordionItemContext = React.createContext<AccordionItemContextValue | null>(null);

function useAccordionItemContext(component: string): AccordionItemContextValue {
  const ctx = React.useContext(AccordionItemContext);
  if (!ctx) throw new Error(`<${component}> phải nằm trong <AccordionItem>`);
  return ctx;
}

export interface AccordionProps {
  /** Danh sách `value` của các mục ĐANG MỞ. Nhiều mục mở cùng lúc là hợp lệ. */
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  className?: string;
  children: React.ReactNode;
}

export function Accordion({ value, onValueChange, className, children }: AccordionProps) {
  // `onValueChange` qua ref: consumer thường truyền hàm inline, và đưa nó thẳng vào deps của `useMemo`
  // dựng lại context MỖI render ⇒ mọi mục re-render theo, kể cả mục không đổi trạng thái.
  const onValueChangeRef = React.useRef(onValueChange);
  React.useEffect(() => {
    onValueChangeRef.current = onValueChange;
  }, [onValueChange]);

  const ctx = React.useMemo<AccordionContextValue>(
    () => ({
      openValues: value,
      toggle: (itemValue: string) =>
        onValueChangeRef.current(
          value.includes(itemValue) ? value.filter((v) => v !== itemValue) : [...value, itemValue],
        ),
    }),
    [value],
  );

  return (
    <AccordionContext.Provider value={ctx}>
      <div className={className}>{children}</div>
    </AccordionContext.Provider>
  );
}

export interface AccordionItemProps {
  value: string;
  className?: string;
  children: React.ReactNode;
}

export function AccordionItem({ value, className, children }: AccordionItemProps) {
  const ctx = React.useContext(AccordionContext);
  if (!ctx) throw new Error("<AccordionItem> phải nằm trong <Accordion>");
  const reactId = React.useId();
  const isOpen = ctx.openValues.includes(value);
  const { toggle } = ctx;

  const itemCtx = React.useMemo<AccordionItemContextValue>(
    () => ({
      isOpen,
      toggle: () => toggle(value),
      triggerId: `accordion-trigger-${reactId}`,
      contentId: `accordion-content-${reactId}`,
    }),
    [isOpen, toggle, value, reactId],
  );

  return (
    <AccordionItemContext.Provider value={itemCtx}>
      <div
        className={cn("border-b border-border", className)}
        data-state={isOpen ? "open" : "closed"}
      >
        {children}
      </div>
    </AccordionItemContext.Provider>
  );
}

export interface AccordionTriggerProps {
  className?: string;
  children: React.ReactNode;
  /** Phần bên phải nhãn (số đếm, badge…) — nằm TRONG nút, trước mũi tên. */
  meta?: React.ReactNode;
  "data-testid"?: string;
}

export function AccordionTrigger({
  className,
  children,
  meta,
  "data-testid": dataTestId,
}: AccordionTriggerProps) {
  const { isOpen, toggle, triggerId, contentId } = useAccordionItemContext("AccordionTrigger");
  return (
    <button
      type="button"
      id={triggerId}
      aria-expanded={isOpen}
      aria-controls={contentId}
      onClick={toggle}
      data-testid={dataTestId}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium hover:bg-accent",
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {meta !== undefined && <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>}
      <ChevronDown
        className={cn(
          "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
          isOpen && "rotate-180",
        )}
        aria-hidden="true"
      />
    </button>
  );
}

export interface AccordionContentProps {
  className?: string;
  children: React.ReactNode;
}

export function AccordionContent({ className, children }: AccordionContentProps) {
  const { isOpen, triggerId, contentId } = useAccordionItemContext("AccordionContent");
  // Đóng ⇒ KHÔNG render con (xem luật 2 ở docblock đầu file). Đây là hợp đồng, không phải tối ưu.
  if (!isOpen) return null;
  return (
    <div id={contentId} role="region" aria-labelledby={triggerId} className={cn("pb-2", className)}>
      {children}
    </div>
  );
}
