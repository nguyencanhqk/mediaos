/**
 * theme.spec.ts — Theme preference primitive (S5-ME-FE-3, ME-SCREEN-014).
 *
 * `vitest.config.ts` chạy environment "node" (KHÔNG jsdom) → `window`/`document` không tồn tại mặc định;
 * mỗi test tự stub qua `vi.stubGlobal` (cùng pattern session.spec.ts) để kiểm chứng cả nhánh SSR
 * (window/document vắng — fail-soft) lẫn nhánh trình duyệt thật (localStorage + matchMedia + classList).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, applyTheme, getStoredTheme, resolveSystemTheme } from "./theme";

function makeLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    store,
  };
}

function makeClassList() {
  const classes = new Set<string>();
  return {
    toggle: vi.fn((name: string, on?: boolean) => {
      if (on) classes.add(name);
      else classes.delete(name);
    }),
    has: (name: string) => classes.has(name),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getStoredTheme", () => {
  it("KHÔNG có window (SSR) → 'system' (fail-soft, không throw)", () => {
    expect(getStoredTheme()).toBe("system");
  });

  it("localStorage rỗng → 'system'", () => {
    vi.stubGlobal("window", { localStorage: makeLocalStorage() });
    expect(getStoredTheme()).toBe("system");
  });

  it("localStorage='light' → 'light'", () => {
    vi.stubGlobal("window", { localStorage: makeLocalStorage({ [THEME_STORAGE_KEY]: "light" }) });
    expect(getStoredTheme()).toBe("light");
  });

  it("localStorage='dark' → 'dark'", () => {
    vi.stubGlobal("window", { localStorage: makeLocalStorage({ [THEME_STORAGE_KEY]: "dark" }) });
    expect(getStoredTheme()).toBe("dark");
  });

  it("localStorage='system' → 'system'", () => {
    vi.stubGlobal("window", { localStorage: makeLocalStorage({ [THEME_STORAGE_KEY]: "system" }) });
    expect(getStoredTheme()).toBe("system");
  });

  it("giá trị lạ (không phải system/light/dark) → 'system' (fail-closed về mặc định)", () => {
    vi.stubGlobal("window", { localStorage: makeLocalStorage({ [THEME_STORAGE_KEY]: "purple" }) });
    expect(getStoredTheme()).toBe("system");
  });

  it("localStorage.getItem throw (Safari private mode) → 'system'", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(getStoredTheme()).toBe("system");
  });
});

describe("resolveSystemTheme", () => {
  it("KHÔNG có window (SSR) → 'light'", () => {
    expect(resolveSystemTheme()).toBe("light");
  });

  it("window.matchMedia không phải function → 'light'", () => {
    vi.stubGlobal("window", {});
    expect(resolveSystemTheme()).toBe("light");
  });

  it("matchMedia({ matches: true }) → 'dark'", () => {
    vi.stubGlobal("window", { matchMedia: vi.fn(() => ({ matches: true })) });
    expect(resolveSystemTheme()).toBe("dark");
  });

  it("matchMedia({ matches: false }) → 'light'", () => {
    vi.stubGlobal("window", { matchMedia: vi.fn(() => ({ matches: false })) });
    expect(resolveSystemTheme()).toBe("light");
  });

  it("matchMedia throw → 'light' (fail-soft)", () => {
    vi.stubGlobal("window", {
      matchMedia: () => {
        throw new Error("not supported");
      },
    });
    expect(resolveSystemTheme()).toBe("light");
  });
});

describe("applyTheme", () => {
  let classList: ReturnType<typeof makeClassList>;
  let localStorage: ReturnType<typeof makeLocalStorage>;

  beforeEach(() => {
    classList = makeClassList();
    localStorage = makeLocalStorage();
    vi.stubGlobal("document", { documentElement: { classList } });
  });

  it("applyTheme('dark') → thêm class 'dark' + ghi localStorage='dark'", () => {
    vi.stubGlobal("window", { localStorage, matchMedia: vi.fn(() => ({ matches: false })) });
    applyTheme("dark");
    expect(classList.toggle).toHaveBeenCalledWith("dark", true);
    expect(classList.has("dark")).toBe(true);
    expect(localStorage.store.get(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("applyTheme('light') → bỏ class 'dark' + ghi localStorage='light'", () => {
    vi.stubGlobal("window", { localStorage, matchMedia: vi.fn(() => ({ matches: true })) });
    applyTheme("light");
    expect(classList.toggle).toHaveBeenCalledWith("dark", false);
    expect(classList.has("dark")).toBe(false);
    expect(localStorage.store.get(THEME_STORAGE_KEY)).toBe("light");
  });

  it("applyTheme('system') resolve qua matchMedia dark=true → áp class dark, LƯU 'system' (không phải 'dark')", () => {
    vi.stubGlobal("window", { localStorage, matchMedia: vi.fn(() => ({ matches: true })) });
    applyTheme("system");
    expect(classList.has("dark")).toBe(true);
    expect(localStorage.store.get(THEME_STORAGE_KEY)).toBe("system");
  });

  it("applyTheme('system') resolve qua matchMedia dark=false → bỏ class dark, LƯU 'system'", () => {
    vi.stubGlobal("window", { localStorage, matchMedia: vi.fn(() => ({ matches: false })) });
    applyTheme("system");
    expect(classList.has("dark")).toBe(false);
    expect(localStorage.store.get(THEME_STORAGE_KEY)).toBe("system");
  });

  it("fail-soft: localStorage.setItem throw → KHÔNG throw, class vẫn được áp", () => {
    vi.stubGlobal("window", {
      localStorage: {
        setItem: () => {
          throw new Error("quota exceeded");
        },
      },
      matchMedia: vi.fn(() => ({ matches: false })),
    });
    expect(() => applyTheme("dark")).not.toThrow();
    expect(classList.has("dark")).toBe(true);
  });

  it("KHÔNG có document (SSR) → KHÔNG throw", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("window", {
      localStorage: makeLocalStorage(),
      matchMedia: vi.fn(() => ({ matches: false })),
    });
    expect(() => applyTheme("dark")).not.toThrow();
  });
});
