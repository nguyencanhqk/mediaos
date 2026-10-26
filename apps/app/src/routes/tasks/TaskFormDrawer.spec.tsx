import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi } from "@mediaos/web-core";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { TaskFormDrawer } from "./TaskFormDrawer";
import { editableDirtyFields, taskFormToUpdatePayload } from "./task-form-schema";

/**
 * S20-SEC-TASKPATCHGATE-1 — form Sửa việc theo cặp quyền server trả (plan §3.6, §4 FE F1–F3; M10, M11).
 *
 * Server: đổi hạn / ưu tiên / người phụ trách qua PATCH đòi cặp chuyên trách tương ứng (`update-deadline`
 * · `update-priority` · `assign`), thiếu ⇒ 403 cho CẢ request. Vì vậy form Sửa:
 *   - khoá ô của trường mà người dùng thiếu cặp (đọc `useCan`, không hard-code vai trò);
 *   - chỉ gửi trường người dùng THỰC SỰ sửa (dirty-only) — gửi đủ body thì một ô bị khoá có giá trị lệch
 *     làm hỏng cả lần lưu tiêu đề.
 * Chỉ thao tác ô văn bản (tránh race option nạp qua effect).
 */
vi.mock("@/hooks/use-dirty-form-guard", () => ({ useDirtyFormGuard: () => {} }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: { updateTask: vi.fn(), createTask: vi.fn() },
    taskProjectApi: { listProjects: vi.fn().mockResolvedValue([]) },
    hrApi: {
      listDepartments: vi.fn().mockResolvedValue([]),
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

const TASK = {
  id: "task-001",
  title: "Việc gốc",
  description: null,
  projectId: null,
  projectName: null,
  mainAssigneeEmployeeId: "emp-001",
  departmentId: null,
  priority: "High",
  startAt: null,
  dueAt: "2026-11-20T03:00:00.000Z",
} as unknown as TaskCoreResponseDto;

const BASE_CAPS = { "update:task": true, "read:employee": true };
const ALL_PAIRS = {
  ...BASE_CAPS,
  "assign:task": true,
  "update-priority:task": true,
  "update-deadline:task": true,
};

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

function renderEdit() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TaskFormDrawer mode="edit" task={TASK} onClose={() => {}} onSuccess={() => {}} />
    </QueryClientProvider>,
  );
}

const field = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`không thấy ô #${id}`);
  return el as HTMLInputElement | HTMLSelectElement;
};

async function editTitleAndSubmit(title: string): Promise<Record<string, unknown>> {
  fireEvent.change(field("task-title"), { target: { value: title } });
  const form = document.getElementById("task-core-form");
  if (!form) throw new Error("không thấy form task-core-form");
  fireEvent.submit(form);
  await waitFor(() => expect(taskCoreApi.updateTask).toHaveBeenCalledTimes(1));
  const [id, body] = vi.mocked(taskCoreApi.updateTask).mock.calls[0];
  expect(id).toBe("task-001");
  return body as Record<string, unknown>;
}

describe("TaskFormDrawer (sửa) — trường theo cặp quyền chuyên trách", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(taskCoreApi.updateTask).mockResolvedValue({ ...TASK, title: "x" } as never);
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  });

  it("F3 · đủ ba cặp ⇒ ô hạn, ưu tiên, người phụ trách đều mở", () => {
    setCapabilities(ALL_PAIRS);
    renderEdit();
    expect(field("task-due-at")).not.toBeDisabled();
    expect(field("task-priority")).not.toBeDisabled();
    expect(field("task-assignee")).not.toBeDisabled();
  });

  it("F1 · thiếu update-deadline ⇒ ô hạn khoá; hai ô còn lại mở", () => {
    setCapabilities({ ...BASE_CAPS, "assign:task": true, "update-priority:task": true });
    renderEdit();
    expect(field("task-due-at")).toBeDisabled();
    expect(field("task-priority")).not.toBeDisabled();
    expect(field("task-assignee")).not.toBeDisabled();
  });

  it("F1 · thiếu update-priority / assign ⇒ ô tương ứng khoá", () => {
    setCapabilities({ ...BASE_CAPS, "update-deadline:task": true });
    renderEdit();
    expect(field("task-priority")).toBeDisabled();
    expect(field("task-assignee")).toBeDisabled();
    expect(field("task-due-at")).not.toBeDisabled();
  });

  it("F1 · mỗi ô khoá theo ĐÚNG cặp của nó: có assign, thiếu update-priority ⇒ chỉ ô ưu tiên khoá", () => {
    setCapabilities({ ...BASE_CAPS, "assign:task": true, "update-deadline:task": true });
    renderEdit();
    expect(field("task-priority")).toBeDisabled();
    expect(field("task-assignee")).not.toBeDisabled();
    expect(field("task-due-at")).not.toBeDisabled();
  });

  it("F1 · mỗi ô khoá theo ĐÚNG cặp của nó: có update-priority, thiếu assign ⇒ chỉ ô người phụ trách khoá", () => {
    setCapabilities({ ...BASE_CAPS, "update-priority:task": true, "update-deadline:task": true });
    renderEdit();
    expect(field("task-assignee")).toBeDisabled();
    expect(field("task-priority")).not.toBeDisabled();
    expect(field("task-due-at")).not.toBeDisabled();
  });

  it("F2a · đủ cặp, chỉ sửa tiêu đề ⇒ body đúng bằng {title}", async () => {
    setCapabilities(ALL_PAIRS);
    renderEdit();
    const body = await editTitleAndSubmit("Việc đã sửa");
    expect(body).toEqual({ title: "Việc đã sửa" });
  });

  it("F2b · thiếu cả ba cặp, chỉ sửa tiêu đề ⇒ body không có khoá của ba trường", async () => {
    setCapabilities(BASE_CAPS);
    renderEdit();
    const body = await editTitleAndSubmit("Việc đã sửa");
    expect(body).toHaveProperty("title", "Việc đã sửa");
    expect(body).not.toHaveProperty("dueAt");
    expect(body).not.toHaveProperty("priority");
    expect(body).not.toHaveProperty("assigneeEmployeeId");
  });
});

// S20-TASK-QUICKEDIT-1 — popover mốc nhanh dùng chung cạnh ô hạn: chọn mốc chỉ ĐIỀN ô (lưu theo nút Lưu).
describe("TaskFormDrawer — mốc hạn nhanh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(taskCoreApi.updateTask).mockResolvedValue({ ...TASK, title: "x" } as never);
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  });

  it("thiếu update-deadline ⇒ không có «Chọn nhanh» (ô hạn khoá)", () => {
    setCapabilities(BASE_CAPS);
    renderEdit();
    expect(screen.queryByTestId("task-due-at-quick")).not.toBeInTheDocument();
  });

  it("«Ngày mai» điền ô hạn và gửi cùng lần Lưu; chưa bấm Lưu thì không gọi API", async () => {
    setCapabilities(ALL_PAIRS);
    renderEdit();
    fireEvent.click(screen.getByTestId("task-due-at-quick"));
    fireEvent.click(screen.getByTestId("task-due-at-quick-preset-tomorrow"));
    expect(taskCoreApi.updateTask).not.toHaveBeenCalled();
    expect((field("task-due-at") as HTMLInputElement).value).toMatch(/T[0-9]{2}:00$/);

    const form = document.getElementById("task-core-form");
    if (!form) throw new Error("không thấy form task-core-form");
    fireEvent.submit(form);
    await waitFor(() => expect(taskCoreApi.updateTask).toHaveBeenCalledTimes(1));
    const body = vi.mocked(taskCoreApi.updateTask).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(String(body.dueAt)).toMatch(/T10:00:00[.]000Z$/); // 17:00 giờ công ty
  });
});

describe("payload sửa — trường bị khoá không vào body dù đã dirty", () => {
  it("F4 · ô khoá bị đánh dấu dirty (đường lập trình) ⇒ payload không có khoá của ô đó", () => {
    const values = {
      title: "Việc đã sửa",
      description: "",
      projectId: "",
      assigneeEmployeeId: "emp-002",
      departmentId: "",
      priority: "Urgent",
      startAt: "",
      dueAt: "2026-12-05T09:30",
    };
    const dirty = { title: true, assigneeEmployeeId: true, priority: true, dueAt: true };
    const locked = { assigneeEmployeeId: true, priority: true, dueAt: true };
    const body = taskFormToUpdatePayload(values as never, editableDirtyFields(dirty, locked));
    expect(body).toEqual({ title: "Việc đã sửa" });
  });

  it("F4 · cùng ô đó KHÔNG khoá ⇒ vào payload (ca đứng cạnh)", () => {
    const values = {
      title: "Việc gốc",
      description: "",
      projectId: "",
      assigneeEmployeeId: "emp-002",
      departmentId: "",
      priority: "Urgent",
      startAt: "",
      dueAt: "",
    };
    const body = taskFormToUpdatePayload(
      values as never,
      editableDirtyFields({ priority: true, assigneeEmployeeId: true }, {}),
    );
    expect(body).toEqual({ priority: "Urgent", assigneeEmployeeId: "emp-002" });
  });
});
