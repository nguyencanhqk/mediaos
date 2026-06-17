import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@mediaos/ui";

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
});
