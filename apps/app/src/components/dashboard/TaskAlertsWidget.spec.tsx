// @vitest-environment jsdom
/**
 * TaskAlertsWidget tests (S4-FE-DASH-1, DASH-WIDGET-003). Phủ: deny-path (thiếu read:task) · empty ·
 * success (summary overdue/dueSoon + danh sách task).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { TaskAlertsWidget } from "./TaskAlertsWidget";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    dashboardApi: { getWidgetData: vi.fn() },
  };
});

import { dashboardApi } from "@mediaos/web-core";
const mockGetWidgetData = dashboardApi.getWidgetData as ReturnType<typeof vi.fn>;

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

function renderWidget() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <TaskAlertsWidget />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("TaskAlertsWidget — gate (read:task)", () => {
  it("thiếu read:task → KHÔNG render, KHÔNG fetch", () => {
    setCaps({});
    renderWidget();
    expect(screen.queryByText(/task cần chú ý/i)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });
});

describe("TaskAlertsWidget — data states (có read:task)", () => {
  beforeEach(() => setCaps({ "read:task": true }));

  it("status Empty → 'Không có task cần chú ý'", async () => {
    mockGetWidgetData.mockResolvedValue({
      widget_code: "TASK_ALERTS",
      widget_type: "Alert",
      status: "Empty",
      data: null,
      empty_state: { message: "Không có task cần chú ý" },
      error_state: null,
      last_updated_at: null,
      cache: null,
      quick_actions: [],
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Không có task cần chú ý")).toBeInTheDocument();
    });
  });

  it("status Active → summary overdue/dueSoon + task list", async () => {
    mockGetWidgetData.mockResolvedValue({
      widget_code: "TASK_ALERTS",
      widget_type: "Alert",
      status: "Active",
      data: {
        items: [
          {
            id: "t-2",
            title: "Task quá hạn",
            status: "In Progress",
            priority: "Urgent",
            dueAt: "2026-07-01T00:00:00.000Z",
            isOverdue: true,
            projectName: null,
          },
        ],
        summary: { total: 1, overdue: 1, dueSoon: 0 },
      },
      empty_state: null,
      error_state: null,
      last_updated_at: "2026-07-11T08:00:00.000Z",
      cache: { hit: true, ttl_seconds: 60, expires_at: "2026-07-11T08:01:00.000Z" },
      quick_actions: [],
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Task quá hạn")).toBeInTheDocument();
    });
    expect(screen.getByText("1 quá hạn · 0 sắp đến hạn")).toBeInTheDocument();
  });
});
