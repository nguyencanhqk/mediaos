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
    authApi: { ...actual.authApi, me: vi.fn() },
  };
});

import { goalApi, authApi, ApiError } from "@mediaos/web-core";
import { TaskGoalField } from "./TaskGoalField";

const mockListGoals = goalApi.listGoals as ReturnType<typeof vi.fn>;
const mockLinkTasks = goalApi.linkTasks as ReturnType<typeof vi.fn>;
const mockMe = authApi.me as ReturnType<typeof vi.fn>;
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
    periodStart: "2020-01-01",
    periodEnd: "2099-12-31",
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
  mockMe.mockResolvedValue({ employee: { id: "emp-1", fullName: "Nguyễn Văn A" } });
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

describe("TaskGoalField — S20-GOAL-SUGGEST-1", () => {
  it("mục tiêu manual/children/project KHÔNG bao giờ vào danh sách gắn (hồi quy: trước đây vẫn hiện)", async () => {
    mockListGoals.mockResolvedValue([
      makeGoal({ id: "g-manual", name: "Đo thủ công", progressMode: "manual" }),
      makeGoal({ id: "g-children", name: "Đo theo con", progressMode: "children" }),
      makeGoal({ id: "g-tasks", name: "Đo theo việc", progressMode: "tasks" }),
    ]);
    renderField();
    const picker = await screen.findByTestId("task-goal-picker");
    await waitFor(() => expect(picker).toHaveTextContent("Đo theo việc"));
    expect(picker).not.toHaveTextContent("Đo thủ công");
    expect(picker).not.toHaveTextContent("Đo theo con");
  });

  it("lọc Ở SERVER theo neo + Active + kỳ, không còn limit 200 mục tiêu đầu", async () => {
    renderField();
    await screen.findByTestId("task-goal-picker");
    await waitFor(() => expect(mockListGoals).toHaveBeenCalled());
    const calls = mockListGoals.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(calls.map((c) => c.employeeId ?? c.projectId ?? c.departmentId).sort()).toEqual(
      ["dept-1", "emp-1", "p-1"].sort(),
    );
    for (const c of calls) {
      expect(c).toMatchObject({ status: "Active", limit: 50 });
      expect(c.periodFrom).toBe(c.periodTo);
    }
  });

  it("thiếu update:task ⇒ không gọi GET /goals", async () => {
    perm.denied.add("update:task");
    renderField();
    await screen.findByTestId("task-goal-readonly");
    expect(mockListGoals).not.toHaveBeenCalled();
  });

  it("việc CHƯA gắn + đúng 1 ứng viên ⇒ chip một chạm gọi linkTasks", async () => {
    mockListGoals.mockResolvedValue([makeGoal({ id: "g-1", name: "Mục tiêu phòng" })]);
    renderField();
    const chip = await screen.findByTestId("task-goal-offer");
    expect(chip).toHaveTextContent("Mục tiêu phòng");
    fireEvent.click(chip);
    await waitFor(() => expect(mockLinkTasks).toHaveBeenCalledWith("g-1", { taskIds: ["t-1"] }));
  });

  it("việc đang gắn mục tiêu khác ⇒ KHÔNG gợi ý chuyển", async () => {
    mockListGoals.mockResolvedValue([makeGoal({ id: "g-1", name: "Mục tiêu phòng" })]);
    renderField({ ...TASK, goalId: "g-old", goalCode: "GOAL-0009", goalName: "Mục tiêu cũ" });
    const picker = await screen.findByTestId("task-goal-picker");
    await waitFor(() => expect(picker).toHaveTextContent("Mục tiêu phòng"));
    expect(screen.queryByTestId("task-goal-offer")).toBeNull();
  });

  it("nhiều ứng viên ⇒ không chip", async () => {
    mockListGoals.mockResolvedValue([
      makeGoal({ id: "g-1", name: "Mục tiêu phòng" }),
      makeGoal({ id: "g-2", name: "Mục tiêu dự án", level: "project", projectId: "p-1", departmentId: null }),
    ]);
    renderField();
    const picker = await screen.findByTestId("task-goal-picker");
    await waitFor(() => expect(picker).toHaveTextContent("Mục tiêu dự án"));
    expect(screen.queryByTestId("task-goal-offer")).toBeNull();
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

/**
 * S20-SEC-GOALNAMEDTO-1 (plan §4 F1–F3) — FE hiển thị ĐÚNG những gì server quyết định: server chỉ trả cờ
 * `hasGoal` (không id/tên/mã) khi người xem không đọc được mục tiêu ⇒ chip trung tính, không picker. Dạng
 * server cũ (không cờ) giữ nguyên hành vi trước đây.
 */
describe("TaskGoalField — tham chiếu mục tiêu theo quyết định của server", () => {
  const RESTRICTED = {
    ...TASK,
    goalId: null,
    goalCode: null,
    goalName: null,
    hasGoal: true,
  } as unknown as TaskCoreResponseDto;

  it("F1 cờ có mục tiêu mà không có tên ⇒ chip trung tính, không picker (kể cả khi có quyền sửa)", () => {
    renderField(RESTRICTED);
    expect(screen.getByTestId("task-goal-restricted")).toBeInTheDocument();
    expect(screen.queryByTestId("task-goal-picker")).toBeNull();
  });

  it("F1b chỉ đọc: cờ có mục tiêu ⇒ chip trung tính, không hiện «—»", () => {
    perm.denied.add("update:goal");
    renderField(RESTRICTED);
    expect(screen.getByTestId("task-goal-restricted")).toBeInTheDocument();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("F2 dạng server cũ (không cờ, đủ ba trường) ⇒ hiện mã — tên như trước", () => {
    perm.denied.add("update:goal");
    renderField({
      ...TASK,
      goalId: "g-1",
      goalCode: "GOAL-0001",
      goalName: "Mục tiêu X",
    } as unknown as TaskCoreResponseDto);
    expect(screen.getByTestId("task-goal-readonly").textContent).toContain(
      "GOAL-0001 — Mục tiêu X",
    );
    expect(screen.queryByTestId("task-goal-restricted")).toBeNull();
  });

  it("F3 không mục tiêu, không cờ ⇒ «—»", () => {
    perm.denied.add("update:goal");
    renderField(TASK);
    expect(screen.getByTestId("task-goal-readonly").textContent).toContain("—");
    expect(screen.queryByTestId("task-goal-restricted")).toBeNull();
  });
});
