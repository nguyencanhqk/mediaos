import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Inbox } from "lucide-react";
import { EmptyState } from "./empty-state";

/**
 * Render-smoke (QA-02 matrix) — EmptyState là trạng thái "empty" dùng chung của mọi màn.
 * Mount không throw + hiển thị tiêu đề/mô tả/hành động.
 */
describe("EmptyState", () => {
  it("hiển thị tiêu đề và mô tả", () => {
    render(<EmptyState title="Không có nhân viên" description="Hãy thêm nhân viên đầu tiên" />);
    expect(screen.getByText("Không có nhân viên")).toBeInTheDocument();
    expect(screen.getByText("Hãy thêm nhân viên đầu tiên")).toBeInTheDocument();
  });

  it("render được icon + hành động (action) khi truyền vào", () => {
    render(
      <EmptyState icon={Inbox} title="Trống" action={<button type="button">Thêm mới</button>} />,
    );
    expect(screen.getByRole("button", { name: "Thêm mới" })).toBeInTheDocument();
  });
});
