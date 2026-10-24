import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi } from "@mediaos/web-core";
import type { SubtaskListItemDto } from "@mediaos/contracts";
import { EditSubtaskDialog } from "./TaskSubtaskDialogs";

/**
 * S20-SEC-TASKPATCHGATE-1 — hộp thoại Sửa việc con theo cặp quyền chuyên trách (plan §3.6, §4 FE).
 *
 * Hộp thoại đi `PATCH /tasks/:id` với người phụ trách + hạn. Server đòi `assign:task` /
 * `update-deadline:task` khi hai trường đó ĐỔI, thiếu ⇒ 403 cả request. Hộp thoại khoá ô theo `useCan`
 * và chỉ gửi trường người dùng sửa (dirty-only). Chỉ thao tác ô văn bản.
 */
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: { updateTask: vi.fn() },
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

const ITEM = {
  id: "sub-001",
  title: "Kịch bản",
  status: "Todo",
  priority: "Medium",
  mainAssigneeEmployeeId: "emp-001",
  assigneeName: "Nguyễn Văn A",
  dueAt: "2026-11-20T03:00:00.000Z",
  isOverdue: false,
  sortOrder: 0,
  canOpen: true,
} as unknown as SubtaskListItemDto;

const BASE_CAPS = { "update:task": true, "read:employee": true };

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

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EditSubtaskDialog
        parentTaskId="task-parent"
        projectId="proj-001"
        item={ITEM}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

const field = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`không thấy ô #${id}`);
  return el as HTMLInputElement | HTMLSelectElement;
};

async function editTitleAndSubmit(title: string): Promise<Record<string, unknown>> {
  fireEvent.change(field("subtask-edit-title"), { target: { value: title } });
  const form = document.getElementById("subtask-edit-form");
  if (!form) throw new Error("không thấy form subtask-edit-form");
  fireEvent.submit(form);
  await waitFor(() => expect(taskCoreApi.updateTask).toHaveBeenCalledTimes(1));
  const [id, body] = vi.mocked(taskCoreApi.updateTask).mock.calls[0];
  expect(id).toBe("sub-001");
  return body as Record<string, unknown>;
}

describe("EditSubtaskDialog — trường theo cặp quyền chuyên trách", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(taskCoreApi.updateTask).mockResolvedValue({ id: "sub-001" } as never);
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  });

  it("đủ cặp ⇒ ô người phụ trách và ô hạn đều mở", () => {
    setCapabilities({ ...BASE_CAPS, "assign:task": true, "update-deadline:task": true });
    renderDialog();
    expect(field("subtask-edit-assignee")).not.toBeDisabled();
    expect(field("subtask-edit-due")).not.toBeDisabled();
  });

  it("thiếu assign ⇒ ô người phụ trách khoá; thiếu update-deadline ⇒ ô hạn khoá", () => {
    setCapabilities(BASE_CAPS);
    renderDialog();
    expect(field("subtask-edit-assignee")).toBeDisabled();
    expect(field("subtask-edit-due")).toBeDisabled();
  });

  it("đủ cặp, chỉ sửa tiêu đề ⇒ body đúng bằng {title}", async () => {
    setCapabilities({ ...BASE_CAPS, "assign:task": true, "update-deadline:task": true });
    renderDialog();
    expect(await editTitleAndSubmit("Kịch bản v2")).toEqual({ title: "Kịch bản v2" });
  });

  it("thiếu cả hai cặp, chỉ sửa tiêu đề ⇒ body không có khoá người phụ trách / hạn", async () => {
    setCapabilities(BASE_CAPS);
    renderDialog();
    const body = await editTitleAndSubmit("Kịch bản v2");
    expect(body).toHaveProperty("title", "Kịch bản v2");
    expect(body).not.toHaveProperty("assigneeEmployeeId");
    expect(body).not.toHaveProperty("dueAt");
  });
});
