/**
 * use-theme — trạng thái theme system/light/dark toàn app (S5-ME-FE-3, ME-SCREEN-014 Appearance).
 *
 * Nguồn sự thật DUY NHẤT nằm ở @mediaos/web-core (lib/theme.ts): class `dark` trên <html> +
 * localStorage "mediaos-theme". Hook ở đây CHỈ là lớp React-state mỏng, DELEGATE toàn bộ qua
 * getStoredTheme/applyTheme/resolveSystemTheme — KHÔNG tự đọc/ghi localStorage lần 2 (single
 * source of truth, tránh 2 package lệch nhau).
 *
 * Back-compat: `toggleTheme()` vẫn hoạt động như trước (đảo light<->dark theo theme ĐÃ RESOLVE
 * hiện tại — nếu đang 'system' thì đảo theo giá trị OS đang áp) để topbar (ThemeToggle) không vỡ.
 * Consumer mới (Appearance) dùng `theme` (raw preference, có thể là 'system') + `setTheme(pref)`
 * + `resolvedTheme` (light/dark thực áp lên UI, dùng để chọn icon).
 */
import * as React from "react";
import {
  applyTheme,
  getStoredTheme,
  resolveSystemTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "@mediaos/web-core";

export type { ThemePreference, ResolvedTheme } from "@mediaos/web-core";
export { THEME_STORAGE_KEY } from "@mediaos/web-core";

function resolve(pref: ThemePreference): ResolvedTheme {
  return pref === "system" ? resolveSystemTheme() : pref;
}

export interface UseThemeResult {
  /** Preference RAW đã lưu — có thể là 'system' (dùng cho radio 3 lựa chọn ở Appearance). */
  theme: ThemePreference;
  /** Theme ĐÃ resolve (light/dark, không có 'system') — dùng để chọn icon/class hiện có. */
  resolvedTheme: ResolvedTheme;
  /** Đặt 1 trong 3 lựa chọn — áp ngay lên <html> + lưu qua web-core applyTheme. */
  setTheme: (pref: ThemePreference) => void;
  /** Back-compat: đảo light<->dark theo resolvedTheme hiện tại (hành vi cũ của ThemeToggle). */
  toggleTheme: () => void;
}

export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = React.useState<ThemePreference>(getStoredTheme);

  const setTheme = React.useCallback((pref: ThemePreference) => {
    applyTheme(pref);
    setThemeState(pref);
  }, []);

  const toggleTheme = React.useCallback(() => {
    setThemeState((prev) => {
      const next: ThemePreference = resolve(prev) === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  }, []);

  return {
    theme,
    resolvedTheme: resolve(theme),
    setTheme,
    toggleTheme,
  };
}
