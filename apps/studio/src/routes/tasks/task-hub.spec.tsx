/**
 * G9-4 — Task Hub (My/Team/Project Tasks) FE spec.
 *
 * Kiểm tra:
 *   - My Tasks tab: gọi tasksApi.getMyTasks, render badge task_type từ constants chung.
 *   - Team Tasks tab: hiện sau PermissionGate (read:task); gọi tasksApi.getTeamTasks khi chọn team.
 *   - Project Tasks tab: hiện sau PermissionGate (read:task); gọi tasksApi.getProjectTasks khi chọn project.
 *   - Trạng thái loading/error/empty từng tab.
 *   - Không có hard-code nhãn task_type (dùng TASK_TYPE_LABELS constants).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskDto } from "@mediaos/contracts";
import { TaskHubPage } from "./task-hub";
import { useAuthStore } from "@mediaos/web-core";
import { TASK_TYPE_LABELS } from "@/components/tasks/task-status-constants";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/tasks-api", () => ({
  tasksApi: {
    getMyTasks: vi.fn(),
    getTeamTasks: vi.fn(),
    getProjectTasks: vi.fn(),
  },
}));

vi.mock("@/lib/org-api", () => ({
  orgApi: {
    listTeams: vi.fn().mockResolvedValue([
      { id: "team-1", name: "Nhóm Sáng tạo", companyId: "co-1" },
    ]),
  },
}));

vi.mock("@/lib/projects-api", () => ({
  projectsApi: {
    listProjects: vi.fn().mockResolvedValue([
      { id: "proj-1", name: "Dự án Alpha", companyId: "co-1" },
    ]),
  },
}));

import { tasksApi } from "@/lib/tasks-api";

const getMyTasksMock = vi.mocked(tasksApi.getMyTasks);
const getTeamTasksMock = vi.mocked(tasksApi.getTeamTasks);
const getProjectTasksMock = vi.mocked(tasksApi.getProjectTasks);

// ─── Helpers ──────────────────────────────────────────────────────────────────

let seq = 0;
function makeTask(over: Partial<TaskDto>): TaskDto {
  seq += 1;
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
    companyId: "co-1",
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
    priority: "none",
    description: null,
    startDate: null,
    sequence: null,
    displayId: null,
    projectIdentifier: null,
    stateId: null,
    stateName: null,
    stateGroup: null,
    stateColor: null,
    ...over,
  };
}

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** Grants read:task so PermissionGate shows Team/Project tabs. capabilities is a
 *  Record<string,boolean> keyed `action:resourceType` (see useCan) — NOT a Set. */
function grantReadTask() {
  useAuthStore.setState({ isAuthenticated: true, capabilities: { "read:task": true } });
}

function denyReadTask() {
  useAuthStore.setState({ isAuthenticated: true, capabilities: {} });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TaskHubPage — My Tasks tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seq = 0;
    grantReadTask();
  });

  it("renders 3 tabs", () => {
    getMyTasksMock.mockResolvedValue([]);
    renderWithClient(<TaskHubPage />);
    expect(screen.getByTestId("hub-tab-my")).toBeInTheDocument();
    expect(screen.getByTestId("hub-tab-team")).toBeInTheDocument();
    expect(screen.getByTestId("hub-tab-project")).toBeInTheDocument();
  });

  it("My Tasks tab active by default — calls getMyTasks", async () => {
    getMyTasksMock.mockResolvedValue([]);
    renderWithClient(<TaskHubPage />);
    await waitFor(() => expect(getMyTasksMock).toHaveBeenCalledOnce());
  });

  it("renders task_type badge using TASK_TYPE_LABELS constant (not hard-coded)", async () => {
    const t = makeTask({ taskType: "hr", title: "Đơn nghỉ phép" });
    getMyTasksMock.mockResolvedValue([t]);
    renderWithClient(<TaskHubPage />);
    // Badge label must come from TASK_TYPE_LABELS["hr"]
    await waitFor(() =>
      expect(screen.getByText(TASK_TYPE_LABELS["hr"])).toBeInTheDocument(),
    );
  });

  it("shows empty state when no tasks", async () => {
    getMyTasksMock.mockResolvedValue([]);
    renderWithClient(<TaskHubPage />);
    await waitFor(() =>
      expect(screen.getByText(/Không có công việc nào/)).toBeInTheDocument(),
    );
  });

  it("shows error state on fetch failure", async () => {
    getMyTasksMock.mockRejectedValue(new Error("Network error"));
    renderWithClient(<TaskHubPage />);
    await waitFor(() =>
      expect(screen.getByText(/Không tải được công việc của bạn/)).toBeInTheDocument(),
    );
  });
});

describe("TaskHubPage — Team Tasks tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seq = 0;
  });

  it("shows fallback when user lacks read:task", async () => {
    denyReadTask();
    getMyTasksMock.mockResolvedValue([]);
    renderWithClient(<TaskHubPage />);
    fireEvent.click(screen.getByTestId("hub-tab-team"));
    await waitFor(() =>
      expect(screen.getByText(/không có quyền xem công việc nhóm/i)).toBeInTheDocument(),
    );
    expect(getTeamTasksMock).not.toHaveBeenCalled();
  });

  it("with read:task — shows team selector; getTeamTasks called after team selected", async () => {
    grantReadTask();
    getMyTasksMock.mockResolvedValue([]);
    getTeamTasksMock.mockResolvedValue([makeTask({ taskType: "meeting_action", title: "Họp tuần" })]);
    renderWithClient(<TaskHubPage />);

    fireEvent.click(screen.getByTestId("hub-tab-team"));

    // Before selecting a team, prompt shown
    await waitFor(() =>
      expect(screen.getByText(/Chọn nhóm để xem công việc/)).toBeInTheDocument(),
    );

    // Wait for the async team options to render before selecting (jsdom keeps the
    // value unchanged if the target <option> isn't present yet).
    await screen.findByRole("option", { name: "Nhóm Sáng tạo" });
    const select = screen.getByRole("combobox", { name: /Chọn nhóm/i });
    fireEvent.change(select, { target: { value: "team-1" } });

    await waitFor(() => expect(getTeamTasksMock).toHaveBeenCalledWith("team-1", expect.any(Object)));
    await waitFor(() =>
      expect(screen.getByText(TASK_TYPE_LABELS["meeting_action"])).toBeInTheDocument(),
    );
  });
});

describe("TaskHubPage — Project Tasks tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seq = 0;
  });

  it("shows fallback when user lacks read:task", async () => {
    denyReadTask();
    getMyTasksMock.mockResolvedValue([]);
    renderWithClient(<TaskHubPage />);
    fireEvent.click(screen.getByTestId("hub-tab-project"));
    await waitFor(() =>
      expect(screen.getByText(/không có quyền xem công việc dự án/i)).toBeInTheDocument(),
    );
    expect(getProjectTasksMock).not.toHaveBeenCalled();
  });

  it("with read:task — shows project selector; getProjectTasks called after project selected", async () => {
    grantReadTask();
    getMyTasksMock.mockResolvedValue([]);
    getProjectTasksMock.mockResolvedValue([makeTask({ taskType: "finance", title: "Báo cáo chi phí" })]);
    renderWithClient(<TaskHubPage />);

    fireEvent.click(screen.getByTestId("hub-tab-project"));

    await waitFor(() =>
      expect(screen.getByText(/Chọn dự án để xem công việc/)).toBeInTheDocument(),
    );

    await screen.findByRole("option", { name: "Dự án Alpha" });
    const select = screen.getByRole("combobox", { name: /Chọn dự án/i });
    fireEvent.change(select, { target: { value: "proj-1" } });

    await waitFor(() =>
      expect(getProjectTasksMock).toHaveBeenCalledWith("proj-1", expect.any(Object)),
    );
    await waitFor(() =>
      expect(screen.getByText(TASK_TYPE_LABELS["finance"])).toBeInTheDocument(),
    );
  });
});
