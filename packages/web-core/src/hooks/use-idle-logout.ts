import { useEffect, useRef } from "react";
import { logoutSession } from "../lib/api-client";

/** Sự kiện "người dùng còn hoạt động" — reset bộ đếm idle. */
const ACTIVITY_EVENTS: (keyof DocumentEventMap)[] = [
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "visibilitychange",
];

const MS_PER_MINUTE = 60_000;
/** Tối thiểu 1 phút (chống cấu hình footgun 0/âm → logout tức thì). */
const MIN_MINUTES = 1;

export interface UseIdleLogoutOptions {
  /** Số phút idle trước khi đăng xuất. null/undefined/≤0 ⇒ TẮT (không gắn listener/timer). */
  autoLogoutMinutes: number | null | undefined;
  /** Override hành động khi idle (mặc định logoutSession). Dùng cho test. */
  onIdle?: () => void;
}

/**
 * CS-9 "Tự động đăng xuất" — idle timer phía client đọc `auto_logout_minutes` từ chính sách bảo mật của
 * công ty. Sau N phút KHÔNG hoạt động → gọi `logoutSession` (thu hồi family + xoá cookie + điều hướng auth).
 *
 * Đây là LỚP TIỆN ÍCH (UX), KHÔNG phải biên bảo mật: backstop thật là access-token TTL ngắn + refresh
 * enforce IP/giờ (server). Bất kỳ hoạt động nào (chuột/phím/cuộn/chạm/đổi tab) reset bộ đếm.
 *
 * TẮT khi minutes null/≤0 (không gắn listener) → app không bật auto-logout không tốn gì.
 */
export function useIdleLogout({ autoLogoutMinutes, onIdle }: UseIdleLogoutOptions): void {
  // Giữ onIdle ở ref để đổi callback KHÔNG re-arm listener mỗi render (chỉ minutes mới re-arm).
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (autoLogoutMinutes == null || autoLogoutMinutes < MIN_MINUTES) return;
    if (typeof window === "undefined") return;

    const idleMs = autoLogoutMinutes * MS_PER_MINUTE;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fire = () => {
      if (onIdleRef.current) onIdleRef.current();
      else void logoutSession();
    };

    const reset = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, idleMs);
    };

    for (const ev of ACTIVITY_EVENTS) {
      document.addEventListener(ev, reset, { passive: true });
    }
    reset(); // arm ngay khi mount

    return () => {
      if (timer) clearTimeout(timer);
      for (const ev of ACTIVITY_EVENTS) {
        document.removeEventListener(ev, reset);
      }
    };
  }, [autoLogoutMinutes]);
}
