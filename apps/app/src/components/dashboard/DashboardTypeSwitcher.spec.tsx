// @vitest-environment jsdom
/**
 * DashboardTypeSwitcher tests (S4-FE-DASH-2, DASH-SCREEN-001 §14.2). Phủ: deny-path (thiếu read:dashboard →
 * ẨN, KHÔNG gọi getDashboardTypes) · ẨN khi ≤1 type khả dụng (không có gì để chuyển) · render ĐÚNG tập type
 * server trả (KHÔNG tự liệt kê 4 type cứng — BẤT BIẾN #1) · click gọi onChange(dashboard_type).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { DashboardTypeSwitcher } from "./DashboardTypeSwitcher";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    dashboardApi: { getDashboardTypes: vi.fn() },
  };
});

import { dashboardApi } from "@mediaos/web-core";
const mockGetDashboardTypes = dashboardApi.getDashboardTypes as ReturnType<typeof vi.fn>;

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

function renderSwitcher(onChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <DashboardTypeSwitcher value={null} onChange={onChange} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { ...utils, onChange };
}

const FOUR_TYPES = [
  {
    dashboard_type: "Admin",
    label: "Quản trị",
    is_default: true,
    permission: "view-admin:dashboard",
  },
  { dashboard_type: "HR", label: "Nhân sự", is_default: false, permission: "view-hr:dashboard" },
  {
    dashboard_type: "Manager",
    label: "Quản lý",
    is_default: false,
    permission: "view-manager:dashboard",
  },
  {
    dashboard_type: "Employee",
    label: "Nhân viên",
    is_default: false,
    permission: "view-employee:dashboard",
  },
];

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("DashboardTypeSwitcher — gate (DASH_READ_PAIR = read:dashboard)", () => {
  it("thiếu read:dashboard → KHÔNG render, KHÔNG gọi getDashboardTypes", () => {
    setCaps({});
    renderSwitcher();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(mockGetDashboardTypes).not.toHaveBeenCalled();
  });
});

describe("DashboardTypeSwitcher — có read:dashboard", () => {
  beforeEach(() => setCaps({ "read:dashboard": true }));

  it("chỉ 1 type khả dụng → ẨN (không có gì để chuyển)", async () => {
    mockGetDashboardTypes.mockResolvedValue([FOUR_TYPES[3]]);
    renderSwitcher();
    await waitFor(() => expect(mockGetDashboardTypes).toHaveBeenCalled());
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("nhiều type → render ĐÚNG tập server trả (KHÔNG tự liệt kê 4 type cứng)", async () => {
    mockGetDashboardTypes.mockResolvedValue(FOUR_TYPES.slice(0, 2)); // chỉ Admin + HR
    renderSwitcher();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Quản trị" })).toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: "Nhân sự" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Quản lý" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Nhân viên" })).not.toBeInTheDocument();
  });

  it("click 1 tab → gọi onChange(dashboard_type) tương ứng", async () => {
    mockGetDashboardTypes.mockResolvedValue(FOUR_TYPES.slice(0, 2));
    const { onChange } = renderSwitcher();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Nhân sự" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Nhân sự" }));
    expect(onChange).toHaveBeenCalledWith("HR");
  });

  it("tab is_default được đánh dấu aria-selected khi value=null", async () => {
    mockGetDashboardTypes.mockResolvedValue(FOUR_TYPES.slice(0, 2));
    renderSwitcher();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Quản trị" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(screen.getByRole("tab", { name: "Nhân sự" })).toHaveAttribute("aria-selected", "false");
  });
});
