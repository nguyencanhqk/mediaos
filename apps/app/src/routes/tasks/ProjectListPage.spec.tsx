import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
import { taskProjectApi } from "@mediaos/web-core";
import { ProjectListPage } from "./ProjectListPage";
import type { TaskProjectListItemDto } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    // S5-TASK-NAV-TREE-1 — page đọc ?departmentId qua useRouterState + đổi URL qua router.history:
    // test không dựng RouterProvider nên mock cả hai (search rỗng = không filter phòng ban).
    useRouter: () => ({ history: { push: vi.fn(), replace: vi.fn() } }),
    useRouterState: ({
      select,
    }: {
      select: (s: { location: { pathname: string; search: Record<string, unknown> } }) => unknown;
    }) => select({ location: { pathname: "/tasks/projects", search: {} } }),
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskProjectApi: {
      listProjects: vi.fn(),
      deleteProject: vi.fn(),
      createProject: vi.fn(),
    },
    hrApi: {
      listDepartments: vi.fn().mockResolvedValue([]),
      listEmployees: vi.fn().mockResolvedValue({ items: [], meta: {} }),
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const MOCK_ITEMS: TaskProjectListItemDto[] = [
  {
    id: "proj-001",
    companyId: "co-001",
    code: "WEB",
    name: "Website Revamp",
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
  },
];

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ProjectListPage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  // ── DENY-PATH: no read:project ────────────────────────────────────────────
  it("renders forbidden state when user lacks read:project", () => {
    setCapabilities({});
    renderWithQuery(<ProjectListPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(taskProjectApi.listProjects).not.toHaveBeenCalled();
  });

  // ── DENY-PATH: create button hidden without create:project ───────────────
  it("hides 'Tạo dự án' button when user lacks create:project", async () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.listProjects).mockResolvedValue(MOCK_ITEMS);
    renderWithQuery(<ProjectListPage />);
    await waitFor(() => expect(screen.getByText("Website Revamp")).toBeInTheDocument());
    expect(screen.queryByText(/tạo dự án/i)).not.toBeInTheDocument();
  });

  // ── ALLOW-PATH: list renders on success ───────────────────────────────────
  it("renders project list when user has read:project", async () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.listProjects).mockResolvedValue(MOCK_ITEMS);
    renderWithQuery(<ProjectListPage />);
    await waitFor(() => expect(screen.getByText("Website Revamp")).toBeInTheDocument());
    expect(screen.getByText("WEB")).toBeInTheDocument();
    expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument();
    expect(screen.getByText("Phòng Kỹ thuật")).toBeInTheDocument();
  });

  // ── ALLOW-PATH: create button visible with create:project ────────────────
  it("shows 'Tạo dự án' button when user has create:project", async () => {
    setCapabilities({ "read:project": true, "create:project": true });
    vi.mocked(taskProjectApi.listProjects).mockResolvedValue(MOCK_ITEMS);
    renderWithQuery(<ProjectListPage />);
    await waitFor(() => expect(screen.getByText("Website Revamp")).toBeInTheDocument());
    expect(screen.getByText(/tạo dự án/i)).toBeInTheDocument();
  });

  // ── DENY-PATH: delete action hidden without delete:project ───────────────
  it("hides delete action when user lacks delete:project", async () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.listProjects).mockResolvedValue(MOCK_ITEMS);
    renderWithQuery(<ProjectListPage />);
    await waitFor(() => expect(screen.getByText("Website Revamp")).toBeInTheDocument());
    expect(screen.queryByLabelText(/xóa dự án/i)).not.toBeInTheDocument();
  });

  // ── LOADING state ──────────────────────────────────────────────────────────
  it("shows table skeleton while loading", () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.listProjects).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<ProjectListPage />);
    expect(document.querySelector("table")).toBeInTheDocument();
  });

  // ── ERROR state ────────────────────────────────────────────────────────────
  it("shows error state when API call fails", async () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.listProjects).mockRejectedValue(new Error("Network error"));
    renderWithQuery(<ProjectListPage />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải danh sách dự án/i)).toBeInTheDocument(),
    );
  });

  // ── EMPTY state ────────────────────────────────────────────────────────────
  it("shows empty state when list has no results", async () => {
    setCapabilities({ "read:project": true });
    vi.mocked(taskProjectApi.listProjects).mockResolvedValue([]);
    renderWithQuery(<ProjectListPage />);
    await waitFor(() => expect(screen.getByText(/chưa có dự án nào/i)).toBeInTheDocument());
  });
});
