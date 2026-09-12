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

  // S5-QA-REG-1 §15.4 (responsive/a11y smoke) — "Tablet: filter wrap, horizontal table scroll".
  // DataTable là bảng DÙNG CHUNG cho mọi list P0 (HR/TASK/ATT/…) — proxy TĨNH (class Tailwind) vì
  // jsdom không đánh giá được layout/viewport thật; xác minh cuộn ngang thật trên tablet/mobile là
  // thủ công (ghi ở QA sign-off), KHÔNG tự động hoá được ở đây.
  it("bọc <table> trong container overflow-x-auto (responsive proxy — cuộn ngang khi bảng rộng hơn viewport)", () => {
    const { container } = render(<DataTable columns={columns} data={data} />);
    const scrollWrapper = container.querySelector(".overflow-x-auto");
    expect(scrollWrapper).toBeInTheDocument();
    expect(scrollWrapper?.querySelector("table")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// S15-UI-SHELL-1 (DEC-020) — GHIM CỘT + slot footer (UI-07 §12.3/§12.4 v1.1)
// ---------------------------------------------------------------------------

/**
 * Ca đắt nhất ở đây là **tương thích ngược**: `DataTable` là bảng dùng chung của HR/ATT/LEAVE/TASK.
 * Không bật ghim thì class của hàng/ô phải GIỮ NGUYÊN bản cũ (`bg-muted/50` · `hover:bg-muted/40`,
 * không `sticky`) — vì ô ghim cần nền ĐỤC nên bật ghim có đổi nền hàng, và đổi nhầm cho mọi bảng là
 * một hồi quy nhìn thấy được ở 20+ màn.
 */
describe("DataTable — ghim cột + footer (v1.1)", () => {
  const pinCols: ColumnDef<Row>[] = [
    { accessorKey: "id", header: "Mã" },
    { accessorKey: "name", header: "Tên" },
    { id: "actions", header: "Thao tác", cell: () => <button type="button">Sửa</button> },
  ];

  it("KHÔNG bật ghim ⇒ không có ô sticky nào, nền hàng giữ nguyên bản cũ", () => {
    const { container } = render(<DataTable columns={pinCols} data={data} />);
    expect(container.querySelectorAll(".sticky").length).toBe(0);
    expect(container.querySelector("thead tr")!.className).toContain("bg-muted/50");
    expect(container.querySelector("tbody tr")!.className).toContain("hover:bg-muted/40");
  });

  it("pinFirstColumn: ô ĐẦU của header và của mọi hàng dính trái, nền đục ăn theo hàng", () => {
    const { container } = render(<DataTable columns={pinCols} data={data} pinFirstColumn />);

    const th = container.querySelectorAll("thead th");
    expect(th[0].className).toContain("sticky");
    expect(th[0].className).toContain("left-0");
    expect(th[0].className).toContain("bg-inherit");
    expect(th[1].className).not.toContain("sticky");

    for (const row of container.querySelectorAll("tbody tr")) {
      expect(row.querySelectorAll("td")[0].className).toContain("sticky");
    }
    // Nền hàng phải ĐỤC, nếu không nội dung cuộn qua hiện xuyên dưới ô ghim.
    expect(container.querySelector("thead tr")!.className).toContain("bg-muted");
    expect(container.querySelector("thead tr")!.className).not.toContain("bg-muted/50");
    expect(container.querySelector("tbody tr")!.className).toContain("bg-card");
    expect(container.querySelector("tbody tr")!.className).toContain("hover:bg-accent");
  });

  it("pinLastColumn: ô CUỐI dính phải; ô giữa không dính", () => {
    const { container } = render(<DataTable columns={pinCols} data={data} pinLastColumn />);
    const th = container.querySelectorAll("thead th");
    expect(th[2].className).toContain("right-0");
    expect(th[0].className).not.toContain("sticky");
    expect(th[1].className).not.toContain("sticky");
  });

  it("ghim theo cột ĐANG HIỂN THỊ: ẩn cột cuối thì cột kế mới là cột ghim phải", () => {
    const { container } = render(
      <DataTable columns={pinCols} data={data} pinLastColumn columnVisibility={{ actions: false }} />,
    );
    const th = container.querySelectorAll("thead th");
    expect(th.length).toBe(2);
    expect(th[1].className).toContain("right-0");
  });

  it("GOM NHÓM tắt ghim (hàng group-header trải hết cột — không còn cột đầu/cuối để dính)", () => {
    const { container } = render(
      <DataTable columns={pinCols} data={data} pinFirstColumn grouping={["name"]} />,
    );
    expect(container.querySelectorAll(".sticky").length).toBe(0);
  });

  it("slot footer render dưới bảng", () => {
    render(<DataTable columns={pinCols} data={data} footer={<span>Tổng số 128</span>} />);
    expect(screen.getByText("Tổng số 128")).toBeInTheDocument();
  });

  it("có footer ⇒ TẮT phân trang client (hai bộ điều khiển trang chồng nhau là lỗi)", () => {
    const many: Row[] = Array.from({ length: 25 }, (_, i) => ({
      id: `E${i}`,
      name: `NV ${i}`,
    }));

    const { rerender } = render(<DataTable columns={pinCols} data={many} pageSize={10} />);
    expect(screen.getByLabelText("Trang sau")).toBeInTheDocument();

    rerender(
      <DataTable columns={pinCols} data={many} pageSize={10} footer={<span>footer riêng</span>} />,
    );
    expect(screen.queryByLabelText("Trang sau")).not.toBeInTheDocument();
    expect(screen.getByText("footer riêng")).toBeInTheDocument();
  });
});
