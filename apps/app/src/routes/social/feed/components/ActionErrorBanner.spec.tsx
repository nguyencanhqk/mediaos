/**
 * Ca L (plan FE-2B §8): MỌI `kind` × {forbidden, generic} và MỌI `reason` ra câu tiếng Việt thật —
 * không bao giờ in nguyên khoá i18n (i18next trả lại chính khoá khi thiếu bản dịch, test chỉ nhìn
 * «có chữ» sẽ xanh giả).
 */
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../social-test-doubles";
import {
  ACTION_ERROR_KINDS,
  ACTION_ERROR_REASONS,
  ActionErrorBanner,
} from "./ActionErrorBanner";

function textOf(): string {
  return screen.getByTestId("feed-action-error").textContent ?? "";
}

describe("ActionErrorBanner — không kind/reason nào ra khoá thô", () => {
  it.each(ACTION_ERROR_KINDS.flatMap((k) => [true, false].map((f) => [k, f] as const)))(
    "kind=%s forbidden=%s",
    (kind, forbidden) => {
      const { unmount } = renderWithProviders(<ActionErrorBanner kind={kind} forbidden={forbidden} />);
      expect(textOf()).not.toContain("actionError.");
      expect(textOf().length).toBeGreaterThan(10);
      unmount();
    },
  );

  it.each(ACTION_ERROR_REASONS)("reason=%s thắng forbidden/generic", (reason) => {
    const { unmount } = renderWithProviders(
      <ActionErrorBanner kind="groupLeave" forbidden reason={reason} />,
    );
    const el = screen.getByTestId("feed-action-error");
    expect(el.getAttribute("data-reason")).toBe(reason);
    expect(textOf()).not.toContain("actionError.");
    // S16-SOCIAL-FE-2D (FULL gate lượt 1, G6): câu có `{{biến}}` mà dải quên truyền tham số ⇒ i18next để
    // NGUYÊN `{{biến}}` (skipOnVariables) — người dùng đọc thấy dấu ngoặc nhọn.
    expect(textOf()).not.toContain("{{");
    unmount();
    // Cùng kind KHÔNG reason ⇒ câu khác (reason thật sự thay câu, không nối thêm).
    renderWithProviders(<ActionErrorBanner kind="groupLeave" forbidden />);
    expect(screen.getByTestId("feed-action-error").getAttribute("data-reason")).toBeNull();
  });

  it("lastOwner nói RÕ cách gỡ (phong chủ nhóm khác hoặc xoá nhóm) — done_when #1", () => {
    renderWithProviders(<ActionErrorBanner kind="groupLeave" forbidden={false} reason="lastOwner" />);
    expect(textOf()).toContain("chủ nhóm");
    expect(textOf()).toContain("xoá nhóm");
  });
});
