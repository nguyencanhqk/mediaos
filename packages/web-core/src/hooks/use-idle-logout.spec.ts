// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdleLogout } from "./use-idle-logout";

describe("useIdleLogout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gọi onIdle sau N phút KHÔNG hoạt động", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleLogout({ autoLogoutMinutes: 5, onIdle }));
    expect(onIdle).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5 * 60_000));
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("hoạt động (keydown) RESET bộ đếm — không logout sớm", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleLogout({ autoLogoutMinutes: 5, onIdle }));
    act(() => vi.advanceTimersByTime(4 * 60_000));
    act(() => document.dispatchEvent(new Event("keydown")));
    act(() => vi.advanceTimersByTime(4 * 60_000)); // tổng 8' nhưng đã reset ở 4'
    expect(onIdle).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1 * 60_000)); // đủ 5' kể từ reset
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("TẮT khi minutes null (không bao giờ logout)", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleLogout({ autoLogoutMinutes: null, onIdle }));
    act(() => vi.advanceTimersByTime(60 * 60_000));
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("TẮT khi minutes ≤ 0 (footgun guard — không logout tức thì)", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleLogout({ autoLogoutMinutes: 0, onIdle }));
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("unmount gỡ listener + timer (không logout sau khi unmount)", () => {
    const onIdle = vi.fn();
    const { unmount } = renderHook(() => useIdleLogout({ autoLogoutMinutes: 5, onIdle }));
    unmount();
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(onIdle).not.toHaveBeenCalled();
  });
});
