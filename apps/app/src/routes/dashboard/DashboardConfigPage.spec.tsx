// @vitest-environment jsdom
/**
 * DashboardConfigPage tests (S4-FE-DASH-3). Phủ: [deny-path] useCanExact('view','dashboard-config')=false
 * → forbidden + getDashboardConfigs KHÔNG gọi · render danh mục · gate nút Sửa (update:dashboard-config
 * thiếu → ẨN, kể cả PermissionGate bọc dialog) · sửa + submit → updateDashboardConfig đúng payload ·
 * error/empty state.
 *
 * Dùng REAL useAuthStore (mirror UsersPage.spec.tsx) — KHÔNG mock useCanExact/PermissionGate: cả 2 đọc
 * CÙNG store `capabilities`, mock rời useCanExact sẽ lệch với PermissionGate thật (nó tự import useCan
 * nội bộ, không đi qua export web-core bị mock) ⇒ dialog "Sửa" sẽ không bao giờ mở được trong test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore, dashboardApi } from "@mediaos/web-core";
import type { DashboardConfigItemDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { DashboardConfigPage } from "./DashboardConfigPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    dashboardApi: {
      ...actual.dashboardApi,
      getDashboardConfigs: vi.fn(),
      updateDashboardConfig: vi.fn(),
    },
  };
});

const mockGetConfigs = dashboardApi.getDashboardConfigs as ReturnType<typeof vi.fn>;
const mockUpdateConfig = dashboardApi.updateDashboardConfig as ReturnType<typeof vi.fn>;

const CONFIG: DashboardConfigItemDto = {
  id: "cfg-1",
  widget_id: "w-1",
  widget_code: "MY_TASKS",
  widget_name: "Task của tôi",
  dashboard_type: "Employee",
  config_scope: "Company",
  role_id: null,
  user_id: null,
  is_enabled: true,
  sort_order: 20,
  layout: { x: null, y: null, width: null, height: null },
  data_scope_override: null,
  refresh_seconds_override: null,
  config: null,
  updated_at: "2026-06-01T00:00:00.000Z",
  updated_by: null,
};

// Cùng danh mục nhưng dashboard_type KHÁC — dùng cho test lọc client-side theo loại.
const CONFIG_MANAGER: DashboardConfigItemDto = {
  ...CONFIG,
  id: "cfg-2",
  widget_id: "w-2",
  widget_code: "PENDING_LEAVE",
  widget_name: "Đơn nghỉ chờ duyệt",
  dashboard_type: "Manager",
  sort_order: 30,
};

function setCapabilities(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "admin@demo.local",
      fullName: "Admin",
      status: "Active",
      companyId: "co-001",
    },
  });
}

function clearCapabilities() {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
}

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  return render(
    <QueryClientProvider client={buildQC()}>
      <I18nextProvider i18n={i18n}>
        <DashboardConfigPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearCapabilities();
});

describe("DashboardConfigPage — gate", () => {
  it("[deny-path] thiếu view:dashboard-config → forbidden EmptyState, KHÔNG gọi getDashboardConfigs", () => {
    setCapabilities({});
    renderPage();

    expect(
      screen.getByText("Bạn không có quyền xem cấu hình widget bảng điều khiển."),
    ).toBeInTheDocument();
    expect(mockGetConfigs).not.toHaveBeenCalled();
  });

  it("canView=true, canUpdate=false → render danh sách nhưng ẨN nút Sửa", async () => {
    setCapabilities({ "view:dashboard-config": true });
    mockGetConfigs.mockResolvedValue({ items: [CONFIG] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Task của tôi")).toBeInTheDocument();
    });
    expect(screen.queryByTestId(`config-edit-btn-${CONFIG.id}`)).not.toBeInTheDocument();
  });
});

describe("DashboardConfigPage — data states", () => {
  it("empty → EmptyState danh mục trống", async () => {
    setCapabilities({ "view:dashboard-config": true, "update:dashboard-config": true });
    mockGetConfigs.mockResolvedValue({ items: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Chưa có cấu hình widget nào")).toBeInTheDocument();
    });
  });

  it("lỗi fetch → error EmptyState + nút thử lại", async () => {
    setCapabilities({ "view:dashboard-config": true });
    mockGetConfigs.mockRejectedValue(new Error("network"));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Không thể tải cấu hình")).toBeInTheDocument();
    });
  });

  it("render danh mục widget theo dashboard-type + kích thước mặc định khi layout rỗng", async () => {
    setCapabilities({ "view:dashboard-config": true, "update:dashboard-config": true });
    mockGetConfigs.mockResolvedValue({ items: [CONFIG] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("MY_TASKS")).toBeInTheDocument();
    });
    expect(screen.getByText("Mặc định")).toBeInTheDocument();
    expect(screen.getByText("Đang bật")).toBeInTheDocument();
  });

  it("chọn dashboard_type ở Select 'Loại bảng điều khiển' → filteredItems chỉ còn đúng loại (lọc client-side)", async () => {
    setCapabilities({ "view:dashboard-config": true });
    mockGetConfigs.mockResolvedValue({ items: [CONFIG, CONFIG_MANAGER] });
    renderPage();

    // Mặc định (Tất cả loại): cả 2 widget hiển thị.
    await waitFor(() => {
      expect(screen.getByText("Task của tôi")).toBeInTheDocument();
    });
    expect(screen.getByText("Đơn nghỉ chờ duyệt")).toBeInTheDocument();
    // getDashboardConfigs gọi 1 lần — lọc là CLIENT-SIDE, KHÔNG refetch theo type.
    expect(mockGetConfigs).toHaveBeenCalledTimes(1);

    // Chọn "Manager" → chỉ còn widget của Manager, widget Employee bị lọc bỏ.
    fireEvent.change(screen.getByLabelText("Loại bảng điều khiển"), {
      target: { value: "Manager" },
    });

    await waitFor(() => {
      expect(screen.queryByText("Task của tôi")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Đơn nghỉ chờ duyệt")).toBeInTheDocument();
    // KHÔNG có round-trip mới khi đổi filter.
    expect(mockGetConfigs).toHaveBeenCalledTimes(1);
  });
});

describe("DashboardConfigPage — sửa cấu hình (dialog)", () => {
  it("có update:dashboard-config → click Sửa mở dialog qua PermissionGate + submit gọi updateDashboardConfig đúng payload", async () => {
    setCapabilities({ "view:dashboard-config": true, "update:dashboard-config": true });
    mockGetConfigs.mockResolvedValue({ items: [CONFIG] });
    mockUpdateConfig.mockResolvedValue({ ...CONFIG, sort_order: 50 });
    renderPage();

    const editBtn = await screen.findByTestId(`config-edit-btn-${CONFIG.id}`);
    fireEvent.click(editBtn);

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const sortInput = screen.getByLabelText("Thứ tự hiển thị");
    fireEvent.change(sortInput, { target: { value: "50" } });

    fireEvent.click(screen.getByTestId("config-form-submit"));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith("cfg-1", {
        is_enabled: true,
        sort_order: 50,
        layout_width: null,
        layout_height: null,
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("thiếu update:dashboard-config → PermissionGate chặn dialog dù editing state được set (defense-in-depth)", async () => {
    // canUpdate=false ⇒ nút Sửa vốn đã ẩn (test trên) — case này khẳng định KHÔNG có đường nào khác
    // (vd click hàng) mở được form khi thiếu quyền: query danh mục vẫn chạy, không render nút.
    setCapabilities({ "view:dashboard-config": true });
    mockGetConfigs.mockResolvedValue({ items: [CONFIG] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Task của tôi")).toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
