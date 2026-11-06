import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../stores/auth";
import { configureToast, type ToastFn } from "./error-mapper";
import { onSessionBoundary } from "./session-boundary";

/**
 * S20-FE-TOAST-2 — ranh giới phiên: đổi người dùng ⇒ dọn thông báo của người trước, ở MỘT chỗ (web-core).
 */

const USER_A = {
  id: "u-a",
  companyId: "co-1",
  email: "a@demo.local",
  fullName: "A",
  status: "active",
};
const USER_B = {
  id: "u-b",
  companyId: "co-1",
  email: "b@demo.local",
  fullName: "B",
  status: "active",
};

function makeSink(): ToastFn & { clear: ReturnType<typeof vi.fn> } {
  return { error: vi.fn(), warning: vi.fn(), clear: vi.fn() };
}

function signIn(user: typeof USER_A): void {
  useAuthStore.getState().setUser(user, {});
}

describe("onSessionBoundary + configureToast — dọn thông báo khi đổi người dùng", () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });
  afterEach(() => {
    configureToast(null);
    useAuthStore.getState().logout();
  });

  it("đăng xuất ⇒ toast.clear() đúng một lần", () => {
    const sink = makeSink();
    signIn(USER_A);
    configureToast(sink);

    useAuthStore.getState().logout();

    expect(sink.clear).toHaveBeenCalledTimes(1);
  });

  it("đổi phiên tại chỗ A → B (không qua đăng xuất) ⇒ toast.clear()", () => {
    const sink = makeSink();
    signIn(USER_A);
    configureToast(sink);

    signIn(USER_B);

    expect(sink.clear).toHaveBeenCalledTimes(1);
  });

  it("cùng người làm mới /me hoặc chỉ đổi access token ⇒ KHÔNG dọn (không xoá thông báo đang đọc)", () => {
    const sink = makeSink();
    signIn(USER_A);
    configureToast(sink);

    signIn({ ...USER_A, fullName: "A (đổi tên)" });
    useAuthStore.getState().setAccessToken(["tok", "refresh", "x"].join("-"));

    expect(sink.clear).not.toHaveBeenCalled();
  });

  it("sau A → B, B làm mới /me nhiều lần ⇒ vẫn chỉ dọn ĐÚNG MỘT lần (mốc so sánh dời sang B)", () => {
    const sink = makeSink();
    signIn(USER_A);
    configureToast(sink);

    signIn(USER_B);
    signIn({ ...USER_B, fullName: "B (đổi tên)" });
    signIn({ ...USER_B, status: "active" });

    expect(sink.clear).toHaveBeenCalledTimes(1);
  });

  it("gắn lại đích ⇒ chỉ đích MỚI được dọn; configureToast(null) ⇒ không dọn gì", () => {
    const first = makeSink();
    const second = makeSink();
    signIn(USER_A);
    configureToast(first);
    configureToast(second);

    useAuthStore.getState().logout();
    expect(first.clear).not.toHaveBeenCalled();
    expect(second.clear).toHaveBeenCalledTimes(1);

    configureToast(null);
    signIn(USER_B);
    expect(second.clear).toHaveBeenCalledTimes(1);
  });

  it("đích không có clear ⇒ không ném khi đổi người dùng", () => {
    configureToast({ error: vi.fn(), warning: vi.fn() });
    signIn(USER_A);
    expect(() => useAuthStore.getState().logout()).not.toThrow();
  });

  it("một handler ném lỗi KHÔNG chặn handler sau, lỗi được log rõ", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const after = vi.fn();
    signIn(USER_A);
    const offBroken = onSessionBoundary(() => {
      throw new Error("hỏng");
    });
    const offAfter = onSessionBoundary(after);

    useAuthStore.getState().logout();

    expect(after).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("[session-boundary]"),
      expect.any(Error),
    );
    offBroken();
    offAfter();
    consoleError.mockRestore();
  });

  it("huỷ đăng ký ⇒ handler không còn được gọi", () => {
    const handler = vi.fn();
    signIn(USER_A);
    const off = onSessionBoundary(handler);
    off();

    useAuthStore.getState().logout();

    expect(handler).not.toHaveBeenCalled();
  });
});
