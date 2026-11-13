/**
 * S16-SOCIAL-FEGROUPBADGE-1 — đếm «bài mới» THEO NHÓM trên `feed:post.created` biến thể `group`.
 * Ca hồi quy: bài nhóm KHÔNG làm tăng badge feed chính (Q-FE (a) của BE-2C).
 */
import { renderHook, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@mediaos/web-core";
import { WS_EVENTS } from "@mediaos/contracts";
import { useFeedRealtime } from "./use-feed-realtime";
import { useGroupFeedRealtime } from "./use-feed-realtime-groups";

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
const counts = { on: 0, off: 0 };

const fakeSocket = {
  on: (event: string, fn: Handler) => {
    counts.on += 1;
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(fn);
  },
  off: (event: string, fn: Handler) => {
    counts.off += 1;
    handlers.get(event)?.delete(fn);
  },
};

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, getAppSocket: () => fakeSocket };
});

function emit(payload: unknown): void {
  for (const fn of handlers.get(WS_EVENTS.FEED_POST_CREATED) ?? []) fn(payload);
}

const GROUP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GROUP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const BASE = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "share",
  orgUnitId: null,
  author: { employeeId: null, fullName: "An", avatarUrl: null },
  body: "chào",
  tags: [],
  attachments: [],
  pinned: false,
  commentsLocked: false,
  requiresAck: false,
  likeCount: 0,
  commentCount: 0,
  viewCount: 0,
  editedAt: null,
  publishedAt: "2026-09-23T03:00:00.000Z",
  lastActivityAt: "2026-09-23T03:00:00.000Z",
  createdAt: "2026-09-23T03:00:00.000Z",
};
const groupPost = (groupId: unknown) => ({ ...BASE, audience: "group", groupId });
const companyPost = { ...BASE, audience: "company", groupId: null };

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

beforeEach(() => {
  handlers.clear();
  counts.on = 0;
  counts.off = 0;
  setCaps({ "view:feed": true });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.restoreAllMocks();
});

describe("useGroupFeedRealtime", () => {
  it("đếm theo groupId: bài nhóm B không làm tăng nhóm A", () => {
    const { result } = renderHook(() => useGroupFeedRealtime());
    act(() => {
      emit(groupPost(GROUP_B));
      emit(groupPost(GROUP_B));
      emit(groupPost(GROUP_A));
    });
    expect(result.current.countFor(GROUP_A)).toBe(1);
    expect(result.current.countFor(GROUP_B)).toBe(2);
  });

  it("reset(groupId) chỉ xoá đúng nhóm", () => {
    const { result } = renderHook(() => useGroupFeedRealtime());
    act(() => {
      emit(groupPost(GROUP_A));
      emit(groupPost(GROUP_B));
    });
    act(() => result.current.reset(GROUP_A));
    expect(result.current.countFor(GROUP_A)).toBe(0);
    expect(result.current.countFor(GROUP_B)).toBe(1);
  });

  it("hai instance cùng mount: reset ở một nơi xoá đếm nhóm đó ở cả hai", () => {
    const rail = renderHook(() => useGroupFeedRealtime());
    const tab = renderHook(() => useGroupFeedRealtime());
    act(() => {
      emit(groupPost(GROUP_A));
      emit(groupPost(GROUP_B));
    });
    expect(rail.result.current.countFor(GROUP_A)).toBe(1);
    act(() => tab.result.current.reset(GROUP_A));
    expect(tab.result.current.countFor(GROUP_A)).toBe(0);
    expect(rail.result.current.countFor(GROUP_A)).toBe(0);
    expect(rail.result.current.countFor(GROUP_B)).toBe(1);
  });

  it("bài công ty và payload sai hợp đồng không được đếm", () => {
    const { result } = renderHook(() => useGroupFeedRealtime());
    act(() => {
      emit(companyPost);
      emit(groupPost(null));
      emit({ audience: "group", groupId: GROUP_A });
    });
    expect(result.current.countFor(GROUP_A)).toBe(0);
    expect(Object.keys(result.current.counts)).toHaveLength(0);
  });

  it("thiếu view:feed ⇒ không đăng ký listener; có ⇒ on bằng off sau unmount", () => {
    setCaps({});
    const denied = renderHook(() => useGroupFeedRealtime());
    expect(counts.on).toBe(0);
    denied.unmount();

    setCaps({ "view:feed": true });
    const allowed = renderHook(() => useGroupFeedRealtime());
    expect(counts.on).toBe(1);
    allowed.unmount();
    expect(counts.off).toBe(1);
  });

  it("hồi quy: bài nhóm KHÔNG tăng badge feed chính, bài công ty KHÔNG tăng badge nhóm", () => {
    const main = renderHook(() => useFeedRealtime());
    const grp = renderHook(() => useGroupFeedRealtime());
    act(() => emit(groupPost(GROUP_A)));
    expect(main.result.current.newPostCount).toBe(0);
    expect(grp.result.current.countFor(GROUP_A)).toBe(1);
    act(() => emit(companyPost));
    expect(main.result.current.newPostCount).toBe(1);
    expect(grp.result.current.countFor(GROUP_A)).toBe(1);
  });
});
