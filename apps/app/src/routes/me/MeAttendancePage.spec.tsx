// @vitest-environment jsdom
/**
 * MeAttendancePage tests (S5-ME-FE-3, ME-SCREEN-009). Phủ: forbidden (thiếu access:me → KHÔNG gọi
 * meApi.getAttendanceSummary) · loading skeleton · lỗi transport + thử lại · mọi section status
 * (ok/error/forbidden/module_disabled/unlinked_employee, §13) · deep-link CHỈ trỏ ME_QUICK_ACTION_PATHS,
 * KHÔNG gọi endpoint bảng ATT nguồn (§7.5 — chỉ mock meApi, page KHÔNG import API nguồn nào khác).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import type { MeAttendanceSection } from "@mediaos/contracts";
import i18n from "@/i18n";
import { ME_QUICK_ACTION_PATHS } from "./constants";
import { MeAttendancePage } from "./MeAttendancePage";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, meApi: { getAttendanceSummary: vi.fn() } };
});

import { meApi } from "@mediaos/web-core";
const mockGetSummary = meApi.getAttendanceSummary as ReturnType<typeof vi.fn>;

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "t@demo.local",
      fullName: "Trần Văn Test",
      status: "Active",
      companyId: "co1",
    },
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MeAttendancePage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("MeAttendancePage — gate (access:me)", () => {
  it("thiếu access:me → forbidden, KHÔNG gọi meApi.getAttendanceSummary", () => {
    setCaps({});
    renderPage();
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(mockGetSummary).not.toHaveBeenCalled();
  });
});

describe("MeAttendancePage — data states (có access:me)", () => {
  beforeEach(() => setCaps({ "access:me": true }));

  it("loading → skeleton, KHÔNG hiện nội dung/lỗi", () => {
    mockGetSummary.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText(/chấm công của tôi/i)).not.toBeInTheDocument();
  });

  it("lỗi transport → error state + thử lại gọi lại API", async () => {
    mockGetSummary.mockRejectedValue(new Error("network"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không tải được dữ liệu chấm công/i)).toBeInTheDocument();
    });
    mockGetSummary.mockClear();
    mockGetSummary.mockResolvedValue({
      status: "ok",
      data: {
        workDate: "2026-07-16",
        status: "CheckedIn",
        checkInAt: "2026-07-16T01:30:00.000Z",
        checkOutAt: null,
        shiftName: "Ca hành chính",
        isLate: false,
        isEarlyLeave: null,
      },
    } satisfies MeAttendanceSection);
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(mockGetSummary).toHaveBeenCalled());
  });

  it("section status='ok' → render giờ vào + deep-link đúng ME_QUICK_ACTION_PATHS", async () => {
    mockGetSummary.mockResolvedValue({
      status: "ok",
      data: {
        workDate: "2026-07-16",
        status: "CheckedIn",
        checkInAt: "2026-07-16T01:30:00.000Z",
        checkOutAt: null,
        shiftName: "Ca hành chính",
        isLate: false,
        isEarlyLeave: null,
      },
    } satisfies MeAttendanceSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/giờ vào/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Check-in / Check-out"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: ME_QUICK_ACTION_PATHS.CHECK_IN_OUT });

    fireEvent.click(screen.getByText("Bảng công của tôi"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: ME_QUICK_ACTION_PATHS.MY_ATTENDANCE_RECORDS });

    // Chỉ 1 nguồn gọi — KHÔNG endpoint bảng ATT nguồn nào khác (mock DUY NHẤT meApi ở test này).
    expect(mockGetSummary).toHaveBeenCalledTimes(1);
  });

  it("section status='forbidden' → hiện thông điệp thiếu quyền mục", async () => {
    mockGetSummary.mockResolvedValue({
      status: "forbidden",
      data: null,
    } satisfies MeAttendanceSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không có quyền xem mục này/i)).toBeInTheDocument();
    });
  });

  it("section status='module_disabled' → hiện thông điệp module chưa bật", async () => {
    mockGetSummary.mockResolvedValue({
      status: "module_disabled",
      data: null,
    } satisfies MeAttendanceSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/chưa được bật/i)).toBeInTheDocument();
    });
  });

  it("section status='unlinked_employee' → hiện thông điệp cần liên kết hồ sơ", async () => {
    mockGetSummary.mockResolvedValue({
      status: "unlinked_employee",
      data: null,
    } satisfies MeAttendanceSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/cần liên kết hồ sơ nhân viên/i)).toBeInTheDocument();
    });
  });

  it("section status='error' (degraded) → hiện lỗi mục + nút thử lại gọi lại API", async () => {
    mockGetSummary.mockResolvedValue({ status: "error", data: null } satisfies MeAttendanceSection);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không tải được dữ liệu/i)).toBeInTheDocument();
    });
    mockGetSummary.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(mockGetSummary).toHaveBeenCalled());
  });
});
