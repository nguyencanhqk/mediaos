/**
 * S20-GOAL-BULKACTIVATE-1 (US-GOAL-QL-11) — thanh kích hoạt hàng loạt: đếm/gửi CHỈ mục Draft, xác nhận
 * trước khi gửi, mỗi mục một PATCH {status:'Active'} qua hook chung, toast tổng kết + báo theo dòng.
 * Ca lỗi một phần · mất mạng · chọn lẫn viết TRƯỚC.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, goalApi: { ...actual.goalApi, updateGoal: vi.fn() } };
});

import { ApiError, goalApi } from "@mediaos/web-core";
import type { GoalCoreResponseDto } from "@mediaos/contracts";
import { toast } from "@mediaos/ui";
import { GoalBulkActivateBar } from "./GoalBulkActivateBar";

const mockUpdateGoal = goalApi.updateGoal as ReturnType<typeof vi.fn>;

function makeGoal(n: number, over: Partial<GoalCoreResponseDto> = {}): GoalCoreResponseDto {
  return {
    id: `g-${n}`,
    companyId: "co-1",
    goalCode: `GOAL-000${n}`,
    name: `Mục tiêu ${n}`,
    description: null,
    level: "employee",
    departmentId: null,
    projectId: null,
    employeeId: "emp-1",
    parentGoalId: null,
    ownerEmployeeId: "emp-1",
    periodType: "quarter",
    periodStart: "2026-10-01",
    periodEnd: "2026-12-31",
    measureType: "percent",
    targetValue: null,
    currentValue: null,
    unit: null,
    progressMode: "manual",
    progressPercent: null,
    weight: 1,
    status: "Draft",
    finalizedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

const SIX_DRAFTS = [1, 2, 3, 4, 5, 6].map((n) => makeGoal(n));

function mount(rows: readonly GoalCoreResponseDto[]) {
  const onFinished = vi.fn();
  const onClearSelection = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <GoalBulkActivateBar
          selectedRows={rows}
          onFinished={onFinished}
          onClearSelection={onClearSelection}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onFinished, onClearSelection };
}

function confirmActivate(count: number) {
  fireEvent.click(screen.getByRole("button", { name: `Kích hoạt (${count})` }));
  fireEvent.click(screen.getByTestId("goal-bulk-activate-confirm"));
}

const patchedIds = () => mockUpdateGoal.mock.calls.map(([id]) => id as string);

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateGoal.mockImplementation((id: string) =>
    Promise.resolve({ ...SIX_DRAFTS[0], id, status: "Active" }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GoalBulkActivateBar — lỗi một phần (TC2)", () => {
  it("1/6 bị 403 ⇒ toast «5 thành công, 1 lỗi» kèm lý do, dòng lỗi được liệt kê, không toast từng mục", async () => {
    const warning = vi.spyOn(toast, "warning");
    const success = vi.spyOn(toast, "success");
    const error = vi.spyOn(toast, "error");
    mockUpdateGoal.mockImplementation((id: string) =>
      id === "g-4"
        ? Promise.reject(new ApiError({ status: 403, code: "FORBIDDEN", message: "Forbidden" }))
        : Promise.resolve({ ...SIX_DRAFTS[0], id, status: "Active" }),
    );
    const { onFinished } = mount(SIX_DRAFTS);

    confirmActivate(6);

    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        "5 thành công, 1 lỗi — Bạn không có quyền sửa mục tiêu này",
      ),
    );
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    const report = screen.getByTestId("goal-bulk-report");
    expect(report).toHaveTextContent("GOAL-0004 — Mục tiêu 4: Bạn không có quyền sửa mục tiêu này");
    expect(onFinished).toHaveBeenCalledWith([]);
  });

  it("đã chốt kỳ (GOAL-ERR-005) ⇒ lý do theo mã", async () => {
    const errorToast = vi.spyOn(toast, "error");
    mockUpdateGoal.mockRejectedValue(
      new ApiError({ status: 422, code: "GOAL-ERR-005", message: "Goal finalized" }),
    );
    mount([makeGoal(1)]);

    confirmActivate(1);

    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith(
        "0 thành công, 1 lỗi — Mục tiêu đã chốt kỳ — mở lại kỳ trước khi đổi trạng thái.",
      ),
    );
  });
});

describe("GoalBulkActivateBar — mất mạng giữa chừng (TC5)", () => {
  it("lỗi kết nối ⇒ dừng gửi, toast số dòng chưa xử lý, KHÔNG thành công giả, giữ chọn dòng chưa xử lý", async () => {
    const success = vi.spyOn(toast, "success");
    const warning = vi.spyOn(toast, "warning");
    mockUpdateGoal.mockImplementation((id: string) =>
      id === "g-1"
        ? Promise.resolve({ ...SIX_DRAFTS[0], status: "Active" })
        : Promise.reject(new TypeError("Failed to fetch")),
    );
    const { onFinished } = mount(SIX_DRAFTS);

    confirmActivate(6);

    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        "Mất kết nối giữa chừng — 1 thành công, 0 lỗi, 5 mục tiêu chưa xử lý. Kiểm tra mạng rồi thử lại.",
      ),
    );
    expect(success).not.toHaveBeenCalled();
    expect(patchedIds()).not.toContain("g-5");
    expect(patchedIds()).not.toContain("g-6");
    expect(onFinished).toHaveBeenCalledWith(["g-2", "g-3", "g-4", "g-5", "g-6"]);
    expect(screen.getByTestId("goal-bulk-report")).toHaveTextContent("5 mục tiêu chưa xử lý");
  });
});

describe("GoalBulkActivateBar — chọn lẫn trạng thái (TC4)", () => {
  it("2 Nháp + 1 Đang chạy ⇒ nút đếm 2, chỉ gửi 2 mục Nháp", async () => {
    const success = vi.spyOn(toast, "success");
    mount([makeGoal(1), makeGoal(2, { status: "Active" }), makeGoal(3)]);

    expect(screen.getByText("Đã chọn 3 mục tiêu")).toBeInTheDocument();
    expect(
      screen.getByText("Chỉ 2 mục Nháp được kích hoạt — mục khác giữ nguyên."),
    ).toBeInTheDocument();
    confirmActivate(2);

    await waitFor(() => expect(success).toHaveBeenCalledWith("Đã kích hoạt 2 mục tiêu"));
    expect(patchedIds().sort()).toEqual(["g-1", "g-3"]);
    for (const [, body] of mockUpdateGoal.mock.calls) expect(body).toEqual({ status: "Active" });
  });

  it("không có mục Nháp nào trong lựa chọn ⇒ nút khoá, không gửi", () => {
    mount([makeGoal(1, { status: "Active" })]);
    expect(screen.getByRole("button", { name: "Kích hoạt (0)" })).toBeDisabled();
    expect(mockUpdateGoal).not.toHaveBeenCalled();
  });
});

describe("GoalBulkActivateBar — thành công + xác nhận", () => {
  it("6/6 ⇒ mỗi mục ĐÚNG một PATCH {status:'Active'}, toast «Đã kích hoạt 6 mục tiêu», bỏ chọn", async () => {
    const success = vi.spyOn(toast, "success");
    const { onFinished } = mount(SIX_DRAFTS);

    confirmActivate(6);

    await waitFor(() => expect(success).toHaveBeenCalledWith("Đã kích hoạt 6 mục tiêu"));
    expect(success).toHaveBeenCalledTimes(1);
    expect(patchedIds().sort()).toEqual(["g-1", "g-2", "g-3", "g-4", "g-5", "g-6"]);
    expect(onFinished).toHaveBeenCalledWith([]);
    expect(screen.queryByTestId("goal-bulk-report")).not.toBeInTheDocument();
  });

  it("huỷ ở hộp xác nhận ⇒ không gửi gì", () => {
    mount(SIX_DRAFTS);
    fireEvent.click(screen.getByRole("button", { name: "Kích hoạt (6)" }));
    expect(screen.getByText("Kích hoạt 6 mục tiêu Nháp?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(mockUpdateGoal).not.toHaveBeenCalled();
  });

  it("«Bỏ chọn» gọi onClearSelection; không chọn gì ⇒ thanh không hiện", () => {
    const { onClearSelection } = mount(SIX_DRAFTS);
    fireEvent.click(screen.getByRole("button", { name: "Bỏ chọn" }));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
    cleanup();
    mount([]);
    expect(screen.queryByTestId("goal-bulk-bar")).not.toBeInTheDocument();
  });
});
