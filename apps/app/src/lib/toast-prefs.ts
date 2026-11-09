/**
 * S20-NOTI-LIVETOAST-1 — tuỳ chọn toast CHỈ lưu trên trình duyệt này (`localStorage`, khoá gắn `userId`).
 *
 * Không có cột `user_preferences`, không gọi API: người khác đăng nhập cùng máy không thừa hưởng (khoá
 * khác), và `localStorage` bị chặn (chế độ riêng tư / chính sách) ⇒ mặc định AN TOÀN, không lỗi console:
 * bật toast, TẮT xem trước nội dung (nội dung tin chỉ lộ khi người dùng chủ động bật).
 */

export interface ToastPrefs {
  /** «Hiện toast thông báo» — mặc định bật. */
  readonly notifications: boolean;
  /** «Toast tin nhắn» — mặc định bật. */
  readonly messages: boolean;
  /** «Xem trước nội dung» — mặc định TẮT. */
  readonly preview: boolean;
}

export const DEFAULT_TOAST_PREFS: ToastPrefs = {
  notifications: true,
  messages: true,
  preview: false,
};

export const TOAST_PREFS_KEY_PREFIX = "mediaos.toast-prefs.v1:";

export const toastPrefsKey = (userId: string): string => `${TOAST_PREFS_KEY_PREFIX}${userId}`;

/** Giữ bản đã ghi khi `localStorage` chặn ghi — để công tắc vẫn có hiệu lực trong phiên tab này. */
const memory = new Map<string, ToastPrefs>();

function pick(raw: unknown): ToastPrefs {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
  return {
    notifications: bool(o.notifications, DEFAULT_TOAST_PREFS.notifications),
    messages: bool(o.messages, DEFAULT_TOAST_PREFS.messages),
    preview: bool(o.preview, DEFAULT_TOAST_PREFS.preview),
  };
}

/** Đọc tuỳ chọn của `userId`; mọi lỗi (chặn, JSON hỏng) ⇒ mặc định an toàn. Không bao giờ ném. */
export function readToastPrefs(userId: string | null | undefined): ToastPrefs {
  if (!userId) return DEFAULT_TOAST_PREFS;
  const remembered = memory.get(userId);
  if (remembered) return remembered;
  try {
    const stored = window.localStorage.getItem(toastPrefsKey(userId));
    return stored === null ? DEFAULT_TOAST_PREFS : pick(JSON.parse(stored));
  } catch {
    return DEFAULT_TOAST_PREFS;
  }
}

/** Ghi một phần tuỳ chọn; trả bản mới. Ghi `localStorage` lỗi thì chỉ giữ trong bộ nhớ tab, không ném. */
export function writeToastPrefs(userId: string, patch: Partial<ToastPrefs>): ToastPrefs {
  const next = { ...readToastPrefs(userId), ...patch };
  try {
    window.localStorage.setItem(toastPrefsKey(userId), JSON.stringify(next));
    memory.delete(userId);
  } catch {
    memory.set(userId, next);
  }
  return next;
}

/** Chỉ cho test: xoá bản nhớ tạm giữa các ca. */
export function resetToastPrefsMemory(): void {
  memory.clear();
}
