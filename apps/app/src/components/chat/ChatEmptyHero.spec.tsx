/**
 * S17-CHAT-UX2-FE-2 — `done_when #5`, vế "hero khung trống với 2 hành động".
 *
 * Ca quan trọng nhất là **cổng `create:chat-room`**: nút "Tin nhắn mới" chỉ tồn tại khi caller truyền
 * `onCreateRoom`. Hiện nút rồi để server trả 403 là dạy người dùng một lối đi không có thật (SPEC-15
 * §14) — và ca DENY chỉ có nghĩa khi đi kèm ca ALLOW đối chứng, nếu không thì một component render
 * rỗng cũng làm nó xanh (memory `deny-cases-vacuous-without-allow-case`).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { ChatEmptyHero } from "./ChatEmptyHero";

function renderHero(props: Partial<Parameters<typeof ChatEmptyHero>[0]> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ChatEmptyHero title="Bắt đầu" description="Chọn một cuộc trò chuyện" {...props} />
    </I18nextProvider>,
  );
}

describe("ChatEmptyHero · nội dung", () => {
  it("hiện tiêu đề + mô tả (khung trống phải NÓI, không chỉ là icon xám)", () => {
    renderHero();
    expect(screen.getByTestId("chat-empty-hero")).toBeTruthy();
    expect(screen.getByText("Bắt đầu")).toBeTruthy();
    expect(screen.getByText("Chọn một cuộc trò chuyện")).toBeTruthy();
  });
});

describe("ChatEmptyHero · cổng create:chat-room", () => {
  it("ALLOW: có `onCreateRoom` ⇒ nút 'Tin nhắn mới' hiện và bấm được", () => {
    const onCreateRoom = vi.fn();
    renderHero({ onCreateRoom });
    const btn = screen.getByTestId("chat-hero-create");
    btn.click();
    expect(onCreateRoom).toHaveBeenCalledTimes(1);
  });

  it("DENY: thiếu cặp ⇒ caller không truyền handler ⇒ nút KHÔNG render", () => {
    renderHero({ onOpenSearch: vi.fn() });
    expect(screen.queryByTestId("chat-hero-create")).toBeNull();
    // Đối chứng trong CÙNG ca: nút kia vẫn còn ⇒ hero không phải đang render rỗng.
    expect(screen.getByTestId("chat-hero-search")).toBeTruthy();
  });
});

describe("ChatEmptyHero · hành động tìm kiếm", () => {
  it("có `onOpenSearch` ⇒ nút hiện và bấm được", () => {
    const onOpenSearch = vi.fn();
    renderHero({ onOpenSearch });
    screen.getByTestId("chat-hero-search").click();
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it("không có hành động nào (khung trống TRONG phòng — ô soạn ngay dưới) ⇒ 0 nút", () => {
    renderHero();
    expect(screen.queryByTestId("chat-hero-create")).toBeNull();
    expect(screen.queryByTestId("chat-hero-search")).toBeNull();
    // Vẫn phải còn phần chữ — "không nút" khác "không nội dung".
    expect(screen.getByText("Bắt đầu")).toBeTruthy();
  });
});
