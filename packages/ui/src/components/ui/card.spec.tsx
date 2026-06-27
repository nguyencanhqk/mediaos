import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./card";

/**
 * Render-smoke (QA-02 matrix) — Card + sub-components: mount không throw.
 */
describe("Card", () => {
  it("render Card đơn (mount không throw)", () => {
    const { container } = render(<Card>Nội dung</Card>);
    expect(container.firstChild).toBeInTheDocument();
    expect(screen.getByText("Nội dung")).toBeInTheDocument();
  });

  it("render đầy đủ sub-components", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Tiêu đề card</CardTitle>
          <CardDescription>Mô tả card</CardDescription>
        </CardHeader>
        <CardContent>Nội dung chính</CardContent>
        <CardFooter>Chân</CardFooter>
      </Card>,
    );
    expect(screen.getByText("Tiêu đề card")).toBeInTheDocument();
    expect(screen.getByText("Mô tả card")).toBeInTheDocument();
    expect(screen.getByText("Nội dung chính")).toBeInTheDocument();
    expect(screen.getByText("Chân")).toBeInTheDocument();
  });
});
