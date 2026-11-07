import { useCallback, useEffect, useRef } from "react";

/**
 * S16-SOCIAL-FILEOPENUX-1 (D5) — `() => boolean`: component còn mount hay không, ổn định qua mọi lần render.
 * Dùng làm `isCurrent` cho `openSignedUrlInNewTab`: rời màn trong lúc chờ URL thì không điều hướng tab app.
 *
 * Gán `true` ở THÂN effect (không chỉ ở giá trị khởi tạo): StrictMode chạy effect → cleanup → effect, nếu chỉ
 * gán `false` ở cleanup thì cờ kẹt `false` dù component vẫn đang hiện (cùng bài học `isMountedRef` của
 * `MessageComposer`).
 */
export function useIsMounted(): () => boolean {
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return useCallback(() => mountedRef.current, []);
}
