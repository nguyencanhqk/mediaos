import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, ApiError } from "@mediaos/web-core";
import { leaveApi } from "@mediaos/web-core";
import type { LeaveTypeAdminView } from "@mediaos/contracts";
import { LeaveTypesPage } from "./LeaveTypesPage";

// Giữ web-core thật (useCan/store/PermissionGate/ApiError/i18n) — chỉ stub API surface.
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    leaveApi: {
      listTypesAdmin: vi.fn(),
      createTypeAdmin: vi.fn(),
      updateTypeAdmin: vi.fn(),
      deleteTypeAdmin: vi.fn(),
    },
  };
});
vi.mock("@/hooks/use-dirty-form-guard", () => ({ useDirtyFormGuard: () => {} }));

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

const LEAVE_TYPE: LeaveTypeAdminView = {
  id: "lt-1",
  name: "Nghỉ phép năm",
  code: "annual",
  paid: true,
  status: "active",
  description: null,
  deductBalance: true,
  balanceUnit: "Day",
  allowFullDay: true,
  allowHalfDay: false,
  allowHourly: false,
  allowMultipleDays: true,
  requireReason: false,
  requireAttachment: false,
  minNoticeDays: null,
  maxDaysPerRequest: null,
  maxHoursPerRequest: null,
  sortOrder: null,
  allowNegativeBalance: null,
};

describe("LeaveTypesPage (LEAVE-SCREEN-010, gate = view:leave-type / create|update|delete:leave-type)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(leaveApi.listTypesAdmin).mockResolvedValue([LEAVE_TYPE]);
  });

  it("shows forbidden and does not fetch without view:leave-type", () => {
    setCaps({ "view-own:leave": true });
    renderWithQuery(<LeaveTypesPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(leaveApi.listTypesAdmin).not.toHaveBeenCalled();
  });

  it("renders list when user has view:leave-type", async () => {
    setCaps({ "view:leave-type": true });
    renderWithQuery(<LeaveTypesPage />);
    await waitFor(() => expect(screen.getByText("Nghỉ phép năm")).toBeInTheDocument());
    expect(screen.getByText("annual")).toBeInTheDocument();
  });

  it("hides add/edit/delete when user only has view:leave-type (no create/update/delete)", async () => {
    setCaps({ "view:leave-type": true });
    renderWithQuery(<LeaveTypesPage />);
    await waitFor(() => expect(screen.getByText("Nghỉ phép năm")).toBeInTheDocument());
    expect(screen.queryByText(/thêm loại nghỉ/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^sửa$/i })).not.toBeInTheDocument();
  });

  it("shows add button when user has create:leave-type", async () => {
    setCaps({ "view:leave-type": true, "create:leave-type": true });
    renderWithQuery(<LeaveTypesPage />);
    await waitFor(() => expect(screen.getByText("Nghỉ phép năm")).toBeInTheDocument());
    expect(screen.getByText(/thêm loại nghỉ/i)).toBeInTheDocument();
  });

  it("creates a leave type with the correct payload (server-authoritative, no company_id)", async () => {
    setCaps({ "view:leave-type": true, "create:leave-type": true });
    vi.mocked(leaveApi.createTypeAdmin).mockResolvedValue({
      ...LEAVE_TYPE,
      id: "lt-2",
      code: "sick",
    });
    const { container } = renderWithQuery(<LeaveTypesPage />);
    await waitFor(() => expect(screen.getByText("Nghỉ phép năm")).toBeInTheDocument());

    fireEvent.click(screen.getByText(/thêm loại nghỉ/i));
    fireEvent.change(container.querySelector("#code") as HTMLInputElement, {
      target: { value: "sick" },
    });
    fireEvent.change(container.querySelector("#name") as HTMLInputElement, {
      target: { value: "Nghỉ ốm" },
    });
    fireEvent.submit(container.querySelector("#master-data-form") as HTMLFormElement);

    await waitFor(() => expect(leaveApi.createTypeAdmin).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(leaveApi.createTypeAdmin).mock.calls[0][0];
    expect(payload).toMatchObject({ code: "sick", name: "Nghỉ ốm" });
    expect(payload).not.toHaveProperty("companyId");
    expect(payload).not.toHaveProperty("status");
  });

  it("deletes via confirm dialog and refetches the list", async () => {
    setCaps({ "view:leave-type": true, "delete:leave-type": true });
    vi.mocked(leaveApi.deleteTypeAdmin).mockResolvedValue(undefined);
    renderWithQuery(<LeaveTypesPage />);
    await waitFor(() => expect(screen.getByText("Nghỉ phép năm")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^xoá$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^xoá$/i }));

    await waitFor(() => expect(leaveApi.deleteTypeAdmin).toHaveBeenCalledWith("lt-1"));
    await waitFor(() =>
      expect(vi.mocked(leaveApi.listTypesAdmin).mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it("maps a 409 conflict to a field-level error on the form (code trùng)", async () => {
    setCaps({ "view:leave-type": true, "create:leave-type": true });
    vi.mocked(leaveApi.createTypeAdmin).mockRejectedValue(
      new ApiError(409, "LEAVE-ERR-TYPE-DUP", "duplicate code"),
    );
    const { container } = renderWithQuery(<LeaveTypesPage />);
    await waitFor(() => expect(screen.getByText("Nghỉ phép năm")).toBeInTheDocument());

    fireEvent.click(screen.getByText(/thêm loại nghỉ/i));
    fireEvent.change(container.querySelector("#code") as HTMLInputElement, {
      target: { value: "annual" },
    });
    fireEvent.change(container.querySelector("#name") as HTMLInputElement, {
      target: { value: "Trùng mã" },
    });
    fireEvent.submit(container.querySelector("#master-data-form") as HTMLFormElement);

    await waitFor(() => expect(screen.getAllByText(/mã đã tồn tại/i).length).toBeGreaterThan(0));
  });

  it("shows empty state when there are no leave types", async () => {
    setCaps({ "view:leave-type": true });
    vi.mocked(leaveApi.listTypesAdmin).mockResolvedValue([]);
    renderWithQuery(<LeaveTypesPage />);
    await waitFor(() => expect(screen.getByText(/chưa có dữ liệu/i)).toBeInTheDocument());
  });

  it("shows error state when the list fails to load", async () => {
    setCaps({ "view:leave-type": true });
    vi.mocked(leaveApi.listTypesAdmin).mockRejectedValue(new Error("net"));
    renderWithQuery(<LeaveTypesPage />);
    await waitFor(() => expect(screen.getByText(/không thể tải danh sách/i)).toBeInTheDocument());
  });
});
