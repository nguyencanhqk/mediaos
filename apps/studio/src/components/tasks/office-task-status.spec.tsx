import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskDto } from "@mediaos/contracts";
import { OfficeTaskStatus } from "./office-task-status";
import { useAuthStore } from "@mediaos/web-core";

// Mock tasksApi — server là sự thật; ở đây chỉ chứng minh control GỌI ĐÚNG DTO.
vi.mock("@/lib/tasks-api", () => ({
  tasksApi: {
    updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  },
}));

import { tasksApi } from "@/lib/tasks-api";

const TASK_ID = "11111111-1111-1111-1111-111111111111";

function officeTask(over: Partial<TaskDto> = {}): TaskDto {
  return {
    id: TASK_ID,
    companyId: "22222222-2222-2222-2222-222222222222",
    taskType: "office",
    title: "Soạn báo cáo",
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

function renderWithClient(ui: ReactNode): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Cấp/thu quyền update:task qua auth store (useCan đọc từ đây). */
function setCan(allowed: boolean): void {
  useAuthStore.setState({ capabilities: allowed ? { "update:task": true } : {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  setCan(true);
});

afterEach(() => {
  useAuthStore.setState({ capabilities: {} });
});

describe("OfficeTaskStatus — luồng rút gọn 3 status", () => {
  it("đổi status → gọi updateTaskStatus đúng OfficeTaskStatusDto (in_progress)", async () => {
    renderWithClient(<OfficeTaskStatus task={officeTask({ status: "not_started" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Đang làm" }));

    await waitFor(() =>
      expect(tasksApi.updateTaskStatus).toHaveBeenCalledWith(TASK_ID, "in_progress"),
    );
  });

  it("đổi sang Hoàn thành → gửi 'completed'", async () => {
    renderWithClient(<OfficeTaskStatus task={officeTask({ status: "in_progress" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Hoàn thành" }));
    await waitFor(() =>
      expect(tasksApi.updateTaskStatus).toHaveBeenCalledWith(TASK_ID, "completed"),
    );
  });

  it("KHÔNG render nút status workflow (Chờ duyệt / Đã duyệt / Đang sửa)", () => {
    renderWithClient(<OfficeTaskStatus task={officeTask()} />);
    expect(screen.queryByRole("button", { name: "Chờ duyệt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Đã duyệt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Đang sửa" })).toBeNull();
  });
});

describe("OfficeTaskStatus — PermissionGate update:task", () => {
  it("thiếu update:task → ẩn control (server vẫn là sự thật)", () => {
    setCan(false);
    renderWithClient(<OfficeTaskStatus task={officeTask()} />);
    expect(screen.queryByRole("button", { name: "Đang làm" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hoàn thành" })).toBeNull();
  });
});
