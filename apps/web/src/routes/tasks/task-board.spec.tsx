import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskDto } from "@mediaos/contracts";
import { TaskBoardPage } from "./task-board";
import { useAuthStore } from "@mediaos/web-core";

// Mock tasksApi — board đọc getBoard; updateTaskStatus cho control luồng rút gọn.
vi.mock("@/lib/tasks-api", () => ({
  tasksApi: {
    getBoard: vi.fn(),
    updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  },
}));

import { tasksApi } from "@/lib/tasks-api";

const getBoardMock = vi.mocked(tasksApi.getBoard);

let seq = 0;
function task(over: Partial<TaskDto>): TaskDto {
  seq += 1;
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
    companyId: "22222222-2222-2222-2222-222222222222",
    taskType: "office",
    title: "Task",
    status: "not_started",
    origin: "initial",
    revisionRound: 0,
    dueDate: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    assigneeUserId: null,
    stepId: null,
    stepCode: null,
    stepName: null,
    stepStatus: null,
    submissionUrl: null,
    submissionNote: null,
    workflowInstanceId: null,
    contentItemId: null,
    contentTitle: null,
    projectId: null,
    projectName: null,
    ...over,
  };
}

/** 7 loại task: 1 office + workflow-driven (production) + 5 loại còn lại. */
const ALL_TYPES_TASKS: TaskDto[] = [
  task({ taskType: "office", title: "Office task", status: "not_started" }),
  task({
    taskType: "production",
    title: "Production task",
    stepId: "step-1",
    status: "in_progress",
  }),
  task({ taskType: "review", title: "Review task", stepId: "step-2", status: "waiting_review" }),
  task({ taskType: "revision", title: "Revision task", stepId: "step-3", status: "revision" }),
  task({ taskType: "meeting_action", title: "Meeting task" }),
  task({ taskType: "finance", title: "Finance task" }),
  task({ taskType: "hr", title: "HR task" }),
];

function renderWithClient(ui: ReactNode): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  useAuthStore.setState({ capabilities: { "update:task": true } });
});

afterEach(() => {
  useAuthStore.setState({ capabilities: {} });
});

describe("TaskBoardPage — filter theo task_type", () => {
  it("'Tất cả' → render đủ 7 loại task", async () => {
    getBoardMock.mockResolvedValue(ALL_TYPES_TASKS);
    renderWithClient(<TaskBoardPage />);

    await waitFor(() => expect(screen.getByText("Office task")).toBeInTheDocument());
    expect(screen.getByText("Production task")).toBeInTheDocument();
    expect(screen.getByText("Review task")).toBeInTheDocument();
    expect(screen.getByText("Revision task")).toBeInTheDocument();
    expect(screen.getByText("Meeting task")).toBeInTheDocument();
    expect(screen.getByText("Finance task")).toBeInTheDocument();
    expect(screen.getByText("HR task")).toBeInTheDocument();
  });

  it("chọn 'Văn phòng' → chỉ còn office card", async () => {
    // getBoard nhận filter taskType='office' → server trả đúng office (mirror BE).
    getBoardMock.mockImplementation((filter) =>
      Promise.resolve(
        filter?.taskType
          ? ALL_TYPES_TASKS.filter((t) => t.taskType === filter.taskType)
          : ALL_TYPES_TASKS,
      ),
    );
    renderWithClient(<TaskBoardPage />);

    await waitFor(() => expect(screen.getByText("Office task")).toBeInTheDocument());

    // Chọn filter "Văn phòng" (label vi của office).
    fireEvent.click(screen.getByRole("button", { name: "Văn phòng" }));

    await waitFor(() => expect(screen.queryByText("Production task")).toBeNull());
    expect(screen.getByText("Office task")).toBeInTheDocument();
    expect(screen.queryByText("HR task")).toBeNull();
  });
});

describe("TaskBoardPage — luồng rút gọn vs workflow", () => {
  it("office task → có control 3-status (Đang làm / Hoàn thành), KHÔNG nút workflow", async () => {
    getBoardMock.mockResolvedValue([
      task({ taskType: "office", title: "Office only", status: "not_started" }),
    ]);
    renderWithClient(<TaskBoardPage />);

    const card = await screen.findByTestId("task-card-office-only");
    // Control luồng rút gọn hiện cho office.
    expect(within(card).getByRole("button", { name: "Đang làm" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Hoàn thành" })).toBeInTheDocument();
    // KHÔNG có nút status workflow.
    expect(within(card).queryByRole("button", { name: "Chờ duyệt" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Đã duyệt" })).toBeNull();
  });

  it("workflow-task card (có stepId) → KHÔNG có nút đổi-status-tay", async () => {
    getBoardMock.mockResolvedValue([
      task({ taskType: "production", title: "WF prod", stepId: "step-1", status: "in_progress" }),
    ]);
    renderWithClient(<TaskBoardPage />);

    const card = await screen.findByTestId("task-card-wf-prod");
    expect(within(card).queryByRole("button", { name: "Đang làm" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Hoàn thành" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Chờ duyệt" })).toBeNull();
  });
});
