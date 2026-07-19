import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, ApiError } from "@mediaos/web-core";
import { taskProjectApi, taskCoreApi } from "@mediaos/web-core";
import { ProjectDetailPage } from "./ProjectDetailPage";
import type { TaskProjectResponseDto } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
// S5-TASK-WORKSPACE-1 — tab là URL-driven (?tab=) qua useRouterState + router.history.push; test
// không dựng RouterProvider nên mock cả hai (mirror ProjectListPage.spec đợt B). searchRef mutable
// để test deep-link từng tab.
const { searchRef, historyPushMock } = vi.hoisted(() => ({
  searchRef: { current: {} as Record<string, unknown> },
  historyPushMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useRouter: () => ({ history: { push: historyPushMock, replace: vi.fn() } }),
    useRouterState: ({
      select,
    }: {
      select: (s: { location: { pathname: string; search: Record<string, unknown> } }) => unknown;
    }) =>
      select({
        location: { pathname: "/tasks/projects/proj-001", search: searchRef.current },
      }),
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskProjectApi: {
      getProject: vi.fn(),
      listMembers: vi.fn().mockResolvedValue([]),
      closeProject: vi.fn(),
      deleteProject: vi.fn(),
      updateProject: vi.fn(),
      // Tab "Báo cáo" (view-report:project SENSITIVE, useCanExact) — gate riêng nên KHÔNG fetch
      // trừ khi test set cap tường minh.
      getReport: vi.fn(),
    },
    // Tab "Bảng" mount TaskKanbanPage (mock để không gọi mạng thật).
    taskCollabApi: {
      getKanbanBoard: vi.fn().mockResolvedValue({ projectId: "proj-001", columns: [] }),
      moveTask: vi.fn(),
      moveTaskState: vi.fn(),
      // Tab "Hoạt động" (S5-TASK-WORKSPACE-1, TASK-API-601).
      listProjectActivity: vi.fn().mockResolvedValue([]),
    },
    // Tab "Danh sách" (ProjectTaskListTab) — 1 query lớn theo projectId.
    taskCoreApi: {
      listTasks: vi.fn().mockResolvedValue([]),
    },
    hrApi: {
      listDepartments: vi.fn().mockResolvedValue([]),
      listEmployees: vi.fn().mockResolvedValue({ items: [], meta: {} }),
    },
    // S4-FE-DASH-2 — Overview tab nhúng <ProjectProgressWidget> (mock để không gọi mạng thật).
    dashboardApi: {
      getWidgetData: vi.fn().mockResolvedValue({
        widget_code: "PROJECT_PROGRESS",
        widget_type: "Chart",
        status: "Empty",
        data: null,
        empty_state: { message: "Dự án chưa có công việc" },
        error_state: null,
        last_updated_at: null,
        cache: null,
        quick_actions: [],
      }),
    },
  };
});

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const MOCK_PROJECT: TaskProjectResponseDto = {
  id: "proj-001",
  companyId: "co-001",
  code: "WEB",
  name: "Website Revamp",
  description: "Nâng cấp website công ty",
  ownerEmployeeId: "emp-001",
  ownerName: "Nguyễn Văn A",
  departmentId: "dept-001",
  departmentName: "Phòng Kỹ thuật",
  priority: "High",
  status: "Active",
  startDate: "2026-01-01",
  endDate: "2026-06-30",
  memberCount: 3,
  createdBy: "u1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  closedAt: null,
  closedBy: null,
};

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

describe("ProjectDetailPage", () => {
  beforeEach(() => {
    clearCapabilities();
    searchRef.current = {};
    vi.clearAllMocks();
  });

  // ── DENY-PATH: no read:project ────────────────────────────────────────────
  it("renders forbidden state when user lacks read:project", () => {
    setCapabilities({});
    renderWithQuery(<ProjectDetailPage projectId="proj-001" onBack={vi.fn()} />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(taskProjectApi.getProject).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH: overview renders ──────────────────────────────────────────
  it("renders project overview when user has read:project", async () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.getProject).mockResolvedValue(MOCK_PROJECT);
    renderWithQuery(<ProjectDetailPage projectId="proj-001" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Website Revamp")).toBeInTheDocument());
    expect(screen.getByText("Nâng cấp website công ty")).toBeInTheDocument();
    expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument();
  });

  // ── DENY-PATH: edit/close/delete hidden without matching permission ──────
  it("hides edit/close/delete actions without update/close/delete:project", async () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.getProject).mockResolvedValue(MOCK_PROJECT);
    renderWithQuery(<ProjectDetailPage projectId="proj-001" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Website Revamp")).toBeInTheDocument());
    expect(screen.queryByText(/sửa dự án/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/đóng dự án/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/xóa dự án/i)).not.toBeInTheDocument();
  });

  // ── ALLOW-PATH: edit/close/delete visible with permission ────────────────
  it("shows edit/close/delete actions with update/close/delete:project", async () => {
    setCapabilities({
      "read:project": true,
      "update:project": true,
      "close:project": true,
      "delete:project": true,
    });
    vi.mocked(taskProjectApi.getProject).mockResolvedValue(MOCK_PROJECT);
    renderWithQuery(<ProjectDetailPage projectId="proj-001" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Website Revamp")).toBeInTheDocument());
    expect(screen.getByText(/sửa dự án/i)).toBeInTheDocument();
    expect(screen.getByText(/đóng dự án/i)).toBeInTheDocument();
    expect(screen.getByText(/xóa dự án/i)).toBeInTheDocument();
  });

  // ── S5-TASK-WORKSPACE-1: tab bar + gating ─────────────────────────────────
  describe("workspace tab bar", () => {
    it("ẨN tab Báo cáo/Hoạt động khi thiếu cặp EXACT (kể cả wildcard *:*)", async () => {
      setCapabilities({ "read:project": true, "*:*": true });
      vi.mocked(taskProjectApi.getProject).mockResolvedValue(MOCK_PROJECT);
      renderWithQuery(<ProjectDetailPage projectId="proj-001" onBack={vi.fn()} />);
      await waitFor(() => expect(screen.getByText("Website Revamp")).toBeInTheDocument());

      expect(screen.getByTestId("workspace-tab-overview")).toBeInTheDocument();
      expect(screen.getByTestId("workspace-tab-board")).toBeInTheDocument();
      expect(screen.getByTestId("workspace-tab-list")).toBeInTheDocument();
      expect(screen.getByTestId("workspace-tab-members")).toBeInTheDocument();
      expect(screen.queryByTestId("workspace-tab-report")).not.toBeInTheDocument();
      expect(screen.queryByTestId("workspace-tab-activity")).not.toBeInTheDocument();
    });

    it("hiện tab Báo cáo/Hoạt động khi có đúng cặp sensitive", async () => {
      setCapabilities({
        "read:project": true,
        "view-report:project": true,
        "view:task-audit-log": true,
      });
      vi.mocked(taskProjectApi.getProject).mockResolvedValue(MOCK_PROJECT);
      renderWithQuery(<ProjectDetailPage projectId="proj-001" onBack={vi.fn()} />);
      await waitFor(() => expect(screen.getByText("Website Revamp")).toBeInTheDocument());
      expect(screen.getByTestId("workspace-tab-report")).toBeInTheDocument();
      expect(screen.getByTestId("workspace-tab-activity")).toBeInTheDocument();
    });

    it("click tab đẩy URL qua history.push (?tab=list) — back/forward đi qua tab", async () => {
      setCapabilities({ "read:project": true });
      vi.mocked(taskProjectApi.getProject).mockResolvedValue(MOCK_PROJECT);
      const client = makeQueryClient();
      const makeUi = () => (
        <QueryClientProvider client={client}>
          <ProjectDetailPage projectId="proj-001" onBack={vi.fn()} />
        </QueryClientProvider>
      );
      const { rerender } = render(makeUi());
      await waitFor(() => expect(screen.getByText("Website Revamp")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("workspace-tab-list"));
      expect(historyPushMock).toHaveBeenCalledWith("/tasks/projects/proj-001?tab=list");

      // Về overview → URL sạch (không ?tab=overview thừa). Mock router không tự re-render nên
      // mutate searchRef + rerender (element MỚI — element cũ === bị React bail-out) để component
      // thấy tab hiện tại = list trước khi click.
      searchRef.current = { tab: "list" };
      rerender(makeUi());
      fireEvent.click(screen.getByTestId("workspace-tab-overview"));
      expect(historyPushMock).toHaveBeenCalledWith("/tasks/projects/proj-001");
    });

    it("deep-link ?tab=board render board + toolbar chung", async () => {
      setCapabilities({ "read:project": true, "view-kanban:task": true });
      vi.mocked(taskProjectApi.getProject).mockResolvedValue(MOCK_PROJECT);
      searchRef.current = { tab: "board" };
      renderWithQuery(<ProjectDetailPage projectId="proj-001" onBack={vi.fn()} />);
      await waitFor(() => expect(screen.getByText("Website Revamp")).toBeInTheDocument());
      expect(screen.getByTestId("workspace-toolbar")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText(/chưa có công việc nào/i)).toBeInTheDocument());
    });

    it("tab overview (mặc định) KHÔNG render toolbar lọc", async () => {
      setCapabilities({ "read:project": true });
      vi.mocked(taskProjectApi.getProject).mockResolvedValue(MOCK_PROJECT);
      renderWithQuery(<ProjectDetailPage projectId="proj-001" onBack={vi.fn()} />);
      await waitFor(() => expect(screen.getByText("Website Revamp")).toBeInTheDocument());
      expect(screen.queryByTestId("workspace-toolbar")).not.toBeInTheDocument();
    });

    it("deep-link ?tab=members tải danh sách thành viên", async () => {
      setCapabilities({ "read:project": true });
      vi.mocked(taskProjectApi.getProject).mockResolvedValue(MOCK_PROJECT);
      searchRef.current = { tab: "members" };
      renderWithQuery(<ProjectDetailPage projectId="proj-001" onBack={vi.fn()} />);
      await waitFor(() => expect(taskProjectApi.listMembers).toHaveBeenCalledWith("proj-001"));
    });

    it("deep-link ?tab=report KHÔNG có quyền → forbidden của content, KHÔNG fetch report", async () => {
      setCapabilities({ "read:project": true });
      vi.mocked(taskProjectApi.getProject).mockResolvedValue(MOCK_PROJECT);
      searchRef.current = { tab: "report" };
      renderWithQuery(<ProjectDetailPage projectId="proj-001" onBack={vi.fn()} />);
      await waitFor(() => expect(screen.getByText("Website Revamp")).toBeInTheDocument());
      expect(
        screen.getByText(/không có quyền xem báo cáo tiến độ của dự án này/i),
      ).toBeInTheDocument();
      expect(taskProjectApi.getReport).not.toHaveBeenCalled();
    });

    it("deep-link ?tab=activity với quyền → tải feed dự án", async () => {
      setCapabilities({ "read:project": true, "view:task-audit-log": true });
      vi.mocked(taskProjectApi.getProject).mockResolvedValue(MOCK_PROJECT);
      searchRef.current = { tab: "activity" };
      renderWithQuery(<ProjectDetailPage projectId="proj-001" onBack={vi.fn()} />);
      await waitFor(() =>
        expect(screen.getByText(/dự án chưa có hoạt động nào/i)).toBeInTheDocument(),
      );
    });
  });

  // ── S5-TASK-WORKSPACE-1: toolbar chung giữ filter khi đổi tab Bảng↔Danh sách ──
  it("giữ nguyên giá trị bộ lọc toolbar khi chuyển tab Bảng → Danh sách", async () => {
    setCapabilities({ "read:project": true, "view-kanban:task": true, "read:task": true });
    vi.mocked(taskProjectApi.getProject).mockResolvedValue(MOCK_PROJECT);
    searchRef.current = { tab: "board" };
    const client = makeQueryClient();
    const makeUi = () => (
      <QueryClientProvider client={client}>
        <ProjectDetailPage projectId="proj-001" onBack={vi.fn()} />
      </QueryClientProvider>
    );
    const { rerender } = render(makeUi());
    await waitFor(() => expect(screen.getByText("Website Revamp")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("workspace-search"), { target: { value: "hop dong" } });
    expect(screen.getByTestId("workspace-search")).toHaveValue("hop dong");

    // Đổi tab (URL đổi) — vỏ vẫn mounted nên state filter giữ nguyên (element MỚI khi rerender,
    // element cũ === bị React bail-out).
    searchRef.current = { tab: "list" };
    rerender(makeUi());
    // Tab Danh sách thật sự mount (query list bắn) và ô tìm kiếm GIỮ nguyên giá trị.
    await waitFor(() => expect(vi.mocked(taskCoreApi.listTasks)).toHaveBeenCalled());
    expect(screen.getByTestId("workspace-search")).toHaveValue("hop dong");
  });

  // ── NOT FOUND (404) ────────────────────────────────────────────────────────
  it("shows not-found state on 404", async () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.getProject).mockRejectedValue(
      new ApiError({ status: 404, code: "NOT_FOUND", message: "not found" }),
    );
    renderWithQuery(<ProjectDetailPage projectId="proj-001" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/không tìm thấy dự án/i)).toBeInTheDocument());
  });

  // ── ERROR state (non-404) ─────────────────────────────────────────────────
  it("shows error state with retry on generic failure", async () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.getProject).mockRejectedValue(new Error("Network error"));
    renderWithQuery(<ProjectDetailPage projectId="proj-001" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/không thể tải dự án/i)).toBeInTheDocument());
  });
});
