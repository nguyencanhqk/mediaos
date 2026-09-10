// @vitest-environment jsdom
/**
 * S17-CHAT-UX2-FE-5 — `useChatLayoutMode` (SPEC-15 §9 CHAT-SCREEN-001 v2, ba mốc của DEC-026).
 *
 * ⚠️ Mock `matchMedia` phải trả `matches` **theo QUERY**, không trả một hằng số. Một mock trả cứng làm
 * cả ba ca dưới đây đọc cùng một giá trị: bài test vẫn xanh, nhưng nó chỉ chứng minh hook gọi được
 * `matchMedia`, chứ không chứng minh nó phân biệt được ba mốc.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { CHAT_MD_QUERY, CHAT_XL_QUERY, useChatLayoutMode } from "./use-chat-viewport";

type Listener = () => void;

/** Danh sách listener theo từng query — để test bắn được sự kiện `change` như trình duyệt thật. */
function stubMatchMedia(widthPx: number) {
  const listeners = new Map<string, Set<Listener>>();
  let width = widthPx;

  const matchesFor = (query: string): boolean => {
    if (query === CHAT_XL_QUERY) return width >= 1280;
    if (query === CHAT_MD_QUERY) return width >= 768;
    throw new Error(`query ngoài hợp đồng của hook: ${query}`);
  };

  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        return matchesFor(query);
      },
      media: query,
      addEventListener: (_type: string, cb: Listener) => {
        const set = listeners.get(query) ?? new Set<Listener>();
        set.add(cb);
        listeners.set(query, set);
      },
      removeEventListener: (_type: string, cb: Listener) => {
        listeners.get(query)?.delete(cb);
      },
    })),
  );

  return {
    resizeTo(next: number) {
      width = next;
      for (const set of listeners.values()) {
        for (const cb of set) cb();
      }
    },
    /** Bao nhiêu listener còn sống — dùng để đo cleanup. */
    listenerCount(): number {
      let total = 0;
      for (const set of listeners.values()) total += set.size;
      return total;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useChatLayoutMode — ba mốc", () => {
  it("≥1280 ⇒ three (ba cột)", () => {
    stubMatchMedia(1440);
    expect(renderHook(() => useChatLayoutMode()).result.current).toBe("three");
  });

  it("768–1279 ⇒ two (thông tin phòng thành Sheet)", () => {
    stubMatchMedia(1024);
    expect(renderHook(() => useChatLayoutMode()).result.current).toBe("two");
  });

  it("<768 ⇒ single (một khung tại một thời điểm)", () => {
    stubMatchMedia(390);
    expect(renderHook(() => useChatLayoutMode()).result.current).toBe("single");
  });

  it("ngay dưới mốc xl (1279) VẪN là two — biên trên đóng đúng chỗ", () => {
    stubMatchMedia(1279);
    expect(renderHook(() => useChatLayoutMode()).result.current).toBe("two");
  });

  it("đúng 768 ⇒ two (min-width là bao gồm)", () => {
    stubMatchMedia(768);
    expect(renderHook(() => useChatLayoutMode()).result.current).toBe("two");
  });
});

describe("useChatLayoutMode — cập nhật khi khung nhìn đổi", () => {
  it("kéo cửa sổ hẹp lại ⇒ three → two → single", () => {
    const mq = stubMatchMedia(1440);
    const { result } = renderHook(() => useChatLayoutMode());
    expect(result.current).toBe("three");

    act(() => mq.resizeTo(1024));
    expect(result.current).toBe("two");

    act(() => mq.resizeTo(400));
    expect(result.current).toBe("single");

    // Và ngược lại — hook không được "kẹt" ở mốc hẹp nhất từng thấy.
    act(() => mq.resizeTo(1600));
    expect(result.current).toBe("three");
  });

  it("unmount ⇒ gỡ HẾT listener (không rò theo số lần vào/ra trang chat)", () => {
    const mq = stubMatchMedia(1440);
    const { unmount } = renderHook(() => useChatLayoutMode());
    expect(mq.listenerCount()).toBe(2);

    unmount();
    expect(mq.listenerCount()).toBe(0);
  });
});

describe("useChatLayoutMode — RATCHET: vắng matchMedia", () => {
  it("môi trường không có matchMedia ⇒ three (giữ ba cột)", () => {
    // Đây KHÔNG phải ca phòng thủ suông. `apps/app/src/test/setup.ts` không polyfill `matchMedia` và
    // jsdom không có sẵn ⇒ toàn bộ spec `/chat` viết TRƯỚC FE-5 đi qua đúng nhánh này và vẫn thấy bố
    // cục ba cột. Thêm một polyfill trả `matches: false` vào `setup.ts` sẽ đẩy chúng sang mốc `single`
    // (danh sách và hội thoại loại trừ nhau) — hàng chục ca đỏ mà không ai lần ra vì sao. Ca này biến
    // thay đổi đó thành MỘT dòng đỏ có tên.
    vi.stubGlobal("matchMedia", undefined);
    expect(renderHook(() => useChatLayoutMode()).result.current).toBe("three");
  });
});
