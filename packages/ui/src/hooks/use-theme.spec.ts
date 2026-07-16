/**
 * use-theme.spec.ts — hook React mỏng DELEGATE nguồn sự thật theme sang @mediaos/web-core
 * (lib/theme.ts). Test ở đây KHÔNG lặp lại các case fail-soft/SSR đã phủ trong
 * packages/web-core/src/lib/theme.spec.ts — chỉ kiểm chứng phần React state + round-trip
 * localStorage thật (jsdom) + back-compat toggleTheme (S5-ME-FE-3 ME-SCREEN-014).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY } from "@mediaos/web-core";
import { useTheme } from "./use-theme";

function mockMatchMedia(matchesDark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("dark") ? matchesDark : !matchesDark,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("useTheme", () => {
  it("mặc định đọc lại preference đã lưu trong localStorage (round-trip)", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
  });

  it("không có gì trong localStorage → mặc định 'system'", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
  });

  it("setTheme('light') → ghi localStorage='light' + bỏ class dark trên <html>", () => {
    document.documentElement.classList.add("dark");
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("light"));
    expect(result.current.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("setTheme('dark') → ghi localStorage='dark' + thêm class dark", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("dark"));
    expect(result.current.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("setTheme('system') với OS dark (matchMedia) → resolvedTheme='dark', lưu 'system' (không phải 'dark')", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("system"));
    expect(result.current.theme).toBe("system");
    expect(result.current.resolvedTheme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("setTheme('system') với OS light (matchMedia) → resolvedTheme='light'", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("system"));
    expect(result.current.resolvedTheme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("toggleTheme back-compat: đảo light -> dark", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("light"));
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("toggleTheme back-compat: đảo dark -> light", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("dark"));
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("toggleTheme khi đang 'system' + OS dark → đảo theo resolved hiện tại (dark -> light)", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("system"));
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
