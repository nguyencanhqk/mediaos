import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, ApiError, type HrDepartment } from "@mediaos/web-core";
import { hrMasterDataApi } from "@mediaos/web-core";
import { DepartmentsPage } from "./DepartmentsPage";

// Giữ web-core thật (useCan/store/PermissionGate/ApiError/i18n) — chỉ stub API surface.
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrMasterDataApi: {
      listDepartments: vi.fn(),
      createDepartment: vi.fn(),
      updateDepartment: vi.fn(),
      deleteDepartment: vi.fn(),
    },
  };
});

// Dirty-form guard kéo router state (không có RouterProvider trong unit test) → no-op.
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

const DEPT: HrDepartment = {
  id: "dept-1",
  companyId: "co1",
  parentId: null,
  name: "Phòng Kỹ thuật",
  code: "TECH",
  description: null,
  headUserId: null,
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("DepartmentsPage", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(hrMasterDataApi.listDepartments).mockResolvedValue([DEPT]);
  });

  // ── QA-05 deny-path: thiếu read:department → forbidden + KHÔNG gọi API ─────────
  it("shows forbidden state and does not fetch when user lacks read:department", () => {
    setCaps({});
    renderWithQuery(<DepartmentsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(hrMasterDataApi.listDepartments).not.toHaveBeenCalled();
  });

  // ── QA-02 list render ──────────────────────────────────────────────────────────
  it("renders department list when user has read:department", async () => {
    setCaps({ "read:department": true });
    renderWithQuery(<DepartmentsPage />);
    await waitFor(() => expect(screen.getByText("Phòng Kỹ thuật")).toBeInTheDocument());
    expect(screen.getByText("TECH")).toBeInTheDocument();
  });

  // ── QA-05: nút thao tác ẩn khi chỉ có read ─────────────────────────────────────
  it("hides create/edit/delete buttons when user only has read:department", async () => {
    setCaps({ "read:department": true });
    renderWithQuery(<DepartmentsPage />);
    await waitFor(() => expect(screen.getByText("Phòng Kỹ thuật")).toBeInTheDocument());
    expect(screen.queryByText(/thêm phòng ban/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^sửa$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^xoá$/i })).not.toBeInTheDocument();
  });

  it("shows add button when user has create:department", async () => {
    setCaps({ "read:department": true, "create:department": true });
    renderWithQuery(<DepartmentsPage />);
    await waitFor(() => expect(screen.getByText("Phòng Kỹ thuật")).toBeInTheDocument());
    expect(screen.getByText(/thêm phòng ban/i)).toBeInTheDocument();
  });

  // ── QA-02 create: submit gọi POST đúng payload (company_id KHÔNG gửi) ───────────
  it("creates a department with the correct payload and no company_id", async () => {
    setCaps({ "read:department": true, "create:department": true });
    vi.mocked(hrMasterDataApi.createDepartment).mockResolvedValue({ ...DEPT, id: "dept-2" });
    const { container } = renderWithQuery(<DepartmentsPage />);
    await waitFor(() => expect(screen.getByText("Phòng Kỹ thuật")).toBeInTheDocument());

    fireEvent.click(screen.getByText(/thêm phòng ban/i));
    const nameInput = container.querySelector("#name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Phòng Mới" } });
    fireEvent.submit(container.querySelector("#master-data-form") as HTMLFormElement);

    await waitFor(() => expect(hrMasterDataApi.createDepartment).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(hrMasterDataApi.createDepartment).mock.calls[0][0];
    expect(payload).toMatchObject({ name: "Phòng Mới", status: "active" });
    expect(payload).not.toHaveProperty("companyId");
    expect(payload).not.toHaveProperty("company_id");
  });

  // ── QA-02 delete: confirm dialog + gọi DELETE + invalidate (refetch) ────────────
  it("deletes via confirm dialog and refetches the list", async () => {
    setCaps({ "read:department": true, "delete:department": true });
    vi.mocked(hrMasterDataApi.deleteDepartment).mockResolvedValue(undefined);
    renderWithQuery(<DepartmentsPage />);
    await waitFor(() => expect(screen.getByText("Phòng Kỹ thuật")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^xoá$/i }));
    const dialog = await screen.findByRole("dialog");
    // Nút xác nhận trong dialog
    fireEvent.click(within(dialog).getByRole("button", { name: /^xoá$/i }));

    await waitFor(() => expect(hrMasterDataApi.deleteDepartment).toHaveBeenCalledWith("dept-1"));
    // invalidate → refetch danh sách (gọi lần 2)
    await waitFor(() =>
      expect(vi.mocked(hrMasterDataApi.listDepartments).mock.calls.length).toBeGreaterThanOrEqual(
        2,
      ),
    );
  });

  // ── QA-04 contract: 422 từ server → field-level error hiển thị trên form ────────
  it("maps a 422 conflict to a field-level error on the form", async () => {
    setCaps({ "read:department": true, "create:department": true });
    vi.mocked(hrMasterDataApi.createDepartment).mockRejectedValue(
      new ApiError(422, "HR-ERR-DUP", "duplicate code"),
    );
    const { container } = renderWithQuery(<DepartmentsPage />);
    await waitFor(() => expect(screen.getByText("Phòng Kỹ thuật")).toBeInTheDocument());

    fireEvent.click(screen.getByText(/thêm phòng ban/i));
    fireEvent.change(container.querySelector("#name") as HTMLInputElement, {
      target: { value: "Phòng Mới" },
    });
    fireEvent.submit(container.querySelector("#master-data-form") as HTMLFormElement);

    await waitFor(() => expect(screen.getAllByText(/mã đã tồn tại/i).length).toBeGreaterThan(0));
  });

  // ── states: loading / empty / error ──────────────────────────────────────────
  it("shows loading skeleton table", () => {
    setCaps({ "read:department": true });
    vi.mocked(hrMasterDataApi.listDepartments).mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<DepartmentsPage />);
    expect(container.querySelector("table")).toBeInTheDocument();
  });

  it("shows empty state when there are no departments", async () => {
    setCaps({ "read:department": true });
    vi.mocked(hrMasterDataApi.listDepartments).mockResolvedValue([]);
    renderWithQuery(<DepartmentsPage />);
    await waitFor(() => expect(screen.getByText(/chưa có dữ liệu/i)).toBeInTheDocument());
  });

  it("shows error state when the list fails to load", async () => {
    setCaps({ "read:department": true });
    vi.mocked(hrMasterDataApi.listDepartments).mockRejectedValue(new Error("net"));
    renderWithQuery(<DepartmentsPage />);
    await waitFor(() => expect(screen.getByText(/không thể tải danh sách/i)).toBeInTheDocument());
  });

  // ── QA-06 no-leak: không có token trong localStorage/sessionStorage ─────────────
  it("does not persist any auth token in web storage", async () => {
    setCaps({ "read:department": true });
    renderWithQuery(<DepartmentsPage />);
    await waitFor(() => expect(screen.getByText("Phòng Kỹ thuật")).toBeInTheDocument());
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i) ?? "";
        const value = storage.getItem(key) ?? "";
        expect(`${key}${value}`).not.toMatch(/token|jwt|eyJ/i);
      }
    }
  });
});
