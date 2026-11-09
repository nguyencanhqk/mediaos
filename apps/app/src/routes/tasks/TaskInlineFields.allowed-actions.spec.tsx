import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ApiError,
  useAuthStore,
  taskCoreApi,
  taskCollabApi,
  taskStatesApi,
  taskKeys,
} from "@mediaos/web-core";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import {
  TaskAssigneeField,
  TaskAssigneeDeadlineFields,
  TaskPriorityField,
  TaskStateField,
  TaskStatusField,
} from "./TaskInlineFields";

/**
 * S20-TASK-ALLOWEDACTIONS-1 — FE khoá ô theo `allowedActions` của server (server THẮNG khi có trường);
 * thiếu trường ⇒ quay về `useCan` (spec TaskInlineFields.spec.tsx giữ nguyên xanh). Làm mới cache chi tiết
 * sau thao tác đổi vòng đời/phạm vi (Q10). KHÔNG phải cổng an ninh — quyền bị thu hồi ⇒ server 403, rollback.
 */
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: {
      assign: vi.fn(),
      changeStatus: vi.fn(),
      changePriority: vi.fn(),
      changeDeadline: vi.fn(),
      updateTask: vi.fn(),
    },
    taskCollabApi: { moveTaskState: vi.fn() },
    taskStatesApi: { listStates: vi.fn() },
    hrApi: {
      listEmployees: vi.fn().mockResolvedValue({
        items: [
          { id: "emp-001", fullName: "Nguyễn Văn A" },
          { id: "emp-002", fullName: "Trần Thị B" },
        ],
        meta: {},
      }),
    },
  };
});

let client: QueryClient;
function renderWithQuery(ui: React.ReactElement) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
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

const BASE = {
  id: "task-001",
  title: "Việc thử",
  status: "Todo",
  priority: "Medium",
  dueAt: null,
  mainAssigneeEmployeeId: "emp-001",
  assigneeName: "Nguyễn Văn A",
} as unknown as TaskCoreResponseDto;

const WATCHER_ACTIONS = {
  changeStatus: false,
  changeState: false,
  changeDeadline: false,
  changePriority: false,
  assign: false,
  edit: false,
  delete: false,
  lockReason: "watcher",
} as const;

const withActions = (a: TaskCoreResponseDto["allowedActions"], extra = {}) =>
  ({ ...BASE, ...extra, allowedActions: a }) as TaskCoreResponseDto;

describe("allowedActions — khoá ô theo server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  });

  it("F1 · changeStatus:true dù useCan false ⇒ badge bấm được", () => {
    setCapabilities({});
    renderWithQuery(<TaskStatusField task={withActions({ changeStatus: true })} />);
    expect(screen.getByTestId("task-status-select")).toBeInTheDocument();
  });

  it("F2 · người chỉ theo dõi (khoá false, useCan true): ô chỉ đọc + lý do", () => {
    setCapabilities({
      "update-status:task": true,
      "update-priority:task": true,
      "update-deadline:task": true,
      "assign:task": true,
    });
    const task = withActions(WATCHER_ACTIONS);
    const { container } = renderWithQuery(
      <>
        <TaskStatusField task={task} />
        <TaskPriorityField task={task} />
        <TaskAssigneeDeadlineFields task={task} />
      </>,
    );
    expect(screen.queryByTestId("task-status-select")).not.toBeInTheDocument();
    expect(screen.queryByTestId("task-priority-select")).not.toBeInTheDocument();
    expect(document.getElementById("task-deadline-input")).toBeNull();
    expect(container.textContent).toContain("Bạn chỉ theo dõi việc này");
  });

  it("F3 · không có trường allowedActions ⇒ hành vi useCan cũ, không thêm lời lý do", () => {
    setCapabilities({});
    const { container } = renderWithQuery(<TaskStatusField task={BASE} />);
    expect(screen.queryByTestId("task-status-select")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("theo dõi");
  });

  it("F3b · khoá thiếu trong allowedActions ⇒ riêng khoá đó quay về useCan", () => {
    setCapabilities({ "update-priority:task": true });
    renderWithQuery(<TaskPriorityField task={withActions({ changeStatus: false })} />);
    expect(screen.getByTestId("task-priority-select")).toBeInTheDocument();
  });

  it("F4 · changeStatus:true nhưng server 403 ⇒ cache về giá trị cũ", async () => {
    setCapabilities({});
    vi.mocked(taskCoreApi.changeStatus).mockRejectedValue(
      new ApiError(403, "AUTH-ERR-FORBIDDEN", "Permission denied"),
    );
    const task = withActions({ changeStatus: true });
    renderWithQuery(<TaskStatusField task={task} />);
    client.setQueryData(taskKeys.detail(task.id), task);

    fireEvent.click(screen.getByTestId("task-status-select"));
    fireEvent.click(screen.getByRole("option", { name: /hoàn thành/i }));
    await waitFor(() => expect(taskCoreApi.changeStatus).toHaveBeenCalled());
    await waitFor(() =>
      expect(client.getQueryData<TaskCoreResponseDto>(taskKeys.detail(task.id))?.status).toBe(
        "Todo",
      ),
    );
  });

  it("F6 · Cancelled → Cần làm thành công ⇒ cache chi tiết bị invalidate", async () => {
    setCapabilities({});
    vi.mocked(taskCoreApi.changeStatus).mockResolvedValue({
      task: { id: "task-001" },
      warnings: [],
    } as never);
    const task = withActions(
      { changeStatus: true, changeDeadline: false },
      { status: "Cancelled" },
    );
    renderWithQuery(<TaskStatusField task={task} />);
    client.setQueryData(taskKeys.detail(task.id), task);

    fireEvent.click(screen.getByTestId("task-status-select"));
    fireEvent.click(screen.getByRole("option", { name: /cần làm/i }));
    await waitFor(() =>
      expect(taskCoreApi.changeStatus).toHaveBeenCalledWith("task-001", { status: "Todo" }),
    );
    await waitFor(() =>
      expect(client.getQueryState(taskKeys.detail(task.id))?.isInvalidated).toBe(true),
    );
  });

  it("F6b · đổi ưu tiên thành công ⇒ cache chi tiết KHÔNG bị invalidate", async () => {
    setCapabilities({});
    vi.mocked(taskCoreApi.changePriority).mockResolvedValue({
      task: { id: "task-001" },
      warnings: [],
    } as never);
    const task = withActions({ changePriority: true });
    renderWithQuery(<TaskPriorityField task={task} />);
    client.setQueryData(taskKeys.detail(task.id), task);

    fireEvent.click(screen.getByTestId("task-priority-select"));
    fireEvent.click(screen.getByRole("option", { name: /cao/i }));
    await waitFor(() => expect(taskCoreApi.changePriority).toHaveBeenCalled());
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(client.getQueryState(taskKeys.detail(task.id))?.isInvalidated).toBe(false);
  });

  it("F7 · giao việc thành công ⇒ cache chi tiết bị invalidate", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(taskCoreApi.assign).mockResolvedValue({
      task: { id: "task-001" },
      warnings: [],
    } as never);
    const task = withActions({ assign: true });
    renderWithQuery(<TaskAssigneeField task={task} />);
    client.setQueryData(taskKeys.detail(task.id), task);

    fireEvent.click(screen.getByTestId("task-assignee-picker"));
    await waitFor(() => expect(screen.getByText("Trần Thị B")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Trần Thị B"));
    await waitFor(() => expect(taskCoreApi.assign).toHaveBeenCalled());
    await waitFor(() =>
      expect(client.getQueryState(taskKeys.detail(task.id))?.isInvalidated).toBe(true),
    );
  });

  it("F7b · move-state thành công ⇒ cache chi tiết bị invalidate", async () => {
    setCapabilities({});
    vi.mocked(taskCollabApi.moveTaskState).mockResolvedValue({ id: "task-001" } as never);
    vi.mocked(taskStatesApi.listStates).mockResolvedValue([
      { id: "st-1", name: "Ý Tưởng", color: "#3b82f6", sortOrder: 1 },
      { id: "st-2", name: "Đang Làm", color: "#f59e0b", sortOrder: 2 },
    ] as never);
    const task = withActions({ changeState: true }, { projectId: "proj-001", stateId: "st-1" });
    renderWithQuery(<TaskStateField task={task} />);
    client.setQueryData(taskKeys.detail(task.id), task);

    await waitFor(() => expect(screen.getByTestId("task-state-select")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("task-state-select"));
    fireEvent.click(screen.getByRole("option", { name: /đang làm/i }));
    await waitFor(() => expect(taskCollabApi.moveTaskState).toHaveBeenCalled());
    await waitFor(() =>
      expect(client.getQueryState(taskKeys.detail(task.id))?.isInvalidated).toBe(true),
    );
  });
});
