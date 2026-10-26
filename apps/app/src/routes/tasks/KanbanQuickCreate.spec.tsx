import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi, ApiError } from "@mediaos/web-core";
import { KanbanQuickCreate } from "./KanbanQuickCreate";

/**
 * S5-TASK-BOARD-UX-1 — tạo nhanh đáy cột pipeline.
 *
 * Trọng tâm test là HAI thứ dễ hỏng âm thầm:
 *   1. GATE ĐÔI: server đòi CẢ `create:task` lẫn `update-state:task` khi có `stateId` tường minh
 *      (task-core.service.ts §3c). Chỉ gate `create:task` ở FE ⇒ nút hiện ra rồi bấm là 403.
 *   2. Payload phải mang ĐÚNG `stateId` của cột được bấm — sai chỗ này thì việc vẫn tạo được nhưng
 *      rơi vào cột mặc định, người dùng nhìn tưởng "board không cập nhật".
 */
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: {
      createTask: vi.fn(),
    },
    // S20-TASK-QUICKADD-1 — chip «Người»: danh sách nhân viên (read:employee) + thành viên dự án.
    hrApi: {
      listEmployees: vi.fn().mockResolvedValue({
        items: [
          { id: "emp-a", fullName: "Nguyễn Văn A", avatarUrl: null },
          { id: "emp-b", fullName: "Trần Thị B", avatarUrl: null },
        ],
        meta: {},
      }),
    },
    taskProjectApi: { listMembers: vi.fn().mockResolvedValue([]) },
  };
});

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient();
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

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

const BOTH_PAIRS = { "create:task": true, "update-state:task": true };

function renderQuickCreate() {
  return renderWithQuery(<KanbanQuickCreate projectId="proj-001" stateId="state-quay" />);
}

/** Mở ô nhập (bấm nút "+ Thêm công việc") và trả về chính ô input. */
function openInput(): HTMLInputElement {
  fireEvent.click(screen.getByTestId("kanban-quick-create-open-state-quay"));
  return screen.getByTestId("kanban-quick-create-input-state-quay") as HTMLInputElement;
}

describe("KanbanQuickCreate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  });

  // ── DENY-PATH (RED trước) ──────────────────────────────────────────────────
  it("ẨN hoàn toàn khi không có quyền nào", () => {
    setCapabilities({});
    renderQuickCreate();
    expect(screen.queryByTestId("kanban-quick-create-open-state-quay")).not.toBeInTheDocument();
  });

  it("ẨN khi có create:task nhưng THIẾU update-state:task — server sẽ 403 vì có stateId tường minh", () => {
    setCapabilities({ "create:task": true });
    renderQuickCreate();
    expect(screen.queryByTestId("kanban-quick-create-open-state-quay")).not.toBeInTheDocument();
  });

  it("ẨN khi có update-state:task nhưng THIẾU create:task", () => {
    setCapabilities({ "update-state:task": true });
    renderQuickCreate();
    expect(screen.queryByTestId("kanban-quick-create-open-state-quay")).not.toBeInTheDocument();
  });

  // ── ALLOW-PATH ─────────────────────────────────────────────────────────────
  it("hiện nút khi có ĐỦ cả hai cặp quyền", () => {
    setCapabilities(BOTH_PAIRS);
    renderQuickCreate();
    expect(screen.getByTestId("kanban-quick-create-open-state-quay")).toBeInTheDocument();
  });

  it("bấm nút mở ô nhập, Enter tạo task với ĐÚNG projectId + stateId của cột", async () => {
    setCapabilities(BOTH_PAIRS);
    vi.mocked(taskCoreApi.createTask).mockResolvedValue({ id: "task-new" } as never);
    renderQuickCreate();

    const input = openInput();
    fireEvent.change(input, { target: { value: "  Dựng cảnh mở đầu  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalledTimes(1));
    // Tiêu đề đã trim; KHÔNG gửi status (server tự suy từ nhóm cột — chống desync-lúc-sinh).
    expect(taskCoreApi.createTask).toHaveBeenCalledWith({
      title: "Dựng cảnh mở đầu",
      projectId: "proj-001",
      stateId: "state-quay",
    });
  });

  it("ô nhập tự xoá và VẪN MỞ sau khi tạo — gõ tiếp việc kế không phải bấm lại", async () => {
    setCapabilities(BOTH_PAIRS);
    vi.mocked(taskCoreApi.createTask).mockResolvedValue({ id: "task-new" } as never);
    renderQuickCreate();

    const input = openInput();
    fireEvent.change(input, { target: { value: "Việc 1" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("kanban-quick-create-input-state-quay")).toHaveValue("");

    fireEvent.change(input, { target: { value: "Việc 2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalledTimes(2));
  });

  it("làm mới CẢ board kanban sau khi tạo — thiếu vế này thẻ mới đứng ngoài board tới 15s", async () => {
    setCapabilities(BOTH_PAIRS);
    vi.mocked(taskCoreApi.createTask).mockResolvedValue({ id: "task-new" } as never);
    const { client } = renderQuickCreate();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const input = openInput();
    fireEvent.change(input, { target: { value: "Việc mới" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["tasks", "kanban", "proj-001"],
      }),
    );
  });

  // ── Không gọi API vô ích ───────────────────────────────────────────────────
  it("Enter khi ô trống (hoặc chỉ khoảng trắng) KHÔNG gọi API", () => {
    setCapabilities(BOTH_PAIRS);
    renderQuickCreate();

    const input = openInput();
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(taskCoreApi.createTask).not.toHaveBeenCalled();
  });

  it("Esc đóng ô nhập, không tạo gì", () => {
    setCapabilities(BOTH_PAIRS);
    renderQuickCreate();

    const input = openInput();
    fireEvent.change(input, { target: { value: "Bỏ dở" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByTestId("kanban-quick-create-input-state-quay")).not.toBeInTheDocument();
    expect(screen.getByTestId("kanban-quick-create-open-state-quay")).toBeInTheDocument();
    expect(taskCoreApi.createTask).not.toHaveBeenCalled();
  });

  it("rời ô khi CÒN chữ thì GIỮ nội dung — không nuốt mất phần đang soạn dở", () => {
    setCapabilities(BOTH_PAIRS);
    renderQuickCreate();

    const input = openInput();
    fireEvent.change(input, { target: { value: "Đang soạn dở" } });
    fireEvent.blur(input);

    expect(screen.getByTestId("kanban-quick-create-input-state-quay")).toHaveValue("Đang soạn dở");
  });

  it("rời ô khi TRỐNG thì tự thu lại", () => {
    setCapabilities(BOTH_PAIRS);
    renderQuickCreate();

    const input = openInput();
    fireEvent.blur(input);

    expect(screen.queryByTestId("kanban-quick-create-input-state-quay")).not.toBeInTheDocument();
  });

  // ── Lỗi từ server ──────────────────────────────────────────────────────────
  it("403 từ server hiện thông báo thiếu quyền", async () => {
    setCapabilities(BOTH_PAIRS);
    vi.mocked(taskCoreApi.createTask).mockRejectedValue(
      new ApiError(403, "TASK-ERR-403", "forbidden"),
    );
    renderQuickCreate();

    const input = openInput();
    fireEvent.change(input, { target: { value: "Việc bị chặn" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/không có quyền/i));
  });

  it("lỗi mạng chung hiện thông báo thử lại", async () => {
    setCapabilities(BOTH_PAIRS);
    vi.mocked(taskCoreApi.createTask).mockRejectedValue(new Error("boom"));
    renderQuickCreate();

    const input = openInput();
    fireEvent.change(input, { target: { value: "Việc lỗi" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/thử lại/i));
  });
});

// ── S20-TASK-QUICKADD-1 — chip «Người» + «Hạn» giữ qua các lần Enter ──────────────────────────────
describe("KanbanQuickCreate — chip Người / Hạn «dính»", () => {
  const ASSIGN_CAPS = { ...BOTH_PAIRS, "assign:task": true, "read:employee": true };

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.mocked(taskCoreApi.createTask).mockResolvedValue({ id: "task-new" } as never);
  });

  async function pickAssignee(name: string) {
    fireEvent.click(screen.getByTestId("kanban-quick-create-state-quay-assignee"));
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(name) }));
  }

  it("không có assign:task ⇒ KHÔNG có chip Người; việc vẫn tạo được (chưa giao)", async () => {
    setCapabilities(BOTH_PAIRS);
    renderQuickCreate();
    const input = openInput();
    expect(screen.queryByTestId("kanban-quick-create-state-quay-assignee")).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Việc chưa giao" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalledTimes(1));
    expect(vi.mocked(taskCoreApi.createTask).mock.calls[0]?.[0]).not.toHaveProperty(
      "assigneeEmployeeId",
    );
  });

  it("chip Hạn chỉ hiện khi có update-deadline:task", () => {
    setCapabilities(ASSIGN_CAPS);
    renderQuickCreate();
    openInput();
    expect(screen.queryByTestId("kanban-quick-create-state-quay-due")).not.toBeInTheDocument();
  });

  it("chọn Người = A + Hạn, gõ 2 tiêu đề ⇒ cả 2 việc mang A và cùng hạn", async () => {
    setCapabilities({ ...ASSIGN_CAPS, "update-deadline:task": true });
    renderQuickCreate();
    const input = openInput();
    await pickAssignee("Nguyễn Văn A");
    fireEvent.click(screen.getByTestId("kanban-quick-create-state-quay-due"));
    fireEvent.click(screen.getByTestId("kanban-quick-create-state-quay-due-preset-tomorrow"));

    for (const title of ["Việc 1", "Việc 2"]) {
      fireEvent.change(input, { target: { value: title } });
      fireEvent.keyDown(input, { key: "Enter" });
    }
    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalledTimes(2));
    const bodies = vi.mocked(taskCoreApi.createTask).mock.calls.map((c) => c[0]);
    for (const body of bodies) {
      expect(body).toMatchObject({
        projectId: "proj-001",
        stateId: "state-quay",
        assigneeEmployeeId: "emp-a",
      });
      expect(body.dueAt).toMatch(/T10:00:00[.]000Z$/);
    }
  });

  it("Esc đóng ô VÀ xoá chip — mở lại thì việc kế không còn người cũ", async () => {
    setCapabilities(ASSIGN_CAPS);
    renderQuickCreate();
    const input = openInput();
    await pickAssignee("Nguyễn Văn A");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("kanban-quick-create-input-state-quay")).not.toBeInTheDocument();

    const reopened = openInput();
    fireEvent.change(reopened, { target: { value: "Việc sau Esc" } });
    fireEvent.keyDown(reopened, { key: "Enter" });
    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalledTimes(1));
    expect(vi.mocked(taskCoreApi.createTask).mock.calls[0]?.[0]).not.toHaveProperty(
      "assigneeEmployeeId",
    );
  });

  it("người ngoài phạm vi (server 400 không phải thành viên) ⇒ dòng lỗi, tiêu đề trả lại vào ô", async () => {
    setCapabilities(ASSIGN_CAPS);
    vi.mocked(taskCoreApi.createTask).mockRejectedValue(
      new ApiError(
        400,
        "BAD_REQUEST",
        "TASK-ERR-ASSIGNEE-INVALID: người thực hiện không phải thành viên đang hoạt động của dự án.",
      ),
    );
    renderQuickCreate();
    const input = openInput();
    await pickAssignee("Trần Thị B");
    fireEvent.change(input, { target: { value: "Việc cho B" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Không giao được cho người này"),
    );
    expect(input).toHaveValue("Việc cho B");
  });

  it("bấm chip khi ô còn trống ⇒ lần rời ô kèm theo KHÔNG thu ô lại (Safari: relatedTarget rỗng)", () => {
    setCapabilities({ ...ASSIGN_CAPS, "update-deadline:task": true });
    renderQuickCreate();
    const input = openInput();
    fireEvent.pointerDown(screen.getByTestId("kanban-quick-create-state-quay-due"));
    fireEvent.blur(input, { relatedTarget: null });
    expect(screen.getByTestId("kanban-quick-create-input-state-quay")).toBeInTheDocument();

    // Bấm ra NGOÀI (không qua chip) ⇒ thu lại như cũ.
    fireEvent.focus(input);
    fireEvent.blur(input, { relatedTarget: null });
    expect(screen.queryByTestId("kanban-quick-create-input-state-quay")).not.toBeInTheDocument();
  });

  it("thành viên dự án đứng ĐẦU danh sách của chip Người", async () => {
    setCapabilities({ ...ASSIGN_CAPS, "read:project": true });
    const { taskProjectApi } = await import("@mediaos/web-core");
    vi.mocked(taskProjectApi.listMembers).mockResolvedValue([
      {
        id: "m-1",
        projectId: "proj-001",
        employeeId: "emp-b",
        employeeName: "Trần Thị B",
        employeeCode: null,
        departmentName: null,
        projectRole: "Member",
        status: "Active",
        joinedAt: null,
        removedAt: null,
      },
    ]);
    renderQuickCreate();
    openInput();
    fireEvent.click(screen.getByTestId("kanban-quick-create-state-quay-assignee"));
    await screen.findByRole("button", { name: /Nguyễn Văn A/ });
    await waitFor(() => expect(taskProjectApi.listMembers).toHaveBeenCalledWith("proj-001"));
    await waitFor(() => {
      const names = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(names[0]).toContain("Trần Thị B");
      expect(names).toHaveLength(2); // B không bị lặp ở nhóm «mọi nhân viên»
    });
  });
});
