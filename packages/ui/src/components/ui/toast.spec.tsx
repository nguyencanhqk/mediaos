/**
 * toast.spec.tsx — S20-FE-TOAST-1 (US-X-91): hệ thông báo nổi dùng chung.
 *
 * Khoá các bất biến mà mọi WO S20 sau dựa vào: gộp theo khoá trong cửa sổ (kèm số lần) · tối đa
 * {@link TOAST_LIMIT} (cũ nhất tự đóng) · vùng `aria-live` (lỗi assertive, còn lại polite, vùng có sẵn
 * TRƯỚC khi có thông báo) · Esc đóng · nút hành động là nút thật (tới được bằng Tab) · chuyển động chỉ
 * khi người dùng không xin giảm chuyển động · mặc định chỉ là chuỗi ngắn, không phải nội dung tuỳ ý.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TOAST_COALESCE_WINDOW_MS,
  TOAST_DEFAULT_DURATION_MS,
  TOAST_LIMIT,
  TOAST_MAX_MESSAGE_LENGTH,
  Toaster,
  toast,
} from "./toast";

function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-slot="toast"]'));
}

function politeRegion(): HTMLElement {
  return screen.getByRole("status");
}

function assertiveRegion(): HTMLElement {
  return screen.getByRole("alert");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T08:00:00Z"));
});

afterEach(() => {
  act(() => toast.clear());
  cleanup();
  vi.useRealTimers();
});

describe("Toaster — vùng aria-live", () => {
  it("hai vùng live có sẵn trước khi có thông báo (trình đọc màn hình chỉ đọc thay đổi trong vùng ĐÃ có)", () => {
    render(<Toaster />);

    expect(politeRegion()).toHaveAttribute("aria-live", "polite");
    expect(assertiveRegion()).toHaveAttribute("aria-live", "assertive");
    expect(cards()).toHaveLength(0);
  });

  it("lỗi vào vùng assertive; thành công và cảnh báo vào vùng polite", () => {
    render(<Toaster />);

    act(() => {
      toast.success("Đã lưu");
      toast.warning("Sắp hết hạn");
      toast.error("Không lưu được");
    });

    expect(within(assertiveRegion()).getByText("Không lưu được")).toBeInTheDocument();
    expect(within(assertiveRegion()).queryByText("Đã lưu")).not.toBeInTheDocument();
    expect(within(politeRegion()).getByText("Đã lưu")).toBeInTheDocument();
    expect(within(politeRegion()).getByText("Sắp hết hạn")).toBeInTheDocument();
  });
});

describe("Toaster — gộp theo khoá", () => {
  it("cùng khoá trong cửa sổ gộp ⇒ MỘT thông báo kèm số lần", () => {
    render(<Toaster />);

    act(() => {
      toast.error("Mất kết nối", { key: "net" });
      vi.advanceTimersByTime(TOAST_COALESCE_WINDOW_MS - 1);
      toast.error("Mất kết nối", { key: "net" });
    });

    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent("×2");
  });

  it("không truyền khoá ⇒ cùng loại + cùng nội dung tự gộp", () => {
    render(<Toaster />);

    act(() => {
      toast.success("Đã lưu");
      toast.success("Đã lưu");
      toast.success("Đã lưu");
    });

    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent("×3");
  });

  it("cùng khoá nhưng NGOÀI cửa sổ ⇒ thông báo mới đếm lại từ 1, không nhân bản", () => {
    render(<Toaster />);

    act(() => {
      toast.error("Mất kết nối", { key: "net", durationMs: TOAST_COALESCE_WINDOW_MS * 3 });
      vi.advanceTimersByTime(TOAST_COALESCE_WINDOW_MS + 1);
      toast.error("Mất kết nối", { key: "net" });
    });

    expect(cards()).toHaveLength(1);
    expect(cards()[0]).not.toHaveTextContent("×");
  });

  it("gộp làm mới đồng hồ tự đóng", () => {
    render(<Toaster />);
    const duration = TOAST_DEFAULT_DURATION_MS.success;

    // Mỗi bước một act: đồng hồ đặt trong effect, effect chỉ chạy khi act kết thúc.
    act(() => toast.success("Đã lưu"));
    act(() => vi.advanceTimersByTime(duration - 100));
    act(() => toast.success("Đã lưu"));
    act(() => vi.advanceTimersByTime(duration - 100));
    expect(cards()).toHaveLength(1);

    act(() => vi.advanceTimersByTime(200));
    expect(cards()).toHaveLength(0);
  });
});

describe("Toaster — giới hạn số lượng và tự đóng", () => {
  it(`hơn ${TOAST_LIMIT} thông báo ⇒ cái cũ nhất tự đóng`, () => {
    render(<Toaster />);

    act(() => {
      toast.success("Một");
      toast.success("Hai");
      toast.success("Ba");
      toast.success("Bốn");
    });

    expect(cards()).toHaveLength(TOAST_LIMIT);
    expect(screen.queryByText("Một")).not.toBeInTheDocument();
    expect(screen.getByText("Bốn")).toBeInTheDocument();
  });

  it("tự đóng sau thời lượng mặc định của loại", () => {
    render(<Toaster />);

    act(() => toast.error("Không lưu được"));
    act(() => vi.advanceTimersByTime(TOAST_DEFAULT_DURATION_MS.error - 1));
    expect(cards()).toHaveLength(1);

    act(() => vi.advanceTimersByTime(1));
    expect(cards()).toHaveLength(0);
  });

  it("đang có tiêu điểm bên trong thì KHÔNG tự đóng (người dùng bàn phím kịp bấm hành động)", () => {
    render(<Toaster />);

    act(() => toast.error("Không lưu được"));
    act(() => screen.getByRole("button", { name: "Đóng thông báo" }).focus());
    act(() => vi.advanceTimersByTime(TOAST_DEFAULT_DURATION_MS.error * 2));

    expect(cards()).toHaveLength(1);
  });
});

describe("Toaster — bàn phím", () => {
  it("Esc khi tiêu điểm trong thông báo ⇒ đóng thông báo đó", () => {
    render(<Toaster />);

    act(() => toast.warning("Sắp hết hạn"));
    const close = screen.getByRole("button", { name: "Đóng thông báo" });
    act(() => close.focus());
    fireEvent.keyDown(close, { key: "Escape" });

    expect(cards()).toHaveLength(0);
  });

  it("nút hành động là <button> thật, nằm trong thứ tự Tab; bấm ⇒ chạy hành động và đóng", () => {
    const onClick = vi.fn();
    render(<Toaster />);

    act(() => toast.error("Không gửi được", { action: { label: "Thử lại", onClick } }));
    const action = screen.getByRole("button", { name: "Thử lại" });

    expect(action.tagName).toBe("BUTTON");
    expect(action.tabIndex).toBe(0);
    expect(action).not.toBeDisabled();

    fireEvent.click(action);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(cards()).toHaveLength(0);
  });

  it("F8 đưa tiêu điểm tới thông báo mới nhất", () => {
    render(<Toaster />);

    act(() => {
      toast.success("Một");
      toast.error("Hai", { action: { label: "Mở", onClick: vi.fn() } });
    });
    fireEvent.keyDown(document, { key: "F8" });

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Mở" }));
  });
});

describe("Toaster — giảm chuyển động", () => {
  it("chuyển động chỉ chạy khi KHÔNG xin giảm chuyển động (motion-reduce tắt transition, không animate-*)", () => {
    render(<Toaster />);

    act(() => toast.success("Đã lưu"));
    const classes = cards()[0]!.className.split(/\s+/);

    expect(classes).toContain("motion-reduce:transition-none");
    expect(classes.filter((c) => c.startsWith("animate-"))).toEqual([]);
  });
});

describe("Toaster — nội dung mặc định an toàn", () => {
  it(`nội dung là văn bản thuần, cắt ở ${TOAST_MAX_MESSAGE_LENGTH} ký tự (không đổ nguyên thân tin/mô tả dài)`, () => {
    render(<Toaster />);
    const long = "<b>x</b>".padEnd(TOAST_MAX_MESSAGE_LENGTH + 50, "y");

    act(() => toast.success(long));
    const text = cards()[0]!.querySelector('[data-slot="toast-message"]')!.textContent ?? "";

    expect(text.length).toBe(TOAST_MAX_MESSAGE_LENGTH);
    expect(text.startsWith("<b>x</b>")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
    expect(cards()[0]!.querySelector("b")).toBeNull();
  });

  it("thông báo không ghi gì ra console", () => {
    const spies = (["log", "info", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    render(<Toaster />);

    act(() => {
      toast.success("Đã lưu");
      toast.error("Không lưu được");
    });

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
  });
});
