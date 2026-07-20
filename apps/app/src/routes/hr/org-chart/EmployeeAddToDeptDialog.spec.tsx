import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { hrApi } from "@mediaos/web-core";
import { EmployeeAddToDeptDialog } from "./EmployeeAddToDeptDialog";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrApi: {
      listEmployees: vi.fn(),
      listDepartments: vi.fn().mockResolvedValue([]),
      updateEmployee: vi.fn(),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const DEPT = { id: "dept-001", name: "Phòng Nội Dung" };

// emp-001 ĐANG ở phòng này (orgUnitId === dept.id) → khóa; emp-002 chưa phân phòng; emp-003 phòng khác.
const PICKER_EMPLOYEES = {
  items: [
    {
      id: "emp-001",
      fullName: "Nguyễn Văn A",
      email: "a@demo.local",
      positionName: "Biên kịch",
      orgUnitId: "dept-001",
      orgUnitName: "Phòng Nội Dung",
      avatarUrl: null,
      employeeCode: "EMP0001",
    },
    {
      id: "emp-002",
      fullName: "Trần Thị B",
      email: "b@demo.local",
      positionName: "Designer",
      orgUnitId: null,
      orgUnitName: null,
      avatarUrl: null,
      employeeCode: "EMP0002",
    },
    {
      id: "emp-003",
      fullName: "Lê Văn C",
      email: "c@demo.local",
      positionName: "QA",
      orgUnitId: "dept-002",
      orgUnitName: "Phòng Kỹ thuật",
      avatarUrl: null,
      employeeCode: "EMP0003",
    },
  ],
  meta: { page: 1, pageSize: 10, total: 3, totalPages: 1, hasNext: false, hasPrev: false },
} as never;

async function openDialog(onClose = vi.fn(), onSaved = vi.fn()) {
  renderWithQuery(<EmployeeAddToDeptDialog dept={DEPT} onClose={onClose} onSaved={onSaved} />);
  await waitFor(() => expect(screen.getByTestId("dept-picker-row-emp-002")).toBeInTheDocument());
  return { onClose, onSaved };
}

describe("EmployeeAddToDeptDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hrApi.listEmployees).mockResolvedValue(PICKER_EMPLOYEES);
  });

  it("hiện bảng chọn; người ĐANG ở phòng này bị khóa + badge, tổng số hiển thị", async () => {
    await openDialog();

    expect(screen.getByLabelText("Nguyễn Văn A")).toBeDisabled();
    expect(screen.getByText("Đã ở phòng này")).toBeInTheDocument();
    expect(screen.getByTestId("dept-picker-total")).toHaveTextContent("Tổng số 3 nhân viên");
    // Người chưa phân phòng vẫn là ứng viên hợp lệ.
    expect(screen.getByLabelText("Trần Thị B")).toBeEnabled();
  });

  it("chọn nhiều → updateEmployee gọi TỪNG người với orgUnitId của phòng; xong đóng dialog", async () => {
    vi.mocked(hrApi.updateEmployee).mockResolvedValue({} as never);
    const { onClose, onSaved } = await openDialog();

    fireEvent.click(screen.getByTestId("dept-picker-row-emp-002"));
    fireEvent.click(screen.getByTestId("dept-picker-row-emp-003"));
    expect(screen.getByTestId("dept-picker-confirm")).toHaveTextContent("Thêm (2)");

    fireEvent.click(screen.getByTestId("dept-picker-confirm"));
    await waitFor(() => expect(hrApi.updateEmployee).toHaveBeenCalledTimes(2));
    expect(hrApi.updateEmployee).toHaveBeenCalledWith("emp-002", { orgUnitId: "dept-001" });
    expect(hrApi.updateEmployee).toHaveBeenCalledWith("emp-003", { orgUnitId: "dept-001" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
  });

  it("một người lỗi → GIỮ LẠI trong selection + báo lỗi, KHÔNG đóng dialog, vẫn invalidate", async () => {
    vi.mocked(hrApi.updateEmployee).mockImplementation((employeeId) =>
      employeeId === "emp-003" ? Promise.reject(new Error("boom")) : Promise.resolve({} as never),
    );
    const { onClose, onSaved } = await openDialog();

    fireEvent.click(screen.getByTestId("dept-picker-row-emp-002"));
    fireEvent.click(screen.getByTestId("dept-picker-row-emp-003"));
    fireEvent.click(screen.getByTestId("dept-picker-confirm"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/1 nhân viên chưa thêm được/i),
    );
    // Chỉ người LỖI còn trong selection để thử lại; dialog vẫn mở.
    expect(screen.getByTestId("dept-picker-confirm")).toHaveTextContent("Thêm (1)");
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });
});
