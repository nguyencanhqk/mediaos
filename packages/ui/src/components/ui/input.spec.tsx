import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./input";

/**
 * Render-smoke (QA-02 matrix) — Input: mount không throw + type/placeholder/disabled.
 */
describe("Input", () => {
  it("render được input (mount không throw)", () => {
    render(<Input aria-label="Tên" />);
    expect(screen.getByRole("textbox", { name: "Tên" })).toBeInTheDocument();
  });

  it("truyền type=password", () => {
    render(<Input type="password" aria-label="Mật khẩu" />);
    const el = screen.getByLabelText("Mật khẩu");
    expect(el).toHaveAttribute("type", "password");
  });

  it("placeholder hiển thị đúng", () => {
    render(<Input placeholder="Nhập email…" aria-label="Email" />);
    expect(screen.getByPlaceholderText("Nhập email…")).toBeInTheDocument();
  });

  it("disabled được truyền xuống", () => {
    render(<Input disabled aria-label="Khoá" />);
    expect(screen.getByRole("textbox", { name: "Khoá" })).toBeDisabled();
  });
});
