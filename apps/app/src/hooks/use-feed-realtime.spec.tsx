/**
 * S16-SOCIAL-FE-1 — ca **C15 · C16** trên `useFeedRealtime`.
 *
 * C15 có một vế **DƯƠNG TÍNH** dễ bị bỏ quên: badge tăng thì dễ assert, nhưng điều SPEC-16 §13.7 +
 * SOC-DEC-010 thật sự cấm là **tự chèn bài**. Nếu chỉ assert "đếm = 3" thì một hiện thực vừa đếm vừa
 * chèn vẫn xanh. Vì vậy ca dưới đây khẳng định hook **không hề có** đường trả bài về.
 */
import { renderHook, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@mediaos/web-core";
import { WS_EVENTS } from "@mediaos/contracts";
import { useFeedRealtime } from "./use-feed-realtime";

type Handler = (payload: unknown) => void;

/** Socket giả đếm `on`/`off` để nghiệm việc gỡ listener có ĐỐI XỨNG không. */
const handlers = new Map<string, Set<Handler>>();
const onCalls: string[] = [];
const offCalls: string[] = [];

const fakeSocket = {
  on: (event: string, fn: Handler) => {
    onCalls.push(event);
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(fn);
  },
  off: (event: string, fn: Handler) => {
    offCalls.push(event);
    handlers.get(event)?.delete(fn);
  },
};

let socketAvailable = true;

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    getAppSocket: () => (socketAvailable ? fakeSocket : null),
  };
});

function emit(event: string, payload: unknown): void {
  for (const fn of handlers.get(event) ?? []) fn(payload);
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

/** Payload hợp lệ theo `wsFeedPostCreatedEventSchema` (đã omit myReaction/savedByMe/isMine/status). */
const WS_POST = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "share",
  audience: "company",
  orgUnitId: null,
  groupId: null,
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

beforeEach(() => {
  handlers.clear();
  onCalls.length = 0;
  offCalls.length = 0;
  socketAvailable = true;
  setCaps({ "view:feed": true });
});

afterEach(() => {
  cleanup();
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.restoreAllMocks();
});

describe("C15 — badge ĐẾM, KHÔNG chèn bài (D7 · SOC-DEC-010)", () => {
  it("3 sự kiện `feed:post.created` ⇒ đếm = 3", () => {
    const { result } = renderHook(() => useFeedRealtime());
    expect(result.current.newPostCount).toBe(0);

    act(() => {
      emit(WS_EVENTS.FEED_POST_CREATED, WS_POST);
      emit(WS_EVENTS.FEED_POST_CREATED, { ...WS_POST, id: "22222222-2222-4222-8222-222222222222" });
      emit(WS_EVENTS.FEED_POST_CREATED, { ...WS_POST, id: "33333333-3333-4333-8333-333333333333" });
    });

    expect(result.current.newPostCount).toBe(3);
  });

  it("DƯƠNG TÍNH: hook KHÔNG trả về bài nào — không có đường để chèn vào danh sách", () => {
    /**
     * Vế này mới là thứ SOC-DEC-010 cấm. Một hiện thực "vừa đếm vừa gom bài vào mảng" sẽ qua được ca
     * trên; nó chỉ chết ở đây. Bề mặt API của hook đúng bằng `{newPostCount, reset}` — thêm khoá
     * `posts`/`items` là ca này ĐỎ ngay, trước khi ai kịp nối nó vào danh sách.
     */
    const { result } = renderHook(() => useFeedRealtime());
    act(() => {
      emit(WS_EVENTS.FEED_POST_CREATED, WS_POST);
    });

    expect(Object.keys(result.current).sort()).toEqual(["newPostCount", "reset"]);
  });

  it("`reset()` đưa đếm về 0 (người dùng đã bấm badge và tải lại)", () => {
    const { result } = renderHook(() => useFeedRealtime());
    act(() => {
      emit(WS_EVENTS.FEED_POST_CREATED, WS_POST);
    });
    expect(result.current.newPostCount).toBe(1);

    act(() => result.current.reset());
    expect(result.current.newPostCount).toBe(0);
  });

  it("payload SAI hợp đồng ⇒ KHÔNG đếm, KHÔNG ném, nhưng CÓ log", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useFeedRealtime());

    act(() => {
      emit(WS_EVENTS.FEED_POST_CREATED, { id: "không-phải-uuid" });
    });

    expect(result.current.newPostCount).toBe(0);
    // Im lặng bỏ qua sẽ biến một lần đổi shape ở contracts thành "badge không bao giờ hiện" mà không
    // để lại dấu vết nào.
    expect(spy).toHaveBeenCalled();
  });
});

describe("C16 — cổng quyền + gỡ listener đối xứng", () => {
  it("ALLOW: có `view:feed` ⇒ CÓ đăng ký listener", () => {
    renderHook(() => useFeedRealtime());
    expect(onCalls).toContain(WS_EVENTS.FEED_POST_CREATED);
  });

  it("DENY: KHÔNG có `view:feed` ⇒ KHÔNG `socket.on` lần nào", () => {
    setCaps({});
    renderHook(() => useFeedRealtime());
    expect(onCalls).toEqual([]);
  });

  it("unmount ⇒ số `off` BẰNG số `on` (không rò listener trên socket dùng chung)", () => {
    /**
     * `getAppSocket()` trả kết nối dùng chung sống suốt phiên. Listener không gỡ sẽ tích luỹ qua mỗi
     * lần vào/ra bảng tin ⇒ badge tăng 2, rồi 3, rồi 4 cho MỖI bài mới — một lỗi chỉ lộ ra sau vài
     * phút dùng thật, không bao giờ lộ trong một lần render.
     */
    const { unmount } = renderHook(() => useFeedRealtime());
    expect(onCalls.length).toBe(1);

    unmount();
    expect(offCalls.length).toBe(onCalls.length);
    expect(handlers.get(WS_EVENTS.FEED_POST_CREATED)?.size ?? 0).toBe(0);
  });

  it("chưa có phiên (socket `null`) ⇒ không ném, không đăng ký", () => {
    socketAvailable = false;
    expect(() => renderHook(() => useFeedRealtime())).not.toThrow();
    expect(onCalls).toEqual([]);
  });
});
