// @vitest-environment jsdom
/**
 * S20-DASH-TODAY-1 — allowlist `defaultLanding`. Ca TẤN CÔNG viết trước: mỗi dạng thoát khỏi allowlist
 * phải về `/home`, không bao giờ trả lại chuỗi đầu vào.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DEFAULT_LANDING_HOLD_MAX_MS,
  DEFAULT_LANDING_OPTIONS,
  resolveDefaultLanding,
  useApplyDefaultLanding,
} from "./default-landing";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));
vi.mock("@mediaos/web-core", () => ({
  meApi: { getPreferences: vi.fn() },
  meKeys: { preferences: () => ["me", "preferences"] },
}));
import { meApi } from "@mediaos/web-core";
const getPrefs = meApi.getPreferences as ReturnType<typeof vi.fn>;

const ATTACKS = [
  "/evil",
  "https://evil.example/home",
  "http://localhost/dashboard",
  "//evil.example",
  "/\\evil.example",
  "\\\\evil.example",
  "javascript:alert(1)",
  "/dashboard?x=1",
  "/dashboard#frag",
  "/dashboard/",
  "/dashboard/../admin",
  "/DASHBOARD",
  " /dashboard",
  "/dashboard ",
  "/dashboard\n",
  "/me/security",
  "/tasks/my-tasks?group=due",
  "",
];

describe("resolveDefaultLanding", () => {
  it.each(DEFAULT_LANDING_OPTIONS)("nhận đúng %s", (path) => {
    expect(resolveDefaultLanding(path)).toBe(path);
  });
  it.each(ATTACKS)("chặn %j ⇒ /home", (raw) => {
    expect(resolveDefaultLanding(raw)).toBe("/home");
  });
  it.each([null, undefined, 42, {}, ["/me"]])("không phải chuỗi (%j) ⇒ /home", (raw) => {
    expect(resolveDefaultLanding(raw)).toBe("/home");
  });
});

function setup(retry: number | false = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry, retryDelay: 60_000 } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useApplyDefaultLanding(), { wrapper });
}

describe("useApplyDefaultLanding", () => {
  beforeEach(() => vi.clearAllMocks());

  it("/dashboard đã chọn ⇒ replace tới /dashboard đúng một lần", async () => {
    getPrefs.mockResolvedValue({ defaultLanding: "/dashboard" });
    const { rerender } = setup();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    rerender();
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/dashboard", replace: true });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it.each(["/\\evil", "https://evil.example", "//evil.example", "/\\evil", "/me?x=1"])(
    "giá trị tấn công %j ⇒ KHÔNG điều hướng đi đâu",
    async (raw) => {
      getPrefs.mockResolvedValue({ defaultLanding: raw });
      setup();
      await waitFor(() => expect(getPrefs).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 20));
      expect(mockNavigate).not.toHaveBeenCalled();
    },
  );

  it("chưa đặt (null) hoặc /home ⇒ ở nguyên", async () => {
    getPrefs.mockResolvedValue({ defaultLanding: null });
    setup();
    await waitFor(() => expect(getPrefs).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("trả true (giữ Home chưa vẽ) khi đang tải hoặc sắp chuyển; false khi ở lại /home", async () => {
    getPrefs.mockResolvedValue({ defaultLanding: "/dashboard" });
    const a = setup();
    expect(a.result.current).toBe(true);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(a.result.current).toBe(true);
    getPrefs.mockResolvedValue({ defaultLanding: null });
    const b = setup();
    expect(b.result.current).toBe(true);
    await waitFor(() => expect(b.result.current).toBe(false));
  });

  it("lỗi tải preferences ⇒ ở nguyên (fail-soft)", async () => {
    getPrefs.mockRejectedValue(new Error("boom"));
    setup();
    await waitFor(() => expect(getPrefs).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("lỗi tạm + react-query đang retry ⇒ nhả Home NGAY (không đợi retry), không điều hướng", async () => {
    getPrefs.mockRejectedValue(new Error("tạm"));
    const { result } = setup(3);
    await waitFor(() => expect(getPrefs).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current).toBe(false));
    expect(getPrefs).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("lỗi tạm rồi retry THÀNH CÔNG ⇒ Home đã nhả thì ở nguyên, không nhảy trang muộn", async () => {
    vi.useFakeTimers();
    try {
      getPrefs
        .mockRejectedValueOnce(new Error("tạm"))
        .mockResolvedValueOnce({ defaultLanding: "/dashboard" });
      const { result } = setup(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(result.current).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_010);
      });
      expect(getPrefs).toHaveBeenCalledTimes(2);
      expect(result.current).toBe(false);
      expect(mockNavigate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lượt tải đầu treo quá trần ⇒ nhả Home, dữ liệu về muộn KHÔNG kéo điều hướng", async () => {
    vi.useFakeTimers();
    try {
      let resolve: (v: unknown) => void = () => undefined;
      getPrefs.mockReturnValue(new Promise((r) => (resolve = r)));
      const { result } = setup();
      expect(result.current).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DEFAULT_LANDING_HOLD_MAX_MS + 10);
      });
      expect(result.current).toBe(false);
      await act(async () => {
        resolve({ defaultLanding: "/dashboard" });
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
