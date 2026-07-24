/**
 * S5-GOAL-FE-1 — GoalListPage (GOAL-SCREEN-001). Trạng thái UI + gate:
 *  (a) không view:goal → forbidden (nội dung ẩn).
 *  (b) tree: loading → data (tên goal + tiến độ).
 *  (c) tree rỗng → empty state.
 *  (d) nút "Tạo mục tiêu" gate create:goal (anti-false-green: useCan gọi ĐÚNG cặp).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => true),
  goalApi: { listGoals: vi.fn(), getTree: vi.fn() },
  goalKeys: {
    list: (p?: unknown) => ["goals", "list", p],
    tree: (p?: unknown) => ["goals", "tree", p],
    detail: (id: string) => ["goals", "detail", id],
  },
  hrApi: { listDepartments: vi.fn(), listEmployees: vi.fn() },
  hrKeys: {
    departments: { list: (p?: unknown) => ["hr", "departments", "list", p] },
    employees: { list: (p?: unknown) => ["hr", "employees", "list", p] },
  },
}));

import { useCan, goalApi, hrApi } from "@mediaos/web-core";
import { GoalListPage } from "./GoalListPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockListGoals = goalApi.listGoals as ReturnType<typeof vi.fn>;
const mockGetTree = goalApi.getTree as ReturnType<typeof vi.fn>;
const mockListDepartments = hrApi.listDepartments as ReturnType<typeof vi.fn>;
const mockListEmployees = hrApi.listEmployees as ReturnType<typeof vi.fn>;

const TREE_NODE = {
  id: "g-1",
  companyId: "co-1",
  goalCode: "GOAL-0001",
  name: "Tăng doanh thu 20%",
  description: null,
  level: "department",
  departmentId: "dept-1",
  projectId: null,
  employeeId: null,
  parentGoalId: null,
  ownerEmployeeId: "emp-1",
  periodType: "quarter",
  periodStart: "2026-01-01",
  periodEnd: "2026-03-31",
  measureType: "percent",
  targetValue: 20,
  currentValue: 8,
  unit: "%",
  progressMode: "manual",
  progressPercent: 40,
  weight: 1,
  status: "Active",
  finalizedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  children: [],
};

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function renderPage() {
  return render(
    <QueryClientProvider client={buildQC()}>
      <I18nextProvider i18n={i18n}>
        <GoalListPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockReturnValue(true);
  mockListGoals.mockResolvedValue([]);
  mockGetTree.mockResolvedValue([TREE_NODE]);
  mockListDepartments.mockResolvedValue([]);
  mockListEmployees.mockResolvedValue({ items: [], meta: {} });
});

describe("GoalListPage — gate view:goal", () => {
  it("(a) không view:goal → forbidden, KHÔNG gọi list/tree", async () => {
    mockUseCan.mockImplementation(
      (action: string, resource: string) => !(resource === "goal" && action === "view"),
    );
    renderPage();
    expect(screen.getByText("Bạn không có quyền xem mục tiêu")).toBeInTheDocument();
    expect(mockGetTree).not.toHaveBeenCalled();
    expect(mockListGoals).not.toHaveBeenCalled();
  });
});

describe("GoalListPage — tree view (mặc định)", () => {
  it("(b) loading → data: hiện tên goal + %", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(mockGetTree).toHaveBeenCalled();
  });

  it("(c) tree rỗng → empty state", async () => {
    mockGetTree.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Chưa có mục tiêu kỳ này")).toBeInTheDocument());
  });
});

describe("GoalListPage — nút Tạo gate create:goal", () => {
  it("(d) có create:goal → nút hiện; useCan gọi đúng cặp", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());
    expect(screen.getAllByText("Tạo mục tiêu").length).toBeGreaterThan(0);
    expect(mockUseCan).toHaveBeenCalledWith("create", "goal");
    expect(mockUseCan).toHaveBeenCalledWith("view", "goal");
  });

  it("(d) không create:goal → nút Tạo ẩn", async () => {
    mockUseCan.mockImplementation(
      (action: string, resource: string) => !(resource === "goal" && action === "create"),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());
    expect(screen.queryByText("Tạo mục tiêu")).not.toBeInTheDocument();
  });
});
