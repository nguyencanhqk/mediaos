// @vitest-environment jsdom
/**
 * NotificationTargetLink tests (S4-FE-NOTI-1) — deep link AN TOÀN, KHÔNG bỏ route guard.
 * Phủ: target_url nội bộ ("/...") → render button, click → onBeforeNavigate() + navigate({to}) ĐÚNG 1 lần.
 * target_url null/rỗng/tuyệt đối/protocol-relative → KHÔNG render button (render span trần, không click được).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

import { NotificationTargetLink, isSafeInternalTarget } from "./NotificationTargetLink";

beforeEach(() => {
  mockNavigate.mockReset();
});

describe("isSafeInternalTarget — whitelist đường dẫn nội bộ", () => {
  it.each([
    ["/leave/me/requests/req-1", true],
    ["/hr/employees/emp-1", true],
    ["/", true],
    [null, false],
    [undefined, false],
    ["", false],
    ["http://evil.example.com/phish", false],
    ["https://evil.example.com", false],
    ["//evil.example.com", false],
    ["javascript:alert(1)", false],
  ])("isSafeInternalTarget(%s) → %s", (input, expected) => {
    expect(isSafeInternalTarget(input as string | null | undefined)).toBe(expected);
  });
});

describe("NotificationTargetLink — render", () => {
  it("target_url nội bộ → render <button>, click → onBeforeNavigate() rồi navigate({to: target_url})", () => {
    const onBeforeNavigate = vi.fn();
    render(
      <NotificationTargetLink
        targetUrl="/leave/me/requests/req-1"
        onBeforeNavigate={onBeforeNavigate}
      >
        Xem đơn nghỉ
      </NotificationTargetLink>,
    );
    const button = screen.getByRole("button", { name: "Xem đơn nghỉ" });
    fireEvent.click(button);
    expect(onBeforeNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/leave/me/requests/req-1" }),
    );
  });

  it("target_url null → KHÔNG render button (render span, click không điều hướng)", () => {
    render(<NotificationTargetLink targetUrl={null}>Không có liên kết</NotificationTargetLink>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Không có liên kết")).toBeTruthy();
  });

  it("target_url tuyệt đối (http://) → KHÔNG render button (chặn open-redirect)", () => {
    render(
      <NotificationTargetLink targetUrl="http://evil.example.com/phish">
        Nội dung
      </NotificationTargetLink>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("target_url protocol-relative (//host) → KHÔNG render button", () => {
    render(
      <NotificationTargetLink targetUrl="//evil.example.com">Nội dung</NotificationTargetLink>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
