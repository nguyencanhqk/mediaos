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

  it("variant=success dùng token trạng thái bg-success-muted", () => {
    const { container } = render(<Badge variant="success">Đã duyệt</Badge>);
    expect(container.firstChild).toHaveClass("bg-success-muted");
  });

  it("variant=danger dùng token trạng thái bg-danger-muted", () => {
    const { container } = render(<Badge variant="danger">Từ chối</Badge>);
    expect(container.firstChild).toHaveClass("bg-danger-muted");
  });

  it("variant=warning dùng token trạng thái bg-warning-muted", () => {
    const { container } = render(<Badge variant="warning">Chờ duyệt</Badge>);
    expect(container.firstChild).toHaveClass("bg-warning-muted");
  });
});
