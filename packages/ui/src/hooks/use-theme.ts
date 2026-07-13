/**
 * use-theme — trạng thái theme light/dark toàn app.
 *
 * Cơ chế (đồng bộ với bootstrap script trong index.html của từng app):
 * - Nguồn sự thật = class `dark` trên <html> + localStorage "mediaos-theme".
 * - Mặc định dark (Control Room); chỉ ghi "light" mới bật chế độ sáng.
 * - Không dùng prefers-color-scheme: nội bộ doanh nghiệp, chọn tay là đủ (KISS).
 */
import * as React from "react";

export type ThemePreference = "light" | "dark";

export const THEME_STORAGE_KEY = "mediaos-theme";

/** Đọc theme đang lưu; lỗi storage (Safari private…) → mặc định dark. */
export function getStoredTheme(): ThemePreference {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Áp theme lên <html> + lưu lựa chọn. Lỗi storage thì vẫn áp class (không chặn UI). */
export function applyTheme(theme: ThemePreference): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // storage bị chặn → theme vẫn đổi trong phiên, chỉ không nhớ qua reload
  }
}

export function useTheme(): { theme: ThemePreference; toggleTheme: () => void } {
  const [theme, setTheme] = React.useState<ThemePreference>(getStoredTheme);

  const toggleTheme = React.useCallback(() => {
    setTheme((prev) => {
      const next: ThemePreference = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
