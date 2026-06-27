import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./skeleton";

/**
 * Render-smoke (QA-02 matrix) — Skeleton: mount không throw + có class animate-pulse.
 */
describe("Skeleton", () => {
  it("render được (mount không throw)", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it("có class animate-pulse (loading animation)", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveClass("animate-pulse");
  });

  it("nhận className bổ sung", () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    expect(container.firstChild).toHaveClass("h-4", "w-32");
  });
});
