import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, ApiError } from "@mediaos/web-core";
import { taskProjectApi } from "@mediaos/web-core";
import { ProjectDetailPage } from "./ProjectDetailPage";
import type { TaskProjectResponseDto } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
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
    },
    // S4-FE-TASK-3 — tab "Kanban" mount TaskKanbanPage (mock để không gọi mạng thật).
    taskCollabApi: {
      getKanbanBoard: vi.fn().mockResolvedValue({ projectId: "proj-001", columns: [] }),
      moveTask: vi.fn(),
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

  // ── Tab switch: members ────────────────────────────────────────────────────
  it("switches to members tab and loads member list", async () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.getProject).mockResolvedValue(MOCK_PROJECT);
    renderWithQuery(<ProjectDetailPage projectId="proj-001" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Website Revamp")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Thành viên" }));
    await waitFor(() => expect(taskProjectApi.listMembers).toHaveBeenCalledWith("proj-001"));
  });

  // ── Tab switch: kanban (S4-FE-TASK-3) ──────────────────────────────────────
  it("switches to kanban tab and loads the board", async () => {
    setCapabilities({ "read:project": true, "view-kanban:task": true });
    vi.mocked(taskProjectApi.getProject).mockResolvedValue(MOCK_PROJECT);
    renderWithQuery(<ProjectDetailPage projectId="proj-001" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Website Revamp")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));
    await waitFor(() => expect(screen.getByText(/chưa có công việc nào/i)).toBeInTheDocument());
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
