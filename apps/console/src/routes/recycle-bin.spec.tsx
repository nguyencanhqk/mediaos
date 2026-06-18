import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { RecycleBinPage } from "./recycle-bin";
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
  return render(<RecycleBinPage />, { wrapper });
}

const okList = (rows: unknown[]) => ({
  success: true,
  data: rows,
  error: null,
});

function makeDeleted(overrides: Partial<{
  id: string;
  userId: string;
  userFullName: string;
  userEmail: string;
  employeeCode: string | null;
  orgUnitName: string | null;
  positionName: string | null;
  status: string;
  deletedAt: string;
}> = {}) {
  return {
    id: overrides.id ?? "00000000-0000-0000-0000-000000000001",
    userId: overrides.userId ?? "00000000-0000-0000-0000-000000000002",
    employeeCode: overrides.employeeCode !== undefined ? overrides.employeeCode : "NV001",
    userFullName: overrides.userFullName ?? "Nguyễn Văn A",
    userEmail: overrides.userEmail ?? "nva@company.com",
    orgUnitId: null,
    orgUnitName: overrides.orgUnitName !== undefined ? overrides.orgUnitName : "Kỹ thuật",
    positionId: null,
    positionName: overrides.positionName !== undefined ? overrides.positionName : "Kỹ sư",
    workType: "offline",
    employmentType: "full_time",
    status: overrides.status ?? "inactive",
    deletedAt: overrides.deletedAt ?? "2026-06-01T00:00:00Z",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Permission gate ───────────────────────────────────────────────────────────

describe("CS-6 RecycleBinPage — permission gate", () => {
  it("KHÔNG có read:employee → noPermission (ẩn bảng)", () => {
    setCaps({});
    renderPage();
    expect(screen.getByText("Không có quyền")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("có read:employee → render bảng dữ liệu", async () => {
    setCaps({ "read:employee": true });
    stubFetch({ ok: true, status: 200, body: okList([]) });
    renderPage();
    // Tabs should appear
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Nhân viên" })).toBeInTheDocument(),
    );
  });
});

// ─── List & tabs ──────────────────────────────────────────────────────────────

describe("CS-6 RecycleBinPage — danh sách & tab", () => {
  it("2 tab Nhân viên / Người dùng render", async () => {
    setCaps({ "read:employee": true });
    stubFetch({ ok: true, status: 200, body: okList([]) });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Nhân viên" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Người dùng" })).toBeInTheDocument();
    });
  });

  it("empty list → EmptyState render", async () => {
    setCaps({ "read:employee": true });
    stubFetch({ ok: true, status: 200, body: okList([]) });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Thùng rác trống")).toBeInTheDocument(),
    );
  });

  it("có dữ liệu → tên nhân viên render", async () => {
    setCaps({ "read:employee": true });
    stubFetch({
      ok: true,
      status: 200,
      body: okList([makeDeleted({ userFullName: "Trần Thị B" })]),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Trần Thị B")).toBeInTheDocument());
  });

  it("load lỗi → role=alert", async () => {
    setCaps({ "read:employee": true });
    stubFetch({ ok: false, status: 500, body: { success: false, data: null } });
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
  });
});

// ─── Restore button ───────────────────────────────────────────────────────────

describe("CS-6 RecycleBinPage — nút Khôi phục", () => {
  it("không có restore:employee → nút Khôi phục ẩn", async () => {
    setCaps({ "read:employee": true });
    stubFetch({
      ok: true,
      status: 200,
      body: okList([makeDeleted()]),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    expect(screen.queryByText("Khôi phục")).not.toBeInTheDocument();
  });

  it("có restore:employee → nút Khôi phục hiển thị", async () => {
    setCaps({ "read:employee": true, "restore:employee": true });
    stubFetch({
      ok: true,
      status: 200,
      body: okList([makeDeleted()]),
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Khôi phục")).toBeInTheDocument(),
    );
  });

  it("click Khôi phục → gọi POST /recycle-bin/employees/:id/restore", async () => {
    setCaps({ "read:employee": true, "restore:employee": true });
    const fetchMock = vi.fn();

    // Lần 1: list deleted
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => okList([makeDeleted()]),
      text: async () => "",
    });
    // Lần 2: restore POST
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { id: "00000000-0000-0000-0000-000000000001" }, error: null }),
      text: async () => "",
    });
    // Lần 3: re-fetch sau invalidate
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => okList([]),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await waitFor(() => expect(screen.getByText("Khôi phục")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Khôi phục"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/recycle-bin/employees/00000000-0000-0000-0000-000000000001/restore"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
