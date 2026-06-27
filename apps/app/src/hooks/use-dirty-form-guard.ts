/**
 * Hook: đăng ký dirty-form guard với layout store.
 *
 * Khi form `isDirty === true`, ghi DirtyFormState vào store → layout shell
 * (topbar home-button, app-switcher, logout) đọc và hiển thị confirm dialog.
 * Cleanup khi component unmount hoặc isDirty → false.
 *
 * Sử dụng:
 *   useDirtyFormGuard({ isDirty: form.formState.isDirty });
 */
import { useEffect } from "react";
import { useLayoutStore } from "@/stores/layout.store";
import { useCurrentRouteMeta } from "./use-current-route-meta";

const DEFAULT_DIRTY_MESSAGE =
  "Bạn có thay đổi chưa lưu. Nếu rời trang, các thay đổi này có thể bị mất.";

export interface UseDirtyFormGuardOptions {
  isDirty: boolean;
  message?: string;
}

export function useDirtyFormGuard({ isDirty, message }: UseDirtyFormGuardOptions): void {
  const setDirtyFormState = useLayoutStore((s) => s.setDirtyFormState);
  const routeMeta = useCurrentRouteMeta();
  const routeKey = routeMeta?.routeKey ?? "unknown";

  useEffect(() => {
    if (!isDirty) {
      setDirtyFormState(null);
      return;
    }
    setDirtyFormState({
      routeKey,
      message: message ?? DEFAULT_DIRTY_MESSAGE,
    });
    return () => setDirtyFormState(null);
  }, [isDirty, message, routeKey, setDirtyFormState]);
}
