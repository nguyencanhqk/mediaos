/**
 * S20-TASK-FEDEBT-1 — spec riêng cho tab nhớ của dự án (`useProjectLastTab`, S20-TASK-PROJECTENTRY-1).
 * Trước WO này hook chỉ được phủ gián tiếp qua ProjectDetailPage; các ca ở đây khoá thẳng hợp đồng:
 * khoá gắn người dùng, đổi dự án/đổi người dùng trên CÙNG instance (không remount) đọc lại tab nhớ,
 * storage hỏng/bị chặn ⇒ như chưa có tính năng, và khoá cũ không hậu tố được dọn một lần.
 */
import { useEffect } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAuthStore } from "@mediaos/web-core";
import { useProjectLastTab } from "./use-workspace-tab-order";

const PREFIX = "mediaos.tasks.projectLastTab";

function signIn(userId: string | null) {
  useAuthStore.setState({
    isAuthenticated: userId !== null,
    capabilities: {},
    user:
      userId === null
        ? null
        : {
            id: userId,
            email: `${userId}@demo.local`,
            fullName: userId,
            status: "Active",
            companyId: "co-001",
          },
  });
}

function store(userId: string, map: Record<string, string>) {
  window.localStorage.setItem(`${PREFIX}:${userId}`, JSON.stringify(map));
}

function stored(userId: string): unknown {
  const raw = window.localStorage.getItem(`${PREFIX}:${userId}`);
  return raw ? JSON.parse(raw) : null;
}

describe("useProjectLastTab", () => {
  beforeEach(() => {
    window.localStorage.clear();
    signIn("u-1");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("đọc tab nhớ theo đúng người dùng + dự án; dự án chưa nhớ ⇒ null", () => {
    store("u-1", { "p-1": "board" });
    store("u-2", { "p-1": "members" });
    const { result } = renderHook(({ projectId }) => useProjectLastTab(projectId), {
      initialProps: { projectId: "p-1" },
    });
    expect(result.current.entryTab).toBe("board");

    const other = renderHook(() => useProjectLastTab("p-9"));
    expect(other.result.current.entryTab).toBeNull();
  });

  it("đổi projectId trên CÙNG instance (cây sidebar P1 → P2) ⇒ đọc lại tab nhớ, không cần remount", () => {
    store("u-1", { "p-1": "board", "p-2": "members" });
    let mounts = 0;
    const { result, rerender, unmount } = renderHook(
      ({ projectId }) => {
        useEffect(() => {
          mounts += 1;
        }, []);
        return useProjectLastTab(projectId);
      },
      { initialProps: { projectId: "p-1" } },
    );
    expect(result.current.entryTab).toBe("board");

    rerender({ projectId: "p-2" });
    expect(result.current.entryTab).toBe("members");
    rerender({ projectId: "p-3" });
    expect(result.current.entryTab).toBeNull();
    rerender({ projectId: "p-1" });
    expect(result.current.entryTab).toBe("board");
    expect(mounts).toBe(1);
    unmount();
  });

  it("rememberTab ghi dưới khoá CỦA người dùng hiện tại; bấm Tổng quan ⇒ entryTab về null", () => {
    store("u-1", { "p-1": "board" });
    const { result } = renderHook(() => useProjectLastTab("p-1"));

    act(() => result.current.rememberTab("members"));
    expect(stored("u-1")).toEqual({ "p-1": "members" });
    expect(result.current.entryTab).toBe("board");

    act(() => result.current.rememberTab("overview"));
    expect(stored("u-1")).toEqual({ "p-1": "overview" });
    expect(result.current.entryTab).toBeNull();
  });

  it("đổi người dùng trên cùng trình duyệt ⇒ dùng tab nhớ của người mới, không thừa hưởng người trước", () => {
    store("u-1", { "p-1": "board" });
    store("u-2", { "p-1": "members" });
    const { result } = renderHook(() => useProjectLastTab("p-1"));
    expect(result.current.entryTab).toBe("board");

    act(() => signIn("u-2"));
    expect(result.current.entryTab).toBe("members");

    act(() => signIn("u-3"));
    expect(result.current.entryTab).toBeNull();
    act(() => result.current.rememberTab("activity"));
    expect(stored("u-3")).toEqual({ "p-1": "activity" });
    expect(stored("u-1")).toEqual({ "p-1": "board" });
  });

  it("chưa có id người dùng ⇒ không đọc, không ghi", () => {
    signIn(null);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useProjectLastTab("p-1"));
    expect(result.current.entryTab).toBeNull();
    act(() => result.current.rememberTab("board"));
    expect(setItem).not.toHaveBeenCalled();
  });

  it("storage bị chặn (getItem/setItem/removeItem ném) ⇒ entryTab null, ghi không làm sập", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useProjectLastTab("p-1"));
    expect(result.current.entryTab).toBeNull();
    expect(() => act(() => result.current.rememberTab("board"))).not.toThrow();
  });

  it("dữ liệu rác trong storage ⇒ như chưa nhớ", () => {
    window.localStorage.setItem(`${PREFIX}:u-1`, "{không phải json");
    const { result } = renderHook(() => useProjectLastTab("p-1"));
    expect(result.current.entryTab).toBeNull();
    store("u-1", { "p-1": "khong-phai-tab" });
    const again = renderHook(() => useProjectLastTab("p-1"));
    expect(again.result.current.entryTab).toBeNull();
  });

  it("khoá cũ KHÔNG hậu tố người dùng được dọn — một lần mỗi lần nạp trang, không đụng khoá có hậu tố", async () => {
    // Cờ «đã dọn» sống ở cấp module ⇒ nạp lại module (và auth store đi cùng) cho ca này.
    vi.resetModules();
    const fresh = await import("./use-workspace-tab-order");
    const core = await import("@mediaos/web-core");
    const signInFresh = (id: string) =>
      core.useAuthStore.setState({
        isAuthenticated: true,
        capabilities: {},
        user: {
          id,
          email: `${id}@demo.local`,
          fullName: id,
          status: "Active",
          companyId: "co-001",
        },
      });
    signInFresh("u-1");
    window.localStorage.setItem(PREFIX, JSON.stringify({ "p-1": "board" }));
    store("u-1", { "p-1": "members" });
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const legacyRemovals = () => removeItem.mock.calls.filter(([key]) => key === PREFIX).length;

    const first = renderHook(() => fresh.useProjectLastTab("p-1"));
    expect(window.localStorage.getItem(PREFIX)).toBeNull();
    expect(legacyRemovals()).toBe(1);
    // Khoá có hậu tố giữ nguyên, tab nhớ vẫn đọc từ đó (không phải từ khoá cũ).
    expect(first.result.current.entryTab).toBe("members");
    expect(stored("u-1")).toEqual({ "p-1": "members" });

    // Dùng tiếp trong cùng lần nạp trang (dự án khác, người khác, ghi tab): không dọn lại.
    renderHook(() => fresh.useProjectLastTab("p-2"));
    act(() => signInFresh("u-2"));
    act(() => first.result.current.rememberTab("activity"));
    expect(legacyRemovals()).toBe(1);
  });

  it("dọn khoá cũ khi storage bị chặn ⇒ không làm sập, hook vẫn chạy", async () => {
    vi.resetModules();
    const fresh = await import("./use-workspace-tab-order");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => fresh.useProjectLastTab("p-1"));
    expect(result.current.entryTab).toBeNull();
  });
});
