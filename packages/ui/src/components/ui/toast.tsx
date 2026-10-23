/**
 * Toast — hệ thông báo nổi dùng chung (S20-FE-TOAST-1 · US-X-91).
 *
 * Mọi thao tác ghi cần phản hồi: thành công ngắn gọn, lỗi rõ ràng thay vì im lặng. Gọi được từ BẤT KỲ
 * đâu (kể cả ngoài React, vd `showApiErrorToast` của web-core qua `configureToast(toast)`), hiển thị
 * bởi MỘT `<Toaster />` mount ở vỏ ứng dụng.
 *
 * Bất biến (khoá ở toast.spec.tsx):
 * - Gộp theo khoá: cùng khoá trong {@link TOAST_COALESCE_WINDOW_MS} ⇒ một thông báo kèm số lần. Bỏ
 *   trống khoá ⇒ khoá = loại + nội dung. Cùng khoá mà quá cửa sổ ⇒ thay bằng thông báo mới (không nhân bản).
 * - Tối đa {@link TOAST_LIMIT}; thêm nữa thì cái cũ nhất tự đóng.
 * - A11y: hai vùng `aria-live` dựng sẵn — lỗi `assertive` (role=alert), còn lại `polite` (role=status);
 *   Esc trong thông báo ⇒ đóng; F8 ⇒ tiêu điểm tới thông báo mới nhất; tiêu điểm/di chuột trong thông
 *   báo ⇒ tạm dừng tự đóng; chuyển động chỉ khi KHÔNG `prefers-reduced-motion`.
 * - Nội dung là CHUỖI ngắn (cắt ở {@link TOAST_MAX_MESSAGE_LENGTH}), không nhận ReactNode: phía gọi
 *   viết câu tóm tắt («Đã gửi tin nhắn»), KHÔNG đổ thân tin chat / mô tả việc vào thông báo.
 *
 * Không thêm dependency: store module-level + `useSyncExternalStore`.
 */
import { CircleCheck, CircleX, TriangleAlert, X } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";

export type ToastVariant = "success" | "error" | "warning";

export interface ToastAction {
  /** Động từ ngắn: «Mở», «Thử lại», «Đổi người». */
  readonly label: string;
  readonly onClick: () => void;
}

export interface ToastOptions {
  /** Khoá gộp (vd `chat-room:<id>`). Bỏ trống ⇒ loại + nội dung. */
  readonly key?: string;
  readonly action?: ToastAction;
  /** Ghi đè thời lượng tự đóng (ms). */
  readonly durationMs?: number;
}

export interface ToastRecord {
  readonly id: string;
  readonly key: string;
  readonly variant: ToastVariant;
  readonly message: string;
  readonly action?: ToastAction;
  readonly count: number;
  readonly durationMs: number;
  /** Mốc lần hiện/gộp gần nhất — đổi ⇒ đồng hồ tự đóng chạy lại. */
  readonly updatedAt: number;
}

export const TOAST_LIMIT = 3;
export const TOAST_COALESCE_WINDOW_MS = 5_000;
export const TOAST_MAX_MESSAGE_LENGTH = 200;
export const TOAST_DEFAULT_DURATION_MS: Readonly<Record<ToastVariant, number>> = {
  success: 4_000,
  warning: 6_000,
  error: 8_000,
};
const FOCUS_HOTKEY = "F8";
const ELLIPSIS = "…";

// ── Store (module-level, bất biến: mỗi thay đổi tạo mảng mới) ────────────────

let toasts: readonly ToastRecord[] = [];
let sequence = 0;
const listeners = new Set<() => void>();

function commit(next: readonly ToastRecord[]): void {
  toasts = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): readonly ToastRecord[] {
  return toasts;
}

function clampMessage(message: string): string {
  if (message.length <= TOAST_MAX_MESSAGE_LENGTH) return message;
  return message.slice(0, TOAST_MAX_MESSAGE_LENGTH - ELLIPSIS.length) + ELLIPSIS;
}

/** Hiện (hoặc gộp) một thông báo. Trả id để phía gọi tự đóng sớm nếu cần. */
export function showToast(
  variant: ToastVariant,
  message: string,
  options: ToastOptions = {},
): string {
  const text = clampMessage(message);
  const key = options.key ?? `${variant}:${text}`;
  const now = Date.now();
  const durationMs = options.durationMs ?? TOAST_DEFAULT_DURATION_MS[variant];
  const existing = toasts.find((t) => t.key === key);

  if (existing && now - existing.updatedAt <= TOAST_COALESCE_WINDOW_MS) {
    const merged: ToastRecord = {
      ...existing,
      variant,
      message: text,
      action: options.action ?? existing.action,
      count: existing.count + 1,
      durationMs,
      updatedAt: now,
    };
    commit(toasts.map((t) => (t.id === existing.id ? merged : t)));
    return existing.id;
  }

  sequence += 1;
  const record: ToastRecord = {
    id: `toast-${sequence}`,
    key,
    variant,
    message: text,
    action: options.action,
    count: 1,
    durationMs,
    updatedAt: now,
  };
  commit([...toasts.filter((t) => t.key !== key), record].slice(-TOAST_LIMIT));
  return record.id;
}

export function dismissToast(id: string): void {
  if (!toasts.some((t) => t.id === id)) return;
  commit(toasts.filter((t) => t.id !== id));
}

/**
 * API gọi nhanh. Thoả `ToastFn` của web-core ⇒ app gắn bằng `configureToast(toast)` lúc khởi động.
 */
export const toast = {
  success: (message: string, options?: ToastOptions): string =>
    showToast("success", message, options),
  error: (message: string, options?: ToastOptions): string => showToast("error", message, options),
  warning: (message: string, options?: ToastOptions): string =>
    showToast("warning", message, options),
  dismiss: dismissToast,
  /** Đóng hết (vd khi đăng xuất). */
  clear: (): void => commit([]),
};

export function useToasts(): readonly ToastRecord[] {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ── Hiển thị ──────────────────────────────────────────────────────────────────

const VARIANT_STYLE: Readonly<Record<ToastVariant, { card: string; icon: string }>> = {
  success: { card: "border-success/40", icon: "text-success" },
  warning: { card: "border-warning/50", icon: "text-warning" },
  error: { card: "border-destructive/50", icon: "text-destructive" },
};

const VARIANT_ICON: Readonly<Record<ToastVariant, typeof CircleCheck>> = {
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleX,
};

interface ToastCardProps {
  readonly item: ToastRecord;
  readonly onDismiss: (id: string) => void;
}

function ToastCard({ item, onDismiss }: ToastCardProps) {
  const [isPaused, setIsPaused] = React.useState(false);
  const { id, updatedAt, durationMs } = item;

  React.useEffect(() => {
    if (isPaused) return undefined;
    const timer = window.setTimeout(() => dismissToast(id), durationMs);
    return () => window.clearTimeout(timer);
  }, [id, updatedAt, durationMs, isPaused]);

  const Icon = VARIANT_ICON[item.variant];
  const style = VARIANT_STYLE[item.variant];

  return (
    <div
      data-slot="toast"
      data-toast-id={id}
      data-variant={item.variant}
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg",
        "transition-[opacity,transform] duration-200 ease-out starting:-translate-y-2 starting:opacity-0 motion-reduce:transition-none",
        style.card,
      )}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsPaused(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onDismiss(id);
      }}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", style.icon)} />
      <p data-slot="toast-message" className="min-w-0 flex-1 break-words text-sm">
        {item.message}
      </p>
      {item.count > 1 ? (
        <span className="shrink-0 rounded bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
          <span aria-hidden="true">×{item.count}</span>
          <span className="sr-only">({item.count} lần)</span>
        </span>
      ) : null}
      {item.action ? (
        <button
          type="button"
          className="shrink-0 rounded-md px-2 py-0.5 text-sm font-medium text-brand outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={() => {
            item.action?.onClick();
            onDismiss(id);
          }}
        >
          {item.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Đóng thông báo"
        className="shrink-0 rounded-md p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onClick={() => onDismiss(id)}
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

export interface ToasterProps {
  readonly className?: string;
}

/**
 * Vùng hiển thị — mount MỘT lần ở vỏ ứng dụng. Đặt phía TRÊN (dưới topbar) ở mọi cỡ màn để không che
 * ô soạn chat ở đáy màn điện thoại.
 */
export function Toaster({ className }: ToasterProps) {
  const items = useToasts();
  const rootRef = React.useRef<HTMLElement>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);
  const newestId = items.at(-1)?.id ?? null;

  React.useEffect(() => {
    if (!newestId) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== FOCUS_HOTKEY) return;
      const target = rootRef.current?.querySelector<HTMLElement>(
        `[data-toast-id="${newestId}"] button`,
      );
      if (!target) return;
      event.preventDefault();
      const active = document.activeElement;
      if (active instanceof HTMLElement && !rootRef.current?.contains(active)) {
        returnFocusRef.current = active;
      }
      target.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [newestId]);

  const handleDismiss = React.useCallback((id: string) => {
    dismissToast(id);
    const previous = returnFocusRef.current;
    returnFocusRef.current = null;
    if (previous?.isConnected) previous.focus();
  }, []);

  const assertive = items.filter((t) => t.variant === "error");
  const polite = items.filter((t) => t.variant !== "error");

  return (
    <section
      ref={rootRef}
      data-slot="toaster"
      aria-label="Thông báo"
      className={cn(
        "pointer-events-none fixed inset-x-4 top-16 z-[60] flex flex-col gap-2 sm:left-auto sm:right-4 sm:w-96",
        className,
      )}
    >
      <div role="alert" aria-live="assertive" aria-atomic="false" className="flex flex-col gap-2">
        {assertive.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={handleDismiss} />
        ))}
      </div>
      <div role="status" aria-live="polite" aria-atomic="false" className="flex flex-col gap-2">
        {polite.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={handleDismiss} />
        ))}
      </div>
    </section>
  );
}
