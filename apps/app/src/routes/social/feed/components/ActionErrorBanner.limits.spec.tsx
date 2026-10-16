/**
 * S16-SOCIAL-FE-2D — FULL gate lượt 1 (G6): câu `actionError.reason.attachmentRejected` đọc TRẦN từ hằng
 * contracts, không chép cứng vào bản dịch.
 *
 * Bản đầu viết «10 ảnh · 1 video · 20 MB» thẳng vào `social.ts` trong khi khay đính kèm nội suy từ contracts
 * (`REJECT_MAX`) — một WO đổi trần (VIDEOMIME · ATTERRSPLIT) sẽ làm khay nói số MỚI còn dải lỗi 422 nói số
 * CŨ, không cổng nào bắt (`ActionErrorBanner.spec` chỉ kiểm khoá có bản dịch). Ca này ĐỔI hằng contracts
 * (mock, file riêng vì `vi.mock` phủ cả file) rồi đọc câu: chỉ khi nối thật mới ra số mới.
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../social-test-doubles";
import { ActionErrorBanner } from "./ActionErrorBanner";

vi.mock("@mediaos/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/contracts")>();
  return {
    ...actual,
    FEED_MAX_IMAGES_PER_POST: 7,
    FEED_MAX_VIDEOS_PER_POST: 2,
    FEED_MAX_ATTACHMENT_BYTES: 5 * 1024 * 1024,
  };
});

describe("G6 — câu `attachmentRejected` nói ĐÚNG trần của contracts", () => {
  it("đổi hằng contracts ⇒ câu đổi theo (7 ảnh · 2 video · 5 MB), không còn `{{biến}}` thô", () => {
    renderWithProviders(
      <ActionErrorBanner kind="post" forbidden={false} reason="attachmentRejected" />,
    );
    const text = screen.getByTestId("feed-action-error").textContent ?? "";

    expect(text).toContain("7 ảnh");
    expect(text).toContain("2 video");
    expect(text).toContain("5 MB");
    expect(text).not.toContain("{{");
  });
});
