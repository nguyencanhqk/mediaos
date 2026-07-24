/**
 * S5-GOAL-FE-2 — TaskGoalField (ô "Mục tiêu" trong panel chi tiết công việc, GOAL-API-010).
 *
 * TWO-GATE: gắn/tháo mục tiêu cho task đòi CẢ ('update','goal') VÀ ('update','task') — đúng hai cổng
 * BE (goal-tasks-link.service.ts). Thiếu một ⇒ CHỈ đọc (không mount picker), không hiện-rồi-403.
 * Picker chỉ liệt kê goal Active KHỚP NEO (employee = assignee chính, project = dự án của task,
 * department = phòng ban của task) — lọc ở client vì GET /goals không có OR-filter đa-neo.
 * Lỗi 422 GOAL-ERR-008 ⇒ hiện verbatim + rollback (KHÔNG giữ mục tiêu mới trên UI).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { TaskCoreResponseDto, GoalCoreResponseDto } from "@mediaos/contracts";
import i18n from "@/i18n";

const perm = vi.hoisted(() => ({ denied: new Set<string>() }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: (action: string, resourceType: string) => !perm.denied.has(`${action}:${resourceType}`),
    goalApi: { ...actual.goalApi, listGoals: vi.fn(), linkTasks: vi.fn(), unlinkTask: vi.fn() },
  };
});

import { goalApi, ApiError } from "@mediaos/web-core";
import { TaskGoalField } from "./TaskGoalField";

const mockListGoals = goalApi.listGoals as ReturnType<typeof vi.fn>;
const mockLinkTasks = goalApi.linkTasks as ReturnType<typeof vi.fn>;
const mockUnlink = goalApi.unlinkTask as ReturnType<typeof vi.fn>;

function makeGoal(over: Partial<GoalCoreResponseDto>): GoalCoreResponseDto {
  return {
    id: "g-x",
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

const TASK = {
  id: "t-1",
  companyId: "co-1",
  taskCode: "TASK-0001",
  title: "Chuẩn bị tài liệu",
  status: "Todo",
  priority: "Medium",
  projectId: "p-1",
  projectName: "Dự án A",
  departmentId: "dept-1",
  mainAssigneeEmployeeId: "emp-1",
  assigneeName: "Nguyễn Văn A",
  goalId: null,
  goalCode: null,
  goalName: null,
  isOverdue: false,
} as unknown as TaskCoreResponseDto;

function renderField(task: TaskCoreResponseDto = TASK) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <TaskGoalField task={task} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

/** Mọi queryKey đã invalidate, dạng chuỗi — so khớp không phụ thuộc thứ tự gọi. */
function invalidatedKeys(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey?: unknown })?.queryKey));
}

beforeEach(() => {
  vi.clearAllMocks();
  perm.denied.clear();
  mockListGoals.mockResolvedValue([]);
  mockLinkTasks.mockResolvedValue({ goalId: "g-1", linked: 1, alreadyLinked: 0, warnings: [] });
  mockUnlink.mockResolvedValue(undefined);
});

describe("TaskGoalField — deny-path two-gate", () => {
  it("thiếu update:goal → chỉ chip đọc, KHÔNG mount picker + KHÔNG gọi listGoals", async () => {
    perm.denied.add("update:goal");
    renderField({ ...TASK, goalId: "g-1", goalCode: "GOAL-0001", goalName: "Mục tiêu X" });
    expect(await screen.findByTestId("task-goal-readonly")).toHaveTextContent("GOAL-0001");
    expect(screen.queryByTestId("task-goal-picker")).not.toBeInTheDocument();
    expect(mockListGoals).not.toHaveBeenCalled();
  });

  it("thiếu update:task → chỉ chip đọc (cổng thứ hai của BE)", async () => {
    perm.denied.add("update:task");
    renderField();
    expect(await screen.findByTestId("task-goal-readonly")).toBeInTheDocument();
    expect(screen.queryByTestId("task-goal-picker")).not.toBeInTheDocument();
  });

  it("đủ hai quyền → có picker", async () => {
    renderField();
    expect(await screen.findByTestId("task-goal-picker")).toBeInTheDocument();
  });
});

describe("TaskGoalField — picker lọc theo neo (GOAL-ERR-008)", () => {
  it("loại goal status ≠ Active và goal cấp nhân viên của NGƯỜI KHÁC", async () => {
    mockListGoals.mockResolvedValue([
      makeGoal({ id: "g-ok-dept", name: "Mục tiêu phòng", level: "department" }),
      makeGoal({
        id: "g-ok-emp",
        name: "Mục tiêu của tôi",
        level: "employee",
        employeeId: "emp-1",
        departmentId: null,
      }),
      makeGoal({
        id: "g-other-emp",
        name: "Mục tiêu người khác",
        level: "employee",
        employeeId: "emp-999",
        departmentId: null,
      }),
      makeGoal({ id: "g-draft", name: "Mục tiêu nháp", status: "Draft" }),
      makeGoal({
        id: "g-other-proj",
        name: "Mục tiêu dự án khác",
        level: "project",
        projectId: "p-999",
        departmentId: null,
      }),
    ]);
    renderField();
    const picker = await screen.findByTestId("task-goal-picker");
    await waitFor(() => expect(picker).toHaveTextContent("Mục tiêu phòng"));
    expect(picker).toHaveTextContent("Mục tiêu của tôi");
    expect(picker).not.toHaveTextContent("Mục tiêu người khác");
    expect(picker).not.toHaveTextContent("Mục tiêu nháp");
    expect(picker).not.toHaveTextContent("Mục tiêu dự án khác");
  });
});

describe("TaskGoalField — ghi", () => {
  beforeEach(() => {
    mockListGoals.mockResolvedValue([makeGoal({ id: "g-1", name: "Mục tiêu phòng" })]);
  });

  it("chọn mục tiêu → gọi linkTasks(goalMới, {taskIds:[task.id]})", async () => {
    renderField();
    const picker = await screen.findByTestId("task-goal-picker");
    await waitFor(() => expect(picker).toHaveTextContent("Mục tiêu phòng"));
    fireEvent.change(picker, { target: { value: "g-1" } });
    await waitFor(() => expect(mockLinkTasks).toHaveBeenCalledWith("g-1", { taskIds: ["t-1"] }));
  });

  it("chọn '—' khi đang có mục tiêu → gọi unlinkTask(goalCũ, taskId)", async () => {
    renderField({ ...TASK, goalId: "g-old", goalCode: "GOAL-0009", goalName: "Mục tiêu cũ" });
    const picker = await screen.findByTestId("task-goal-picker");
    fireEvent.change(picker, { target: { value: "" } });
    await waitFor(() => expect(mockUnlink).toHaveBeenCalledWith("g-old", "t-1"));
  });

  it("422 GOAL-ERR-008 → hiện verbatim err.message + KHÔNG giữ mục tiêu mới (rollback)", async () => {
    mockLinkTasks.mockRejectedValue(
      new ApiError(422, "GOAL-ERR-008", "Công việc không thuộc phạm vi neo của mục tiêu."),
    );
    renderField();
    const picker = await screen.findByTestId("task-goal-picker");
    await waitFor(() => expect(picker).toHaveTextContent("Mục tiêu phòng"));
    fireEvent.change(picker, { target: { value: "g-1" } });
    await waitFor(() =>
      expect(
        screen.getByText("Công việc không thuộc phạm vi neo của mục tiêu."),
      ).toBeInTheDocument(),
    );
    expect((picker as HTMLSelectElement).value).toBe("");
  });
});

describe("TaskGoalField — đồng bộ cache 2 chiều (pattern PR #250)", () => {
  it("đổi mục tiêu → invalidate CẢ goal MỚI lẫn goal CŨ + task detail + board dự án", async () => {
    mockListGoals.mockResolvedValue([makeGoal({ id: "g-new", name: "Mục tiêu phòng" })]);
    const { invalidateSpy } = renderField({
      ...TASK,
      goalId: "g-old",
      goalCode: "GOAL-0009",
      goalName: "Mục tiêu cũ",
    });
    const picker = await screen.findByTestId("task-goal-picker");
    await waitFor(() => expect(picker).toHaveTextContent("Mục tiêu phòng"));
    fireEvent.change(picker, { target: { value: "g-new" } });
    await waitFor(() => expect(mockLinkTasks).toHaveBeenCalled());

    await waitFor(() => {
      const keys = invalidatedKeys(invalidateSpy);
      // % của CẢ HAI mục tiêu đổi (server recompute previousGoalIds) — thiếu vế "goal cũ" là để lại
      // số sai trên màn hình người khác đang mở.
      expect(keys).toContain(JSON.stringify(["goals", "detail", "g-new"]));
      expect(keys).toContain(JSON.stringify(["goals", "detail", "g-old"]));
      expect(keys).toContain(JSON.stringify(["goals", "linked-tasks", "g-new"]));
      expect(keys).toContain(JSON.stringify(["goals", "linked-tasks", "g-old"]));
      expect(keys).toContain(JSON.stringify(["tasks", "detail", "t-1"]));
      expect(keys).toContain(JSON.stringify(["tasks", "kanban", "p-1"]));
    });
  });
});
