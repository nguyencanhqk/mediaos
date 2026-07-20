import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { hrApi, hrMasterDataApi } from "@mediaos/web-core";
import { DeptHeadPickerDialog } from "./DeptHeadPickerDialog";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrApi: {
      listEmployees: vi.fn(),
      listDepartments: vi.fn().mockResolvedValue([]),
    },
    hrMasterDataApi: {
      updateDepartment: vi.fn(),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const DEPT = { id: "dept-001", name: "Phòng Nội Dung" };

// emp-001 CHƯA liên kết tài khoản (userId null) → không làm trưởng đơn vị được (head_user_id FK users).
const PICKER_EMPLOYEES = {
  items: [
    {
      id: "emp-001",
      userId: null,
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
      userId: "user-002",
      fullName: "Trần Thị B",
      email: "b@demo.local",
      positionName: "Designer",
      orgUnitId: "dept-001",
      orgUnitName: "Phòng Nội Dung",
      avatarUrl: null,
      employeeCode: "EMP0002",
    },
    {
      id: "emp-003",
      userId: "user-003",
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

async function openDialog(
  onClose = vi.fn(),
  onSaved = vi.fn(),
  currentHeadName: string | null = null,
) {
  renderWithQuery(
    <DeptHeadPickerDialog
      dept={DEPT}
      currentHeadName={currentHeadName}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  await waitFor(() =>
    expect(screen.getByTestId("dept-head-picker-row-emp-002")).toBeInTheDocument(),
  );
  return { onClose, onSaved };
}

describe("DeptHeadPickerDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hrApi.listEmployees).mockResolvedValue(PICKER_EMPLOYEES);
  });

  it("người CHƯA liên kết tài khoản bị khóa + badge; chọn-một nên KHÔNG có chọn-cả-trang", async () => {
    await openDialog();

    expect(screen.getByLabelText("Nguyễn Văn A")).toBeDisabled();
    expect(screen.getByText("Chưa có tài khoản")).toBeInTheDocument();
    expect(screen.queryByTestId("dept-head-picker-select-page")).not.toBeInTheDocument();
  });

  it("chọn-một: bấm người thứ hai THAY người thứ nhất; xác nhận PATCH đúng 1 lần với userId", async () => {
    vi.mocked(hrMasterDataApi.updateDepartment).mockResolvedValue({} as never);
    const { onClose, onSaved } = await openDialog();

    fireEvent.click(screen.getByTestId("dept-head-picker-row-emp-002"));
    fireEvent.click(screen.getByTestId("dept-head-picker-row-emp-003"));
    // Selection bị THAY (không cộng dồn) — footer đếm 1.
    expect(screen.getByTestId("dept-head-picker-selected-count")).toHaveTextContent("Đã chọn 1");

    fireEvent.click(screen.getByTestId("dept-head-picker-confirm"));
    await waitFor(() => expect(hrMasterDataApi.updateDepartment).toHaveBeenCalledTimes(1));
    // Gửi EMPLOYEE id đúng spec (DB-03) — BE tự resolve user liên kết ghi head_user_id.
    expect(hrMasterDataApi.updateDepartment).toHaveBeenCalledWith("dept-001", {
      managerEmployeeId: "emp-003",
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
  });

  it("nút GỠ chỉ hiện khi phòng ĐANG có trưởng; bấm ⇒ PATCH managerEmployeeId=null + đóng", async () => {
    vi.mocked(hrMasterDataApi.updateDepartment).mockResolvedValue({} as never);
    const { onClose, onSaved } = await openDialog(vi.fn(), vi.fn(), "Nguyễn Văn A");

    fireEvent.click(screen.getByTestId("dept-head-picker-remove"));
    await waitFor(() => expect(hrMasterDataApi.updateDepartment).toHaveBeenCalledTimes(1));
    expect(hrMasterDataApi.updateDepartment).toHaveBeenCalledWith("dept-001", {
      managerEmployeeId: null,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
  });

  it("phòng CHƯA có trưởng ⇒ không có nút gỡ", async () => {
    await openDialog();
    expect(screen.queryByTestId("dept-head-picker-remove")).not.toBeInTheDocument();
  });

  it("lưu lỗi → báo lỗi + giữ selection, KHÔNG đóng dialog", async () => {
    vi.mocked(hrMasterDataApi.updateDepartment).mockRejectedValue(new Error("boom"));
    const { onClose } = await openDialog();

    fireEvent.click(screen.getByTestId("dept-head-picker-row-emp-002"));
    fireEvent.click(screen.getByTestId("dept-head-picker-confirm"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/1 nhân viên chưa thêm được/i),
    );
    expect(screen.getByTestId("dept-head-picker-selected-count")).toHaveTextContent("Đã chọn 1");
    expect(onClose).not.toHaveBeenCalled();
  });
});
