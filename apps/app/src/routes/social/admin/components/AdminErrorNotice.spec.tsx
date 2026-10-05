/**
 * S16-SOCIAL-FE-3 (L1, ca A4) — `AdminErrorNotice` với i18n THẬT: MỌI reason của tập đóng ra một câu
 * tiếng Việt thật. i18next trả lại chính khoá khi thiếu bản dịch ⇒ ca chỉ nhìn «có chữ» sẽ xanh giả
 * (plan B18) — nên ở đây so chữ render với CHÍNH khoá thô.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../feed/social-test-doubles";
import { ADMIN_ERROR_REASONS } from "../lib/admin-errors";
import { AdminErrorNotice } from "./AdminErrorNotice";

function messageOf(reason: (typeof ADMIN_ERROR_REASONS)[number]): string {
  const { unmount } = renderWithProviders(<AdminErrorNotice reason={reason} />);
  const text = screen.getByRole("alert").textContent ?? "";
  unmount();
  return text;
}

describe("AdminErrorNotice — mọi reason ra câu tiếng Việt thật", () => {
  it.each(ADMIN_ERROR_REASONS)("reason=%s: role=alert + data-reason + chữ ≠ khoá thô", (reason) => {
    renderWithProviders(<AdminErrorNotice reason={reason} />);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-reason")).toBe(reason);
    const text = alert.textContent ?? "";
    expect(text).not.toBe(`admin.error.${reason}`);
    expect(text).not.toContain("admin.error");
    expect(text.trim().length).toBeGreaterThan(15);
  });

  it("mỗi reason một câu KHÁC nhau — không dùng chung một câu «có lỗi xảy ra»", () => {
    const texts = ADMIN_ERROR_REASONS.map(messageOf);
    expect(new Set(texts).size).toBe(ADMIN_ERROR_REASONS.length);
    expect(texts.length).toBeGreaterThanOrEqual(13);
  });

  it("câu nói LÝ DO: `reportBusy` bảo thử lại, `reportAlreadyDecided` nói đã có người xử lý, `forbidden` nói về quyền", () => {
    expect(messageOf("reportBusy")).toMatch(/thử lại/i);
    expect(messageOf("reportAlreadyDecided")).toMatch(/đã được xử lý/i);
    expect(messageOf("forbidden")).toMatch(/quyền/i);
    expect(messageOf("reportDuplicate")).toMatch(/đã báo cáo/i);
  });
});

describe("AdminErrorNotice — nút hành động", () => {
  it("có `onRetry` ⇒ nút «Thử lại» gọi đúng 1 lần; không truyền ⇒ KHÔNG có nút (403 thử lại là vô ích)", () => {
    const onRetry = vi.fn();
    const { unmount } = renderWithProviders(
      <AdminErrorNotice reason="generic" onRetry={onRetry} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    unmount();

    renderWithProviders(<AdminErrorNotice reason="generic" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thử lại" })).toBeNull();
  });

  it("có `onDismiss` ⇒ nút đóng có tên trợ năng, gọi đúng 1 lần; không truyền ⇒ không có nút đóng", () => {
    const onDismiss = vi.fn();
    const { unmount } = renderWithProviders(
      <AdminErrorNotice reason="generic" onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Đóng thông báo" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    unmount();

    renderWithProviders(<AdminErrorNotice reason="generic" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
