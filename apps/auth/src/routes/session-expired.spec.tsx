import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionExpiredPage } from "./session-expired";

const assign = vi.fn();

describe("apps/auth SessionExpiredPage", () => {
  beforeEach(() => {
    assign.mockClear();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "http://auth.localhost:5275/session-expired", assign },
    });
  });
  afterEach(cleanup);

  it("renders heading + CTA", () => {
    render(<SessionExpiredPage />);
    expect(screen.getByText("Phiên đăng nhập đã hết hạn")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /đăng nhập lại/i })).toBeInTheDocument();
  });

  it("CTA click → redirects to auth login URL", () => {
    render(<SessionExpiredPage />);
    fireEvent.click(screen.getByRole("button", { name: /đăng nhập lại/i }));

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls[0][0]).toContain("/login?redirect=");
  });
});
