/**
 * theme.ts — Theme preference PRIMITIVE (system/light/dark), S5-ME-FE-3 (ME-SCREEN-014 Appearance).
 *
 * Đặt Ở web-core (KHÔNG packages/ui): hướng phụ thuộc chuẩn là ui → web-core (web-core KHÔNG import
 * ui — packages/ui/package.json phụ thuộc @mediaos/web-core, chiều ngược lại sẽ tạo cycle). Hook React
 * `useTheme` (packages/ui/src/hooks/use-theme.ts, lane fe3uitheme SAU lane này) sẽ delegate qua các hàm
 * THUẦN ở đây để hỗ trợ thêm lựa chọn 'system' — vẫn giữ API light/dark cũ + `toggleTheme` back-compat
 * cho code hiện có (topbar/theme-toggle).
 *
 * Nguồn sự thật: class `dark` trên <html> + localStorage khoá `mediaos-theme` — CÙNG KHOÁ với
 * packages/ui/src/hooks/use-theme.ts hiện tại (KHÔNG đổi tên khoá, tránh mất lựa chọn đã lưu của user).
 */

export const THEME_STORAGE_KEY = "mediaos-theme";

export const THEME_VALUES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_VALUES)[number];

/** Theme ĐÃ resolve (áp thực tế lên UI) — không có 'system' (system luôn resolve về 1 trong 2 giá trị này). */
export type ResolvedTheme = "light" | "dark";

/** Đọc lựa chọn đã lưu; giá trị lạ/vắng/lỗi storage (Safari private mode…) → 'system' (mặc định theo OS). */
export function getStoredTheme(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
  } catch {
    return "system";
  }
}

/**
 * Resolve theme hệ điều hành qua `matchMedia('(prefers-color-scheme: dark)')`. Môi trường không hỗ trợ
 * (SSR / jsdom chưa mock matchMedia) → fallback 'light' (fail-soft, KHÔNG ném).
 */
export function resolveSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/**
 * Áp 1 lựa chọn theme: 'system' resolve qua `resolveSystemTheme()`, 'light'/'dark' áp thẳng. Ghi class
 * `dark` lên `<html>` + lưu NGUYÊN lựa chọn (không phải giá trị đã resolve — để lần load sau vẫn biết
 * user chọn 'system' chứ không phải 'dark' cứng) vào localStorage.
 *
 * Fail-soft: lỗi ghi storage (quota/private mode) KHÔNG chặn UI — class vẫn được áp, chỉ không nhớ qua
 * reload. KHÔNG throw — theme là tiện ích hiển thị, không phải luồng nghiệp vụ cần chặn.
 */
export function applyTheme(pref: ThemePreference): void {
  const resolved: ResolvedTheme = pref === "system" ? resolveSystemTheme() : pref;
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // storage bị chặn — theme vẫn đổi trong phiên, chỉ không nhớ qua reload.
  }
}
