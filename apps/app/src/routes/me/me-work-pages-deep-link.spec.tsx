// @vitest-environment jsdom
/**
 * [me-work-pages-deep-link] S5-ME-FE-3 — chốt hợp đồng deep-link + "không query bảng nguồn" (§7.5) cho 3
 * trang "Công việc của tôi" (ME-SCREEN-009/010/011) trong 1 file, tránh trôi giữa các spec riêng lẻ:
 *  - Mỗi trang CHỈ mock/gọi ĐÚNG 1 hàm `meApi.*Summary` tương ứng — KHÔNG gọi API bảng ATT/LEAVE/TASK
 *    nguồn nào khác (assert `toHaveBeenCalledTimes(1)` trên chính summary fn, không mock hàm nguồn nào).
 *  - Nút deep-link render đúng nhãn VÀ khi click gọi `navigate({ to })` với string TRÙNG KHỚP
 *    `ME_QUICK_ACTION_PATHS` — cùng hằng router.tsx/sidebar dùng, chống lệch path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import type { MeAttendanceSection, MeLeaveSection, MeTaskSection } from "@mediaos/contracts";
import i18n from "@/i18n";
import { ME_QUICK_ACTION_PATHS } from "./constants";
import { MeAttendancePage } from "./MeAttendancePage";
import { MeLeavePage } from "./MeLeavePage";
import { MeTasksPage } from "./MeTasksPage";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    meApi: {
      getAttendanceSummary: vi.fn(),
      getLeaveSummary: vi.fn(),
      getTaskSummary: vi.fn(),
    },
  };
});

import { meApi } from "@mediaos/web-core";

function setCaps() {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: { "access:me": true },
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

function renderWithProviders(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
  setCaps();
});

describe("MeAttendancePage — deep-link + no-source-table", () => {
  it("chỉ gọi meApi.getAttendanceSummary; deep-link đúng CHECK_IN_OUT & MY_ATTENDANCE_RECORDS", async () => {
    const getAttendanceSummary = meApi.getAttendanceSummary as ReturnType<typeof vi.fn>;
    getAttendanceSummary.mockResolvedValue({
      status: "ok",
      data: {
        workDate: "2026-07-16",
        status: "CheckedIn",
        checkInAt: "2026-07-16T01:00:00.000Z",
        checkOutAt: null,
        shiftName: null,
        isLate: false,
        isEarlyLeave: null,
      },
    } satisfies MeAttendanceSection);
    renderWithProviders(<MeAttendancePage />);
    await waitFor(() => expect(getAttendanceSummary).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Check-in / Check-out")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Check-in / Check-out"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: ME_QUICK_ACTION_PATHS.CHECK_IN_OUT });
    expect(ME_QUICK_ACTION_PATHS.CHECK_IN_OUT).toBe("/attendance/today");

    fireEvent.click(screen.getByText("Bảng công của tôi"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: ME_QUICK_ACTION_PATHS.MY_ATTENDANCE_RECORDS });
    expect(ME_QUICK_ACTION_PATHS.MY_ATTENDANCE_RECORDS).toBe("/attendance/my-records");
  });
});

describe("MeLeavePage — deep-link + no-source-table", () => {
  it("chỉ gọi meApi.getLeaveSummary; deep-link đúng MY_LEAVE_REQUESTS", async () => {
    const getLeaveSummary = meApi.getLeaveSummary as ReturnType<typeof vi.fn>;
    getLeaveSummary.mockResolvedValue({
      status: "ok",
      data: { balances: [], pendingRequestCount: 0 },
    } satisfies MeLeaveSection);
    renderWithProviders(<MeLeavePage />);
    await waitFor(() => expect(getLeaveSummary).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Đơn nghỉ của tôi")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Đơn nghỉ của tôi"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: ME_QUICK_ACTION_PATHS.MY_LEAVE_REQUESTS });
    expect(ME_QUICK_ACTION_PATHS.MY_LEAVE_REQUESTS).toBe("/leave/me/requests");
  });
});

describe("MeTasksPage — deep-link + no-source-table", () => {
  it("chỉ gọi meApi.getTaskSummary; deep-link đúng MY_TASKS", async () => {
    const getTaskSummary = meApi.getTaskSummary as ReturnType<typeof vi.fn>;
    getTaskSummary.mockResolvedValue({
      status: "ok",
      data: { assignedCount: 0, dueTodayCount: 0, overdueCount: 0 },
    } satisfies MeTaskSection);
    renderWithProviders(<MeTasksPage />);
    await waitFor(() => expect(getTaskSummary).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Task của tôi")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Task của tôi"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: ME_QUICK_ACTION_PATHS.MY_TASKS });
    expect(ME_QUICK_ACTION_PATHS.MY_TASKS).toBe("/tasks/my-tasks");
  });
});
