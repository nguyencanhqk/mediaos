import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, goalApi } from "@mediaos/web-core";
import type { GoalCoreResponseDto } from "@mediaos/contracts";
import { ProjectGoalsTab } from "./ProjectGoalsTab";

const nav = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => nav.navigate };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    goalApi: { listGoals: vi.fn() },
    hrApi: {
      listEmployees: vi.fn().mockResolvedValue({
        items: [{ id: "emp-1", fullName: "Trần Thị Bình" }],
        meta: {},
      }),
    },
  };
});

function makeGoal(overrides: Partial<GoalCoreResponseDto> = {}): GoalCoreResponseDto {
  return {
    id: "g-1",
    companyId: "co-1",
    goalCode: "GOAL-0007",
    name: "Tăng lượt xem kênh Q3",
    description: null,
    level: "project",
    departmentId: null,
    projectId: "proj-1",
    employeeId: null,
    parentGoalId: null,
    ownerEmployeeId: "emp-1",
    periodType: "quarter",
    periodStart: "2026-07-01",
    periodEnd: "2026-09-30",
    measureType: "percent",
    targetValue: null,
    currentValue: null,
    unit: null,
    progressMode: "tasks",
    progressPercent: 62,
    weight: 1,
    status: "Active",
    finalizedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "t@demo.local",
      fullName: "T",
      status: "Active",
      companyId: "co-1",
    },
  });
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectGoalsTab projectId="proj-1" />
    </QueryClientProvider>,
  );
}

describe("ProjectGoalsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  });

  it("DENY: thiếu view:goal ⇒ không render, không gọi /goals", () => {
    setCaps({});
    renderTab();
    expect(screen.queryByTestId("project-goals-tab")).not.toBeInTheDocument();
    expect(goalApi.listGoals).not.toHaveBeenCalled();
  });

  it("hiện 2 mục tiêu kèm tiến độ, trạng thái, người phụ trách; gọi /goals với projectId", async () => {
    setCaps({ "view:goal": true, "read:employee": true });
    vi.mocked(goalApi.listGoals).mockResolvedValue([
      makeGoal(),
      makeGoal({
        id: "g-2",
        goalCode: "GOAL-0012",
        name: "Ra mắt series mới",
        progressPercent: null,
      }),
    ]);
    renderTab();
    await waitFor(() => expect(screen.getByText("Tăng lượt xem kênh Q3")).toBeInTheDocument());
    expect(goalApi.listGoals).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-1" }),
    );
    expect(screen.getByText("Ra mắt series mới")).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getAllByText("Đang chạy")).toHaveLength(2);
    await waitFor(() => expect(screen.getAllByText(/Trần Thị Bình/)).toHaveLength(2));
    // «chưa đo» ≠ 0%: mục tiêu null không vẽ thanh tiến độ.
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
  });

  it("bấm mục tiêu ⇒ mở /goals/:id", async () => {
    setCaps({ "view:goal": true });
    vi.mocked(goalApi.listGoals).mockResolvedValue([makeGoal()]);
    renderTab();
    fireEvent.click(await screen.findByTestId("project-goal-open-g-1"));
    expect(nav.navigate).toHaveBeenCalledWith({ to: "/goals/$goalId", params: { goalId: "g-1" } });
  });

  it("rỗng + có create:goal ⇒ «Tạo mục tiêu dự án» mở /goals/new prefill level+projectId", async () => {
    setCaps({ "view:goal": true, "create:goal": true });
    vi.mocked(goalApi.listGoals).mockResolvedValue([]);
    renderTab();
    fireEvent.click(await screen.findByTestId("project-goals-create"));
    expect(nav.navigate).toHaveBeenCalledWith({
      to: "/goals/new",
      search: { level: "project", projectId: "proj-1" },
    });
  });

  it("DENY: rỗng + thiếu create:goal ⇒ trạng thái rỗng, KHÔNG có nút tạo", async () => {
    setCaps({ "view:goal": true });
    vi.mocked(goalApi.listGoals).mockResolvedValue([]);
    renderTab();
    await waitFor(() => expect(screen.getByText("Dự án chưa có mục tiêu")).toBeInTheDocument());
    expect(screen.queryByTestId("project-goals-create")).not.toBeInTheDocument();
  });

  it("API lỗi ⇒ thông báo lỗi + «Thử lại» gọi lại", async () => {
    setCaps({ "view:goal": true });
    vi.mocked(goalApi.listGoals).mockRejectedValueOnce(new Error("boom"));
    renderTab();
    await waitFor(() =>
      expect(screen.getByText("Không tải được mục tiêu của dự án")).toBeInTheDocument(),
    );
    vi.mocked(goalApi.listGoals).mockResolvedValue([makeGoal()]);
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(screen.getByText("Tăng lượt xem kênh Q3")).toBeInTheDocument());
  });
});
