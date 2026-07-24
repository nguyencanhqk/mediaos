import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders its children", () => {
    render(<Button>Đăng nhập</Button>);
    expect(screen.getByRole("button", { name: "Đăng nhập" })).toBeInTheDocument();
  });

  it("applies the destructive variant classes", () => {
    render(<Button variant="destructive">Xoá</Button>);
    expect(screen.getByRole("button", { name: "Xoá" })).toHaveClass("bg-destructive");
  });

  it("forwards the disabled attribute", () => {
    render(<Button disabled>Off</Button>);
    expect(screen.getByRole("button", { name: "Off" })).toBeDisabled();
  });

  // ── S5-FND-UI-GEN-1: biến thể/cỡ thêm ở thế hệ mới ──────────────────────────

  it("biến thể destructive dùng token destructive-foreground, KHÔNG phải primary-foreground", () => {
    // Ở dark, --destructive là đỏ NHẠT nên chữ trắng chỉ ~2.2:1; token cho chữ gần-đen mới đọc được.
    render(<Button variant="destructive">Xoá</Button>);
    const el = screen.getByRole("button", { name: "Xoá" });
    expect(el).toHaveClass("text-destructive-foreground");
    expect(el).not.toHaveClass("text-primary-foreground");
  });

  it.each([
    ["secondary", "bg-secondary"],
    ["outline", "border-input"],
    ["ghost", "hover:bg-accent"],
    ["link", "text-brand"],
  ] as const)("biến thể %s có class đặc trưng %s", (variant, expected) => {
    render(<Button variant={variant}>Nút</Button>);
    expect(screen.getByRole("button", { name: "Nút" })).toHaveClass(expected);
  });

  it.each([
    ["icon", "size-10"],
    ["icon-sm", "size-9"],
    ["icon-lg", "size-11"],
  ] as const)("cỡ %s là ô vuông %s", (size, expected) => {
    render(<Button size={size}>+</Button>);
    expect(screen.getByRole("button", { name: "+" })).toHaveClass(expected);
  });

  it("GIỮ chiều cao h-10 của MediaOS (không hạ xuống h-9 của thế hệ mới)", () => {
    // Quyết định chốt ở docs/plans/S5-FND-UI-GEN-1.md §2 — đổi mật độ control là thay đổi
    // thấy được trên 3 app production. Test này là chốt chặn cho quyết định đó.
    render(<Button>Lưu</Button>);
    expect(screen.getByRole("button", { name: "Lưu" })).toHaveClass("h-10");
  });

  it("dùng ngôn ngữ focus-ring thế hệ mới (border-ring + ring 3px)", () => {
    render(<Button>Lưu</Button>);
    const el = screen.getByRole("button", { name: "Lưu" });
    expect(el).toHaveClass("focus-visible:border-ring");
    expect(el).toHaveClass("focus-visible:ring-[3px]");
  });
});
