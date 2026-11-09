import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi, taskStatesApi } from "@mediaos/web-core";
import { ProjectTaskListTab } from "./ProjectTaskListTab";
import { DEFAULT_WORKSPACE_FILTERS, type WorkspaceTaskFilters } from "./workspace-constants";
import type { TaskCoreResponseDto } from "@mediaos/contracts";

// S5-TASK-WORKSPACE-1 — tab "Danh sách" workspace dự án: 1 query lớn theo projectId, lọc/sắp
// CLIENT-SIDE qua cùng helper với tab Bảng; rail avatar multi-select; tuỳ chỉnh cột hiển thị.

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: {
      listTasks: vi.fn(),
      assign: vi.fn(),
    },
    taskStatesApi: { listStates: vi.fn() },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function makeTask(overrides: Partial<TaskCoreResponseDto>): TaskCoreResponseDto {
  return {
    id: "task-001",
    companyId: "co-001",
    title: "Chuẩn bị báo cáo tuần",
    description: null,
    taskType: "office",
    status: "Todo",
    priority: "Medium",
    projectId: "proj-001",
    projectName: "Dự án A",
    mainAssigneeEmployeeId: "emp-001",
    assigneeName: "Nguyễn Văn A",
    creatorUserId: "u1",
    creatorName: "Test User",
    reporterEmployeeId: null,
    departmentId: null,
    dueAt: null,
    startAt: null,
    completedAt: null,
    isOverdue: false,
    createdBy: "u1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

const TASKS: TaskCoreResponseDto[] = [
  makeTask({}),
  makeTask({
    id: "task-002",
    title: "Soạn thảo hợp đồng",
    status: "In Progress",
    priority: "Urgent",
    mainAssigneeEmployeeId: "emp-002",
    assigneeName: "Trần Thị B",
    dueAt: "2026-07-25T00:00:00.000Z",
  }),
  makeTask({
    id: "task-003",
    title: "Việc chưa có người nhận",
    mainAssigneeEmployeeId: null,
    assigneeName: null,
    dueAt: "2026-07-20T00:00:00.000Z",
  }),
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

/** Harness giữ selection state như vỏ workspace thật. */
function ListHarness({ filters = DEFAULT_WORKSPACE_FILTERS }: { filters?: WorkspaceTaskFilters }) {
  const [selection, setSelection] = React.useState<ReadonlySet<string>>(new Set());
  const toggle = (value: string) =>
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  return (
    <ProjectTaskListTab
      projectId="proj-001"
      filters={filters}
      assigneeSelection={selection}
      onToggleAssignee={toggle}
      onClearAssignees={() => setSelection(new Set())}
    />
  );
}

describe("ProjectTaskListTab", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
  });

  // ── DENY-PATH: thiếu read:task → forbidden, không fetch ─────────────────────
  it("renders forbidden without read:task and never fetches", () => {
    setCapabilities({});
    renderWithQuery(<ListHarness />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(taskCoreApi.listTasks).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH: 1 query lớn theo projectId + cột "Dự án" ẩn mặc định ────────
  it("fetches one big page scoped to the project and hides the project column by default", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue(TASKS);
    renderWithQuery(<ListHarness />);
    await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());

    expect(taskCoreApi.listTasks).toHaveBeenCalledWith({
      projectId: "proj-001",
      limit: 200,
      offset: 0,
      parentOnly: true,
    });
    // Cột "Dự án" ẩn mặc định (workspace 1 dự án) — không render tên dự án.
    expect(screen.queryByText("Dự án A")).not.toBeInTheDocument();
  });

  it("bật lại cột Dự án qua menu 'Hiển thị' (tuỳ chỉnh hiển thị)", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue(TASKS);
    renderWithQuery(<ListHarness />);
    await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("list-columns-toggle"));
    fireEvent.click(screen.getByTestId("list-column-checkbox-projectName"));
    await waitFor(() => expect(screen.getAllByText("Dự án A").length).toBeGreaterThan(0));
  });

  // ── Toolbar filters (props) áp client-side ──────────────────────────────────
  it("áp filters từ toolbar chung: q không dấu + status", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue(TASKS);
    renderWithQuery(<ListHarness filters={{ ...DEFAULT_WORKSPACE_FILTERS, q: "hop dong" }} />);
    await waitFor(() => expect(screen.getByText("Soạn thảo hợp đồng")).toBeInTheDocument());
    expect(screen.queryByText("Chuẩn bị báo cáo tuần")).not.toBeInTheDocument();
    expect(screen.queryByText("Việc chưa có người nhận")).not.toBeInTheDocument();
  });

  // ── Sắp xếp client-side ─────────────────────────────────────────────────────
  it("sắp xếp dueAsc — deadline gần lên đầu, null xuống cuối", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue(TASKS);
    renderWithQuery(<ListHarness filters={{ ...DEFAULT_WORKSPACE_FILTERS, sort: "dueAsc" }} />);
    await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());

    const rows = screen.getAllByRole("row").slice(1); // bỏ header
    const titles = rows.map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(titles).toEqual([
      "Việc chưa có người nhận",
      "Soạn thảo hợp đồng",
      "Chuẩn bị báo cáo tuần",
    ]);
  });

  // ── Rail avatar multi-select + đếm ──────────────────────────────────────────
  it("rail lọc multi-select + 'Chưa giao', đếm đúng theo tập đã lọc toolbar", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue(TASKS);
    renderWithQuery(<ListHarness />);
    await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());

    expect(screen.getByTestId("assignee-rail-count-emp-001")).toHaveTextContent("1");
    expect(screen.getByTestId("assignee-rail-count-unassigned")).toHaveTextContent("1");

    fireEvent.click(screen.getByTestId("assignee-rail-item-emp-002"));
    await waitFor(() =>
      expect(screen.queryByText("Chuẩn bị báo cáo tuần")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Soạn thảo hợp đồng")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("assignee-rail-unassigned"));
    await waitFor(() => expect(screen.getByText("Việc chưa có người nhận")).toBeInTheDocument());
    expect(screen.getByText("Soạn thảo hợp đồng")).toBeInTheDocument();
    // Đếm của người KHÁC không triệt tiêu khi đang lọc.
    expect(screen.getByTestId("assignee-rail-count-emp-001")).toHaveTextContent("1");
  });

  // ── EMPTY sau lọc ───────────────────────────────────────────────────────────
  it("shows workspace empty state when filters match nothing", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue(TASKS);
    renderWithQuery(
      <ListHarness filters={{ ...DEFAULT_WORKSPACE_FILTERS, q: "không tồn tại xyz" }} />,
    );
    await waitFor(() =>
      expect(screen.getByText(/không có công việc nào khớp bộ lọc/i)).toBeInTheDocument(),
    );
  });

  // ── ERROR + retry ───────────────────────────────────────────────────────────
  it("shows error state with retry on load failure", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockRejectedValueOnce(new Error("network"));
    renderWithQuery(<ListHarness />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải danh sách công việc/i)).toBeInTheDocument(),
    );
    vi.mocked(taskCoreApi.listTasks).mockResolvedValueOnce(TASKS);
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());
  });

  // ── S20-TASK-BULKACTIONS-1 — chọn nhiều việc + thanh hành động ─────────────
  describe("chọn nhiều việc (S20-TASK-BULKACTIONS-1)", () => {
    const STATE_ID = "22222222-2222-4222-8222-222222222222";

    beforeEach(() => {
      vi.mocked(taskCoreApi.listTasks).mockResolvedValue(TASKS);
      vi.mocked(taskStatesApi.listStates).mockResolvedValue([
        { id: STATE_ID, name: "Đang làm" } as never,
      ]);
    });

    it("không có quyền hành động nào ⇒ không có cột chọn, không có thanh", async () => {
      setCapabilities({ "read:task": true });
      renderWithQuery(<ListHarness />);
      await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());
      expect(screen.queryAllByRole("checkbox", { name: /chọn việc/i })).toHaveLength(0);
      expect(screen.queryByTestId("task-bulk-bar")).not.toBeInTheDocument();
    });

    it("chưa chọn ⇒ thanh ẩn; chọn 2 dòng ⇒ thanh hiện «Đã chọn 2 việc» + Chuyển cột (dự án pipeline)", async () => {
      setCapabilities({ "read:task": true, "update-state:task": true });
      renderWithQuery(<ListHarness />);
      await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());
      expect(screen.queryByTestId("task-bulk-bar")).not.toBeInTheDocument();
      await waitFor(() => expect(taskStatesApi.listStates).toHaveBeenCalledWith("proj-001"));
      fireEvent.click(screen.getByRole("checkbox", { name: "Chọn việc Soạn thảo hợp đồng" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "Chọn việc Chuẩn bị báo cáo tuần" }));
      expect(screen.getByTestId("task-bulk-count")).toHaveTextContent("Đã chọn 2 việc");
      expect(await screen.findByTestId("bulk-move-state")).toBeInTheDocument();
      expect(screen.queryByTestId("bulk-assign")).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("task-bulk-clear"));
      expect(screen.queryByTestId("task-bulk-bar")).not.toBeInTheDocument();
    });

    it("dự án không có cột pipeline ⇒ không có «Chuyển cột»", async () => {
      setCapabilities({ "read:task": true, "update-state:task": true, "update-status:task": true });
      vi.mocked(taskStatesApi.listStates).mockResolvedValue([]);
      renderWithQuery(<ListHarness />);
      await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());
      await waitFor(() => expect(taskStatesApi.listStates).toHaveBeenCalled());
      fireEvent.click(screen.getByRole("checkbox", { name: "Chọn việc Soạn thảo hợp đồng" }));
      expect(screen.getByTestId("bulk-status")).toBeInTheDocument();
      expect(screen.queryByTestId("bulk-move-state")).not.toBeInTheDocument();
    });

    it("chọn tất cả (đầu bảng) ⇒ đếm đủ số việc đang hiện", async () => {
      setCapabilities({ "read:task": true, "update-status:task": true });
      renderWithQuery(<ListHarness />);
      await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("checkbox", { name: "Chọn tất cả việc đang hiện" }));
      expect(screen.getByTestId("task-bulk-count")).toHaveTextContent("Đã chọn 3 việc");
    });
  });
});
