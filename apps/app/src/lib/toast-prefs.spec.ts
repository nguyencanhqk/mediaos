// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TOAST_PREFS,
  readToastPrefs,
  resetToastPrefsMemory,
  toastPrefsKey,
  writeToastPrefs,
} from "./toast-prefs";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  resetToastPrefsMemory();
});

describe("toast-prefs", () => {
  it("mặc định: bật toast thông báo + tin nhắn, TẮT xem trước", () => {
    expect(readToastPrefs("u1")).toEqual({ notifications: true, messages: true, preview: false });
    expect(readToastPrefs(null)).toEqual(DEFAULT_TOAST_PREFS);
  });

  it("khoá gắn userId: người khác đăng nhập cùng máy không thừa hưởng", () => {
    writeToastPrefs("u1", { preview: true, messages: false });
    expect(readToastPrefs("u1")).toEqual({ notifications: true, messages: false, preview: true });
    expect(readToastPrefs("u2")).toEqual(DEFAULT_TOAST_PREFS);
    expect(window.localStorage.getItem(toastPrefsKey("u1"))).not.toBeNull();
  });

  it("JSON hỏng / sai kiểu ⇒ mặc định an toàn, không ném", () => {
    window.localStorage.setItem(toastPrefsKey("u1"), "{không phải json");
    expect(readToastPrefs("u1")).toEqual(DEFAULT_TOAST_PREFS);
    window.localStorage.setItem(
      toastPrefsKey("u1"),
      JSON.stringify({ preview: "yes", messages: 0 }),
    );
    expect(readToastPrefs("u1")).toEqual(DEFAULT_TOAST_PREFS);
  });

  it("localStorage bị chặn (đọc + ghi ném) ⇒ mặc định an toàn, không ném; công tắc giữ trong phiên", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readToastPrefs("u1")).toEqual(DEFAULT_TOAST_PREFS);
    expect(() => writeToastPrefs("u1", { notifications: false })).not.toThrow();
    expect(readToastPrefs("u1").notifications).toBe(false);
    expect(readToastPrefs("u2")).toEqual(DEFAULT_TOAST_PREFS);
  });
});
