// @vitest-environment jsdom
/**
 * MeOverviewPage tests (S5-ME-FE-1, ME-SCREEN-001). Phủ: forbidden (thiếu access:me → KHÔNG gọi
 * meApi.getOverview) · loading skeleton · error + thử lại · success render đủ 5 section + identity banner +
 * quick actions · 1 section lỗi (forbidden/module_disabled/unlinked_employee) KHÔNG phá trang (§18.2).
 *
 * Giữ web-core THẬT (useCan/useAuthStore) — chỉ stub `meApi.getOverview` (mirror DashboardMePage.spec.tsx).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import type { MeOverview } from "@mediaos/contracts";
import i18n from "@/i18n";
import { MeOverviewPage } from "./MeOverviewPage";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    meApi: {
      getOverview: vi.fn(),
      // S5-ME-FE-4 — banner MeBannerAvatar đọc GET /me/avatar (fail-soft). Mặc định null (chưa có avatar).
      getAvatar: vi.fn(() => Promise.resolve(null)),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
    },
  };
});

import { meApi } from "@mediaos/web-core";
const mockGetOverview = meApi.getOverview as ReturnType<typeof vi.fn>;

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
        <MeOverviewPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const FULL_OVERVIEW: MeOverview = {
  identity: {
    account: {
      userId: "u1",
      email: "t@demo.local",
      status: "active",
      displayName: "Trần Văn Test",
      roles: [{ id: "r1", name: "Nhân viên" }],
      lastLoginAt: null,
      createdAt: null,
    },
    linkStatus: "linked",
    employee: {
      employeeId: "e1",
      employeeCode: "NV001",
      fullName: "Trần Văn Test",
      departmentName: "Phòng CNTT",
      positionName: "Kỹ sư",
    },
  },
  hr: {
    status: "ok",
    data: {
      employeeCode: "NV001",
      fullName: "Trần Văn Test",
      departmentName: "Phòng CNTT",
      positionName: "Kỹ sư",
      status: "active",
      startDate: "2024-01-01",
    },
  },
  attendance: {
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
  },
  leave: {
    status: "ok",
    data: {
      balances: [
        { leaveTypeCode: "ANNUAL", leaveTypeName: "Phép năm", remainingDays: 8, unit: "ngày" },
      ],
      pendingRequestCount: 1,
    },
  },
  task: {
    status: "ok",
    data: { assignedCount: 5, dueTodayCount: 2, overdueCount: 1 },
  },
  notification: {
    status: "ok",
    data: {
      unreadCount: 3,
      highPriorityUnreadCount: 1,
      urgentUnreadCount: 0,
      lastNotificationAt: null,
    },
  },
};

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("MeOverviewPage — gate (ME_ACCESS_PAIR = access:me)", () => {
  it("thiếu access:me → hiện forbidden, KHÔNG gọi meApi.getOverview", () => {
    setCaps({});
    renderPage();
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(mockGetOverview).not.toHaveBeenCalled();
  });
});

describe("MeOverviewPage — data states (có access:me)", () => {
  beforeEach(() => setCaps({ "access:me": true }));

  it("loading → hiện skeleton (KHÔNG hiện banner/lỗi)", () => {
    mockGetOverview.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText(/xin chào/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/không thể tải/i)).not.toBeInTheDocument();
  });

  it("lỗi fetch → error state + nút thử lại gọi lại meApi.getOverview", async () => {
    mockGetOverview.mockRejectedValue(new Error("network"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không thể tải trang tổng quan/i)).toBeInTheDocument();
    });
    mockGetOverview.mockClear();
    mockGetOverview.mockResolvedValue(FULL_OVERVIEW);
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => {
      expect(mockGetOverview).toHaveBeenCalled();
    });
  });

  it("mọi section ok → render banner + 5 section + quick actions", async () => {
    mockGetOverview.mockResolvedValue(FULL_OVERVIEW);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Trần Văn Test")).toBeInTheDocument();
    });
    expect(screen.getByText("Phòng CNTT")).toBeInTheDocument();
    // Task/Leave/Notification stat badges (count interpolation).
    expect(screen.getByText(/5 được giao/i)).toBeInTheDocument();
    expect(screen.getByText(/3 chưa đọc/i)).toBeInTheDocument();
    // Quick actions
    expect(screen.getByText("Chỉnh sửa hồ sơ")).toBeInTheDocument();
    expect(screen.getByText("Check-in / Check-out")).toBeInTheDocument();
  });

  it("user chưa liên kết employee → banner hiện thông điệp §12.2", async () => {
    mockGetOverview.mockResolvedValue({
      ...FULL_OVERVIEW,
      identity: { ...FULL_OVERVIEW.identity, linkStatus: "unlinked", employee: null },
      hr: { status: "unlinked_employee", data: null },
      attendance: { status: "unlinked_employee", data: null },
      leave: { status: "unlinked_employee", data: null },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/chưa được liên kết với hồ sơ nhân viên/i)).toBeInTheDocument();
    });
    // 3 section employee-dependent đều hiện cùng thông điệp unlinked (KHÔNG phá trang).
    expect(screen.getAllByText(/cần liên kết hồ sơ nhân viên/i).length).toBeGreaterThanOrEqual(3);
    // Task/Notification (KHÔNG employee-dependent) vẫn render bình thường.
    expect(screen.getByText(/3 chưa đọc/i)).toBeInTheDocument();
  });

  it("1 section lỗi (attendance='error') KHÔNG phá các section khác", async () => {
    mockGetOverview.mockResolvedValue({
      ...FULL_OVERVIEW,
      attendance: { status: "error", data: null },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Trần Văn Test")).toBeInTheDocument();
    });
    expect(screen.getByText(/không tải được dữ liệu/i)).toBeInTheDocument();
    // Notification section vẫn render bình thường dù attendance lỗi.
    expect(screen.getByText(/3 chưa đọc/i)).toBeInTheDocument();
  });

  it("task section forbidden → khối 'Cần thực hiện' hiện thông điệp thiếu quyền", async () => {
    mockGetOverview.mockResolvedValue({
      ...FULL_OVERVIEW,
      task: { status: "forbidden", data: null },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Trần Văn Test")).toBeInTheDocument();
    });
    expect(screen.getAllByText(/không có quyền xem mục này/i).length).toBeGreaterThanOrEqual(1);
  });
});
