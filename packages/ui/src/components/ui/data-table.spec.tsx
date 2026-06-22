import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "./data-table";

/**
 * Render-smoke (QA-02 matrix) — DataTable (TanStack Table v8 headless) là "table" dùng chung
 * (filter/pagination/skeleton/empty). Mount không throw + render header + dữ liệu hàng.
 * Nhánh empty/loading phụ thuộc i18n (useTranslation) — để feature spec (có i18n) phủ; ở đây
 * dùng đường có dữ liệu để smoke độc lập i18n.
 */
interface Row {
  id: string;
  name: string;
}

const columns: ColumnDef<Row>[] = [
  { accessorKey: "id", header: "Mã" },
  { accessorKey: "name", header: "Tên" },
];

const data: Row[] = [
  { id: "E1", name: "An" },
  { id: "E2", name: "Bình" },
];

describe("DataTable", () => {
  it("render header và dữ liệu hàng (mount không throw)", () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText("Mã")).toBeInTheDocument();
    expect(screen.getByText("Tên")).toBeInTheDocument();
    expect(screen.getByText("An")).toBeInTheDocument();
    expect(screen.getByText("Bình")).toBeInTheDocument();
  });

  it("hiển thị skeleton (5 hàng) khi isLoading", () => {
    const { container } = render(<DataTable columns={columns} data={[]} isLoading />);
    // 5 hàng skeleton × 2 cột = 10 ô skeleton
    expect(container.querySelectorAll("tbody tr").length).toBe(5);
  });
});
