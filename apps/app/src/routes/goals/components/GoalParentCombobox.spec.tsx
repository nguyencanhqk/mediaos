/**
 * S20-GOAL-PARENTPICKER-1 (US-GOAL-NV-12) — ô chọn mục tiêu cha có tìm kiếm.
 *
 * Khoá: gợi ý mặc định gọi GET /goals cùng phòng + cùng kỳ; gõ «doanh» chỉ còn mục khớp tên/mã;
 * không khớp ⇒ «Không tìm thấy» và vẫn bỏ chọn được; tải theo trang; danh sách = ĐÚNG tập server trả
 * (phạm vi view:goal do server lọc — FE không thêm/bớt); bàn phím ↑/↓/Enter/Esc + aria-activedescendant.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  goalApi: { listGoals: vi.fn() },
  goalKeys: { list: (p?: unknown) => ["goals", "list", p] },
}));

import { goalApi } from "@mediaos/web-core";
import type { GoalCoreResponseDto } from "@mediaos/contracts";
import { GOAL_PARENT_PAGE_SIZE, GoalParentCombobox } from "./GoalParentCombobox";

const mockListGoals = goalApi.listGoals as ReturnType<typeof vi.fn>;
const DEPT = "11111111-1111-4111-8111-111111111111";

function goal(n: number, name: string): GoalCoreResponseDto {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return {
    id,
    companyId: "co-1",
    goalCode: `GOAL-${String(n).padStart(4, "0")}`,
    name,
    description: null,
    level: "department",
    departmentId: DEPT,
    projectId: null,
    employeeId: null,
    parentGoalId: null,
    ownerEmployeeId: "22222222-2222-4222-8222-222222222222",
    periodType: "quarter",
    periodStart: "2026-10-01",
    periodEnd: "2026-12-31",
    measureType: "percent",
    targetValue: null,
    currentValue: null,
    unit: null,
    progressMode: "children",
    progressPercent: null,
    weight: 1,
    status: "Active",
    finalizedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

/** Phòng có 30 mục tiêu quý này: 3 mục «Doanh …», còn lại tên khác. */
const THIRTY = Array.from({ length: 30 }, (_, i) =>
  goal(i + 1, i < 3 ? `Doanh thu kênh ${i + 1}` : `Tuyển dụng đợt ${i + 1}`),
);

type Props = Partial<React.ComponentProps<typeof GoalParentCombobox>>;

function renderBox(props: Props = {}) {
  const onSelect = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <GoalParentCombobox
          label="Mục tiêu cha"
          selected={null}
          onSelect={onSelect}
          departmentId={DEPT}
          periodFrom="2026-10-01"
          periodTo="2026-12-31"
          {...props}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onSelect };
}

function input(): HTMLInputElement {
  return screen.getByRole("combobox", { name: /Mục tiêu cha/ }) as HTMLInputElement;
}

async function openList() {
  fireEvent.keyDown(input(), { key: "ArrowDown" });
  return screen.findByRole("listbox");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListGoals.mockResolvedValue(THIRTY);
});

describe("GoalParentCombobox — gợi ý + tìm (TC1, TC4)", () => {
  it("mở ⇒ gọi GET /goals cùng phòng + cùng kỳ, trang đầu", async () => {
    renderBox();
    await openList();
    await waitFor(() => expect(mockListGoals).toHaveBeenCalled());
    expect(mockListGoals).toHaveBeenCalledWith({
      departmentId: DEPT,
      periodFrom: "2026-10-01",
      periodTo: "2026-12-31",
      limit: GOAL_PARENT_PAGE_SIZE,
      offset: 0,
    });
  });

  it("gõ «doanh» ⇒ chỉ mục khớp tên (không phân biệt hoa/dấu) + ô «Không có»", async () => {
    renderBox();
    fireEvent.change(input(), { target: { value: "doanh" } });
    const list = await screen.findByRole("listbox");
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(4));
    const labels = within(list)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(labels[0]).toMatch(/Không có/);
    expect(labels.slice(1).every((l) => /Doanh thu/.test(l ?? ""))).toBe(true);
  });

  it("gõ theo mã «goal-0012» ⇒ khớp mã", async () => {
    renderBox();
    fireEvent.change(input(), { target: { value: "goal-0012" } });
    const list = await screen.findByRole("listbox");
    await waitFor(() => expect(within(list).getByText(/GOAL-0012/)).toBeInTheDocument());
    expect(within(list).getAllByRole("option")).toHaveLength(2);
  });

  it("không khớp ⇒ «Không tìm thấy», vẫn chọn được «Không có» để bỏ cha", async () => {
    const { onSelect } = renderBox({ selected: THIRTY[0] });
    fireEvent.change(input(), { target: { value: "zzz" } });
    const list = await screen.findByRole("listbox");
    expect(await screen.findByText("Không tìm thấy")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("option", { name: /Không có/ }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("nút xoá ⇒ bỏ chọn cha", () => {
    const { onSelect } = renderBox({ selected: THIRTY[0] });
    expect(input().value).toBe("GOAL-0001 — Doanh thu kênh 1");
    fireEvent.click(screen.getByRole("button", { name: /Bỏ chọn mục tiêu cha/ }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe("GoalParentCombobox — phạm vi + phân trang (TC5)", () => {
  it("danh sách = đúng tập server trả về (FE không lọc thêm theo vai trò, không chèn mục ngoài)", async () => {
    mockListGoals.mockResolvedValue([goal(7, "Doanh thu A"), goal(8, "Chi phí B")]);
    renderBox({ selected: goal(99, "Cha ngoài phạm vi") });
    const list = await openList();
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(3));
    expect(within(list).queryByText(/Cha ngoài phạm vi/)).not.toBeInTheDocument();
  });

  it("bỏ chính mục tiêu đang sửa khỏi danh sách", async () => {
    renderBox({ excludeGoalId: THIRTY[1].id });
    const list = await openList();
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(30));
    expect(within(list).queryByText(/GOAL-0002/)).not.toBeInTheDocument();
  });

  it("trang đầy ⇒ «Tải thêm» gọi trang kế (offset = cỡ trang); trang thiếu ⇒ hết nút", async () => {
    const page1 = Array.from({ length: GOAL_PARENT_PAGE_SIZE }, (_, i) =>
      goal(i + 1, `Mục ${i + 1}`),
    );
    mockListGoals.mockResolvedValueOnce(page1).mockResolvedValueOnce([goal(500, "Doanh số cuối")]);
    renderBox();
    await openList();
    fireEvent.click(await screen.findByRole("button", { name: /Tải thêm/ }));
    await waitFor(() =>
      expect(mockListGoals).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: GOAL_PARENT_PAGE_SIZE, limit: GOAL_PARENT_PAGE_SIZE }),
      ),
    );
    expect(await screen.findByText(/Doanh số cuối/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tải thêm/ })).not.toBeInTheDocument();
  });

  it("bỏ «Chỉ gợi ý cùng phòng, cùng kỳ» ⇒ gọi GET /goals không lọc phòng/kỳ", async () => {
    renderBox();
    await openList();
    fireEvent.click(screen.getByRole("checkbox", { name: /cùng phòng, cùng kỳ/ }));
    await waitFor(() =>
      expect(mockListGoals).toHaveBeenLastCalledWith({ limit: GOAL_PARENT_PAGE_SIZE, offset: 0 }),
    );
  });

  it("kỳ chưa hợp lệ + không có phòng ⇒ không gửi bộ lọc rác", async () => {
    renderBox({ departmentId: null, periodFrom: "2026-13-01", periodTo: "" });
    await openList();
    await waitFor(() =>
      expect(mockListGoals).toHaveBeenCalledWith({ limit: GOAL_PARENT_PAGE_SIZE, offset: 0 }),
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("GoalParentCombobox — a11y + bàn phím", () => {
  it("↓ di chuyển mục đang chọn (aria-activedescendant), Enter chọn, không submit form", async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onSelect = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <form onSubmit={onSubmit}>
            <GoalParentCombobox
              label="Mục tiêu cha"
              selected={null}
              onSelect={onSelect}
              departmentId={DEPT}
              periodFrom="2026-10-01"
              periodTo="2026-12-31"
            />
          </form>
        </I18nextProvider>
      </QueryClientProvider>,
    );
    const list = await openList();
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(31));
    expect(input()).toHaveAttribute("aria-expanded", "true");
    expect(input()).toHaveAttribute("aria-controls", list.id);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    const active = input().getAttribute("aria-activedescendant");
    expect(active).toBe(within(list).getAllByRole("option")[1].id);
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(input().getAttribute("aria-activedescendant")).toBe(
      within(list).getAllByRole("option")[0].id,
    );
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(THIRTY[0]);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input()).toHaveAttribute("aria-expanded", "false");
  });

  it("Esc đóng danh sách và trả ô về nhãn của cha đang chọn", async () => {
    renderBox({ selected: THIRTY[2] });
    fireEvent.change(input(), { target: { value: "tuy" } });
    await screen.findByRole("listbox");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input().value).toBe("GOAL-0003 — Doanh thu kênh 3");
  });

  it("lỗi tải ⇒ thông báo, không vỡ", async () => {
    mockListGoals.mockRejectedValue(new Error("boom"));
    renderBox();
    await openList();
    expect(await screen.findByText(/Không tải được danh sách mục tiêu/)).toBeInTheDocument();
  });

  it("disabled ⇒ không mở", () => {
    renderBox({ disabled: true });
    expect(input()).toBeDisabled();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("GoalParentCombobox — Enter ngay sau khi mở không đổi cha", () => {
  it("cha đang chọn KHÔNG có trong các trang đã tải ⇒ không trỏ mục nào, Enter giữ cha", async () => {
    const outside = goal(99, "Cha ngoài trang gợi ý");
    const { onSelect } = renderBox({ selected: outside });
    const list = await openList();
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(31));
    expect(input()).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input().value).toBe("GOAL-0099 — Cha ngoài trang gợi ý");
  });

  it("danh sách đang tải ⇒ Enter giữ cha đang chọn", async () => {
    mockListGoals.mockReturnValue(new Promise<GoalCoreResponseDto[]>(() => undefined));
    const { onSelect } = renderBox({ selected: THIRTY[4] });
    await openList();
    expect(await screen.findByText(/Đang tải/)).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("cha đang chọn tới cùng trang đầu ⇒ trỏ đúng mục đó; ↓ rồi ↑ về «Không có» vẫn bỏ cha được", async () => {
    const { onSelect } = renderBox({ selected: THIRTY[4] });
    const list = await openList();
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(31));
    await waitFor(() =>
      expect(input().getAttribute("aria-activedescendant")).toBe(
        within(list).getAllByRole("option")[5].id,
      ),
    );
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalledWith(null);

    await openList();
    for (let i = 0; i < 6; i += 1) fireEvent.keyDown(input(), { key: "ArrowUp" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});

describe("GoalParentCombobox — bấm trong panel giữ focus ở ô nhập", () => {
  it("mousedown ở vùng panel ngoài các mục (dòng trạng thái, thanh cuộn) bị chặn mặc định", async () => {
    mockListGoals.mockResolvedValue([]);
    renderBox();
    await openList();
    const status = await screen.findByText("Không tìm thấy");
    expect(fireEvent.mouseDown(status)).toBe(false);
    expect(fireEvent.mouseDown(screen.getByRole("listbox"))).toBe(false);
  });
});
