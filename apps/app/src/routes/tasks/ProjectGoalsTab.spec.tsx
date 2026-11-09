import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, goalApi, hrApi } from "@mediaos/web-core";
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
      listEmployees: vi.fn(),
      getEmployee: vi.fn(),
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
    vi.mocked(hrApi.listEmployees).mockResolvedValue({
      items: [{ id: "emp-1", fullName: "Trần Thị Bình" }],
      meta: {},
    } as never);
    vi.mocked(hrApi.getEmployee).mockRejectedValue(new Error("nf"));
  });

  it("DENY: thiếu view:goal ⇒ không render, không gọi /goals", () => {
    setCaps({});
    renderTab();
    expect(screen.queryByTestId("project-goals-tab")).not.toBeInTheDocument();
    expect(goalApi.listGoals).not.toHaveBeenCalled();
  });

  it("hiện 2 mục tiêu kèm tiến độ, trạng thái, người phụ trách; gọi /goals với projectId", async () => {
    setCaps({ "view:goal": true, "access:goal": true, "read:employee": true });
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
    setCaps({ "view:goal": true, "access:goal": true });
    vi.mocked(goalApi.listGoals).mockResolvedValue([makeGoal()]);
    renderTab();
    fireEvent.click(await screen.findByTestId("project-goal-open-g-1"));
    expect(nav.navigate).toHaveBeenCalledWith({ to: "/goals/$goalId", params: { goalId: "g-1" } });
  });

  it("rỗng + có create:goal ⇒ «Tạo mục tiêu dự án» mở /goals/new prefill level+projectId", async () => {
    setCaps({ "view:goal": true, "access:goal": true, "create:goal": true });
    vi.mocked(goalApi.listGoals).mockResolvedValue([]);
    renderTab();
    fireEvent.click(await screen.findByTestId("project-goals-create"));
    expect(nav.navigate).toHaveBeenCalledWith({
      to: "/goals/new",
      search: { level: "project", projectId: "proj-1" },
    });
  });

  it("DENY: rỗng + thiếu create:goal ⇒ trạng thái rỗng, KHÔNG có nút tạo", async () => {
    setCaps({ "view:goal": true, "access:goal": true });
    vi.mocked(goalApi.listGoals).mockResolvedValue([]);
    renderTab();
    await waitFor(() => expect(screen.getByText("Dự án chưa có mục tiêu")).toBeInTheDocument());
    expect(screen.queryByTestId("project-goals-create")).not.toBeInTheDocument();
  });

  it("DENY: có view:goal + create:goal nhưng thiếu access:goal ⇒ không render, 0 gọi /goals", () => {
    setCaps({ "view:goal": true, "create:goal": true, "read:employee": true });
    renderTab();
    expect(screen.queryByTestId("project-goals-tab")).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-goals-create")).not.toBeInTheDocument();
    expect(goalApi.listGoals).not.toHaveBeenCalled();
  });

  it("DENY: có access:goal nhưng thiếu view:goal ⇒ không render, 0 gọi /goals", () => {
    setCaps({ "access:goal": true });
    renderTab();
    expect(goalApi.listGoals).not.toHaveBeenCalled();
  });

  it("/goals rỗng ⇒ KHÔNG gọi danh bạ nhân viên", async () => {
    setCaps({ "view:goal": true, "access:goal": true, "read:employee": true });
    vi.mocked(goalApi.listGoals).mockResolvedValue([]);
    renderTab();
    await waitFor(() => expect(screen.getByText("Dự án chưa có mục tiêu")).toBeInTheDocument());
    expect(hrApi.listEmployees).not.toHaveBeenCalled();
  });

  it("/goals lỗi ⇒ KHÔNG gọi danh bạ nhân viên", async () => {
    setCaps({ "view:goal": true, "access:goal": true, "read:employee": true });
    vi.mocked(goalApi.listGoals).mockRejectedValue(new Error("boom"));
    renderTab();
    await screen.findByText("Thử lại");
    expect(hrApi.listEmployees).not.toHaveBeenCalled();
  });

  it("có mục tiêu ⇒ gọi danh bạ đúng 1 lần", async () => {
    setCaps({ "view:goal": true, "access:goal": true, "read:employee": true });
    vi.mocked(goalApi.listGoals).mockResolvedValue([makeGoal()]);
    renderTab();
    await screen.findByText("Trần Thị Bình", { exact: false });
    expect(hrApi.listEmployees).toHaveBeenCalledTimes(1);
  });

  it("API lỗi ⇒ thông báo lỗi + «Thử lại» gọi lại", async () => {
    setCaps({ "view:goal": true, "access:goal": true });
    vi.mocked(goalApi.listGoals).mockRejectedValueOnce(new Error("boom"));
    renderTab();
    await waitFor(() =>
      expect(screen.getByText("Không tải được mục tiêu của dự án")).toBeInTheDocument(),
    );
    vi.mocked(goalApi.listGoals).mockResolvedValue([makeGoal()]);
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(screen.getByText("Tăng lượt xem kênh Q3")).toBeInTheDocument());
  });

  it("loading ⇒ role=status + aria-busy + chữ sr-only cho trình đọc màn hình", () => {
    setCaps({ "view:goal": true, "access:goal": true });
    vi.mocked(goalApi.listGoals).mockReturnValue(new Promise(() => {}));
    renderTab();
    const box = screen.getByTestId("project-goals-loading");
    expect(box).toHaveAttribute("role", "status");
    expect(box).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Đang tải mục tiêu của dự án…")).toHaveClass("sr-only");
  });

  it("owner ngoài trang danh bạ (đã nghỉ / >100 người) ⇒ tra theo id, không hiện «—»", async () => {
    setCaps({ "view:goal": true, "access:goal": true, "read:employee": true });
    vi.mocked(goalApi.listGoals).mockResolvedValue([makeGoal({ ownerEmployeeId: "emp-9" })]);
    vi.mocked(hrApi.getEmployee).mockResolvedValue({ id: "emp-9", fullName: "Lê Văn Cũ" } as never);
    renderTab();
    await waitFor(() => expect(screen.getByText(/Lê Văn Cũ/)).toBeInTheDocument());
    expect(hrApi.getEmployee).toHaveBeenCalledWith("emp-9");
    expect(hrApi.listEmployees).toHaveBeenCalledWith({ pageSize: 100 });
  });

  it("thiếu read:employee ⇒ không tra danh bạ, hiện «—»", async () => {
    setCaps({ "view:goal": true, "access:goal": true });
    vi.mocked(goalApi.listGoals).mockResolvedValue([makeGoal({ ownerEmployeeId: "emp-9" })]);
    renderTab();
    await screen.findByText("Tăng lượt xem kênh Q3");
    expect(hrApi.listEmployees).not.toHaveBeenCalled();
    expect(hrApi.getEmployee).not.toHaveBeenCalled();
  });

  it("đủ trần 200 mục tiêu ⇒ báo danh sách bị cắt, không im lặng", async () => {
    setCaps({ "view:goal": true, "access:goal": true });
    vi.mocked(goalApi.listGoals).mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => makeGoal({ id: "g-" + i })),
    );
    renderTab();
    expect(await screen.findByTestId("project-goals-truncated")).toBeInTheDocument();
  });

  it("dưới trần ⇒ không có cảnh báo cắt", async () => {
    setCaps({ "view:goal": true, "access:goal": true });
    vi.mocked(goalApi.listGoals).mockResolvedValue([makeGoal()]);
    renderTab();
    await screen.findByTestId("project-goals-tab");
    expect(screen.queryByTestId("project-goals-truncated")).not.toBeInTheDocument();
  });
});
