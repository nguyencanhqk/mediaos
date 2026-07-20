import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskProjectApi } from "@mediaos/web-core";
import { ProjectReportPage } from "./ProjectReportPage";
import type { ProjectReportDto } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks — taskProjectApi.getReport / getProject. useCanExact GIỮ THẬT (đọc auth store).
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskProjectApi: {
      getReport: vi.fn(),
      getProject: vi.fn().mockResolvedValue({ id: "p-1", name: "Dự án Alpha" }),
    },
  };
});

const REPORT: ProjectReportDto = {
  projectId: "p-1",
  countsByStatus: { Todo: 3, "In Progress": 2, "In Review": 1, Done: 4, Cancelled: 1 },
  overdueCount: 2,
  assigneeWorkload: [{ employeeId: "e-1", employeeName: "Nguyễn Văn A", activeCount: 5 }],
};

const EMPTY_REPORT: ProjectReportDto = {
  projectId: "p-1",
  countsByStatus: { Todo: 0, "In Progress": 0, "In Review": 0, Done: 0, Cancelled: 0 },
  overdueCount: 0,
  assigneeWorkload: [],
};

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ProjectReportPage projectId="p-1" onBack={vi.fn()} />
    </QueryClientProvider>,
  );
}

function setCapabilities(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "test@demo.local",
      fullName: "Test User",
      status: "Active",
      companyId: "co-001",
    },
  });
}

function clearCapabilities() {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
}

describe("ProjectReportPage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  it("fail-closed: wildcard *:* does NOT open the sensitive report (needs EXACT view-report:project)", () => {
    setCapabilities({ "*:*": true, "read:project": true });
    renderPage();
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(taskProjectApi.getReport).not.toHaveBeenCalled();
  });

  it("renders KPI tiles with correct totals when granted EXACT view-report:project", async () => {
    setCapabilities({ "view-report:project": true, "read:project": true });
    vi.mocked(taskProjectApi.getReport).mockResolvedValue(REPORT);
    renderPage();

    await waitFor(() => expect(screen.getByText("Dự án Alpha")).toBeInTheDocument());
    // Scope trong dải KPI ("Hoàn thành" cũng là nhãn status Done ở breakdown → cần scope).
    const kpi = within(screen.getByTestId("project-report-kpi"));
    // Tổng = Σ status = 11 · Hoàn thành = 4 · Chưa hoàn thành = 3+2+1 = 6 · Quá hạn = 2
    expect(kpi.getByText("Tổng công việc").closest("div")).toHaveTextContent("11");
    expect(kpi.getByText("Hoàn thành").closest("div")).toHaveTextContent("4");
    expect(kpi.getByText("Chưa hoàn thành").closest("div")).toHaveTextContent("6");
    expect(kpi.getByText("Quá hạn").closest("div")).toHaveTextContent("2");
    // Bar tải công việc theo người phụ trách.
    expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument();
    expect(screen.getByText(/5 việc đang làm/i)).toBeInTheDocument();
  });

  // S5-TASK-SUBTASK-1 (D-34/D-37/D-40) — ghi chú BẮT BUỘC: đếm-lá có thể khác danh sách + người chỉ
  // ôm việc cha có thể hiện 0 trong biểu đồ tải.
  it("renders the leaf-counting note (D-34) below the KPI tiles", async () => {
    setCapabilities({ "view-report:project": true, "read:project": true });
    vi.mocked(taskProjectApi.getReport).mockResolvedValue(REPORT);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("project-report-leaf-counting-note")).toBeInTheDocument(),
    );
    expect(screen.getByText(/được tính theo việc con/i)).toBeInTheDocument();
  });

  it("shows empty state when the project has no tasks", async () => {
    setCapabilities({ "view-report:project": true });
    vi.mocked(taskProjectApi.getReport).mockResolvedValue(EMPTY_REPORT);
    renderPage();
    await waitFor(() => expect(screen.getByText(/chưa có công việc nào/i)).toBeInTheDocument());
  });

  it("shows error state when the report fetch fails", async () => {
    setCapabilities({ "view-report:project": true });
    vi.mocked(taskProjectApi.getReport).mockRejectedValue(new Error("boom"));
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/không thể tải báo cáo dự án/i)).toBeInTheDocument(),
    );
  });
});
