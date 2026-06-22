import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Select } from "./select";

/**
 * Render-smoke (QA-02 matrix) — Select: mount không throw + options + disabled.
 */
describe("Select", () => {
  it("render được combobox (mount không throw)", () => {
    render(
      <Select aria-label="Trạng thái">
        <option value="active">Đang làm việc</option>
        <option value="inactive">Đã nghỉ</option>
      </Select>,
    );
    expect(screen.getByRole("combobox", { name: "Trạng thái" })).toBeInTheDocument();
  });

  it("render các option con", () => {
    render(
      <Select aria-label="Phòng ban">
        <option value="tech">Kỹ thuật</option>
        <option value="hr">Nhân sự</option>
      </Select>,
    );
    expect(screen.getByRole("option", { name: "Kỹ thuật" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Nhân sự" })).toBeInTheDocument();
  });

  it("disabled được truyền xuống", () => {
    render(
      <Select disabled aria-label="Khoá">
        <option value="">--</option>
      </Select>,
    );
    expect(screen.getByRole("combobox", { name: "Khoá" })).toBeDisabled();
  });
});
