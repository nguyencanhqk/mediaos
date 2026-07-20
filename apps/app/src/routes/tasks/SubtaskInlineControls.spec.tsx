import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi, hrApi } from "@mediaos/web-core";
import type { SubtaskListItemDto } from "@mediaos/contracts";
import { SubtaskAssigneeControl, SubtaskDueControl } from "./SubtaskInlineControls";

/**
 * S5-TASK-INLINE-1 — sửa người thực hiện + hạn NGAY trên dòng việc con.
 *
 * Điểm khoá quan trọng: `canEdit` phải bao gồm `item.canOpen` (D-39 — ĐỌC thừa hưởng từ cha nhưng
 * GHI thì KHÔNG). Con nằm ngoài phạm vi đọc riêng của actor mà vẫn cho bấm sửa thì mỗi lần bấm là
 * một 403 — đúng loại "nút mời gọi rồi từ chối" mà UI-02 §5.3 cấm.
 */
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: {
      updateTask: vi.fn(),
      assign: vi.fn(),
    },
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

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
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

const ITEM = {
  id: "sub-001",
  title: "Kịch bản",
  status: "Todo",
  priority: "Medium",
  mainAssigneeEmployeeId: "emp-001",
  assigneeName: "Nguyễn Văn A",
  dueAt: null,
  isOverdue: false,
  sortOrder: 0,
  canOpen: true,
} as unknown as SubtaskListItemDto;

const PROPS = { item: ITEM, parentTaskId: "task-parent", projectId: "proj-001", canEdit: true };

describe("SubtaskAssigneeControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  });

  it("bấm avatar mở danh sách chọn người", async () => {
    setCapabilities({ "read:employee": true });
    renderWithQuery(<SubtaskAssigneeControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-assignee-trigger-sub-001"));
    await waitFor(() => expect(screen.getByText("Trần Thị B")).toBeInTheDocument());
  });

  it("chọn người ⇒ PATCH việc con với assigneeEmployeeId", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(taskCoreApi.updateTask).mockResolvedValue({ id: "sub-001" } as never);
    renderWithQuery(<SubtaskAssigneeControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-assignee-trigger-sub-001"));
    await waitFor(() => expect(screen.getByText("Trần Thị B")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Trần Thị B"));

    await waitFor(() =>
      expect(taskCoreApi.updateTask).toHaveBeenCalledWith("sub-001", {
        assigneeEmployeeId: "emp-002",
      }),
    );
  });

  it("đi PATCH chứ KHÔNG đi route assign — nhân viên thường có update:task@Own nhưng không có assign:task", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(taskCoreApi.updateTask).mockResolvedValue({ id: "sub-001" } as never);
    renderWithQuery(<SubtaskAssigneeControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-assignee-trigger-sub-001"));
    await waitFor(() => expect(screen.getByText("Trần Thị B")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Trần Thị B"));

    await waitFor(() => expect(taskCoreApi.updateTask).toHaveBeenCalled());
    expect(taskCoreApi.assign).not.toHaveBeenCalled();
  });

  it("gỡ được người thực hiện (PATCH nhận null — khác route assign đòi uuid)", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(taskCoreApi.updateTask).mockResolvedValue({ id: "sub-001" } as never);
    renderWithQuery(<SubtaskAssigneeControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-assignee-trigger-sub-001"));
    await waitFor(() => expect(screen.getByText(/bỏ người thực hiện/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/bỏ người thực hiện/i));

    await waitFor(() =>
      expect(taskCoreApi.updateTask).toHaveBeenCalledWith("sub-001", { assigneeEmployeeId: null }),
    );
  });

  it("chọn LẠI đúng người đang giữ ⇒ không gọi API", async () => {
    setCapabilities({ "read:employee": true });
    renderWithQuery(<SubtaskAssigneeControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-assignee-trigger-sub-001"));
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Nguyễn Văn A"));

    expect(taskCoreApi.updateTask).not.toHaveBeenCalled();
  });

  it("lọc theo ô tìm kiếm", async () => {
    setCapabilities({ "read:employee": true });
    renderWithQuery(<SubtaskAssigneeControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-assignee-trigger-sub-001"));
    await waitFor(() => expect(screen.getByText("Trần Thị B")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("subtask-assignee-search-sub-001"), {
      target: { value: "Trần" },
    });

    expect(screen.getByText("Trần Thị B")).toBeInTheDocument();
    expect(screen.queryByText("Nguyễn Văn A")).not.toBeInTheDocument();
  });

  it("canEdit=false ⇒ avatar không bấm được, không mở picker", () => {
    setCapabilities({ "read:employee": true });
    renderWithQuery(<SubtaskAssigneeControl {...PROPS} canEdit={false} />);

    const trigger = screen.getByTestId("subtask-assignee-trigger-sub-001");
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByTestId("subtask-assignee-search-sub-001")).not.toBeInTheDocument();
  });

  it("thiếu read:employee ⇒ mở picker vẫn được nhưng báo thiếu quyền, không gọi API", async () => {
    setCapabilities({});
    renderWithQuery(<SubtaskAssigneeControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-assignee-trigger-sub-001"));
    await waitFor(() => expect(screen.getByText(/quyền/i)).toBeInTheDocument());
    expect(hrApi.listEmployees).not.toHaveBeenCalled();
  });
});

describe("SubtaskDueControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  });

  it("bấm ngày mở ô nhập, Enter là lưu", async () => {
    setCapabilities({});
    vi.mocked(taskCoreApi.updateTask).mockResolvedValue({ id: "sub-001" } as never);
    renderWithQuery(<SubtaskDueControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-due-trigger-sub-001"));
    const input = screen.getByTestId("subtask-due-input-sub-001");
    fireEvent.change(input, { target: { value: "2026-08-01T09:00" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(taskCoreApi.updateTask).toHaveBeenCalledTimes(1));
    expect(vi.mocked(taskCoreApi.updateTask).mock.calls[0][0]).toBe("sub-001");
    expect(vi.mocked(taskCoreApi.updateTask).mock.calls[0][1]).toHaveProperty("dueAt");
  });

  it("rời ô cũng lưu", async () => {
    setCapabilities({});
    vi.mocked(taskCoreApi.updateTask).mockResolvedValue({ id: "sub-001" } as never);
    renderWithQuery(<SubtaskDueControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-due-trigger-sub-001"));
    const input = screen.getByTestId("subtask-due-input-sub-001");
    fireEvent.change(input, { target: { value: "2026-08-01T09:00" } });
    fireEvent.blur(input);

    await waitFor(() => expect(taskCoreApi.updateTask).toHaveBeenCalledTimes(1));
  });

  it("Esc huỷ, KHÔNG lưu", () => {
    setCapabilities({});
    renderWithQuery(<SubtaskDueControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-due-trigger-sub-001"));
    const input = screen.getByTestId("subtask-due-input-sub-001");
    fireEvent.change(input, { target: { value: "2026-08-01T09:00" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByTestId("subtask-due-input-sub-001")).not.toBeInTheDocument();
    expect(taskCoreApi.updateTask).not.toHaveBeenCalled();
  });

  it("không đổi gì rồi rời ô ⇒ không gọi API", () => {
    setCapabilities({});
    renderWithQuery(<SubtaskDueControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-due-trigger-sub-001"));
    fireEvent.blur(screen.getByTestId("subtask-due-input-sub-001"));
    expect(taskCoreApi.updateTask).not.toHaveBeenCalled();
  });

  it("canEdit=false ⇒ chỉ là chữ, không bấm được", () => {
    setCapabilities({});
    renderWithQuery(<SubtaskDueControl {...PROPS} canEdit={false} />);
    expect(screen.queryByTestId("subtask-due-trigger-sub-001")).not.toBeInTheDocument();
  });
});
