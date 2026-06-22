import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";

/**
 * Render-smoke (QA-02 matrix) — Badge: mount không throw + variant class + children.
 */
describe("Badge", () => {
  it("render được (mount không throw)", () => {
    render(<Badge>Đang làm việc</Badge>);
    expect(screen.getByText("Đang làm việc")).toBeInTheDocument();
  });

  it("variant=success có class bg-emerald-50", () => {
    const { container } = render(<Badge variant="success">Đã duyệt</Badge>);
    expect(container.firstChild).toHaveClass("bg-emerald-50");
  });

  it("variant=danger có class bg-red-50", () => {
    const { container } = render(<Badge variant="danger">Từ chối</Badge>);
    expect(container.firstChild).toHaveClass("bg-red-50");
  });

  it("variant=warning có class bg-amber-50", () => {
    const { container } = render(<Badge variant="warning">Chờ duyệt</Badge>);
    expect(container.firstChild).toHaveClass("bg-amber-50");
  });
});
