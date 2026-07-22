// @vitest-environment jsdom
/**
 * S5-BRAND-FE-2 — useFavicon (DOM-only).
 *
 * Chốt các hành vi dễ hỏng âm thầm:
 *   - url có → đổi href + BỎ type="image/svg+xml" (favicon động là png/webp; khai sai kiểu ⇒ một số
 *     trình duyệt bỏ qua icon);
 *   - url null → KHÔI PHỤC favicon tĩnh ban đầu, KHÔNG để href rỗng (tab mất icon);
 *   - unmount → khôi phục tĩnh (không giữ URL presigned đã chết);
 *   - index.html không có <link rel="icon"> → no-op, KHÔNG tự chế thẻ mới.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFavicon } from "./use-favicon";

const STATIC_HREF = "/favicon.svg";

function setupLink(): HTMLLinkElement {
  document.head.innerHTML = "";
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.setAttribute("href", STATIC_HREF);
  document.head.appendChild(link);
  return link;
}

function currentLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
}

beforeEach(() => {
  document.head.innerHTML = "";
});

describe("useFavicon", () => {
  it("url có → đặt href động và gỡ type (không khai sai kiểu)", () => {
    setupLink();
    renderHook(() => useFavicon("https://storage.local/fav.png"));

    const link = currentLink()!;
    expect(link.getAttribute("href")).toBe("https://storage.local/fav.png");
    expect(link.hasAttribute("type")).toBe(false);
  });

  it("url null → giữ favicon TĨNH, không xoá trắng href", () => {
    setupLink();
    renderHook(() => useFavicon(null));

    const link = currentLink()!;
    expect(link.getAttribute("href")).toContain(STATIC_HREF);
    expect(link.type).toBe("image/svg+xml");
  });

  it("đổi từ động → null (gỡ favicon) thì khôi phục đúng bản tĩnh", () => {
    setupLink();
    const { rerender } = renderHook(({ u }: { u: string | null }) => useFavicon(u), {
      initialProps: { u: "https://storage.local/fav.png" as string | null },
    });
    expect(currentLink()!.getAttribute("href")).toBe("https://storage.local/fav.png");

    rerender({ u: null });

    const link = currentLink()!;
    expect(link.getAttribute("href")).toContain(STATIC_HREF);
    expect(link.type).toBe("image/svg+xml");
  });

  it("unmount → khôi phục bản tĩnh (không giữ URL presigned đã chết)", () => {
    setupLink();
    const { unmount } = renderHook(() => useFavicon("https://storage.local/fav.png"));

    unmount();

    expect(currentLink()!.getAttribute("href")).toContain(STATIC_HREF);
  });

  it("không có <link rel=icon> → no-op, KHÔNG tự tạo thẻ mới", () => {
    renderHook(() => useFavicon("https://storage.local/fav.png"));
    expect(currentLink()).toBeNull();
  });
});
