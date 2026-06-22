import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar, initialsFrom } from "./avatar";

/**
 * Render-smoke (QA-02 matrix) — Avatar: mount không throw + initials logic + img fallback.
 */
describe("initialsFrom", () => {
  it("tên rỗng/null → '?'", () => {
    expect(initialsFrom(null)).toBe("?");
    expect(initialsFrom("")).toBe("?");
  });

  it("tên đơn → 2 ký tự đầu viết hoa", () => {
    expect(initialsFrom("Bình")).toBe("BÌ");
  });

  it("họ tên đầy đủ → ký tự đầu-cuối viết hoa", () => {
    expect(initialsFrom("Nguyễn Văn Cảnh")).toBe("NC");
  });
});

describe("Avatar", () => {
  it("render initials khi không có src (mount không throw)", () => {
    render(<Avatar name="An Bình" />);
    // Initials "AB"
    expect(screen.getByText("AB")).toBeInTheDocument();
  });

  it("render img khi có src", () => {
    render(<Avatar name="An" src="https://example.com/avatar.png" />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://example.com/avatar.png");
  });

  it("name=undefined → '?' hiển thị", () => {
    render(<Avatar />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });
});
