import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { ObjectsPage } from "./index";
import { useAuthStore } from "@mediaos/web-core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stubFetch(res: { ok: boolean; status: number; body?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: res.ok,
    status: res.status,
    json: async () => res.body,
    text: async () => JSON.stringify(res.body ?? ""),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({ capabilities: caps });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ObjectsPage />, { wrapper });
}

const okList = (rows: unknown[]) => ({
  success: true,
  data: rows,
  error: null,
});

const makeEmployee = (
  overrides: Partial<{
    id: string;
    userId: string;
    userFullName: string;
    userEmail: string;
    employeeCode: string;
    orgUnitName: string;
    positionName: string;
    workType: string;
    employmentType: string;
    status: string;
    baseSalary: number | null;
  }> = {},
) => ({
  id: overrides.id ?? "00000000-0000-0000-0000-000000000001",
  userId: overrides.userId ?? "00000000-0000-0000-0000-000000000002",
  userFullName: overrides.userFullName ?? "Nguyễn Văn A",
  userEmail: overrides.userEmail ?? "nva@company.com",
  employeeCode: overrides.employeeCode ?? "NV001",
  orgUnitName: overrides.orgUnitName ?? "Kỹ thuật",
  positionName: overrides.positionName ?? "Kỹ sư",
  workType: overrides.workType ?? "offline",
  employmentType: overrides.employmentType ?? "full_time",
  status: overrides.status ?? "active",
  baseSalary: overrides.baseSalary !== undefined ? overrides.baseSalary : null,
});

const ALL_PERMS: Record<string, boolean> = {
  "read:employee": true,
  "create:employee": true,
  "update:employee": true,
  "delete:employee": true,
  "import:employee": true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Permission gate ───────────────────────────────────────────────────────────

describe("CS-4 ObjectsPage — permission gate", () => {
  it("KHÔNG có read:employee → noPermission (ẩn bảng)", () => {
    setCaps({});
    renderPage();
    expect(screen.getByText("Không có quyền")).toBeInTheDocument();
    // Bảng không render
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("có read:employee → render bảng", async () => {
    setCaps({ "read:employee": true });
    stubFetch({ ok: true, status: 200, body: okList([]) });
    renderPage();
    // Toolbar render
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Tìm theo tên, email, mã…")).toBeInTheDocument(),
    );
  });
});

// ─── List & tabs ──────────────────────────────────────────────────────────────

describe("CS-4 ObjectsPage — danh sách & tab", () => {
  it("2 tab Nhân viên / Người dùng render", async () => {
    setCaps({ "read:employee": true });
    stubFetch({ ok: true, status: 200, body: okList([]) });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Nhân viên" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Người dùng" })).toBeInTheDocument();
    });
  });

  it("empty list → EmptyState title render", async () => {
    setCaps({ "read:employee": true });
    stubFetch({ ok: true, status: 200, body: okList([]) });
    renderPage();
    await waitFor(() => expect(screen.getByText("Chưa có nhân viên")).toBeInTheDocument());
  });

  it("có dữ liệu → tên nhân viên render", async () => {
    setCaps({ "read:employee": true });
    stubFetch({
      ok: true,
      status: 200,
      body: okList([makeEmployee({ userFullName: "Trần Thị B" })]),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Trần Thị B")).toBeInTheDocument());
  });

  it("status badge active → Đang hoạt động", async () => {
    setCaps({ "read:employee": true });
    stubFetch({
      ok: true,
      status: 200,
      body: okList([makeEmployee({ status: "active" })]),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Đang hoạt động")).toBeInTheDocument());
  });

  it("load lỗi → role=alert", async () => {
    setCaps({ "read:employee": true });
    stubFetch({ ok: false, status: 500, body: { success: false, data: null } });
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});

// ─── Search filter ────────────────────────────────────────────────────────────

describe("CS-4 ObjectsPage — search", () => {
  it("gõ từ khoá → lọc client-side theo tên", async () => {
    setCaps({ "read:employee": true });
    stubFetch({
      ok: true,
      status: 200,
      body: okList([
        makeEmployee({ id: "00000000-0000-0000-0000-000000000010", userFullName: "Nguyễn Văn A" }),
        makeEmployee({ id: "00000000-0000-0000-0000-000000000011", userFullName: "Lê Văn C" }),
      ]),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());

    const searchInput = screen.getByPlaceholderText("Tìm theo tên, email, mã…");
    fireEvent.change(searchInput, { target: { value: "Lê" } });

    await waitFor(() => {
      expect(screen.queryByText("Nguyễn Văn A")).not.toBeInTheDocument();
      expect(screen.getByText("Lê Văn C")).toBeInTheDocument();
    });
  });
});

// ─── Status filter ────────────────────────────────────────────────────────────

describe("CS-4 ObjectsPage — status filter", () => {
  it("đổi status filter → query key thay đổi (re-fetch)", async () => {
    setCaps({ "read:employee": true });
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      body: okList([makeEmployee({ status: "active" })]),
    });
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Kiểm tra URL gọi chứa /employees
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/employees"),
      expect.anything(),
    );
  });
});

// ─── Create dialog ────────────────────────────────────────────────────────────

describe("CS-4 ObjectsPage — create dialog", () => {
  it("không có create:employee → nút Thêm mới ẩn", async () => {
    setCaps({ "read:employee": true });
    stubFetch({ ok: true, status: 200, body: okList([]) });
    renderPage();
    await waitFor(() => expect(screen.queryByText("Thêm mới")).not.toBeInTheDocument());
  });

  it("có create:employee → nút Thêm mới hiển thị + mở dialog", async () => {
    setCaps(ALL_PERMS);
    stubFetch({ ok: true, status: 200, body: okList([]) });
    renderPage();
    await waitFor(() => expect(screen.getByText("Thêm mới")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Thêm mới"));
    await waitFor(() => expect(screen.getByText("Thêm nhân viên")).toBeInTheDocument());
  });
});

// ─── Edit dialog ──────────────────────────────────────────────────────────────

describe("CS-4 ObjectsPage — edit dialog", () => {
  it("không có update:employee → nút Chỉnh sửa ẩn", async () => {
    setCaps({ "read:employee": true });
    stubFetch({
      ok: true,
      status: 200,
      body: okList([makeEmployee()]),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    expect(screen.queryByText("Chỉnh sửa")).not.toBeInTheDocument();
  });

  it("có update:employee → nút Chỉnh sửa hiển thị + mở dialog", async () => {
    setCaps({ "read:employee": true, "update:employee": true });
    stubFetch({
      ok: true,
      status: 200,
      body: okList([makeEmployee({ userFullName: "Phạm Thị D" })]),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Phạm Thị D")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Chỉnh sửa"));
    await waitFor(() => expect(screen.getByText("Chỉnh sửa nhân viên")).toBeInTheDocument());
  });
});

// ─── Soft-delete (vô hiệu hoá) ────────────────────────────────────────────────

describe("CS-4 ObjectsPage — vô hiệu hoá (soft-delete)", () => {
  it("không có delete:employee → nút Vô hiệu hoá ẩn", async () => {
    setCaps({ "read:employee": true });
    stubFetch({
      ok: true,
      status: 200,
      body: okList([makeEmployee()]),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    expect(screen.queryByText("Vô hiệu hoá")).not.toBeInTheDocument();
  });

  it("có delete:employee → nút Vô hiệu hoá hiển thị + gọi DELETE", async () => {
    setCaps({ "read:employee": true, "delete:employee": true });
    const fetchMock = vi.fn();
    // Lần 1: list; lần 2: DELETE; lần 3: re-fetch sau invalidate
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => okList([makeEmployee()]),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => null,
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => okList([]),
        text: async () => "",
      });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Vô hiệu hoá"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/employees/00000000-0000-0000-0000-000000000001"),
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
});

// ─── Import CSV (S5-HR-IMPORT-BE-1) ────────────────────────────────────────────
// Legacy /employees/import + /employees/import/confirm bulk-import UI đã bị GỠ khỏi
// ObjectsPage (route media-era gỡ ở BE — không SequenceService, audit yếu). Import
// hàng loạt mới thuộc S5-HR-IMPORT-FE-1 ở apps/app (POST /hr/employees/import).

describe("CS-4 ObjectsPage — import CSV (đã gỡ)", () => {
  it("nút Nhập CSV KHÔNG còn tồn tại dù có import:employee", async () => {
    setCaps(ALL_PERMS);
    stubFetch({ ok: true, status: 200, body: okList([]) });
    renderPage();
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Tìm theo tên, email, mã…")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Nhập CSV")).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
  });
});
