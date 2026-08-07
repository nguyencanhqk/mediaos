/**
 * S8-CHAT-UX-FE-3 — thanh cảm xúc (`done_when #3`).
 *
 * Bài quan trọng nhất: **bộ emoji đến TỪ CONTRACTS**, không phải một mảng chép tay. Bộ này đã sống ở ba
 * chỗ phải khớp nhau (CHECK ở DB mig `0543` · hằng drizzle · enum Zod); nếu FE tự khai bản thứ tư thì
 * ngày nào đó người dùng bấm một emoji hợp lệ về mặt UI và ăn 400. Bài test dưới so trực tiếp với
 * `chatReactionEmojiSchema.options` nên nó không thể trôi.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { chatReactionEmojiSchema, type ChatMessageReactionDto } from "@mediaos/contracts";
import { ReactionBar } from "./ReactionBar";

function renderBar(
  reactions: readonly ChatMessageReactionDto[],
  opts: { readOnly?: boolean; onToggle?: ReturnType<typeof vi.fn> } = {},
) {
  const onToggle = opts.onToggle ?? vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <ReactionBar reactions={reactions} readOnly={opts.readOnly ?? false} onToggle={onToggle} />
    </I18nextProvider>,
  );
  return { onToggle };
}

describe("bộ emoji ĐÓNG, lấy từ contracts (CHAT-DEC-018)", () => {
  it("bộ chọn có ĐÚNG 6 emoji và ĐÚNG bộ mã của contracts", () => {
    renderBar([]);
    fireEvent.click(screen.getByTestId("chat-reaction-open"));

    const picker = screen.getByTestId("chat-reaction-picker");
    const rendered = Array.from(picker.querySelectorAll("button")).map((b) =>
      b.getAttribute("data-testid")?.replace("chat-reaction-pick-", ""),
    );
    expect(rendered).toEqual([...chatReactionEmojiSchema.options]);
    expect(rendered).toHaveLength(6);
  });
});

describe("hiển thị tổng hợp", () => {
  it("chỉ hiện emoji CÓ lượt thả, kèm số đếm", () => {
    renderBar([
      { emoji: "like", count: 3, mine: false },
      { emoji: "love", count: 1, mine: true },
    ]);
    expect(screen.getByTestId("chat-reaction-like").textContent).toContain("3");
    expect(screen.getByTestId("chat-reaction-love").textContent).toContain("1");
    // Emoji chưa ai thả KHÔNG được hiện `count: 0` — server cũng không trả chúng.
    expect(screen.queryByTestId("chat-reaction-haha")).toBeNull();
  });

  it("emoji MÌNH đã thả được đánh dấu `aria-pressed` (không chỉ đổi màu)", () => {
    renderBar([
      { emoji: "like", count: 3, mine: false },
      { emoji: "love", count: 1, mine: true },
    ]);
    expect(screen.getByTestId("chat-reaction-love").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("chat-reaction-like").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("bật/tắt", () => {
  it("bấm emoji CHƯA thả ⇒ báo `currentlyMine=false` (caller sẽ gọi PUT)", () => {
    const { onToggle } = renderBar([{ emoji: "like", count: 3, mine: false }]);
    fireEvent.click(screen.getByTestId("chat-reaction-like"));
    expect(onToggle).toHaveBeenCalledWith("like", false);
  });

  it("bấm LẠI emoji mình đã thả ⇒ báo `currentlyMine=true` (caller sẽ gọi DELETE)", () => {
    const { onToggle } = renderBar([{ emoji: "love", count: 1, mine: true }]);
    fireEvent.click(screen.getByTestId("chat-reaction-love"));
    expect(onToggle).toHaveBeenCalledWith("love", true);
  });

  it("chọn từ bộ chọn ⇒ đóng bộ chọn NGAY (không chờ API)", () => {
    const { onToggle } = renderBar([]);
    fireEvent.click(screen.getByTestId("chat-reaction-open"));
    fireEvent.click(screen.getByTestId("chat-reaction-pick-wow"));
    expect(onToggle).toHaveBeenCalledWith("wow", false);
    expect(screen.queryByTestId("chat-reaction-picker")).toBeNull();
  });
});

describe("chỉ đọc (phòng đã lưu trữ)", () => {
  it("KHÔNG có nút mở bộ chọn, và các nút tổng hợp bị vô hiệu", () => {
    renderBar([{ emoji: "like", count: 2, mine: false }], { readOnly: true });
    expect(screen.queryByTestId("chat-reaction-open")).toBeNull();
    expect(screen.getByTestId<HTMLButtonElement>("chat-reaction-like").disabled).toBe(true);
  });

  it("không có cảm xúc nào VÀ chỉ đọc ⇒ không vẽ gì (không chiếm chỗ)", () => {
    renderBar([], { readOnly: true });
    expect(screen.queryByTestId("chat-reaction-bar")).toBeNull();
  });
});
