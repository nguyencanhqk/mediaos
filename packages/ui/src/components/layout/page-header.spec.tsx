import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Users } from "lucide-react";
import { PageHeader } from "./page-header";

/**
 * Render-smoke (QA-02 matrix) — PageHeader: mount không throw + title/description/icon/actions.
 */
describe("PageHeader", () => {
  it("render tiêu đề (mount không throw)", () => {
    render(<PageHeader title="Quản lý nhân sự" />);
    expect(screen.getByRole("heading", { name: "Quản lý nhân sự" })).toBeInTheDocument();
  });

  it("render description khi truyền vào", () => {
    render(<PageHeader title="Nhân sự" description="Danh sách nhân viên toàn công ty" />);
    expect(screen.getByText("Danh sách nhân viên toàn công ty")).toBeInTheDocument();
  });

  it("render icon khi truyền vào", () => {
    const { container } = render(<PageHeader title="HR" icon={Users} />);
    // Icon renders as SVG inside the header
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("render slot actions khi truyền vào", () => {
    render(<PageHeader title="HR" actions={<button type="button">Thêm nhân viên</button>} />);
    expect(screen.getByRole("button", { name: "Thêm nhân viên" })).toBeInTheDocument();
  });

  it("render slot children (toolbar) khi truyền vào", () => {
    render(
      <PageHeader title="HR">
        <div>Thanh lọc</div>
      </PageHeader>,
    );
    expect(screen.getByText("Thanh lọc")).toBeInTheDocument();
  });
});
