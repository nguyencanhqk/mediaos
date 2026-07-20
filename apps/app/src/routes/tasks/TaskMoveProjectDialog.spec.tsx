import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi, taskProjectApi, taskStatesApi } from "@mediaos/web-core";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { TaskMoveProjectDialog } from "./TaskMoveProjectDialog";

/**
 * S5-TASK-MOVEPROJ-1 — khoá tính chất DUY NHẤT mà WO này tồn tại để bảo đảm:
 * **không tồn tại đường submit nào đổi `project_id` mà không kèm `state_id`.**
 *
 * Vì sao phải test ở tầng này chứ không tin đọc code: contract KHÔNG cho gửi `stateId: null`
 * (`updateTaskCoreSchema.stateId = z.string().uuid()`, không nullable) và server KHÔNG BAO GIỜ tự dọn
 * `state_id` khi `project_id` đổi (`task-core.service.ts` — `applyStateChangeTx` chỉ chạy khi
 * `dto.stateId !== undefined`). Nên MỌI nhánh UI cho bấm Xác nhận mà payload thiếu `stateId` đều đẻ
 * ra task trỏ cột dự án cũ — im lặng, không lỗi, không test nào khác phủ.
 *
 * Ba cửa từng lọt (đều cho `columns` rỗng nên trông giống hệt nhau trên UI):
 *   (a) chọn "Không thuộc dự án"      → payload `projectId: null`, không stateId
 *   (b) dự án đích 0 cột pipeline      → cho đi tiếp, không stateId
 *   (c) cột đang tải / API cột lỗi     → `states ?? []` rỗng ⇒ tưởng là (b)
 */
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: { updateTask: vi.fn() },
    taskProjectApi: { listProjects: vi.fn() },
    taskStatesApi: { listStates: vi.fn() },
  };
});

const PROJECTS = [
  { id: "proj-cu", name: "Dự án cũ" },
  { id: "proj-moi", name: "Dự án mới" },
];

const TASK = {
  id: "task-1",
  projectId: "proj-cu",
  parentTaskId: null,
  subtaskTotal: 0,
} as unknown as TaskCoreResponseDto;

function renderDialog(task: TaskCoreResponseDto = TASK) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TaskMoveProjectDialog task={task} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

function confirmButton(): HTMLButtonElement {
  return screen.getByTestId("move-project-submit") as HTMLButtonElement;
}

function projectSelect(): HTMLSelectElement {
  return document.querySelector("#move-project-select") as HTMLSelectElement;
}

/**
 * Chọn theo id của <Select> — nhãn "Dự án" trùng chuỗi với cả tiêu đề lẫn mô tả hộp thoại.
 *
 * PHẢI chờ <option> render xong trước khi đổi: `fireEvent.change` gán một giá trị chưa có trong
 * danh sách option là NO-OP âm thầm (select giữ giá trị cũ), và test sẽ đỏ ở một assert khác hẳn.
 * Chờ mock `listProjects` "đã được gọi" là KHÔNG đủ — gọi xong còn phải resolve rồi re-render.
 */
async function selectProject(value: string) {
  await waitFor(() =>
    expect(projectSelect().querySelector(`option[value="${value}"]`)).not.toBeNull(),
  );
  fireEvent.change(projectSelect(), { target: { value } });
  await waitFor(() => expect(projectSelect().value).toBe(value));
}

function columnSelect(): HTMLSelectElement | null {
  return document.querySelector("#move-project-state");
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: { "read:project": true, "update:task": true, "update-state:task": true },
    user: {
      id: "u1",
      email: "t@demo.local",
      fullName: "T",
      status: "Active",
      companyId: "co-1",
    },
  });
  vi.mocked(taskProjectApi.listProjects).mockResolvedValue(PROJECTS as never);
});

describe("TaskMoveProjectDialog — không đường nào đổi dự án mà thiếu cột đích", () => {
  it("(a) KHÔNG còn lựa chọn 'Không thuộc dự án' — cửa gỡ-khỏi-dự-án đã đóng", async () => {
    vi.mocked(taskStatesApi.listStates).mockResolvedValue([
      { id: "st-1", name: "Cần làm" },
    ] as never);
    renderDialog();
    await waitFor(() => expect(taskProjectApi.listProjects).toHaveBeenCalled());

    // Task ĐANG thuộc một dự án ⇒ không được có option rỗng nào để rơi về "không dự án".
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
    const options = screen.getAllByRole("option") as HTMLOptionElement[];
    const emptyProjectOption = options.filter(
      (o) => o.value === "" && /không thuộc dự án/i.test(o.textContent ?? ""),
    );
    expect(emptyProjectOption).toHaveLength(0);
  });

  it("(b) dự án đích 0 cột pipeline ⇒ CHẶN submit + giải thích, không gửi PATCH", async () => {
    vi.mocked(taskStatesApi.listStates).mockResolvedValue([] as never);
    renderDialog();
    await waitFor(() => expect(taskProjectApi.listProjects).toHaveBeenCalled());

    await selectProject("proj-moi");
    await waitFor(() => expect(taskStatesApi.listStates).toHaveBeenCalledWith("proj-moi"));

    await waitFor(() => expect(screen.getByText(/chưa có cột pipeline/i)).toBeInTheDocument());
    expect(confirmButton()).toBeDisabled();

    fireEvent.click(confirmButton());
    expect(taskCoreApi.updateTask).not.toHaveBeenCalled();
  });

  it("(c) API cột LỖI ⇒ chặn submit + báo lỗi RIÊNG, không đội lốt 'chưa có cột'", async () => {
    vi.mocked(taskStatesApi.listStates).mockRejectedValue(new Error("network"));
    renderDialog();
    await waitFor(() => expect(taskProjectApi.listProjects).toHaveBeenCalled());

    await selectProject("proj-moi");

    await waitFor(() =>
      expect(screen.getByText(/không tải được danh sách cột/i)).toBeInTheDocument(),
    );
    // Thông báo "chưa có cột pipeline" sẽ đẩy người dùng đi tạo cột cho dự án vốn đã đủ cột.
    expect(screen.queryByText(/chưa có cột pipeline/i)).not.toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();

    fireEvent.click(confirmButton());
    expect(taskCoreApi.updateTask).not.toHaveBeenCalled();
  });

  it("đường HỢP LỆ gửi projectId + stateId trong CÙNG một PATCH", async () => {
    vi.mocked(taskStatesApi.listStates).mockResolvedValue([
      { id: "st-moi", name: "Cần làm" },
    ] as never);
    vi.mocked(taskCoreApi.updateTask).mockResolvedValue({} as never);
    renderDialog();
    await waitFor(() => expect(taskProjectApi.listProjects).toHaveBeenCalled());

    await selectProject("proj-moi");
    await waitFor(() => expect(taskStatesApi.listStates).toHaveBeenCalledWith("proj-moi"));

    fireEvent.change(columnSelect() as HTMLSelectElement, {
      target: { value: "st-moi" },
    });
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(taskCoreApi.updateTask).toHaveBeenCalledWith("task-1", {
        projectId: "proj-moi",
        stateId: "st-moi",
      }),
    );
  });

  it("chưa chọn cột ⇒ nút vẫn khoá (không có nhánh nào 'cho đi tiếp')", async () => {
    vi.mocked(taskStatesApi.listStates).mockResolvedValue([
      { id: "st-moi", name: "Cần làm" },
    ] as never);
    renderDialog();
    await waitFor(() => expect(taskProjectApi.listProjects).toHaveBeenCalled());

    await selectProject("proj-moi");
    await waitFor(() => expect(columnSelect()).not.toBeNull());

    expect(confirmButton()).toBeDisabled();
    fireEvent.click(confirmButton());
    expect(taskCoreApi.updateTask).not.toHaveBeenCalled();
  });
});
