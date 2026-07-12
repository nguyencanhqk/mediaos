// @vitest-environment jsdom
/**
 * ProjectProgressWidget tests (S4-FE-DASH-2, DASH-WIDGET-006). Phủ: deny-path (thiếu read:project →
 * KHÔNG render, KHÔNG fetch) · empty/error(Degraded)/success · projectId FORWARD đúng vào getWidgetData
 * (BE bắt buộc project_id, xem doc-block component) · refresh gọi getWidgetData(refresh:true).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { ProjectProgressWidget } from "./ProjectProgressWidget";

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

function renderWidget(projectId = "proj-001") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ProjectProgressWidget projectId={projectId} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const ACTIVE_DTO = {
  widget_code: "PROJECT_PROGRESS",
  widget_type: "Chart",
  status: "Active" as const,
  data: {
    projectId: "proj-001",
    summary: { total: 10, done: 6, percent: 60 },
    byStatus: { Done: 6, "In Progress": 3, "To Do": 1 },
  },
  empty_state: null,
  error_state: null,
  last_updated_at: "2026-07-12T02:00:00.000Z",
  cache: { hit: false, ttl_seconds: 60, expires_at: "2026-07-12T02:01:00.000Z" },
  quick_actions: [],
};

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("ProjectProgressWidget — gate (DASH_WIDGET_GATE_PAIR.PROJECT_PROGRESS = read:project)", () => {
  it("thiếu read:project → KHÔNG render widget, KHÔNG gọi getWidgetData", () => {
    setCaps({});
    renderWidget();
    expect(screen.queryByText(/tiến độ dự án/i)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });
});

describe("ProjectProgressWidget — data states (có read:project)", () => {
  beforeEach(() => setCaps({ "read:project": true }));

  it("gọi getWidgetData('PROJECT_PROGRESS', { project_id }) — BE bắt buộc project_id", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget("proj-xyz");
    await waitFor(() => {
      expect(mockGetWidgetData).toHaveBeenCalledWith(
        "PROJECT_PROGRESS",
        expect.objectContaining({ project_id: "proj-xyz" }),
      );
    });
  });

  it("status Empty → hiện empty title", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Empty",
      data: null,
      empty_state: { message: "Dự án chưa có công việc" },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Dự án chưa có công việc")).toBeInTheDocument();
    });
  });

  it("status server Degraded → error state (§16.7, KHÔNG render progress bar)", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Degraded",
      error_state: {
        code: "DASH-ERR-WIDGET-DEGRADED",
        message: "Dữ liệu tạm thời không đầy đủ",
        source_module: "TASK",
        retryable: true,
      },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Dữ liệu tạm thời không đầy đủ")).toBeInTheDocument();
    });
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("status Active → render % hoàn thành + breakdown byStatus + nút Làm mới", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("60%")).toBeInTheDocument();
    });
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
    expect(screen.getByText("Done")).toBeInTheDocument();
    mockGetWidgetData.mockClear();
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    fireEvent.click(screen.getByRole("button", { name: /làm mới/i }));
    await waitFor(() => {
      expect(mockGetWidgetData).toHaveBeenCalledWith(
        "PROJECT_PROGRESS",
        expect.objectContaining({ refresh: true, project_id: "proj-001" }),
      );
    });
  });
});
