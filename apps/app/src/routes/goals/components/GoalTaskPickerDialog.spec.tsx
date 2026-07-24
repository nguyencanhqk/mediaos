/**
 * S5-GOAL-FE-2 — GoalTaskPickerDialog (gắn BULK việc vào mục tiêu, GOAL-API-010).
 *
 * GIỚI HẠN API THẬT: `GET /tasks` (listTaskCoreQuerySchema) KHÔNG có filter tìm-kiếm lẫn departmentId —
 * chỉ có projectId/assigneeEmployeeId. Vì vậy mục tiêu cấp PHÒNG BAN buộc phải chọn dự án trước rồi
 * mới liệt kê việc (KHÔNG tự chế endpoint mới ở lane FE).
 *
 * warnings[] (department soft-mismatch, SPEC-10 §12) là CẢNH BÁO MỀM — server ĐÃ gắn xong; hiển thị
 * như cảnh báo, TUYỆT ĐỐI không coi là lỗi/rollback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { GoalCoreResponseDto, TaskCoreResponseDto } from "@mediaos/contracts";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: () => true,
    goalApi: { ...actual.goalApi, linkTasks: vi.fn() },
    taskCoreApi: { ...actual.taskCoreApi, listTasks: vi.fn() },
    taskProjectApi: { ...actual.taskProjectApi, listProjects: vi.fn() },
  };
});

import { goalApi, taskCoreApi, taskProjectApi } from "@mediaos/web-core";
import { GoalTaskPickerDialog } from "./GoalTaskPickerDialog";

const mockLinkTasks = goalApi.linkTasks as ReturnType<typeof vi.fn>;
const mockListTasks = taskCoreApi.listTasks as ReturnType<typeof vi.fn>;
const mockListProjects = taskProjectApi.listProjects as ReturnType<typeof vi.fn>;

function makeGoal(over: Partial<GoalCoreResponseDto> = {}): GoalCoreResponseDto {
  return {
    id: "g-1",
    companyId: "co-1",
    goalCode: "GOAL-0001",
    name: "Mục tiêu X",
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
    targetValue: null,
    currentValue: null,
    unit: null,
    progressMode: "tasks",
    progressPercent: null,
    weight: 1,
    status: "Active",
    finalizedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function makeTask(id: string, title: string, over: Record<string, unknown> = {}) {
  return {
    id,
    companyId: "co-1",
    taskCode: `TASK-${id}`,
    title,
    status: "Todo",
    priority: "Medium",
    projectId: "p-1",
    projectName: "Dự án A",
    mainAssigneeEmployeeId: "emp-1",
    assigneeName: "Nguyễn Văn A",
    goalId: null,
    isOverdue: false,
    ...over,
  } as unknown as TaskCoreResponseDto;
}

function renderDialog(goal: GoalCoreResponseDto, onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <GoalTaskPickerDialog goal={goal} onClose={onClose} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListTasks.mockResolvedValue([]);
  mockListProjects.mockResolvedValue([{ id: "p-1", name: "Dự án A" }]);
  mockLinkTasks.mockResolvedValue({ goalId: "g-1", linked: 1, alreadyLinked: 0, warnings: [] });
});

describe("GoalTaskPickerDialog — nguồn ứng viên theo neo", () => {
  it("cấp phòng ban: CHƯA tải việc cho tới khi chọn dự án (GET /tasks không có filter phòng ban)", async () => {
    renderDialog(makeGoal({ level: "department", departmentId: "dept-1" }));
    await waitFor(() => expect(mockListProjects).toHaveBeenCalled());
    expect(mockListTasks).not.toHaveBeenCalled();

    fireEvent.change(await screen.findByTestId("goal-task-picker-project"), {
      target: { value: "p-1" },
    });
    await waitFor(() =>
      expect(mockListTasks).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p-1" })),
    );
  });

  it("cấp dự án: gọi listTasks NGAY với projectId của mục tiêu", async () => {
    renderDialog(makeGoal({ level: "project", projectId: "p-9", departmentId: null }));
    await waitFor(() =>
      expect(mockListTasks).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p-9" })),
    );
  });

  it("cấp nhân viên: gọi listTasks với assigneeEmployeeId của mục tiêu", async () => {
    renderDialog(makeGoal({ level: "employee", employeeId: "emp-7", departmentId: null }));
    await waitFor(() =>
      expect(mockListTasks).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeEmployeeId: "emp-7" }),
      ),
    );
  });
});

describe("GoalTaskPickerDialog — danh sách chọn", () => {
  it("loại việc ĐÃ gắn đúng mục tiêu này khỏi danh sách", async () => {
    mockListTasks.mockResolvedValue([
      makeTask("t-1", "Việc chưa gắn"),
      makeTask("t-2", "Việc đã gắn rồi", { goalId: "g-1" }),
    ]);
    renderDialog(makeGoal({ level: "project", projectId: "p-1", departmentId: null }));
    expect(await screen.findByText("Việc chưa gắn")).toBeInTheDocument();
    expect(screen.queryByText("Việc đã gắn rồi")).not.toBeInTheDocument();
  });

  it("chọn nhiều + gắn → linkTasks BULK với đủ taskIds", async () => {
    mockListTasks.mockResolvedValue([makeTask("t-1", "Việc 1"), makeTask("t-2", "Việc 2")]);
    renderDialog(makeGoal({ level: "project", projectId: "p-1", departmentId: null }));
    fireEvent.click(await screen.findByTestId("goal-task-pick-t-1"));
    fireEvent.click(screen.getByTestId("goal-task-pick-t-2"));
    fireEvent.click(screen.getByTestId("goal-task-picker-submit"));
    await waitFor(() =>
      expect(mockLinkTasks).toHaveBeenCalledWith("g-1", { taskIds: ["t-1", "t-2"] }),
    );
  });
});

describe("GoalTaskPickerDialog — warnings mềm KHÁC lỗi", () => {
  it("200 kèm warnings[] → hiện cảnh báo, KHÔNG hiện lỗi (đã gắn thành công)", async () => {
    mockListTasks.mockResolvedValue([makeTask("t-1", "Việc 1")]);
    mockLinkTasks.mockResolvedValue({
      goalId: "g-1",
      linked: 1,
      alreadyLinked: 0,
      warnings: [
        { taskId: "t-1", taskCode: "TASK-t-1", message: "Việc không thuộc phòng ban mục tiêu." },
      ],
    });
    renderDialog(makeGoal({ level: "department", departmentId: "dept-1" }));
    const projectSelect = await screen.findByTestId("goal-task-picker-project");
    // Option chỉ có SAU khi listProjects trả — đổi value trước đó thì <select> giữ nguyên "".
    await waitFor(() => expect(projectSelect).toHaveTextContent("Dự án A"));
    fireEvent.change(projectSelect, { target: { value: "p-1" } });
    fireEvent.click(await screen.findByTestId("goal-task-pick-t-1"));
    fireEvent.click(screen.getByTestId("goal-task-picker-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("goal-task-picker-warnings")).toHaveTextContent(
        "Việc không thuộc phòng ban mục tiêu.",
      ),
    );
    expect(screen.queryByTestId("goal-task-picker-error")).not.toBeInTheDocument();
  });
});
