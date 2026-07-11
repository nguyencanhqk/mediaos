import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

// ---------------------------------------------------------------------------
// HR-PROFILE-UI-2 — GOM NHÓM (getGroupedRowModel + getExpandedRowModel)
// ---------------------------------------------------------------------------
interface GroupedRow {
  id: string;
  name: string;
  dept: string;
}

const groupedColumns: ColumnDef<GroupedRow>[] = [
  { accessorKey: "id", header: "Mã", enableSorting: false },
  { accessorKey: "name", header: "Tên", enableSorting: true },
  { accessorKey: "dept", header: "Phòng ban" },
];

const groupedData: GroupedRow[] = [
  { id: "E1", name: "An", dept: "Kỹ thuật" },
  { id: "E2", name: "Bình", dept: "Kỹ thuật" },
  { id: "E3", name: "Cường", dept: "Nhân sự" },
];

describe("DataTable — gom nhóm 1 cấp", () => {
  it("render group-header cho mỗi nhóm kèm số hàng con (aggregation count)", () => {
    render(<DataTable columns={groupedColumns} data={groupedData} grouping={["dept"]} />);
    const toggles = screen.getAllByTestId("group-header-toggle");
    // 2 nhóm: Kỹ thuật (2) + Nhân sự (1)
    expect(toggles).toHaveLength(2);
    const kyThuat = toggles.find((el) => el.textContent?.includes("Kỹ thuật"));
    expect(kyThuat).toBeDefined();
    expect(within(kyThuat as HTMLElement).getByText("(2)")).toBeInTheDocument();
    const nhanSu = toggles.find((el) => el.textContent?.includes("Nhân sự"));
    expect(within(nhanSu as HTMLElement).getByText("(1)")).toBeInTheDocument();
  });

  it("nhóm mở mặc định → hàng con hiển thị; collapse ẩn hàng con, expand hiện lại", () => {
    render(<DataTable columns={groupedColumns} data={groupedData} grouping={["dept"]} />);
    // mở mặc định → leaf An/Bình/Cường hiển thị
    expect(screen.getByText("An")).toBeInTheDocument();
    expect(screen.getByText("Cường")).toBeInTheDocument();

    const kyThuatToggle = screen
      .getAllByTestId("group-header-toggle")
      .find((el) => el.textContent?.includes("Kỹ thuật")) as HTMLElement;
    fireEvent.click(kyThuatToggle);
    // collapse nhóm Kỹ thuật → An/Bình ẩn, Cường (Nhân sự) vẫn hiển thị
    expect(screen.queryByText("An")).not.toBeInTheDocument();
    expect(screen.queryByText("Bình")).not.toBeInTheDocument();
    expect(screen.getByText("Cường")).toBeInTheDocument();

    fireEvent.click(kyThuatToggle);
    expect(screen.getByText("An")).toBeInTheDocument();
  });

  it("gom nhóm 2 cấp → nhóm lồng (đơn vị → trạng thái) render group-header nhiều cấp", () => {
    const twoLevel: Array<GroupedRow & { status: string }> = [
      { id: "E1", name: "An", dept: "Kỹ thuật", status: "active" },
      { id: "E2", name: "Bình", dept: "Kỹ thuật", status: "inactive" },
    ];
    const cols: ColumnDef<GroupedRow & { status: string }>[] = [
      { accessorKey: "name", header: "Tên" },
      { accessorKey: "dept", header: "Phòng ban" },
      { accessorKey: "status", header: "Trạng thái" },
    ];
    render(<DataTable columns={cols} data={twoLevel} grouping={["dept", "status"]} />);
    // 1 nhóm cấp 1 (Kỹ thuật) + 2 nhóm cấp 2 (active/inactive) = 3 group-header
    expect(screen.getAllByTestId("group-header-toggle")).toHaveLength(3);
  });

  it("KHÔNG truyền grouping → không có group-header (hành vi cũ nguyên vẹn)", () => {
    render(<DataTable columns={groupedColumns} data={groupedData} />);
    expect(screen.queryByTestId("group-header-toggle")).not.toBeInTheDocument();
    expect(screen.getByText("An")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// HR-PROFILE-UI-2 — SẮP XẾP SERVER (manual-mode header click)
// ---------------------------------------------------------------------------
describe("DataTable — sắp xếp server (manual-mode)", () => {
  it("cột sortable hiện affordance click → phát onSortingChange khi bấm header", () => {
    const onSortingChange = vi.fn();
    render(
      <DataTable
        columns={groupedColumns}
        data={groupedData}
        sorting={[]}
        onSortingChange={onSortingChange}
      />,
    );
    // 'name' sortable → có nút; 'id' enableSorting:false → KHÔNG có nút
    expect(screen.getByTestId("sort-name")).toBeInTheDocument();
    expect(screen.queryByTestId("sort-id")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("sort-name"));
    expect(onSortingChange).toHaveBeenCalledTimes(1);
  });

  it("KHÔNG truyền onSortingChange → không có affordance sắp xếp (không manual-sort)", () => {
    render(<DataTable columns={groupedColumns} data={groupedData} />);
    expect(screen.queryByTestId("sort-name")).not.toBeInTheDocument();
  });
});
