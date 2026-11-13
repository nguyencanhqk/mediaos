import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { GoalCoreResponseDto, TaskCoreResponseDto } from "@mediaos/contracts";
import i18n from "@/i18n";

/**
 * S20-GOAL-SUGGEST-1 (US-GOAL-NV-92) — form TẠO việc: ô «Mục tiêu» + bước gắn thứ hai.
 * Tiêu chí 1 (chọn sẵn + «Gợi ý»), 3 (cá nhân do quản lý tạo ⇒ chỉ chip), 4 (thiếu quyền ⇒ không ô,
 * không GET /goals), 6 (bước gắn lỗi ⇒ «chưa gắn» + «Thử gắn lại», không báo thành công giả).
 */
vi.mock("@/hooks/use-dirty-form-guard", () => ({ useDirtyFormGuard: () => {} }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: { updateTask: vi.fn(), createTask: vi.fn() },
    taskProjectApi: { listProjects: vi.fn().mockResolvedValue([]) },
    authApi: { ...actual.authApi, me: vi.fn() },
    hrApi: {
      listDepartments: vi.fn().mockResolvedValue([]),
      listEmployees: vi.fn().mockResolvedValue({ items: [], meta: {} }),
    },
    goalApi: { ...actual.goalApi, listGoals: vi.fn(), linkTasks: vi.fn(), unlinkTask: vi.fn() },
  };
});

import { useAuthStore, taskCoreApi, authApi, goalApi, ApiError } from "@mediaos/web-core";
import { TaskFormDrawer } from "./TaskFormDrawer";

const mockList = goalApi.listGoals as ReturnType<typeof vi.fn>;
const mockLink = goalApi.linkTasks as ReturnType<typeof vi.fn>;
const mockCreate = taskCoreApi.createTask as ReturnType<typeof vi.fn>;
const mockMe = authApi.me as ReturnType<typeof vi.fn>;

function goal(over: Partial<GoalCoreResponseDto>): GoalCoreResponseDto {
  return {
    id: "g-me",
    companyId: "co-1",
    goalCode: "G-0001",
    name: "Mục tiêu của tôi",
    description: null,
    level: "employee",
    departmentId: null,
    projectId: null,
    employeeId: "emp-me",
    parentGoalId: null,
    ownerEmployeeId: "emp-me",
    periodType: "year",
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

const CREATED = {
  id: "t-new",

  title: "Việc mới",
  projectId: null,
} as unknown as TaskCoreResponseDto;

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co-1" },
  });
}

function renderCreate(onSuccess = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <TaskFormDrawer mode="create" onClose={() => {}} onSuccess={onSuccess} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return onSuccess;
}

function submitWithTitle(title: string) {
  const input = document.getElementById("task-title") as HTMLInputElement;
  fireEvent.change(input, { target: { value: title } });
  const form = document.getElementById("task-core-form");
  if (!form) throw new Error("không thấy form");
  fireEvent.submit(form);
}

beforeEach(() => {
  vi.clearAllMocks();
  setCaps({ "update:task": true, "update:goal": true });
  mockMe.mockResolvedValue({ employee: { id: "emp-me", fullName: "Tôi" } });
  mockCreate.mockResolvedValue(CREATED);
  mockLink.mockResolvedValue({ goalId: "g-me", linked: 1, alreadyLinked: 0, warnings: [] });
  mockList.mockResolvedValue([goal({})]);
});

describe("TaskFormDrawer (tạo) — ô Mục tiêu", () => {
  it("1 ứng viên là mục tiêu cá nhân của chính tôi ⇒ chọn sẵn + «Gợi ý»; Lưu = tạo rồi gắn", async () => {
    const onSuccess = renderCreate();
    const select = (await screen.findByLabelText(/Mục tiêu/)) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("g-me"));
    expect(screen.getByTestId("task-form-goal-badge")).toHaveTextContent("Gợi ý");

    submitWithTitle("Việc mới");
    await waitFor(() => expect(mockLink).toHaveBeenCalledWith("g-me", { taskIds: ["t-new"] }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(CREATED));
    expect(mockCreate.mock.invocationCallOrder[0]).toBeLessThan(
      mockLink.mock.invocationCallOrder[0],
    );
  });

  it("mục tiêu cá nhân do QUẢN LÝ tạo (owner khác) ⇒ chỉ chip, không chọn sẵn; không bấm ⇒ không gắn", async () => {
    mockList.mockResolvedValue([goal({ ownerEmployeeId: "emp-mgr" })]);
    const onSuccess = renderCreate();
    expect(await screen.findByTestId("task-form-goal-chip")).toBeInTheDocument();
    expect(screen.queryByTestId("task-form-goal-on")).toBeNull();

    submitWithTitle("Việc mới");
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(mockLink).not.toHaveBeenCalled();
  });

  it("bước gắn lỗi GOAL-ERR-005 ⇒ việc vẫn còn, «chưa gắn: mục tiêu đã chốt kỳ» + Thử gắn lại", async () => {
    mockLink.mockRejectedValueOnce(new ApiError(422, "GOAL-ERR-005", "Kỳ đã chốt."));
    const onSuccess = renderCreate();
    const select = (await screen.findByLabelText(/Mục tiêu/)) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("g-me"));

    submitWithTitle("Việc mới");
    const notice = await screen.findByTestId("task-created-unlinked");
    expect(notice).toHaveTextContent("Đã tạo việc «Việc mới» nhưng chưa gắn: mục tiêu đã chốt kỳ");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Thử gắn lại" }));
    await waitFor(() => expect(mockLink).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(CREATED));
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("đang «Thử gắn lại» thì Esc KHÔNG đóng hộp thoại giữa chừng (onSuccess chưa gọi)", async () => {
    mockLink.mockRejectedValueOnce(new ApiError(422, "GOAL-ERR-005", "Kỳ đã chốt."));
    let finish: (v: unknown) => void = () => {};
    mockLink.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const onSuccess = renderCreate();
    const select = (await screen.findByLabelText(/Mục tiêu/)) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("g-me"));
    submitWithTitle("Việc mới");
    await screen.findByTestId("task-created-unlinked");

    fireEvent.click(screen.getByRole("button", { name: "Thử gắn lại" }));
    await waitFor(() => expect(mockLink).toHaveBeenCalledTimes(2));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId("task-created-unlinked")).toBeInTheDocument();

    finish({ goalId: "g-me", linked: 1, alreadyLinked: 0, warnings: [] });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(CREATED));
  });

  it("bước gắn 404 ⇒ «bạn không có quyền ghi việc này vào mục tiêu»", async () => {
    mockLink.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Không tìm thấy"));
    renderCreate();
    const select = (await screen.findByLabelText(/Mục tiêu/)) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("g-me"));
    submitWithTitle("Việc mới");
    expect(await screen.findByTestId("task-created-unlinked")).toHaveTextContent(
      "bạn không có quyền ghi việc này vào mục tiêu",
    );
  });

  it("thiếu update:goal ⇒ không có ô, KHÔNG gọi GET /goals; tạo việc chạy như cũ", async () => {
    setCaps({ "update:task": true });
    const onSuccess = renderCreate();
    submitWithTitle("Việc mới");
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(screen.queryByTestId("task-form-goal")).toBeNull();
    expect(mockList).not.toHaveBeenCalled();
    expect(mockLink).not.toHaveBeenCalled();
  });
});
