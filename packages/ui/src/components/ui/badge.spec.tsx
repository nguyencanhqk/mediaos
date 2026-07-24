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

  // ── S5-FND-UI-GEN-1: chốt chặn chống mất biến thể riêng khi port stock shadcn ──

  it.each([
    ["brand", "bg-brand-muted"],
    ["success", "bg-success-muted"],
    ["warning", "bg-warning-muted"],
    ["danger", "bg-danger-muted"],
    ["muted", "bg-muted"],
  ] as const)(
    "biến thể RIÊNG của MediaOS %s vẫn tồn tại và dùng token %s",
    (variant, expected) => {
      // 5 biến thể này KHÔNG có ở shadcn gốc. Port stock đè lên là mất sạch mà typecheck
      // vẫn xanh (cva chỉ hẹp kiểu union). Xem docs/plans/S5-FND-UI-GEN-1.md §5.
      const { container } = render(<Badge variant={variant}>Nhãn</Badge>);
      expect(container.firstChild).toHaveClass(expected);
    },
  );

  it("GIỮ dáng viên thuốc rounded-full của MediaOS (không phải rounded-md)", () => {
    const { container } = render(<Badge>Nhãn</Badge>);
    expect(container.firstChild).toHaveClass("rounded-full");
  });
});
